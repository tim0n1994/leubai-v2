import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, FIXTURE_IDS } from "../../domain/index.ts";
import { buildWorkspaceExport } from "./workspace-export.ts";
import { readWorkspaceSavedState } from "./workspace-readback.ts";
import type { CommitOutcome, DomainPersistence } from "../../data/persistence.ts";
import type { DomainState } from "../../domain/types.ts";

async function draftState() {
  const store = createDomainStore({ dataMode: "fixture" });
  const base = { actor: "user" as const, issuedAt: "2026-09-13T12:00:00Z" };
  const plan = await store.execute({ ...base, commandId: "export-plan", type: "selectPlan", entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(plan.ok);
  const approval = await store.execute({ ...base, commandId: "export-grant", type: "grantApproval", entityId: plan.data.plan.id, expectedRevision: plan.data.plan.revision, changeSetId: plan.data.changeSet.id, grants: ["readMaterial", "createLocalDraft", "updateEstimate"] });
  assert.ok(approval.ok);
  assert.ok((await store.execute({ ...base, commandId: "export-start", type: "startOperation", entityId: approval.data.approval.id, expectedRevision: approval.data.approval.revision, approvalId: approval.data.approval.id })).ok);
  return structuredClone(store.getState());
}

test("export serializes only the selected saved draft, preserving versions, sources, open issues and unsent state", async () => {
  const state = await draftState();
  const draft = Object.values(state.drafts)[0];
  draft.sections[0].content = "真实正文\n第二行 <script>只作为文本</script>";
  draft.sections[0].openIssues = ["金额尚未核对"];
  draft.openQuestions = ["等待人工成本"];
  state.drafts.unrelated = { ...draft, id: "unrelated", sections: [{ ...draft.sections[0], content: "其他草稿不能导出" }] };
  const before = JSON.stringify(state);
  const result = buildWorkspaceExport(state, draft.id, draft.revision, "2026-09-13T13:00:00Z");
  assert.ok(result.ok);
  assert.match(result.file.filename, /^LeuBai-draft-.+-v\d+\.json$/);
  assert.equal(result.file.mimeType, "application/json;charset=utf-8");
  const exported = JSON.parse(result.file.content);
  assert.equal(exported.format, "LeuBai-draft-export");
  assert.equal(exported.dataMode, "fixture");
  assert.deepEqual(exported.draft, draft);
  assert.equal(exported.summary.sendState, "未发送");
  assert.deepEqual(exported.summary.pendingReviewSectionIds, draft.sections.filter(section => section.reviewStatus !== "confirmed").map(section => section.id));
  assert.ok(exported.sources.length > 0);
  assert.doesNotMatch(result.file.content, /其他草稿不能导出/);
  assert.equal(JSON.stringify(state), before);
});

test("withdrawn export keeps the withdrawal event and never turns withdrawal into sent", async () => {
  const state = await draftState();
  const draft = Object.values(state.drafts)[0];
  draft.status = "withdrawn";
  draft.withdrawal = { withdrawnAt: "2026-09-13T13:01:00Z", reason: "保留审计，不再使用" };
  const result = buildWorkspaceExport(state, draft.id, draft.revision, "2026-09-13T13:02:00Z");
  assert.ok(result.ok);
  const exported = JSON.parse(result.file.content);
  assert.equal(exported.summary.draftState, "已撤回");
  assert.equal(exported.summary.sendState, "未发送");
  assert.deepEqual(exported.draft.withdrawal, draft.withdrawal);
});

test("missing persisted data, unknown draft and changed revision refuse export instead of falling back", async () => {
  const state = await draftState();
  const draft = Object.values(state.drafts)[0];
  assert.equal(buildWorkspaceExport(null, draft.id, draft.revision, "2026-09-13T13:00:00Z").ok, false);
  assert.equal(buildWorkspaceExport(state, "missing", draft.revision, "2026-09-13T13:00:00Z").ok, false);
  assert.equal(buildWorkspaceExport(state, draft.id, draft.revision + 1, "2026-09-13T13:00:00Z").ok, false);
});

function persistenceStub(
  savedState: DomainState | null,
  refreshOutcome: CommitOutcome = { ok: true },
): DomainPersistence {
  return {
    dataMode: "fixture",
    openStatus: "ready",
    openReason: null,
    rawPayload: null,
    getState: () => savedState,
    readFreshState: () => savedState,
    commit: async () => ({ ok: true }),
    subscribeExternal: () => () => {},
    resetFixtureOnly: async () => ({ ok: true }),
    refresh: async () => refreshOutcome,
  };
}

test("saved-state readback refreshes and returns the committed server state", async () => {
  const state = await draftState();
  const fresh = await readWorkspaceSavedState(persistenceStub(state));
  assert.equal(fresh, state);
});

test("readback refuses instead of guessing when refresh or the saved state is unavailable", async () => {
  const state = await draftState();
  await assert.rejects(
    readWorkspaceSavedState(persistenceStub(state, { ok: false, code: "STORAGE_UNAVAILABLE", reason: "服务器暂时不可用。", retryable: false })),
    /服务器暂时不可用/,
  );
  await assert.rejects(readWorkspaceSavedState(persistenceStub(null)), /无法读取已保存的工作区数据/);
});
