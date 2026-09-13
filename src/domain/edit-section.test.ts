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

const FULL_GRANTS = ["readMaterial", "createLocalDraft", "updateEstimate"] as const;

async function makeDraft(store: ReturnType<typeof newStore>): Promise<Draft> {
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  asOk(await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })));
  return Object.values(store.getState().drafts)[0];
}

function movedSourceProvider() {
  return {
    async readSnapshot() { return { ok: true as const, value: { intervals: [], version: 2 } }; },
    async sync() { return { ok: true as const, value: { intervals: [], version: 2 } }; },
    async executeAllowedAction() { return { ok: false as const, reason: "unused" }; },
    async readback() { return { ok: false as const, reason: "unused" }; },
    async revokeAccess() { return { ok: false as const, reason: "unused" }; },
  };
}

function countNotifications(store: ReturnType<typeof newStore>): () => number {
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  return () => notified;
}

test("editDraftSection applies the user's text to one section, invalidates only that confirmation, and leaves the sibling section untouched", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  asOk(
    await store.execute(
      cmd("flagSectionIssue", { entityId: draft.id, expectedRevision: draft.revision, sectionId: draft.sections[0].id, issue: "第三段数据与我的记录不一致" }),
    ),
  );
  const confirmed = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: store.getState().drafts[draft.id].revision,
        sections: draft.sections.map((s) => ({ sectionId: s.id, expectedContentVersion: s.contentVersion })),
      }),
    ),
  );
  assert.equal(confirmed.rejected.length, 0);
  const before = structuredClone(store.getState().drafts[draft.id]);
  const data = asOk(
    await store.execute(
      cmd("editDraftSection", {
        entityId: before.id,
        expectedRevision: before.revision,
        sectionId: before.sections[0].id,
        expectedContentVersion: before.sections[0].contentVersion,
        content: "用户改写后的对比结论",
      }),
    ),
  );
  const edited = data.draft;
  assert.equal(edited.revision, before.revision + 1);
  assert.equal(edited.version, before.version + 1);
  assert.equal(edited.sections[0].content, "用户改写后的对比结论");
  assert.equal(edited.sections[0].contentVersion, before.sections[0].contentVersion + 1);
  assert.equal(edited.sections[0].reviewStatus, "pendingReview");
  assert.equal(edited.sections[0].confirmedBy, null);
  assert.equal(edited.sections[0].confirmedAt, null);
  assert.ok(edited.sections[0].confirmationInvalidReason);
  assert.ok(edited.sections[0].confirmationInvalidReason?.includes("edited"));
  assert.deepEqual(edited.sections[0].openIssues, before.sections[0].openIssues);
  assert.deepEqual(edited.sections[0].sourceRefs, before.sections[0].sourceRefs);
  assert.deepEqual(edited.sections[0].sourceVersions, before.sections[0].sourceVersions);
  assert.deepEqual(edited.sections[1], before.sections[1]);
  assert.equal(edited.sentAt, null);
  assert.equal(edited.status, "partiallyConfirmed");
  assert.deepEqual(store.getState().drafts[edited.id], edited);
  const events = store.getState().events;
  assert.equal(events[events.length - 1].type, "draft.sectionEdited");
});

test("editDraftSection rejects a stale draft revision and preserves the exact draft with zero notifications", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const before = structuredClone(draft);
  const notified = countNotifications(store);
  const f = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: draft.revision + 3,
        sectionId: draft.sections[0].id,
        expectedContentVersion: draft.sections[0].contentVersion,
        content: "迟到的编辑",
      }),
    ),
  );
  assert.equal(f.code, "REVISION_CONFLICT");
  assert.deepEqual(store.getState().drafts[draft.id], before);
  assert.equal(notified(), 0);
});

test("editDraftSection rejects a stale section contentVersion and preserves the exact draft with zero notifications", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const before = structuredClone(draft);
  const notified = countNotifications(store);
  const f = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sectionId: draft.sections[0].id,
        expectedContentVersion: 99,
        content: "基于过期版本的编辑",
      }),
    ),
  );
  assert.equal(f.code, "CONFLICT");
  assert.ok(f.reason.includes("content moved"));
  assert.deepEqual(store.getState().drafts[draft.id], before);
  assert.equal(notified(), 0);
});

test("editDraftSection rejects when a bound source version moved on and preserves the exact draft with zero notifications", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  asOk(
    await store.execute(
      cmd("syncSource", { entityId: FIXTURE_IDS.sourceCalendar, expectedRevision: 1, provider: movedSourceProvider() }),
    ),
  );
  const before = structuredClone(store.getState().drafts[draft.id]);
  const notified = countNotifications(store);
  const f = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: before.revision,
        sectionId: before.sections[0].id,
        expectedContentVersion: before.sections[0].contentVersion,
        content: "基于变更来源的编辑",
      }),
    ),
  );
  assert.equal(f.code, "CONFLICT");
  assert.ok(f.reason.includes(FIXTURE_IDS.sourceCalendar));
  assert.deepEqual(store.getState().drafts[draft.id], before);
  assert.equal(notified(), 0);
});

