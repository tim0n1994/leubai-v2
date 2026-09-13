/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, createInitialState } from "./index.ts";
import type {
  CaptureDraft,
  CommandFailure,
  CommandResult,
  DomainCommand,
  DomainState,
  SaveCaptureDraftCommand,
} from "./index.ts";

const NOW = "2026-09-12T12:00:00+08:00";

// saveCaptureDraft consumes exactly two uuid values per handler run:
// the first is the draft id, the second is the domain event id.
function makeUuidCounter(prefix: string) {
  let n = 0;
  return {
    uuid: () => {
      n += 1;
      return prefix + n;
    },
    count: () => n,
  };
}

function draftCommand(commandId: string, raw: string): DomainCommand {
  return {
    type: "saveCaptureDraft",
    commandId,
    entityId: null,
    expectedRevision: null,
    actor: "user",
    issuedAt: NOW,
    channel: "text",
    raw,
  };
}

function parsedDraftCommand(commandId: string, raw: string): SaveCaptureDraftCommand {
  return {
    type: "saveCaptureDraft",
    commandId,
    entityId: null,
    expectedRevision: null,
    actor: "user",
    issuedAt: NOW,
    channel: "text",
    raw,
    parsedFields: { topic: "original-topic" },
  };
}

function foreignDraft(id: string, raw: string): CaptureDraft {
  return {
    id,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    dataMode: "fixture",
    provenance: { origin: "user" },
    channel: "text",
    raw,
    parsedFields: { date: null, startTime: null, endTime: null, timezone: null, topic: null },
    ambiguityNote: null,
    status: "open",
  };
}

function asOk<C extends DomainCommand>(result: CommandResult<C>): CommandResult<C> & { ok: true } {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result;
}

function asFailure(result: CommandResult<DomainCommand>): CommandFailure {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

function draftRaws(state: DomainState): string[] {
  return Object.values(state.captureDrafts).map((draft) => draft.raw).sort();
}

function tick(times = 5): Promise<void> {
  return new Promise((resolve) => {
    let remaining = times;
    const step = () => (remaining-- <= 0 ? resolve() : setTimeout(step, 0));
    step();
  });
}

test("postwrite-unverified commit retains the exact candidate; same-command retry commits the original nextState and publishes the original result once", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("replay-");
  const commitCalls: Array<{ expected: number; next: DomainState }> = [];
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async (expected, next) => {
      commitCalls.push({ expected, next });
      if (commitCalls.length === 1) {
        return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "postwrite readback unavailable", retryable: true };
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const stateBefore = store.getState();
  const command = draftCommand("replay-cmd-1", "retry-me");

  const first = await store.execute(command);
  const firstFailure = asFailure(first);
  assert.equal(firstFailure.code, "STORAGE_READBACK_UNVERIFIED");
  assert.equal(firstFailure.retryable, true);
  assert.equal(ids.count(), 2, "exactly one handler run for the first attempt");
  assert.equal(store.getState(), stateBefore, "unverified failure must not mutate memory");
  assert.equal(notifications, 0, "nothing may be published before verification");
  assert.equal(commitCalls.length, 1);
  assert.equal(commitCalls[0]!.expected, baseRevision, "first attempt commits at the captured base revision");

  const retry = await store.execute({ ...command });
  const retryOk = asOk(retry);
  const retryData = retryOk.data as { captureDraft: CaptureDraft };
  assert.equal(retryData.captureDraft.id, "replay-1", "retry must publish the original candidate id");
  assert.equal(ids.count(), 2, "retry must never rerun the handler");
  assert.equal(commitCalls.length, 2);
  assert.equal(commitCalls[1]!.expected, baseRevision, "retry must commit at the original base revision");
  assert.equal(commitCalls[1]!.next, commitCalls[0]!.next, "retry must re-send the exact retained candidate object");
  assert.equal(notifications, 1, "original result publishes exactly once, after verification");
  assert.equal(store.getState().globalRevision, baseRevision + 1);
  assert.deepEqual(draftRaws(store.getState()), ["retry-me"]);
});

test("different payload under the same commandId is rejected while a write candidate is pending", async () => {
  const initial = createInitialState("fixture");
  const ids = makeUuidCounter("pending-");
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "readback unavailable", retryable: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const stateBefore = store.getState();
  const command = draftCommand("pending-cmd-1", "original");

  const first = await store.execute(command);
  assert.equal(asFailure(first).code, "STORAGE_READBACK_UNVERIFIED");

  const changed = await store.execute({ ...command, raw: "different" });
  const failure = asFailure(changed);
  assert.equal(failure.code, "CONFLICT");
  assert.equal(failure.retryable, false);
  assert.equal(ids.count(), 2, "no handler rerun for a mismatched retry");
  assert.equal(commitCalls, 1, "mismatched retry must not touch persistence");
  assert.equal(store.getState(), stateBefore);
  assert.equal(notifications, 0);
});

test("exact duplicate after verified commit recovers the recorded result and never executes twice; changed payload conflicts", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("dup-");
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      return { ok: true };
    },
  });
  const command = draftCommand("dup-cmd-1", "once");

  const first = asOk(await store.execute(command));
  const firstData = first.data as { captureDraft: CaptureDraft };
  assert.equal(firstData.captureDraft.id, "dup-1");

  const duplicate = asOk(await store.execute({ ...command }));
  const duplicateData = duplicate.data as { captureDraft: CaptureDraft };
  assert.equal(duplicateData.captureDraft.id, "dup-1", "duplicate recovers the original result id");
  assert.equal(ids.count(), 2, "duplicate must not rerun the handler");
  assert.equal(commitCalls, 1, "duplicate must not write again");
  assert.equal(store.getState().globalRevision, baseRevision + 1, "duplicate must not advance the revision");
  assert.deepEqual(draftRaws(store.getState()), ["once"]);

  const changed = await store.execute({ ...command, raw: "changed" });
  const failure = asFailure(changed);
  assert.equal(failure.code, "CONFLICT");
  assert.equal(failure.retryable, false);
  assert.equal(ids.count(), 2);
  assert.equal(commitCalls, 1);
  assert.deepEqual(draftRaws(store.getState()), ["once"]);
});

