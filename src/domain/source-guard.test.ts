/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_IDS,
  createDomainStore,
  createInitialState,
} from "./index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
  DomainState,
  FailureCode,
  ProviderOutcome,
  SourceProvider,
  SourceSnapshotData,
  SyncSourceCommand,
} from "./index.ts";

const NOW = "2026-09-12T10:00:00+08:00";
const SOURCE_ID = FIXTURE_IDS.sourceCalendar;
const GOOD_INTERVALS = [
  { start: "2026-09-14T09:00:00+08:00", end: "2026-09-14T19:00:00+08:00", timezone: "Asia/Shanghai" },
];

let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "sg-uuid-" + uuidSeq;
}

function baseState(): DomainState {
  return createInitialState("fixture");
}

function newStore() {
  return createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: testUuid, initialState: baseState() });
}

function storeWith(mutate: (s: DomainState) => void) {
  const state = baseState();
  mutate(state);
  return createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: testUuid, initialState: state });
}

function cmd<T extends CommandType>(
  type: T,
  rest: Omit<Extract<DomainCommand, { type: T }>, "type" | "commandId" | "actor" | "issuedAt"> &
    Partial<Pick<CommandBase, "actor" | "commandId">>,
): Extract<DomainCommand, { type: T }> {
  commandSeq += 1;
  return {
    type,
    commandId: rest.commandId ?? "sg-cmd-" + commandSeq,
    actor: "user",
    issuedAt: NOW,
    ...rest,
  } as Extract<DomainCommand, { type: T }>;
}

function syncCommand(
  overrides: Partial<Pick<SyncSourceCommand, "entityId" | "expectedRevision" | "actor">> & {
    provider: SourceProvider;
  },
): SyncSourceCommand {
  commandSeq += 1;
  return {
    type: "syncSource",
    commandId: "sg-cmd-" + commandSeq,
    entityId: SOURCE_ID,
    expectedRevision: 1,
    actor: "user",
    issuedAt: NOW,
    ...overrides,
  };
}

function asOk<T extends DomainCommand>(result: CommandResult<T>): CommandDataOf<T> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

