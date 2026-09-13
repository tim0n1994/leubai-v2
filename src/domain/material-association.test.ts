/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_IDS,
  createDomainStore,
} from "./index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
  DomainState,
  Draft,
  FailureCode,
} from "./index.ts";

const NOW = "2026-09-12T10:00:00+08:00";
let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "uuid-" + uuidSeq;
}

function newStore(overrides?: { initialState?: DomainState }) {
  return createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    initialState: overrides?.initialState,
  });
}

function newStoreWithFailingCommit(initialState: DomainState) {
  return createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    initialState,
    commit: async () => ({
      ok: false as const,
      code: "STORAGE_WRITE_FAILED" as const,
      reason: "injected commit failure",
      retryable: false,
    }),
  });
}

function cmd<T extends CommandType>(
  type: T,
  rest: Omit<Extract<DomainCommand, { type: T }>, "type" | "commandId" | "actor" | "issuedAt"> &
    Partial<Pick<CommandBase, "actor" | "commandId">>,
): Extract<DomainCommand, { type: T }> {
  commandSeq += 1;
  return {
    type,
    commandId: rest.commandId ?? "cmd-" + commandSeq,
    actor: "user",
    issuedAt: NOW,
    ...rest,
  } as Extract<DomainCommand, { type: T }>;
}

function asOk<T extends DomainCommand>(result: CommandResult<T>): CommandDataOf<T> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

function asFailure(result: CommandResult<DomainCommand>): { code: FailureCode; reason: string } {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

const jsonOf = (value: unknown) => JSON.stringify(value);

const FULL_GRANTS = ["readMaterial", "createLocalDraft", "updateEstimate"] as const;

async function makeDraft(store: ReturnType<typeof newStore>): Promise<Draft> {
  const knownDraftIds = new Set(Object.keys(store.getState().drafts));
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  asOk(await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })));
  const draft = Object.values(store.getState().drafts).find((d) => !knownDraftIds.has(d.id));
  if (!draft || draft.sections.length !== 2) throw new Error("authorized operation did not create a two-section draft");
  return draft;
}

test("registerMaterial (granted, local text) stores the text, links the material, and applies it only to the selected section", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const comparison = draft.sections[0];
  const cost = draft.sections[1];
  const before = structuredClone(store.getState().drafts[draft.id]);
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "本地复盘笔记",
        content: "这是用户本地的真实材料文本，不来自网络",
        readPermission: "granted",
        sectionIds: [comparison.id],
        version: 2,
      }),
    ),
  );
  const material = data.material;
  assert.ok(material, "registerMaterial must return the material");
  const after = data.draft;
  assert.ok(after, "registerMaterial must return the draft");
  assert.equal(material.verified, false, "registration must never claim verification");
  assert.equal(material.readPermission, "granted");
  assert.equal(material.draftId, draft.id);
  assert.deepEqual(material.sectionIds, [comparison.id]);
  assert.equal(material.content, "这是用户本地的真实材料文本，不来自网络");
  assert.equal(material.accessRef, null);
  assert.equal(material.version, 2);

  const cmpAfter = after.sections.find((s) => s.id === comparison.id);
  assert.ok(cmpAfter, "selected section still present");
  assert.ok(cmpAfter.sourceRefs.includes(material.id), "selected section must reference the material");
  assert.equal(cmpAfter.sourceVersions[material.id], 2);
  assert.ok(cmpAfter.sourceRefs.includes(FIXTURE_IDS.sourceCalendar), "earlier section sources preserved");
  assert.equal(cmpAfter.sourceVersions[FIXTURE_IDS.sourceCalendar], 1);
  assert.equal(cmpAfter.contentVersion, comparison.contentVersion + 1, "selected contentVersion must move");
  assert.ok(after.sources.includes(material.id), "material id added to draft.sources");
  assert.ok(after.sources.includes(FIXTURE_IDS.sourceCalendar), "earlier draft sources preserved");
  assert.equal(after.version, before.version + 1);
  assert.equal(after.revision, before.revision + 1);

  const costAfter = after.sections.find((s) => s.id === cost.id);
  assert.ok(costAfter, "unselected section still present");
  assert.equal(jsonOf(costAfter), jsonOf(cost), "unselected section must stay byte-equivalent");
});

