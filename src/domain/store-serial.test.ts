/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, createInitialState } from "./index.ts";
import type { CommandResult, DomainCommand, DomainState, FailureCode } from "./index.ts";

const NOW = "2026-09-12T12:00:00+08:00";
let uuidSeq = 0;
let commandSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "serial-uuid-" + uuidSeq;
}

function draftCommand(raw: string): DomainCommand {
  commandSeq += 1;
  return {
    type: "saveCaptureDraft",
    commandId: "serial-cmd-" + commandSeq,
    entityId: null,
    expectedRevision: null,
    actor: "user",
    issuedAt: NOW,
    channel: "text",
    raw,
  };
}

function asOk<C extends DomainCommand>(result: CommandResult<C>): CommandResult<C> & { ok: true } {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result;
}

function asFailure(result: CommandResult<DomainCommand>): { code: FailureCode; reason: string; retryable: boolean } {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

function tick(times = 5): Promise<void> {
  return new Promise((resolve) => {
    let remaining = times;
    const step = () => (remaining-- <= 0 ? resolve() : setTimeout(step, 0));
    step();
  });
}

test("two concurrent commands serialize handler->commit->publish and retain both effects", async () => {
  const initial = createInitialState("fixture");
  const initialRevision = initial.globalRevision;
  const commitExpected: number[] = [];
  let releaseFirstCommit: (() => void) | null = null;
  const firstCommitGate = new Promise<void>((resolve) => {
    releaseFirstCommit = resolve;
  });
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: testUuid,
    commit: async (expectedGlobalRevision) => {
      commitExpected.push(expectedGlobalRevision);
      if (commitExpected.length === 1) await firstCommitGate;
      return { ok: true };
    },
  });
  const published: DomainState[] = [];
  store.subscribe((s) => published.push(s));

  const first = store.execute(draftCommand("first"));
  const second = store.execute(draftCommand("second"));
  await tick();
  releaseFirstCommit!();
  const results = await Promise.all([first, second]);

  asOk(results[0]!);
  asOk(results[1]!);
  const state = store.getState();
  const raws = Object.values(state.captureDrafts).map((draft) => draft.raw).sort();
  assert.deepEqual(raws, ["first", "second"], "both concurrent commands must retain their effects");
  assert.equal(state.globalRevision, initialRevision + 2, "revision must advance once per committed command");
  assert.deepEqual(commitExpected, [initialRevision, initialRevision + 1], "second commit must observe the first publication");
  assert.equal(published.length, 2);
});

test("external adoption during pending commit fails closed and never overwrites newer state", async () => {
  const initial = createInitialState("fixture");
  const adoptedState: DomainState = { ...initial, globalRevision: initial.globalRevision + 5 };
  const commitExpected: number[] = [];
  let releaseCommit: (() => void) | null = null;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: testUuid,
    commit: async (expectedGlobalRevision) => {
      commitExpected.push(expectedGlobalRevision);
      await commitGate;
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const pending = store.execute(draftCommand("ghost"));
  await tick();
  store.adoptExternalState(adoptedState);
  assert.equal(store.getState(), adoptedState);
  releaseCommit!();
  const result = await pending;

  const failure = asFailure(result);
  assert.equal(failure.code, "REVISION_CONFLICT");
  assert.equal(store.getState(), adoptedState, "stale candidate must not overwrite adopted newer state");
  assert.deepEqual(commitExpected, [initial.globalRevision], "commit must receive the captured pre-handler revision");
  assert.equal(notifications, 1, "only the adoption may notify");
});

test("rejected commit resolves as typed failure, preserves state identity, notifies zero subscribers", async () => {
  const store = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    commit: async () => ({ ok: false, code: "STORAGE_WRITE_FAILED", reason: "quota exceeded", retryable: true }),
  });
  const before = store.getState();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const result = await store.execute(draftCommand("rejected"));
  const failure = asFailure(result);
  assert.equal(failure.code, "STORAGE_WRITE_FAILED");
  assert.equal(failure.reason, "quota exceeded");
  assert.equal(store.getState(), before, "rejected writes must not mutate or republish state");
  assert.equal(notifications, 0);
});

test("throwing commit resolves as typed failure instead of rejecting execute", async () => {
  const store = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    commit: async () => {
      throw new Error("storage exploded");
    },
  });
  const before = store.getState();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const result = await store.execute(draftCommand("throws"));
  const failure = asFailure(result);
  assert.equal(failure.code, "STORAGE_WRITE_FAILED");
  assert.match(failure.reason, /storage exploded/);
  assert.equal(store.getState(), before);
  assert.equal(notifications, 0);
});

test("a failed queued command does not poison the next command", async () => {
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    commit: async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        return { ok: false, code: "STORAGE_WRITE_FAILED", reason: "first write fails", retryable: true };
      }
      return { ok: true };
    },
  });
  const initialRevision = store.getState().globalRevision;

  const failed = store.execute(draftCommand("failed"));
  const recovered = store.execute(draftCommand("recovered"));
  const failedResult = await failed;
  const recoveredResult = await recovered;

  assert.equal(asFailure(failedResult).code, "STORAGE_WRITE_FAILED");
  asOk(recoveredResult);
  const state = store.getState();
  const raws = Object.values(state.captureDrafts).map((draft) => draft.raw);
  assert.deepEqual(raws, ["recovered"]);
  assert.equal(state.globalRevision, initialRevision + 1);
});