test("equal-revision different-payload external adoption during delayed commit is not overwritten by the candidate", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("eqrev-");
  const commitCalls: Array<{ expected: number; next: DomainState }> = [];
  let releaseCommit: (() => void) | null = null;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async (expected, next) => {
      commitCalls.push({ expected, next });
      await commitGate;
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const pending = store.execute(draftCommand("eqrev-cmd-1", "ghost"));
  await tick();
  const adopted = JSON.parse(JSON.stringify(initial)) as DomainState;
  adopted.globalRevision = baseRevision + 1;
  adopted.captureDrafts["foreign-draft"] = foreignDraft("foreign-draft", "foreign");
  store.adoptExternalState(adopted);
  assert.equal(store.getState(), adopted);
  releaseCommit!();
  const result = await pending;

  const failure = asFailure(result);
  assert.equal(failure.code, "REVISION_CONFLICT", "equal-revision different content is not a self echo");
  assert.equal(store.getState(), adopted, "candidate must not overwrite the externally adopted state");
  assert.deepEqual(draftRaws(store.getState()), ["foreign"]);
  assert.equal(notifications, 1, "only the adoption may notify");
  assert.equal(commitCalls[0]!.expected, baseRevision);
});

test("identical verified echo adopted during commit is accepted and the canonical candidate is published", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("echo-");
  const committedCandidates: DomainState[] = [];
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async (_expected, next) => {
      committedCandidates.push(next);
      if (committedCandidates.length === 1) {
        store.adoptExternalState(JSON.parse(JSON.stringify(next)) as DomainState);
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const result = asOk(await store.execute(draftCommand("echo-cmd-1", "echoed")));
  const data = result.data as { captureDraft: CaptureDraft };
  const candidate = committedCandidates[0]!;
  assert.equal(data.captureDraft.id, "echo-1");
  assert.equal(store.getState(), candidate, "canonical candidate object is republished over its identical echo");
  assert.equal(store.getState().globalRevision, baseRevision + 1);
  assert.equal(notifications, 2, "adoption notification plus the verified publish");
});

test("newer external generation preserved over delayed candidate", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("newer-");
  let releaseCommit: (() => void) | null = null;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      await commitGate;
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const pending = store.execute(draftCommand("newer-cmd-1", "ghost"));
  await tick();
  const adopted: DomainState = { ...initial, globalRevision: baseRevision + 5 };
  store.adoptExternalState(adopted);
  releaseCommit!();
  const result = await pending;

  assert.equal(asFailure(result).code, "REVISION_CONFLICT");
  assert.equal(store.getState(), adopted);
  assert.equal(notifications, 1);
});