test("registerMaterial (granted, explicit reference) stores the reference only and performs no fetch", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const comparison = draft.sections[0];
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "Q2 数据表引用",
        accessRef: "local://sheets/q2",
        readPermission: "granted",
        sectionIds: [comparison.id],
        version: 3,
      }),
    ),
  );
  const material = data.material;
  assert.ok(material, "registerMaterial must return the material");
  assert.equal(material.accessRef, "local://sheets/q2");
  assert.equal(material.content, null, "no content is invented for a reference-only material");
  assert.equal(material.verified, false, "storing a reference is not accessibility proof");
  const current = data.draft;
  assert.ok(current, "registerMaterial must return the draft");
  const cmpAfter = current.sections.find((s) => s.id === comparison.id);
  assert.ok(cmpAfter, "selected section still present");
  assert.equal(cmpAfter.sourceVersions[material.id], 3);
});

test("registerMaterial (denied) stores metadata but never applies source refs or changes the draft", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const before = structuredClone(store.getState().drafts[draft.id]);
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "拒绝使用的材料",
        content: "这段内容不允许被读取或引用",
        accessRef: "local://private/x",
        readPermission: "denied",
        sectionIds: [draft.sections[0].id],
        version: 1,
      }),
    ),
  );
  const material = data.material;
  assert.ok(material, "denied registration still records the material");
  assert.equal(material.readPermission, "denied");
  assert.equal(material.verified, false);
  assert.equal(material.draftId, draft.id);
  const after = data.draft;
  assert.ok(after, "denied registration may return the unchanged draft");
  assert.equal(jsonOf(after), jsonOf(before), "denied registration must not change the draft");
  const state = store.getState();
  assert.ok(state.materials[material.id], "material stored in state");
  assert.equal(
    jsonOf(state.drafts[draft.id]),
    jsonOf(before),
    "denied material must not touch sections, sourceRefs, sourceVersions, or versions",
  );
});

test("granted material invalidates only the selected confirmed section; sibling confirmation and sources stay byte-equivalent", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const confirmed = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sections: draft.sections.map((s) => ({ sectionId: s.id, expectedContentVersion: s.contentVersion })),
      }),
    ),
  );
  assert.equal(confirmed.rejected.length, 0);
  const before = structuredClone(store.getState().drafts[draft.id]);
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: before.revision,
        name: "补充材料",
        content: "新补充的本地材料文本",
        readPermission: "granted",
        sectionIds: [before.sections[0].id],
        version: 1,
      }),
    ),
  );
  const after = data.draft;
  assert.ok(after, "registerMaterial must return the draft");
  const selected = after.sections.find((s) => s.id === before.sections[0].id);
  assert.ok(selected, "selected section still present");
  assert.ok(selected.sourceVersions[data.material.id], "material applied to selected section");
  assert.equal(selected.reviewStatus, "pendingReview", "selected confirmation invalidated");
  assert.equal(selected.confirmedBy, null);
  assert.equal(selected.confirmedAt, null);
  assert.ok(selected.confirmationInvalidReason, "invalidation reason recorded");
  assert.equal(selected.contentVersion, before.sections[0].contentVersion + 1);
  const sibling = after.sections.find((s) => s.id === before.sections[1].id);
  assert.ok(sibling, "sibling section still present");
  assert.equal(jsonOf(sibling), jsonOf(before.sections[1]), "sibling section must stay byte-equivalent");
  assert.equal(sibling.reviewStatus, "confirmed");
  assert.equal(after.status, "partiallyConfirmed");
});