function asFailure(result: CommandResult<DomainCommand>): { code: FailureCode; reason: string } {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

function okOutcome(): ProviderOutcome<SourceSnapshotData> {
  return { ok: true, value: { version: 2, intervals: GOOD_INTERVALS } };
}

interface ProviderSpy {
  provider: SourceProvider;
  total(): number;
}

function spyProvider(outcome: () => ProviderOutcome<SourceSnapshotData>): ProviderSpy {
  const calls = { sync: 0, readSnapshot: 0, executeAllowedAction: 0, readback: 0, revokeAccess: 0 };
  const provider: SourceProvider = {
    async readSnapshot() {
      calls.readSnapshot += 1;
      return outcome();
    },
    async sync() {
      calls.sync += 1;
      return outcome();
    },
    async executeAllowedAction() {
      calls.executeAllowedAction += 1;
      return { ok: false as const, reason: "not used by source-guard tests" };
    },
    async readback() {
      calls.readback += 1;
      return { ok: false as const, reason: "not used by source-guard tests" };
    },
    async revokeAccess() {
      calls.revokeAccess += 1;
      return { ok: false as const, reason: "not used by source-guard tests" };
    },
  };
  return {
    provider,
    total: () => calls.sync + calls.readSnapshot + calls.executeAllowedAction + calls.readback + calls.revokeAccess,
  };
}

function providerOk(version: number): SourceProvider {
  return spyProvider(() => ({ ok: true, value: { version, intervals: GOOD_INTERVALS } })).provider;
}

function withReadDenied(s: DomainState) {
  s.ruleset = { ...s.ruleset, grants: { ...s.ruleset.grants, readMaterial: false } };
}

function withPaused(s: DomainState) {
  s.ruleset = { ...s.ruleset, paused: true };
}

function withRevokedStatus(s: DomainState) {
  s.sources[SOURCE_ID] = { ...s.sources[SOURCE_ID], status: "revoked" };
}

function withRevokedAt(s: DomainState) {
  s.sources[SOURCE_ID] = { ...s.sources[SOURCE_ID], accessRevokedAt: "2026-09-12T09:30:00+08:00" };
}

function assertFailedReceipt(store: ReturnType<typeof newStore>) {
  const source = store.getState().sources[SOURCE_ID];
  assert.equal(source.status, "stale");
  assert.deepEqual(source.coverage, { known: false, intervals: [] });
  const previous = baseState().sources[SOURCE_ID];
  assert.deepEqual(source.lastUsableSnapshot, { ...previous.lastUsableSnapshot, stale: true });
  assert.ok(source.lastError, "failed receipt must record a clear lastError");
  assert.ok(source.lastError && !source.lastError.includes("SECRET"), "lastError must not leak provider internals");
}

test("denied readMaterial grant rejects INVALID_GRANT with zero provider calls and no state mutation", async () => {
  const store = storeWith(withReadDenied);
  const baseline = baseState();
  withReadDenied(baseline);
  const before = JSON.stringify(store.getState());
  const spy = spyProvider(okOutcome);
  const f = asFailure(await store.execute(syncCommand({ provider: spy.provider })));
  assert.equal(f.code, "INVALID_GRANT");
  assert.equal(spy.total(), 0);
  assert.equal(JSON.stringify(store.getState()), before);
});

test("revoked source by status or accessRevokedAt rejects INVALID_GRANT with zero provider calls", async () => {
  for (const mutate of [withRevokedStatus, withRevokedAt]) {
    const store = storeWith(mutate);
    const baseline = baseState();
    mutate(baseline);
    const spy = spyProvider(okOutcome);
    const f = asFailure(await store.execute(syncCommand({ provider: spy.provider })));
    assert.equal(f.code, "INVALID_GRANT");
    assert.equal(spy.total(), 0);
    assert.equal(JSON.stringify(store.getState()), JSON.stringify(baseline));
  }
});

test("paused ruleset blocks automation sync with AUTOMATION_PAUSED and zero provider calls", async () => {
  const store = storeWith(withPaused);
  const spy = spyProvider(okOutcome);
  const f = asFailure(await store.execute(syncCommand({ actor: "automation", provider: spy.provider })));
  assert.equal(f.code, "AUTOMATION_PAUSED");
  assert.equal(spy.total(), 0);
  const baseline = baseState();
  withPaused(baseline);
  assert.equal(JSON.stringify(store.getState()), JSON.stringify(baseline));
});

test("paused ruleset blocks model sync with AUTOMATION_PAUSED and zero provider calls", async () => {
  const store = storeWith(withPaused);
  const spy = spyProvider(okOutcome);
  const f = asFailure(await store.execute(syncCommand({ actor: "model", provider: spy.provider })));
  assert.equal(f.code, "AUTOMATION_PAUSED");
  assert.equal(spy.total(), 0);
});

test("explicit user sync is permitted while automation is paused", async () => {
  const store = storeWith(withPaused);
  const data = asOk(await store.execute(syncCommand({ actor: "user", provider: providerOk(2) })));
  assert.equal(data.syncResult, "success");
  assert.equal(store.getState().sources[SOURCE_ID].status, "connected");
  assert.equal(store.getState().ruleset.paused, true);
});

test("missing entity, null expectedRevision, and stale expectedRevision reject before provider access", async () => {
  const missingStore = newStore();
  const missingSpy = spyProvider(okOutcome);
  const missing = asFailure(
    await missingStore.execute(syncCommand({ entityId: "sg-missing-source", provider: missingSpy.provider })),
  );
  assert.equal(missing.code, "ENTITY_NOT_FOUND");
  assert.equal(missingSpy.total(), 0);

  const nullStore = newStore();
  const nullSpy = spyProvider(okOutcome);
  const nullRev = asFailure(await nullStore.execute(syncCommand({ expectedRevision: null, provider: nullSpy.provider })));
  assert.equal(nullRev.code, "INVALID_INPUT");
  assert.equal(nullSpy.total(), 0);
  assert.equal(JSON.stringify(nullStore.getState()), JSON.stringify(baseState()));

  const staleStore = newStore();
  const staleSpy = spyProvider(okOutcome);
  const stale = asFailure(await staleStore.execute(syncCommand({ expectedRevision: 99, provider: staleSpy.provider })));
  assert.equal(stale.code, "REVISION_CONFLICT");
  assert.equal(staleSpy.total(), 0);
});

test("missing or unusable provider persists a failed receipt naming the unavailable provider", async () => {
  const unusable: unknown[] = [null, undefined, { sync: null }];
  for (const candidate of unusable) {
    const store = newStore();
    const data = asOk(await store.execute(syncCommand({ provider: candidate as SourceProvider })));
    assert.equal(data.syncResult, "failed");
    assertFailedReceipt(store);
    const receipt = store.getState().sources[SOURCE_ID];
    assert.ok(receipt.lastError?.includes("unavailable"), "message must say the provider is unavailable");
    assert.ok(receipt.lastError?.includes("fixture-calendar"), "message must identify the unavailable provider");
  }
});

test("provider sync throw becomes a persisted failure receipt without leaking provider details", async () => {
  for (const poison of [new Error("SECRET credential token abc123"), "raw provider failure string"]) {
    const store = newStore();
    const spy = spyProvider(() => {
      throw poison;
    });
    const data = asOk(await store.execute(syncCommand({ provider: spy.provider })));
    assert.equal(data.syncResult, "failed");
    assertFailedReceipt(store);
    assert.ok(!JSON.stringify(store.getState().sources[SOURCE_ID].lastError).includes("raw provider failure"));
  }
});

test("malformed or invalid success output persists a failed receipt and never claims success", async () => {
  const badSuccesses: Array<unknown> = [
    null,
    {},
    { ok: true },
    { ok: true, value: null },
    { ok: true, value: { version: -1, intervals: GOOD_INTERVALS } },
    { ok: true, value: { version: 1.5, intervals: GOOD_INTERVALS } },
    { ok: true, value: { version: Number.NaN, intervals: GOOD_INTERVALS } },
    { ok: true, value: { version: 9007199254740992, intervals: GOOD_INTERVALS } },
    { ok: true, value: { version: 2, intervals: "not-an-array" } },
    {
      ok: true,
      value: {
        version: 2,
        intervals: [{ start: "2026-09-14T09:00:00+08:00", timezone: "Asia/Shanghai" }],
      },
    },
    {
      ok: true,
      value: {
        version: 2,
        intervals: [{ start: "2026-09-14T09:00:00", end: "2026-09-14T19:00:00+08:00", timezone: "Asia/Shanghai" }],
      },
    },
    {
      ok: true,
      value: {
        version: 2,
        intervals: [{ start: "2026-09-14T19:00:00+08:00", end: "2026-09-14T09:00:00+08:00", timezone: "Asia/Shanghai" }],
      },
    },
    {
      ok: true,
      value: {
        version: 2,
        intervals: [{ start: "2026-09-14T09:00:00+08:00", end: "2026-09-14T19:00:00+08:00", timezone: "Mars/Olympus" }],
      },
    },
  ];
  for (const outcome of badSuccesses) {
    const store = newStore();
    const spy = spyProvider(() => outcome as ProviderOutcome<SourceSnapshotData>);
    const data = asOk(await store.execute(syncCommand({ provider: spy.provider })));
    assert.equal(data.syncResult, "failed", "malformed outcome must not claim success: " + JSON.stringify(outcome));
    assertFailedReceipt(store);
  }
});

test("normal provider failure receipt keeps the reason and marks the old snapshot stale", async () => {
  const store = newStore();
  const spy = spyProvider(() => ({ ok: false, reason: "fixture network down" }));
  const data = asOk(await store.execute(syncCommand({ provider: spy.provider })));
  assert.equal(data.syncResult, "failed");
  const receipt = store.getState().sources[SOURCE_ID];
  assert.equal(receipt.status, "stale");
  assert.equal(receipt.lastError, "fixture network down");
  assertFailedReceipt(store);
});

test("valid fixture sync still succeeds and invalidates approvals bound to the old source version", async () => {
  const store = newStore();
  const sel = asOk(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })),
  );
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: sel.changeSet.id,
        grants: ["readMaterial", "createLocalDraft", "updateEstimate"],
      }),
    ),
  );
  const spy = spyProvider(okOutcome);
  const data = asOk(await store.execute(syncCommand({ provider: spy.provider })));
  assert.equal(data.syncResult, "success");
  assert.equal(spy.total(), 1);
  const source = store.getState().sources[SOURCE_ID];
  assert.equal(source.status, "connected");
  assert.equal(source.sourceVersion, 2);
  assert.equal(source.lastUsableSnapshot?.stale, false);
  assert.deepEqual(source.coverage, { known: true, intervals: GOOD_INTERVALS });
  const approval = store.getState().approvals[grant.approval.id];
  assert.equal(approval.status, "invalid");
  assert.match(approval.invalidReason ?? "", /moved from version 1 to 2/);
  const f = asFailure(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(f.code, "APPROVAL_INVALID");
});