test("a queued command progresses while a candidate is pending, and the stale same-command retry fails closed instead of clobbering it", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("queue-");
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "readback unavailable", retryable: true };
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const commandA = draftCommand("queue-cmd-A", "A");
  const commandB = draftCommand("queue-cmd-B", "B");

  const resultA = await store.execute(commandA);
  assert.equal(asFailure(resultA).code, "STORAGE_READBACK_UNVERIFIED");
  assert.equal(notifications, 0);

  asOk(await store.execute(commandB));
  assert.deepEqual(draftRaws(store.getState()), ["B"], "following queue command still progresses");
  assert.equal(store.getState().globalRevision, baseRevision + 1);
  assert.equal(notifications, 1);
  assert.equal(ids.count(), 4, "A once plus B once");

  const staleRetry = await store.execute({ ...commandA });
  const staleFailure = asFailure(staleRetry);
  assert.equal(staleFailure.code, "REVISION_CONFLICT", "stale candidate must fail closed after the state advanced");
  assert.equal(ids.count(), 4, "stale retry must not rerun the handler");
  assert.equal(commitCalls, 2, "stale candidate must not be re-sent to persistence");
  assert.deepEqual(draftRaws(store.getState()), ["B"]);
  assert.equal(notifications, 1);

  asOk(await store.execute({ ...commandA, commandId: "queue-cmd-A-2" }));
  assert.deepEqual(draftRaws(store.getState()), ["A", "B"]);
  assert.equal(store.getState().globalRevision, baseRevision + 2);
  assert.equal(notifications, 2);
});

test("thrown commit is reported as stage-unknown, retains the candidate, and the same-command retry resolves it", async () => {
  const initial = createInitialState("fixture");
  const ids = makeUuidCounter("throw-");
  const committedCandidates: DomainState[] = [];
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async (_expected, next) => {
      committedCandidates.push(next);
      if (committedCandidates.length === 1) {
        throw new Error("storage exploded");
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const stateBefore = store.getState();
  const command = draftCommand("throw-cmd-1", "thrown");

  const first = await store.execute(command);
  const failure = asFailure(first);
  assert.equal(failure.code, "STORAGE_WRITE_FAILED");
  assert.match(failure.reason, /storage exploded/);
  assert.match(failure.reason, /unknown/, "uncertainty must be reported explicitly");
  assert.equal((failure.details as { stage?: string } | undefined)?.stage, "unknown");
  assert.equal(store.getState(), stateBefore);
  assert.equal(notifications, 0, "a throw must not claim success by publishing");

  const retry = asOk(await store.execute({ ...command }));
  const retryData = retry.data as { captureDraft: CaptureDraft };
  const originalDraftId = Object.keys(committedCandidates[0]!.captureDrafts)[0]!;
  assert.equal(retryData.captureDraft.id, originalDraftId, "retry resolves the original candidate");
  assert.equal(ids.count(), 2, "handler ran exactly once across both attempts");
  assert.equal(committedCandidates.length, 2);
  assert.equal(committedCandidates[1], committedCandidates[0], "retry re-sends the retained candidate object");
  assert.equal(notifications, 1);
});

test("caller mutation of the executed command object is rejected for pending retry and committed duplicate; the captured snapshot stays exact-retryable", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("mut-");
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "postwrite readback unavailable", retryable: true };
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const command = parsedDraftCommand("mut-cmd-1", "original");

  const firstFailure = asFailure(await store.execute(command));
  assert.equal(firstFailure.code, "STORAGE_READBACK_UNVERIFIED");

  command.raw = "mutated-raw";
  command.parsedFields!.topic = "mutated-topic";

  const mutatedPendingRetry = await store.execute(command);
  const mutatedPendingFailure = asFailure(mutatedPendingRetry);
  assert.equal(mutatedPendingFailure.code, "CONFLICT", "the same object with a mutated payload must not pass as the exact command");
  assert.equal(mutatedPendingFailure.retryable, false);
  assert.equal(ids.count(), 2, "mutated pending retry must not rerun the handler");
  assert.equal(commitCalls, 1, "mutated pending retry must not touch persistence");

  const exactRetry = asOk(await store.execute(parsedDraftCommand("mut-cmd-1", "original")));
  const exactData = exactRetry.data as { captureDraft: CaptureDraft };
  assert.equal(exactData.captureDraft.raw, "original", "the original captured snapshot remains exact-retryable");
  assert.equal(exactData.captureDraft.parsedFields.topic, "original-topic");
  assert.equal(ids.count(), 2);
  assert.equal(commitCalls, 2);
  assert.equal(store.getState().globalRevision, baseRevision + 1);
  assert.deepEqual(draftRaws(store.getState()), ["original"]);
  assert.equal(notifications, 1);

  const mutatedCommittedDuplicate = await store.execute(command);
  const mutatedCommittedFailure = asFailure(mutatedCommittedDuplicate);
  assert.equal(mutatedCommittedFailure.code, "CONFLICT", "mutated duplicate must conflict with the retained committed snapshot");
  assert.equal(ids.count(), 2);
  assert.equal(commitCalls, 2);
  assert.deepEqual(draftRaws(store.getState()), ["original"]);
});