test("a previously opened confirm request cannot confirm a newly sourced section, but the current version can", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const comparison = draft.sections[0];
  const oldVersion = comparison.contentVersion;
  asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "新来源材料",
        content: "新材料文本",
        readPermission: "granted",
        sectionIds: [comparison.id],
        version: 5,
      }),
    ),
  );
  const stale = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: store.getState().drafts[draft.id].revision,
        sections: [{ sectionId: comparison.id, expectedContentVersion: oldVersion }],
      }),
    ),
  );
  assert.equal(stale.rejected.length, 1, "stale confirm request must be rejected");
  assert.equal(stale.rejected[0].sectionId, comparison.id);
  assert.ok(stale.rejected[0].reason.includes("content moved"));
  assert.equal(stale.draft.sections.find((s) => s.id === comparison.id)?.reviewStatus, "pendingReview");

  const current = store.getState().drafts[draft.id].sections.find((s) => s.id === comparison.id);
  assert.ok(current, "section present");
  const fresh = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: store.getState().drafts[draft.id].revision,
        sections: [{ sectionId: comparison.id, expectedContentVersion: current.contentVersion }],
      }),
    ),
  );
  assert.equal(fresh.rejected.length, 0, "current version is confirmable");
  assert.equal(fresh.draft.sections.find((s) => s.id === comparison.id)?.reviewStatus, "confirmed");
});

test("registerMaterial rejects unknown sections, stale revisions, wrong actors, invalid inputs, unknown drafts, and sent drafts", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const base = {
    entityId: draft.id,
    expectedRevision: draft.revision,
    name: "材料",
    accessRef: "local://a",
    version: 1,
    readPermission: "granted" as const,
    sectionIds: [draft.sections[0].id],
  };
  let f = asFailure(await store.execute(cmd("registerMaterial", { ...base, sectionIds: ["no-such-section"] })));
  assert.equal(f.code, "INVALID_INPUT");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, sectionIds: [] })));
  assert.equal(f.code, "INVALID_INPUT");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, name: "   " })));
  assert.equal(f.code, "INVALID_INPUT");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, version: 0 })));
  assert.equal(f.code, "INVALID_INPUT");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, version: 1.5 })));
  assert.equal(f.code, "INVALID_INPUT");
  f = asFailure(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "材料",
        version: 1,
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
      }),
    ),
  );
  assert.equal(f.code, "INVALID_INPUT", "content and accessRef both missing must be rejected");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, entityId: "no-such-draft" })));
  assert.equal(f.code, "ENTITY_NOT_FOUND");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, expectedRevision: draft.revision + 5 })));
  assert.equal(f.code, "REVISION_CONFLICT");
  f = asFailure(await store.execute(cmd("registerMaterial", { ...base, actor: "model" })));
  assert.equal(f.code, "USER_ONLY");

  const sentState = structuredClone(store.getState());
  sentState.drafts[draft.id].sentAt = NOW;
  sentState.drafts[draft.id].status = "sent";
  const sentStore = newStore({ initialState: sentState });
  f = asFailure(await sentStore.execute(cmd("registerMaterial", base)));
  assert.equal(f.code, "INVALID_TRANSITION", "sent drafts must not accept new materials");
});

test("a granted material does not make editDraftSection falsely report a missing source", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const registered = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "编辑材料",
        content: "材料文本",
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
        version: 2,
      }),
    ),
  );
  const current = store.getState().drafts[draft.id];
  const section = current.sections.find((s) => s.id === draft.sections[0].id);
  assert.ok(section, "section present");
  assert.equal(section.sourceVersions[registered.material.id], 2, "material bound before edit");
  const edited = asOk(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: current.revision,
        sectionId: section.id,
        expectedContentVersion: section.contentVersion,
        content: "合并材料后的用户改写",
      }),
    ),
  );
  const editedSection = edited.draft.sections.find((s) => s.id === section.id);
  assert.ok(editedSection, "edited section present");
  assert.equal(editedSection.content, "合并材料后的用户改写");
  assert.equal(editedSection.contentVersion, section.contentVersion + 1);
  assert.ok(editedSection.sourceRefs.includes(registered.material.id), "material binding preserved through edit");
});

