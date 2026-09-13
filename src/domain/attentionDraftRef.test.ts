import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, FIXTURE_IDS } from "./index.ts";
import { resolveAttentionDraftRef } from "./attentionDraftRef.ts";

const now = "2026-09-12T10:00:00+08:00";
async function prepared() {
  let sequence = 0;
  const store = createDomainStore({ dataMode: "fixture", now: () => now, uuid: () => `attention-ref-${++sequence}` });
  const base = () => ({ commandId: `command-${++sequence}`, entityId: null, expectedRevision: null, actor: "user" as const, issuedAt: now });
  const plan = await store.execute({ ...base(), type: "selectPlan", entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(plan.ok);
  const approval = await store.execute({ ...base(), type: "grantApproval", changeSetId: plan.data.changeSet.id, grants: ["readMaterial", "createLocalDraft", "updateEstimate"] });
  assert.ok(approval.ok);
  const execution = await store.execute({ ...base(), type: "startOperation", approvalId: approval.data.approval.id });
  assert.ok(execution.ok);
  const state = store.getState();
  const draft = Object.values(state.drafts)[0];
  assert.ok(draft);
  return { store, state, draft, base };
}

test("a real executed draft resolves its exact operation and optional section", async () => {
  const { state, draft } = await prepared();
  assert.deepEqual(resolveAttentionDraftRef(state, { draftId: draft.id }), { ok: true, draftId: draft.id, operationId: draft.operationId, sectionId: null, sectionTitle: null });
  assert.deepEqual(resolveAttentionDraftRef(state, { draftId: draft.id, sectionId: draft.sections[0].id }), { ok: true, draftId: draft.id, operationId: draft.operationId, sectionId: draft.sections[0].id, sectionTitle: draft.sections[0].title });
});

test("absent, malformed, missing or ambiguous references never select a fallback draft", async () => {
  const { state, draft } = await prepared();
  for (const ref of [undefined, null, {}, "draft", { draftId: "" }, { draftId: ` ${draft.id}` }, { draftId: "missing" }, { draftId: draft.id, sectionId: null }, { draftId: draft.id, sectionId: "missing" }]) {
    assert.equal(resolveAttentionDraftRef(state, ref).ok, false);
  }
  const duplicate = structuredClone(state);
  duplicate.drafts[draft.id].sections.push(structuredClone(draft.sections[0]));
  assert.equal(resolveAttentionDraftRef(duplicate, { draftId: draft.id, sectionId: draft.sections[0].id }).ok, false);
});

test("withdrawal, missing ownership and incompatible data mode invalidate a stored link", async () => {
  const { state, draft } = await prepared();
  for (const mutate of [
    (copy: typeof state) => { copy.drafts[draft.id].status = "withdrawn"; },
    (copy: typeof state) => { delete copy.operations[draft.operationId]; },
    (copy: typeof state) => { copy.operations[draft.operationId].resultRefs = ["other-draft"]; },
    (copy: typeof state) => { copy.drafts[draft.id].dataMode = "live"; },
  ]) {
    const copy = structuredClone(state);
    mutate(copy);
    assert.equal(resolveAttentionDraftRef(copy, { draftId: draft.id }).ok, false);
  }
});

test("delivery persists a valid reference and rejects a nonexistent target without spending budget", async () => {
  const { store, draft, base } = await prepared();
  const draftRef = { draftId: draft.id, sectionId: draft.sections[0].id };
  const result = await store.execute({ ...base(), type: "deliverAttention", deliveryId: "linked", source: "ai", urgency: "normal", title: "检查真实草稿", draftRef });
  assert.ok(result.ok);
  assert.deepEqual(result.data.item.draftRef, draftRef);
  const before = store.getState().attention.budget.used;
  const invalid = await store.execute({ ...base(), type: "deliverAttention", deliveryId: "invalid", source: "ai", urgency: "normal", title: "无效目标", draftRef: { draftId: "missing" } });
  assert.equal(invalid.ok, false);
  assert.equal(store.getState().attention.budget.used, before);
});