test("queue mutation of the command object before the handler runs must not leak into execution, the candidate, or committed identity", async () => {
  const initial = createInitialState("fixture");
  const ids = makeUuidCounter("qm-");
  let commitCalls = 0;
  let releaseCommit: (() => void) | null = null;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      await commitGate;
      return { ok: true };
    },
  });
  const command = parsedDraftCommand("qm-cmd-1", "original");

  const pending = store.execute(command);
  command.raw = "mutated-raw";
  command.parsedFields!.topic = "mutated-topic";
  await tick();
  releaseCommit!();
  const result = asOk(await pending);
  const resultData = result.data as { captureDraft: CaptureDraft };
  assert.equal(resultData.captureDraft.raw, "original", "handler must run on the snapshot captured at invocation, not the mutated object");
  assert.equal(resultData.captureDraft.parsedFields.topic, "original-topic");
  assert.deepEqual(draftRaws(store.getState()), ["original"]);

  const mutatedDuplicate = await store.execute(command);
  assert.equal(asFailure(mutatedDuplicate).code, "CONFLICT", "queue mutation must not corrupt committed identity either");

  const exactDuplicate = asOk(await store.execute(parsedDraftCommand("qm-cmd-1", "original")));
  assert.equal((exactDuplicate.data as { captureDraft: CaptureDraft }).captureDraft.id, resultData.captureDraft.id);
  assert.equal(ids.count(), 2, "neither duplicate reran the handler");
  assert.equal(commitCalls, 1, "neither duplicate touched persistence");
});

test("postwrite conflict retains a fail-closed record: two later retries and changed payload are inert, a fresh commandId still works", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("pwr-");
  let commitCalls = 0;
  let releaseCommit: (() => void) | null = null;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      await commitGate;
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const pending = store.execute(draftCommand("pwr-cmd-1", "ghost"));
  await tick();
  const adopted = JSON.parse(JSON.stringify(initial)) as DomainState;
  adopted.globalRevision = baseRevision + 1;
  adopted.captureDrafts["foreign-draft"] = foreignDraft("foreign-draft", "foreign");
  store.adoptExternalState(adopted);
  releaseCommit!();
  const firstResult = await pending;
  assert.equal(asFailure(firstResult).code, "REVISION_CONFLICT", "precondition: postwrite conflict for the first attempt");
  assert.equal(commitCalls, 1);
  assert.equal(ids.count(), 2);

  const staleRetry1 = await store.execute({ ...draftCommand("pwr-cmd-1", "ghost") });
  const staleFailure1 = asFailure(staleRetry1);
  assert.equal(staleFailure1.code, "REVISION_CONFLICT");
  assert.equal(staleFailure1.retryable, false, "the retained rejection must stay fail-closed");
  assert.equal(ids.count(), 2, "stale retry must not rerun the handler");
  assert.equal(commitCalls, 1, "stale retry must not write again");
  assert.equal(notifications, 1, "stale retry must not publish");
  assert.equal(store.getState(), adopted);

  const staleRetry2 = await store.execute({ ...draftCommand("pwr-cmd-1", "ghost") });
  assert.equal(asFailure(staleRetry2).code, "REVISION_CONFLICT");
  assert.equal(ids.count(), 2);
  assert.equal(commitCalls, 1);
  assert.equal(notifications, 1);

  const changed = await store.execute({ ...draftCommand("pwr-cmd-1", "ghost"), raw: "changed" });
  assert.equal(asFailure(changed).code, "CONFLICT", "changed payload under a rejected commandId must also conflict");
  assert.equal(ids.count(), 2);
  assert.equal(commitCalls, 1);

  const fresh = asOk(await store.execute(draftCommand("pwr-cmd-2", "fresh")));
  const freshData = fresh.data as { captureDraft: CaptureDraft };
  assert.equal(freshData.captureDraft.raw, "fresh", "the fresh commandId runs a genuinely new requested action");
  assert.equal(freshData.captureDraft.id, "pwr-3");
  assert.equal(ids.count(), 4, "only the fresh commandId may run the handler");
  assert.equal(commitCalls, 2);
  assert.deepEqual(draftRaws(store.getState()).sort(), ["foreign", "fresh"]);
  assert.equal(notifications, 2);
});