test("editDraftSection detects a changed bound material version", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const registered = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "会变版本的材料",
        accessRef: "local://mutating",
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
        version: 2,
      }),
    ),
  );
  const mutated = structuredClone(store.getState());
  mutated.materials[registered.material.id].version = 3;
  const store2 = newStore({ initialState: mutated });
  const current = store2.getState().drafts[draft.id];
  const section = current.sections.find((s) => s.id === draft.sections[0].id);
  assert.ok(section, "section present");
  const f = asFailure(
    await store2.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: current.revision,
        sectionId: section.id,
        expectedContentVersion: section.contentVersion,
        content: "新的改写",
      }),
    ),
  );
  assert.equal(f.code, "CONFLICT");
  assert.ok(f.reason.includes(registered.material.id), "failure names the moved material");
});

test("confirmSections rejects a section whose bound material version changed", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const registered = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "确认前变化",
        content: "文本",
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
        version: 2,
      }),
    ),
  );
  const mutated = structuredClone(store.getState());
  mutated.materials[registered.material.id].version = 7;
  const store2 = newStore({ initialState: mutated });
  const current = store2.getState().drafts[draft.id];
  const section = current.sections.find((s) => s.id === draft.sections[0].id);
  assert.ok(section, "section present");
  const data = asOk(
    await store2.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: current.revision,
        sections: [{ sectionId: section.id, expectedContentVersion: section.contentVersion }],
      }),
    ),
  );
  assert.equal(data.rejected.length, 1);
  assert.ok(data.rejected[0].reason.includes(registered.material.id), "rejection names the moved material");
  assert.equal(data.draft.sections.find((s) => s.id === section.id)?.reviewStatus, "pendingReview");
});

test("saveCheckpoint scopes materials to this draft's granted applied set, excluding denied and unrelated-draft materials", async () => {
  const store = newStore();
  const d1 = await makeDraft(store);
  const d2 = await makeDraft(store);
  const grantedA = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: d1.id,
        expectedRevision: d1.revision,
        name: "草稿一材料",
        content: "A 文本",
        readPermission: "granted",
        sectionIds: [d1.sections[0].id],
        version: 4,
      }),
    ),
  );
  const d1AfterA = store.getState().drafts[d1.id];
  asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: d1.id,
        expectedRevision: d1AfterA.revision,
        name: "拒绝材料",
        content: "D 文本",
        readPermission: "denied",
        sectionIds: [d1.sections[0].id],
        version: 1,
      }),
    ),
  );
  asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: d2.id,
        expectedRevision: d2.revision,
        name: "草稿二材料",
        accessRef: "local://other-draft",
        readPermission: "granted",
        sectionIds: [d2.sections[0].id],
        version: 2,
      }),
    ),
  );
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: d1.id, expectedRevision: store.getState().drafts[d1.id].revision, draftId: d1.id, nextStep: "逐节复核" })),
  );
  const cp = saved.checkpoint;
  assert.equal(cp.materials.length, 1, "only this draft's granted applied material is claimed");
  assert.equal(cp.materials[0].id, grantedA.material.id);
  assert.equal(cp.materials[0].version, 4);
  assert.deepEqual(cp.sourceVersionSet, {
    [FIXTURE_IDS.sourceCalendar]: 1,
    [grantedA.material.id]: 4,
  });
  const resumed = asOk(
    await store.execute(cmd("resumeCheckpoint", { entityId: cp.id, expectedRevision: cp.revision })),
  );
  assert.deepEqual(resumed.validation.staleSourceIds, []);
  assert.equal(resumed.validation.requiresReview, false);
});

