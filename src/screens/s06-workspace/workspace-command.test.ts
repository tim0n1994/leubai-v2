import assert from "node:assert/strict";
import test from "node:test";
import { createPersistedDomainStore } from "../../data/persistedStore.ts";
import { InMemoryStorage } from "../../data/storage.ts";
import type { StorageLike } from "../../data/storage.ts";
import { FIXTURE_IDS } from "../../domain/ids.ts";
import type { DomainCommand } from "../../domain/types.ts";
import { workspaceCommands } from "./workspace-command.ts";
import { createDomainStore } from "../../domain/store.ts";
import type { DomainStore } from "../../domain/store.ts";

async function preparedDraft(store: DomainStore) {
  const base = { actor: "user" as const, issuedAt: "2026-09-13T12:00:00Z" };
  const plan = await store.execute({ ...base, commandId: "setup-plan", type: "selectPlan", entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(plan.ok);
  const approval = await store.execute({ ...base, commandId: "setup-grant", type: "grantApproval", entityId: plan.data.plan.id, expectedRevision: plan.data.plan.revision, changeSetId: plan.data.changeSet.id, grants: ["readMaterial", "createLocalDraft", "updateEstimate"] });
  assert.ok(approval.ok);
  assert.ok((await store.execute({ ...base, commandId: "setup-operation", type: "startOperation", entityId: approval.data.approval.id, expectedRevision: approval.data.approval.revision, approvalId: approval.data.approval.id })).ok);
  const draft = Object.values(store.getState().drafts)[0];
  assert.ok(draft);
  return draft;
}

for (const kind of ["confirm", "flag", "material", "checkpoint", "withdraw", "assistant"] as const) test(kind + " uses the same unresolved command and completion callback after retry", async () => {
  let armed = false;
  const candidates: unknown[] = [];
  const store = createDomainStore({ dataMode: "fixture", commit: async (_revision, next) => {
    candidates.push(next);
    if (armed) { armed = false; return { ok: false, code: "STORAGE_READBACK_UNVERIFIED", reason: "readback unknown", retryable: true }; }
    return { ok: true };
  } });
  const draft = await preparedDraft(store);
  const section = draft.sections[0];
  const base = { actor: "user" as const, issuedAt: "2026-09-13T12:00:00Z", commandId: "exact-" + kind, entityId: draft.id, expectedRevision: draft.revision };
  const commands: Record<typeof kind, DomainCommand> = {
    confirm: { ...base, type: "confirmSections", sections: [{ sectionId: section.id, expectedContentVersion: section.contentVersion }] },
    flag: { ...base, type: "flagSectionIssue", sectionId: section.id, issue: "待核对" },
    material: { ...base, type: "registerMaterial", name: "未授权测试材料", version: 1, content: "保留原文", readPermission: "denied", sectionIds: [section.id] },
    checkpoint: { ...base, type: "saveCheckpoint", draftId: draft.id, nextStep: "继续检查" },
    withdraw: { ...base, type: "withdrawDraft", reason: "不再使用" },
    assistant: { ...base, type: "editDraftSection", sectionId: section.id, expectedContentVersion: section.contentVersion, content: "原助手建议" },
  };
  const controller = workspaceCommands(store);
  let completed = 0;
  armed = true;
  const first = await controller.run(kind, commands[kind], () => { completed++; });
  assert.equal(first.code, "STORAGE_READBACK_UNVERIFIED");
  const candidate = candidates.at(-1);
  assert.equal(completed, 0);
  assert.equal((await controller.retry())?.ok, true);
  assert.equal(candidates.at(-1), candidate);
  assert.equal(completed, 1);
});

test("definitive revision conflict retains the typed edit candidate but does not claim an unknown write", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const draft = await preparedDraft(store);
  const section = draft.sections[0];
  const controller = workspaceCommands(store);
  const command: DomainCommand = { type: "editDraftSection", actor: "user", issuedAt: "2026-09-13T12:00:00Z", commandId: "stale-edit", entityId: draft.id, expectedRevision: draft.revision + 1, sectionId: section.id, expectedContentVersion: section.contentVersion, content: "冲突时必须保留的正文" };
  const failed = await controller.run("edit:" + section.id, command);
  assert.equal(failed.code, "REVISION_CONFLICT");
  assert.equal(controller.getSnapshot().pending, null);
  assert.deepEqual(failed.command, command);
  assert.equal(store.getState().drafts[draft.id].sections[0].content, section.content);
});

test("postwrite revision conflict remains uncertain and retains the original command", async () => {
  let armed = false;
  const store = createDomainStore({ dataMode: "fixture", commit: async (_revision, next) => {
    if (armed) {
      armed = false;
      store.adoptExternalState({ ...structuredClone(next), globalRevision: next.globalRevision + 1 });
    }
    return { ok: true };
  } });
  const draft = await preparedDraft(store);
  const section = draft.sections[0];
  const controller = workspaceCommands(store);
  const command: DomainCommand = { type: "editDraftSection", actor: "user", issuedAt: "2026-09-13T12:00:00Z", commandId: "postwrite-edit", entityId: draft.id, expectedRevision: draft.revision, sectionId: section.id, expectedContentVersion: section.contentVersion, content: "已写后发生外部变化" };
  armed = true;
  const result = await controller.run("edit:" + section.id, command);
  assert.equal(result.code, "REVISION_CONFLICT");
  assert.deepEqual(controller.getSnapshot().pending?.command, command);
});

test("postwrite unknown retries the same immutable candidate once and blocks other draft mutations", async () => {
  const backing = new InMemoryStorage();
  let failReads = false;
  let arm = false;
  let writes = 0;
  const storage: StorageLike = {
    getItem: key => { if (failReads) throw new Error("readback blocked"); return backing.getItem(key); },
    setItem: (key, value) => { backing.setItem(key, value); writes++; if (arm) { arm = false; failReads = true; } },
    removeItem: key => backing.removeItem(key),
  };
  const handle = await createPersistedDomainStore({ dataMode: "fixture", storage });
  assert.equal(handle.status, "ready");
  if (handle.status !== "ready") return;
  const store = handle.store;
  const base = { actor: "user" as const, issuedAt: "2026-09-13T12:00:00Z" };
  const selected = await store.execute({ ...base, commandId: "ws-plan", type: "selectPlan", entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" });
  assert.ok(selected.ok);
  const granted = await store.execute({ ...base, commandId: "ws-grant", type: "grantApproval", entityId: selected.data.plan.id, expectedRevision: selected.data.plan.revision, changeSetId: selected.data.changeSet.id, grants: ["readMaterial", "createLocalDraft", "updateEstimate"] });
  assert.ok(granted.ok);
  const operated = await store.execute({ ...base, commandId: "ws-start", type: "startOperation", entityId: granted.data.approval.id, expectedRevision: granted.data.approval.revision, approvalId: granted.data.approval.id });
  assert.ok(operated.ok);
  const draft = Object.values(store.getState().drafts)[0];
  assert.ok(draft);
  const section = draft.sections[0];
  assert.ok(section);
  const command: DomainCommand = { ...base, type: "editDraftSection", commandId: "ws-exact", entityId: draft.id, expectedRevision: draft.revision, sectionId: section.id, expectedContentVersion: section.contentVersion, content: "保留原样的未知正文" };
  const controller = workspaceCommands(store);
  let completed = 0;
  arm = true;
  const failed = await controller.run("edit:" + section.id, command, () => { completed++; });
  assert.equal(failed.ok, false);
  assert.equal(controller.getSnapshot().pending?.command.commandId, "ws-exact");
  command.content = "不能替换已提交候选";
  const blocked = await controller.run("checkpoint", { ...base, commandId: "ws-other", type: "saveCheckpoint", entityId: "another-draft", expectedRevision: 1, draftId: "another-draft" });
  assert.equal(blocked.code, "WORKSPACE_UNRESOLVED");
  failReads = false;
  const before = writes;
  assert.equal(workspaceCommands(store), controller);
  const retried = await controller.run("edit:" + section.id, { ...command, commandId: "wrong-new-id" });
  assert.equal(retried.ok, true);
  assert.equal(writes, before);
  assert.equal(completed, 1);
  assert.equal(store.getState().drafts[draft.id].sections[0].content, "保留原样的未知正文");
  assert.equal(controller.getSnapshot().pending, null);
});
