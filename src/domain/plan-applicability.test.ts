import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, createInitialState, FIXTURE_IDS } from "./index.ts";
import type { DomainState, PlanKind } from "./types.ts";

const NOW = "2026-09-13T10:00:00+08:00";
function storeFor(state: DomainState) {
  let seq = 0;
  return createDomainStore({ dataMode: "fixture", initialState: state, now: () => NOW, uuid: () => "applicable-" + ++seq });
}
function select(store: ReturnType<typeof storeFor>, kind: PlanKind) {
  return store.execute({ type: "selectPlan", commandId: "select-" + kind, entityId: FIXTURE_IDS.intent,
    expectedRevision: 1, actor: "user", issuedAt: NOW, kind });
}
function enableLocal(state: DomainState) {
  state.contextReview.localOnly = { enabled: true, revision: 1, changedAt: NOW, changedBy: "user" };
  return state;
}

test("another-date intent never borrows existing responsibilities and failure does not mutate state", async () => {
  const state = createInitialState("fixture");
  state.intents[FIXTURE_IDS.intent].parsedFields.date = "2026-09-16";
  const store = storeFor(state);
  const before = JSON.stringify(store.getState());
  for (const kind of ["A", "B"] as const) {
    const result = await select(store, kind);
    assert.equal(result.ok, false);
  }
  assert.equal(JSON.stringify(store.getState()), before);
});

test("intent date timezone and end bound exclude unrelated work from target and capacity", async () => {
  const state = createInitialState("fixture");
  const report = state.commitments[FIXTURE_IDS.commitmentReport];
  assert.ok(report.schedule);
  state.commitments["other-day"] = { ...report, id: "other-day", effortEstimateMinutes: 900,
    schedule: { ...report.schedule, date: "2026-09-16" } };
  state.commitments["after-window"] = { ...report, id: "after-window", effortEstimateMinutes: 800,
    schedule: { ...report.schedule, startMinute: 1250, endMinute: 1350 } };
  state.commitments["other-zone"] = { ...report, id: "other-zone", effortEstimateMinutes: 700,
    schedule: { ...report.schedule, timezone: "America/New_York" } };
  const result = await select(storeFor(state), "A");
  assert.ok(result.ok);
  assert.equal(result.data.plan.commitmentId, FIXTURE_IDS.commitmentReport);
  assert.equal(result.data.plan.capacityBeforeMinutes, 130);
  assert.deepEqual(result.data.plan.constraintRefs, ["fx-constraint-01"]);
});

test("unknown intent date and unreviewed constraints fail closed", async () => {
  for (const mutate of [
    (state: DomainState) => { state.intents[FIXTURE_IDS.intent].parsedFields.date = null; },
    (state: DomainState) => { state.intents[FIXTURE_IDS.intent].constraints[0].confirmed = false; },
  ]) {
    const state = createInitialState("fixture"); mutate(state);
    const result = await select(storeFor(state), "A");
    assert.equal(result.ok, false);
  }
});

test("local-only permits non-scheduling estimate proposals but rejects unknown future intervals", async () => {
  const state = enableLocal(createInitialState("fixture"));
  const store = storeFor(state);
  assert.equal((await select(store, "A")).ok, true);
  const before = JSON.stringify(store.getState());
  const result = await select(store, "B");
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(store.getState()), before);
});

test("local-only reschedule needs explicit fresh complete coverage and never accepts stale or partial coverage", async () => {
  const state = enableLocal(createInitialState("fixture"));
  const source = state.sources[FIXTURE_IDS.sourceCalendar];
  source.lastSuccessAt = NOW;
  source.coverage.intervals = [{ start: "2026-09-14T18:00:00+08:00", end: "2026-09-14T20:00:00+08:00", timezone: "Asia/Shanghai" }];
  assert.equal((await select(storeFor(structuredClone(state)), "B")).ok, true);
  for (const mutate of [
    (copy: DomainState) => { copy.sources[FIXTURE_IDS.sourceCalendar].lastSuccessAt = "2026-09-12T10:00:00+08:00"; },
    (copy: DomainState) => { copy.sources[FIXTURE_IDS.sourceCalendar].coverage.known = false; },
    (copy: DomainState) => { copy.sources[FIXTURE_IDS.sourceCalendar].coverage.intervals[0].end = "2026-09-14T18:45:00+08:00"; },
    (copy: DomainState) => { copy.ruleset.grants.readMaterial = false; },
  ]) {
    const copy = structuredClone(state); mutate(copy);
    assert.equal((await select(storeFor(copy), "B")).ok, false);
  }
});

test("local-only activation after proposal or approval still blocks unknown-interval execution", async () => {
  const store = storeFor(createInitialState("fixture"));
  const selected = await select(store, "B"); assert.ok(selected.ok);
  const selectedState = structuredClone(store.getState());
  const localStore = storeFor(enableLocal(selectedState));
  const rejectedGrant = await localStore.execute({ type: "grantApproval", commandId: "local-grant",
    entityId: selected.data.plan.id, expectedRevision: 1, actor: "user", issuedAt: NOW,
    changeSetId: selected.data.changeSet.id, grants: ["internalReschedule"] });
  assert.equal(rejectedGrant.ok, false);
  const grant = await store.execute({ type: "grantApproval", commandId: "grant",
    entityId: selected.data.plan.id, expectedRevision: 1, actor: "user", issuedAt: NOW,
    changeSetId: selected.data.changeSet.id, grants: ["internalReschedule"] }); assert.ok(grant.ok);
  const approvedLocalStore = storeFor(enableLocal(structuredClone(store.getState())));
  const before = JSON.stringify(approvedLocalStore.getState());
  const run = await approvedLocalStore.execute({ type: "startOperation", commandId: "run",
    entityId: grant.data.approval.id, expectedRevision: 1, actor: "user", issuedAt: NOW,
    approvalId: grant.data.approval.id });
  assert.equal(run.ok, false);
  assert.equal(JSON.stringify(approvedLocalStore.getState()), before);
});

test("a reschedule never occupies an active local protected block even with fresh external coverage", async () => {
  const state = createInitialState("fixture");
  const block = state.protectedBlocks[FIXTURE_IDS.protectedBlock];
  state.protectedBlocks["future-protection"] = { ...block, id: "future-protection", range: {
    start: "2026-09-14T18:45:00+08:00", end: "2026-09-14T19:30:00+08:00", timezone: "Asia/Shanghai",
  } };
  const result = await select(storeFor(state), "B");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /本地保护时段/);
  state.protectedBlocks["future-protection"].range = {
    start: "2026-09-14T10:45:00Z", end: "2026-09-14T11:30:00Z", timezone: "UTC",
  };
  assert.equal((await select(storeFor(state), "B")).ok, false);
});