test("resumeCheckpoint detects a changed bound material version", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const registered = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "检查点材料",
        content: "文本",
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
        version: 2,
      }),
    ),
  );
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: store.getState().drafts[draft.id].revision, draftId: draft.id, nextStep: null })),
  );
  const mutated = structuredClone(store.getState());
  mutated.materials[registered.material.id].version = 9;
  const store2 = newStore({ initialState: mutated });
  const resumed = asOk(
    await store2.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.deepEqual(resumed.validation.staleSourceIds, [registered.material.id]);
  assert.equal(resumed.validation.requiresReview, true);
});

test("legacy unlinked materials are never retroactively granted and stay excluded from checkpoints", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const withLegacy = structuredClone(store.getState());
  withLegacy.materials["legacy-mat-1"] = {
    id: "legacy-mat-1",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    dataMode: "fixture",
    provenance: { origin: "user" },
    name: "旧未链接材料",
    accessRef: "local://old",
    version: 1,
    verified: false,
  };
  const store2 = newStore({ initialState: withLegacy });
  const saved = asOk(
    await store2.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: store2.getState().drafts[draft.id].revision, draftId: draft.id, nextStep: null })),
  );
  assert.equal(saved.checkpoint.materials.length, 0, "legacy unlinked material must not be claimed");
  assert.deepEqual(saved.checkpoint.sourceVersionSet, { [FIXTURE_IDS.sourceCalendar]: 1 });

  const bound = structuredClone(withLegacy);
  bound.drafts[draft.id].sections[0].sourceVersions["legacy-mat-1"] = 1;
  const store3 = newStore({ initialState: bound });
  const current = store3.getState().drafts[draft.id];
  const f = asFailure(
    await store3.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: current.revision,
        sectionId: draft.sections[0].id,
        expectedContentVersion: current.sections[0].contentVersion,
        content: "尝试编辑",
      }),
    ),
  );
  assert.equal(f.code, "CONFLICT", "legacy material must fail closed as a bound ref");
});

test("a failed store commit cannot publish the material or the draft", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "已成功材料",
        accessRef: "local://ok",
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
        version: 1,
      }),
    ),
  );
  const snapshot = structuredClone(store.getState());
  const failing = newStoreWithFailingCommit(snapshot);
  const result = await failing.execute(
    cmd("registerMaterial", {
      entityId: draft.id,
      expectedRevision: snapshot.drafts[draft.id].revision,
      name: "未发布材料",
      content: "不应被发布的文本",
      readPermission: "granted",
      sectionIds: [snapshot.drafts[draft.id].sections[0].id],
      version: 1,
    }),
  );
  assert.equal(result.ok, false, "failed commit must fail the command");
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "STORAGE_WRITE_FAILED");
  const after = failing.getState();
  assert.equal(jsonOf(after.drafts[draft.id]), jsonOf(snapshot.drafts[draft.id]), "draft must not move");
  assert.equal(
    Object.keys(after.materials).length,
    Object.keys(snapshot.materials).length,
    "no material may be published on a failed commit",
  );
});

test("registerMaterial granted is typed-rejected while the global readMaterial grant is revoked; nothing may move", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  asOk(
    await store.execute(
      cmd("updateRules", {
        entityId: null,
        expectedRevision: null,
        grants: { readMaterial: false },
        summary: "revoke global material read",
      }),
    ),
  );
  const before = structuredClone(store.getState());
  const f = asFailure(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: before.drafts[draft.id].revision,
        name: "全局撤销后的材料",
        content: "用户明确同意读取的本地文本",
        readPermission: "granted",
        sectionIds: [before.drafts[draft.id].sections[0].id],
        version: 1,
      }),
    ),
  );
  assert.equal(f.code, "INVALID_GRANT", "per-material consent must not override the revoked global policy");
  assert.ok(f.reason.includes("readMaterial"), "failure names the revoked grant");
  const after = store.getState();
  assert.equal(jsonOf(after), jsonOf(before), "typed rejection must leave the whole state unchanged");
  assert.equal(after.events.length, before.events.length, "no event may be committed");
  assert.equal(after.globalRevision, before.globalRevision, "no commit may move the global revision");

  asOk(
    await store.execute(
      cmd("updateRules", {
        entityId: null,
        expectedRevision: null,
        grants: { readMaterial: true },
        summary: "restore global material read",
      }),
    ),
  );
  const current = store.getState().drafts[draft.id];
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: current.revision,
        name: "全局恢复后的材料",
        content: "同一份用户本地文本",
        readPermission: "granted",
        sectionIds: [current.sections[0].id],
        version: 1,
      }),
    ),
  );
  assert.equal(data.material.readPermission, "granted", "restoring the global grant unblocks granted registration");
});

