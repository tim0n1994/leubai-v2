import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "./store.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { InMemoryStorage } from "../data/storage.ts";
import { FIXTURE_IDS } from "./ids.ts";
import type { CreateProtectedBlockCommand } from "./types.ts";

const command = (patch: Partial<CreateProtectedBlockCommand> = {}): CreateProtectedBlockCommand => ({ type: "createProtectedBlock", commandId: "create-user-boundary", blockId: "user-stable-boundary", entityId: null, expectedRevision: null, actor: "user", issuedAt: "2026-09-13T10:00:00Z", intentId: null, date: "2026-09-14", startTime: "19:00", endTime: "20:00", timezone: "Asia/Shanghai", purpose: null, ...patch });

test("user creates an unassigned purpose-free local boundary without inventing intent, responsibility, capacity or external coverage", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const before = store.getState();
  const result = await store.execute(command());
  assert.ok(result.ok);
  assert.equal(result.data.protectedBlock.intentId, null);
  assert.equal(result.data.protectedBlock.purpose, null);
  assert.equal(result.data.protectedBlock.range.start, "2026-09-14T19:00:00+08:00");
  assert.equal(result.data.protectedBlock.blockId, "user-stable-boundary");
  assert.equal(result.data.coverage, "unknown");
  assert.equal(result.data.externalWrite, "none");
  for (const key of ["intents", "commitments", "sources", "ledger", "ruleset"] as const) assert.deepEqual(store.getState()[key], before[key]);
});

test("stable block id and exact command remain idempotent after persistent store reopen", async () => {
  const storage = new InMemoryStorage();
  const handle = await createPersistedDomainStore({ dataMode: "fixture", storage });
  if (handle.status !== "ready") throw new Error(handle.status);
  const original = command({ purpose: "  散步  ", intentId: FIXTURE_IDS.intent });
  const first = await handle.store.execute(original);
  assert.ok(first.ok);
  assert.equal(first.data.protectedBlock.purpose, "  散步  ");
  const reopened = await createPersistedDomainStore({ dataMode: "fixture", storage });
  if (reopened.status !== "ready") throw new Error(reopened.status);
  const repeat = await reopened.store.execute(original);
  assert.ok(repeat.ok);
  assert.equal(repeat.data.protectedBlock.id, first.data.protectedBlock.id);
  assert.equal(Object.values(reopened.store.getState().protectedBlocks).filter(block => block.blockId === original.blockId).length, 1);
  const conflict = await reopened.store.execute({ ...original, commandId: "conflicting", purpose: "不同用途" });
  assert.equal(conflict.ok, false);
});

test("non-user, invalid interval/date/timezone, unknown intent and malformed identity are rejected without mutation", async () => {
  for (const patch of [{ actor: "model" as const }, { actor: "automation" as const }, { date: "2026-02-30" }, { startTime: "25:00" }, { startTime: "20:00" }, { endTime: "18:00" }, { timezone: "not-a-zone" }, { intentId: "missing" }, { blockId: "" }, { entityId: "existing" }, { expectedRevision: 1 }]) {
    const store = createDomainStore({ dataMode: "fixture" });
    const before = store.getState();
    const result = await store.execute(command(patch));
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.deepEqual(store.getState(), before);
  }
});

test("nonexistent and repeated DST wall times fail closed instead of silently moving the user's boundary", async () => {
  for (const patch of [{ date: "2026-03-08", startTime: "02:15", endTime: "03:15" }, { date: "2026-11-01", startTime: "01:15", endTime: "02:15" }]) {
    const store = createDomainStore({ dataMode: "fixture" });
    assert.equal((await store.execute(command({ ...patch, timezone: "America/New_York" }))).ok, false);
  }
  const store = createDomainStore({ dataMode: "fixture" });
  const valid = await store.execute(command({ date: "2026-03-08", startTime: "03:15", endTime: "04:15", timezone: "America/New_York" }));
  assert.ok(valid.ok);
  assert.equal(valid.data.protectedBlock.range.start, "2026-03-08T03:15:00-04:00");
});

test("new local boundary invalidates unexecuted proposals and approvals without cancelling existing responsibility", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" };
  const plan = await store.execute({ ...base, type: "selectPlan", commandId: "plan", entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(plan.ok);
  const approval = await store.execute({ ...base, type: "grantApproval", commandId: "approval", entityId: null, expectedRevision: null, changeSetId: plan.data.changeSet.id, grants: ["updateEstimate"] });
  assert.ok(approval.ok);
  assert.ok((await store.execute(command())).ok);
  assert.equal(store.getState().plans[plan.data.plan.id].status, "invalid");
  assert.equal(store.getState().approvals[approval.data.approval.id].status, "invalid");
  assert.equal(store.getState().commitments[FIXTURE_IDS.commitmentReport].status, "active");
});

test("creating protected time preserves already executed plan, consumed approval and operation history", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" };
  const plan = await store.execute({ ...base, type: "selectPlan", commandId: "past-plan", entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(plan.ok);
  const approval = await store.execute({ ...base, type: "grantApproval", commandId: "past-approval", entityId: null, expectedRevision: null, changeSetId: plan.data.changeSet.id, grants: ["updateEstimate"] });
  assert.ok(approval.ok);
  const operation = await store.execute({ ...base, type: "startOperation", commandId: "past-operation", entityId: null, expectedRevision: null, approvalId: approval.data.approval.id });
  assert.ok(operation.ok);
  const before = store.getState();
  assert.ok((await store.execute(command())).ok);
  assert.deepEqual(store.getState().plans, before.plans);
  assert.deepEqual(store.getState().approvals, before.approvals);
  assert.deepEqual(store.getState().operations, before.operations);
});