test("editDraftSection is user-only and rejects unknown sections", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const before = structuredClone(draft);
  const notified = countNotifications(store);
  const modelFail = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        actor: "model",
        entityId: draft.id,
        expectedRevision: draft.revision,
        sectionId: draft.sections[0].id,
        expectedContentVersion: draft.sections[0].contentVersion,
        content: "模型擅自改写",
      }),
    ),
  );
  assert.equal(modelFail.code, "USER_ONLY");
  const unknownFail = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sectionId: "no-such-section",
        expectedContentVersion: 1,
        content: "x",
      }),
    ),
  );
  assert.equal(unknownFail.code, "ENTITY_NOT_FOUND");
  assert.deepEqual(store.getState().drafts[draft.id], before);
  assert.equal(notified(), 0);
});

test("editDraftSection rejects a sent draft and preserves the exact draft with zero notifications", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const sentState = structuredClone(store.getState());
  const sentDraft = sentState.drafts[draft.id];
  sentDraft.sentAt = NOW;
  sentDraft.status = "sent";
  const sentStore = newStore({ initialState: sentState });
  const before = structuredClone(sentDraft);
  const notified = countNotifications(sentStore);
  const f = asFailure(
    await sentStore.execute(
      cmd("editDraftSection", {
        entityId: sentDraft.id,
        expectedRevision: sentDraft.revision,
        sectionId: sentDraft.sections[0].id,
        expectedContentVersion: sentDraft.sections[0].contentVersion,
        content: "发送后的迟到编辑",
      }),
    ),
  );
  assert.equal(f.code, "INVALID_TRANSITION");
  assert.deepEqual(sentStore.getState().drafts[sentDraft.id], before);
  assert.equal(notified(), 0);
});

test("editDraftSection accepts empty text as a legitimate editor value without inventing content", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const before = structuredClone(draft);
  const data = asOk(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sectionId: draft.sections[0].id,
        expectedContentVersion: draft.sections[0].contentVersion,
        content: "",
      }),
    ),
  );
  assert.equal(data.draft.sections[0].content, "");
  assert.equal(data.draft.sections[0].contentVersion, before.sections[0].contentVersion + 1);
  assert.equal(data.draft.sections[0].reviewStatus, "pendingReview");
  assert.equal(data.draft.sections[0].confirmedBy, null);
  assert.equal(data.draft.sections[0].confirmedAt, null);
  assert.equal(data.draft.sections[0].confirmationInvalidReason, null);
  assert.deepEqual(data.draft.sections[1], before.sections[1]);
  assert.equal(data.draft.sentAt, null);
});

test("editDraftSection rejects non-string content at the domain boundary without publishing", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const before = structuredClone(draft);
  const notified = countNotifications(store);
  const badCommand = {
    type: "editDraftSection",
    commandId: "cmd-bad-content-type",
    entityId: draft.id,
    expectedRevision: draft.revision,
    actor: "user",
    issuedAt: NOW,
    sectionId: draft.sections[0].id,
    expectedContentVersion: draft.sections[0].contentVersion,
    content: 42,
  } as unknown as DomainCommand;
  const f = asFailure(await store.execute(badCommand));
  assert.equal(f.code, "INVALID_INPUT");
  assert.ok(f.reason.includes("content"));
  assert.ok(f.reason.includes("string"));
  assert.deepEqual(store.getState().drafts[draft.id], before);
  assert.equal(notified(), 0);
});

test("editDraftSection with a failing commit publishes no success notification and preserves the exact draft", async () => {
  const store = newStore();
  const draft = await makeDraft(store);
  const snapshotState = structuredClone(store.getState());
  const failingStore = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    initialState: snapshotState,
    commit: async () => ({ ok: false as const, code: "STORAGE_WRITE_FAILED" as const, reason: "disk full", retryable: true }),
  });
  const before = structuredClone(snapshotState.drafts[draft.id]);
  const notified = countNotifications(failingStore);
  const f = asFailure(
    await failingStore.execute(
      cmd("editDraftSection", {
        entityId: before.id,
        expectedRevision: before.revision,
        sectionId: before.sections[0].id,
        expectedContentVersion: before.sections[0].contentVersion,
        content: "已输入但未落盘的文本",
      }),
    ),
  );
  assert.equal(f.code, "STORAGE_WRITE_FAILED");
  assert.deepEqual(failingStore.getState().drafts[draft.id], before);
  assert.equal(notified(), 0);
});