test("failed sync commits one receipt atomically: approvals untouched, no partial state", async () => {
  const store = newStore();
  const sel = asOk(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })),
  );
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: sel.changeSet.id,
        grants: ["readMaterial", "createLocalDraft", "updateEstimate"],
      }),
    ),
  );
  const before = store.getState();
  const beforeSource = before.sources[SOURCE_ID];
  const spy = spyProvider(() => {
    throw new Error("SECRET provider exploded");
  });
  const data = asOk(await store.execute(syncCommand({ provider: spy.provider })));
  assert.equal(data.syncResult, "failed");
  const after = store.getState();
  assert.equal(after.globalRevision, before.globalRevision + 1);
  assert.equal(after.events.length, before.events.length + 1);
  assert.equal(after.events[after.events.length - 1].type, "source.syncFailed");
  assert.deepEqual(after.approvals, before.approvals);
  assert.equal(after.approvals[grant.approval.id].status, "valid");
  assert.deepEqual(after.plans, before.plans);
  assert.deepEqual(after.changeSets, before.changeSets);
  assert.deepEqual(after.commitments, before.commitments);
  const receipt = after.sources[SOURCE_ID];
  assert.equal(receipt.status, "stale");
  assert.equal(receipt.revision, beforeSource.revision + 1);
  assert.deepEqual(receipt.lastUsableSnapshot, { ...beforeSource.lastUsableSnapshot, stale: true });
  assert.deepEqual(receipt.coverage, { known: false, intervals: [] });
});

test("commit failure surfaces as a command failure and leaves no partial state", async () => {
  let commitAttempts = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    initialState: baseState(),
    commit: async () => {
      commitAttempts += 1;
      return { ok: false as const, code: "STORAGE_WRITE_FAILED" as const, reason: "injected commit failure", retryable: false };
    },
  });
  const before = JSON.stringify(store.getState());
  const f = asFailure(await store.execute(syncCommand({ provider: providerOk(2) })));
  assert.equal(f.code, "STORAGE_WRITE_FAILED");
  assert.equal(commitAttempts, 1);
  assert.equal(JSON.stringify(store.getState()), before);
});