test("registerMaterial denied still records metadata while the global readMaterial grant is revoked, and binds nothing", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  asOk(
    await store.execute(
      cmd("updateRules", {
        entityId: null,
        expectedRevision: null,
        grants: { readMaterial: false },
        summary: "revoke global material read",
      }),
    ),
  );
  const before = structuredClone(store.getState().drafts[draft.id]);
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: before.revision,
        name: "全局撤销下仍登记的拒绝材料",
        content: "仅保存元数据和本地文本",
        readPermission: "denied",
        sectionIds: [before.sections[0].id],
        version: 1,
      }),
    ),
  );
  const material = data.material;
  assert.ok(material, "denied registration still records the material");
  assert.equal(material.readPermission, "denied");
  assert.equal(material.verified, false);
  assert.equal(material.draftId, draft.id);
  const after = store.getState();
  assert.equal(after.materials[material.id].readPermission, "denied");
  assert.equal(jsonOf(after.drafts[draft.id]), jsonOf(before), "denied material must not bind sources or change the draft");
});

test("revoking the global readMaterial grant makes existing granted bindings require review instead of claiming valid", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const registered = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "随后被全局撤销的材料",
        content: "已经绑定进草稿的本地文本",
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
        version: 2,
      }),
    ),
  );
  const materialId = registered.material.id;
  asOk(
    await store.execute(
      cmd("updateRules", {
        entityId: null,
        expectedRevision: null,
        grants: { readMaterial: false },
        summary: "revoke global material read",
      }),
    ),
  );

  const current = store.getState().drafts[draft.id];
  const section = current.sections.find((s) => s.id === draft.sections[0].id);
  assert.ok(section, "section present");
  const confirmed = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: current.revision,
        sections: [{ sectionId: section.id, expectedContentVersion: section.contentVersion }],
      }),
    ),
  );
  assert.equal(confirmed.rejected.length, 1, "confirmation must be rejected while global read is revoked");
  assert.equal(confirmed.rejected[0].sectionId, section.id);
  assert.ok(confirmed.rejected[0].reason.includes(materialId), "rejection names the unreadable material");
  assert.equal(confirmed.draft.sections.find((s) => s.id === section.id)?.reviewStatus, "pendingReview");

  const afterConfirm = store.getState().drafts[draft.id];
  const afterSection = afterConfirm.sections.find((s) => s.id === section.id);
  assert.ok(afterSection, "section still present after rejected confirmation");
  const f = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: afterConfirm.revision,
        sectionId: section.id,
        expectedContentVersion: afterSection.contentVersion,
        content: "尝试在撤销读取后改写",
      }),
    ),
  );
  assert.equal(f.code, "CONFLICT", "edit must fail closed while global read is revoked");
  assert.ok(f.reason.includes(materialId), "edit failure names the unreadable material");

  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: store.getState().drafts[draft.id].revision, draftId: draft.id, nextStep: null })),
  );
  const resumed = asOk(
    await store.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })),
  );
  assert.ok(resumed.validation.staleSourceIds.includes(materialId), "checkpoint validation must treat the material as stale");
  assert.equal(resumed.validation.requiresReview, true);
});
