import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "../../domain/store.ts";
import { FIXTURE_IDS } from "../../domain/ids.ts";
import type { GrantKey } from "../../domain/types.ts";
import { approvalPreflight } from "./approval-preflight.ts";

const combinations = [
  { bits: 0, kinds: [], primary: "none" },
  { bits: 1, kinds: ["readMaterial"], primary: "read" },
  { bits: 2, kinds: [], primary: "none" },
  { bits: 3, kinds: ["createDraft", "readMaterial"], primary: "draft" },
  { bits: 4, kinds: ["updateEstimate"], primary: "estimate" },
  { bits: 5, kinds: ["readMaterial", "updateEstimate"], primary: "estimate" },
  { bits: 6, kinds: ["updateEstimate"], primary: "estimate" },
  { bits: 7, kinds: ["createDraft", "readMaterial", "updateEstimate"], primary: "draft" },
] as const;

for (const scenario of combinations) test("preflight and domain reduction agree for grant mask " + scenario.bits, async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" };
  const selected = await store.execute({ ...base, type: "selectPlan", commandId: "preflight-plan-" + scenario.bits, entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(selected.ok);
  const keys: GrantKey[] = ["readMaterial", "createLocalDraft", "updateEstimate"];
  const grants = keys.filter((_key, index) => (scenario.bits & (1 << index)) !== 0);
  const preflight = approvalPreflight(selected.data.changeSet.actions, grants);
  assert.deepEqual(preflight.effective.map(action => action.kind).sort(), [...scenario.kinds]);
  assert.equal(preflight.primary, scenario.primary);
  assert.equal(preflight.canApprove, scenario.kinds.length > 0);
  const approved = await store.execute({ ...base, type: "grantApproval", commandId: "preflight-approve-" + scenario.bits, entityId: selected.data.plan.id, expectedRevision: selected.data.plan.revision, changeSetId: selected.data.changeSet.id, grants });
  assert.equal(approved.ok, preflight.canApprove);
  if (approved.ok) assert.deepEqual(approved.data.changeSet.actions.map(action => action.id).sort(), preflight.effective.map(action => action.id).sort());
  if (scenario.bits === 6) assert.equal(preflight.excluded.find(action => action.kind === "createDraft")?.reason, "dependency");
});
