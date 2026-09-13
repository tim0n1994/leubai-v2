import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "./store.ts";
import { captureRulesSnapshot, compareCheckpointRules, isCheckpointRulesSnapshot } from "./checkpointRulesModel.ts";

test("new checkpoint captures rules at save time and subsequent rule edits do not rewrite history", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" };
  const before = store.getState().ruleset;
  const saved = await store.execute({ ...base, commandId: "rules-snapshot-save", type: "saveCheckpoint", entityId: null, expectedRevision: null });
  assert.ok(saved.ok);
  assert.equal(saved.data.checkpoint.rulesSnapshot?.dailyCapacityMinutes, before.dailyCapacityMinutes);
  const updated = await store.execute({ ...base, commandId: "rules-change", type: "updateRules", entityId: before.id, expectedRevision: before.revision, dailyCapacityMinutes: before.dailyCapacityMinutes + 10, summary: "Change daily capacity" });
  assert.ok(updated.ok);
  assert.equal(store.getState().checkpoints[saved.data.checkpoint.id]?.rulesSnapshot?.dailyCapacityMinutes, before.dailyCapacityMinutes);
});

test("rule comparison reports precise changed fields and keeps unchanged snapshots empty", () => {
  const current = createDomainStore({ dataMode: "fixture" }).getState().ruleset;
  const snapshot = captureRulesSnapshot(current);
  assert.deepEqual(compareCheckpointRules(snapshot, current), []);
  const changed = { ...current, paused: !current.paused, dailyCapacityMinutes: current.dailyCapacityMinutes + 30, grants: { ...current.grants, readMaterial: !current.grants.readMaterial } };
  assert.equal(compareCheckpointRules(snapshot, changed).length, 3);
  assert.ok(isCheckpointRulesSnapshot(snapshot));
  assert.equal(isCheckpointRulesSnapshot({ ...snapshot, grants: {} }), false);
  assert.equal(isCheckpointRulesSnapshot({ ...snapshot, dailyCapacityMinutes: -1 }), false);
  assert.equal(isCheckpointRulesSnapshot({ ...snapshot, dailyCapacityMinutes: 0 }), false);
  assert.equal(isCheckpointRulesSnapshot({ ...snapshot, dailyCapacityMinutes: 1.5 }), false);
});