test("prewrite conflict retains a fail-closed record: three later retries and changed payload are inert, a fresh commandId still works", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("pre-");
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async () => {
      commitCalls += 1;
      if (commitCalls === 1) {
        return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "postwrite readback unavailable", retryable: true };
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const firstFailure = asFailure(await store.execute(draftCommand("pre-cmd-1", "ghost")));
  assert.equal(firstFailure.code, "STORAGE_READBACK_UNVERIFIED", "precondition: unverified commit retains the candidate");

  const adopted: DomainState = { ...initial, globalRevision: baseRevision + 5 };
  store.adoptExternalState(adopted);
  assert.equal(notifications, 1);

  const staleRetry1 = await store.execute({ ...draftCommand("pre-cmd-1", "ghost") });
  const staleFailure1 = asFailure(staleRetry1);
  assert.equal(staleFailure1.code, "REVISION_CONFLICT");
  assert.equal((staleFailure1.details as { stage?: string } | undefined)?.stage, "prewrite");
  assert.equal(ids.count(), 2, "stale retry must not rerun the handler");
  assert.equal(commitCalls, 1, "stale retry must not write again");
  assert.equal(store.getState(), adopted);
  assert.equal(notifications, 1);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const staleRetry = await store.execute({ ...draftCommand("pre-cmd-1", "ghost") });
    const staleFailure = asFailure(staleRetry);
    assert.equal(staleFailure.code, "REVISION_CONFLICT");
    assert.equal(staleFailure.retryable, false, "the retained rejection must stay fail-closed");
    assert.equal(ids.count(), 2);
    assert.equal(commitCalls, 1);
  }

  const changed = await store.execute({ ...draftCommand("pre-cmd-1", "ghost"), raw: "changed" });
  assert.equal(asFailure(changed).code, "CONFLICT", "changed payload under a rejected commandId must also conflict");
  assert.equal(ids.count(), 2);
  assert.equal(commitCalls, 1);

  const fresh = asOk(await store.execute(draftCommand("pre-cmd-2", "fresh")));
  const freshData = fresh.data as { captureDraft: CaptureDraft };
  assert.equal(freshData.captureDraft.raw, "fresh", "the fresh commandId runs a genuinely new requested action");
  assert.equal(freshData.captureDraft.id, "pre-3");
  assert.equal(ids.count(), 4, "only the fresh commandId may run the handler");
  assert.equal(commitCalls, 2);
  assert.equal(notifications, 2);
  assert.equal(store.getState().globalRevision, baseRevision + 6);
  assert.deepEqual(draftRaws(store.getState()), ["fresh"]);
});

test("synchronous caller commandId mutation after execute stores the candidate under the snapshot key; exact original retry re-commits the identical nextState without a new handler run", async () => {
  const initial = createInitialState("fixture");
  const baseRevision = initial.globalRevision;
  const ids = makeUuidCounter("keymut-");
  const committedCandidates: DomainState[] = [];
  const store = createDomainStore({
    dataMode: "fixture",
    initialState: initial,
    now: () => NOW,
    uuid: ids.uuid,
    commit: async (_expected, next) => {
      committedCandidates.push(next);
      if (committedCandidates.length === 1) {
        return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "postwrite readback unavailable", retryable: true };
      }
      return { ok: true };
    },
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const command = draftCommand("keymut-cmd-1", "original");

  const pending = store.execute(command);
  command.commandId = "keymut-cmd-1-hijacked";
  const firstFailure = asFailure(await pending);
  assert.equal(firstFailure.code, "STORAGE_READBACK_UNVERIFIED");
  assert.equal(firstFailure.commandId, "keymut-cmd-1", "the failure reports the snapshot commandId, not the mutated caller value");
  assert.equal(ids.count(), 2, "the handler ran exactly once");
  assert.equal(notifications, 0, "the unverified commit must not publish");

  const retry = asOk(await store.execute(draftCommand("keymut-cmd-1", "original")));
  const retryData = retry.data as { captureDraft: CaptureDraft };
  const originalDraftId = Object.keys(committedCandidates[0]!.captureDrafts)[0]!;
  assert.equal(retryData.captureDraft.id, originalDraftId, "the retry resolves the original candidate result, not a rerun");
  assert.equal(committedCandidates.length, 2);
  assert.equal(committedCandidates[1], committedCandidates[0], "the retry re-sends the retained candidate's identical original nextState object");
  assert.equal(ids.count(), 2, "the exact original retry must not rerun the handler or mint a new uuid");
  assert.equal(store.getState(), committedCandidates[0], "the retained candidate is published as the canonical state");
  assert.equal(store.getState().globalRevision, baseRevision + 1);
  assert.deepEqual(draftRaws(store.getState()), ["original"]);
  assert.equal(notifications, 1);
});
