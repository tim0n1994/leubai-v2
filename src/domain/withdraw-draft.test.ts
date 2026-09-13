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
  Operation,
  Approval,
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

function asFailure(result: CommandResult<DomainCommand>): { code: FailureCode; reason: string; retryable: boolean } {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

const jsonOf = (value: unknown) => JSON.stringify(value);

const FULL_GRANTS = ["readMaterial", "createLocalDraft", "updateEstimate"] as const;

async function makeAuthorizedDraft(store: ReturnType<typeof newStore>): Promise<{
  draft: Draft;
  operation: Operation;
  approval: Approval;
}> {
  const knownDraftIds = new Set(Object.keys(store.getState().drafts));
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const started = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const draft = Object.values(store.getState().drafts).find((d) => !knownDraftIds.has(d.id));
  if (!draft || draft.sections.length !== 2) throw new Error("authorized operation did not create a two-section draft");
  const operation = store.getState().operations[started.operation.id];
  const approval = store.getState().approvals[grant.approval.id];
  if (!operation || !approval) throw new Error("operation or approval missing after startOperation");
  return { draft, operation, approval };
}

test("withdrawDraft withdraws a real operation-generated draft: artifact fully preserved, approval stays consumed, operation and resultRefs stable", async () => {
  const store = newStore();
  const { draft, operation, approval } = await makeAuthorizedDraft(store);
  const beforeState = structuredClone(store.getState());
  const before = beforeState.drafts[draft.id];
  assert.notEqual(before.status, "withdrawn");

  const data = asOk(
    await store.execute(
      cmd("withdrawDraft", { entityId: draft.id, expectedRevision: draft.revision, reason: "不再需要这份草稿" }),
    ),
  );
  const withdrawn = data.draft;
  assert.ok(withdrawn, "withdrawDraft must return data.draft");
  assert.equal(withdrawn.id, draft.id);
  assert.equal(withdrawn.status, "withdrawn");
  assert.deepEqual(withdrawn.withdrawal, { withdrawnAt: NOW, reason: "不再需要这份草稿" });
  assert.equal(withdrawn.version, before.version + 1, "withdrawal bumps draft version");
  assert.equal(withdrawn.revision, before.revision + 1, "withdrawal bumps draft revision");
  assert.equal(withdrawn.sentAt, null, "withdrawal is local-only and never sends");
  assert.equal(jsonOf(withdrawn.sections), jsonOf(before.sections), "sections, text, sources and confirmations preserved");
  assert.equal(jsonOf(withdrawn.sources), jsonOf(before.sources), "draft sources preserved");
  assert.deepEqual(withdrawn.openQuestions, before.openQuestions);
  assert.equal(withdrawn.operationId, before.operationId);
  assert.equal(withdrawn.commitmentId, before.commitmentId);

  const afterState = store.getState();
  assert.equal(afterState.events.length, beforeState.events.length + 1, "exactly one withdrawal event appended");
  assert.equal(jsonOf(afterState.events.slice(0, beforeState.events.length)), jsonOf(beforeState.events), "historical events preserved");
  const event = afterState.events[afterState.events.length - 1];
  assert.equal(event.type, "draft.withdrawn");
  assert.equal(event.actor, "user");
  assert.deepEqual(event.entityRevisions, [{ entityId: draft.id, before: draft.revision, after: draft.revision + 1 }]);

  const approvalAfter = afterState.approvals[approval.id];
  assert.equal(approvalAfter.status, "consumed", "consumed approval stays consumed");
  assert.equal(approvalAfter.consumedByOperationId, operation.id);
  const operationAfter = afterState.operations[operation.id];
  assert.equal(jsonOf(operationAfter), jsonOf(operation), "existing operation stays byte-stable");
  assert.ok(operationAfter.resultRefs.includes(draft.id), "authoritative resultRefs still point at the withdrawn artifact");
});

test("repeated withdrawal recovers the same withdrawn draft idempotently: no new event, no version bump, no metadata overwrite", async () => {
  const store = newStore();
  const { draft, operation, approval } = await makeAuthorizedDraft(store);
  const firstCmd = cmd("withdrawDraft", { entityId: draft.id, expectedRevision: draft.revision, reason: "第一次撤回" });
  asOk(await store.execute(firstCmd));
  const after1State = structuredClone(store.getState());
  const after1 = after1State.drafts[draft.id];

  const data2 = asOk(
    await store.execute(cmd("withdrawDraft", { entityId: draft.id, expectedRevision: after1.revision, reason: "第二次撤回", commandId: "cmd-repeat-new-id" })),
  );
  const data3 = asOk(await store.execute(firstCmd));
  const state3 = store.getState();

  assert.equal(jsonOf(data2.draft), jsonOf(after1), "repeat with a new commandId recovers the same withdrawn draft");
  assert.equal(jsonOf(data3.draft), jsonOf(after1), "same-commandId retry recovers the same withdrawn draft");
  assert.equal(data2.draft.version, after1.version, "no version bump on repeat");
  assert.equal(data2.draft.revision, after1.revision, "no revision bump on repeat");
  assert.deepEqual(data2.draft.withdrawal, { withdrawnAt: NOW, reason: "第一次撤回" }, "original withdrawal metadata is kept");
  assert.equal(state3.events.length, after1State.events.length, "no new event on repeat");
  assert.equal(state3.globalRevision, after1State.globalRevision, "global revision unchanged on repeat");

  const repeat = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: approval.id })),
  );
  assert.equal(repeat.operation.id, operation.id, "existing operation is recovered, never regenerated after withdrawal");
  assert.equal(
    Object.keys(store.getState().drafts).length,
    Object.keys(after1State.drafts).length,
    "no fresh draft is generated for the consumed operation after withdrawal",
  );
});

test("editDraftSection, confirmSections, flagSectionIssue and registerMaterial all reject withdrawn drafts, so no mutation can resurrect status", async () => {
  const store = newStore();
  const { draft } = await makeAuthorizedDraft(store);
  asOk(await store.execute(cmd("withdrawDraft", { entityId: draft.id, expectedRevision: draft.revision })));
  const guardState = structuredClone(store.getState());
  const withdrawn = guardState.drafts[draft.id];
  const section = withdrawn.sections[0];

  const fEdit = asFailure(
    await store.execute(
      cmd("editDraftSection", {
        entityId: draft.id,
        expectedRevision: withdrawn.revision,
        sectionId: section.id,
        expectedContentVersion: section.contentVersion,
        content: "撤回后的篡改",
      }),
    ),
  );
  assert.equal(fEdit.code, "INVALID_TRANSITION");
  const fConfirm = asFailure(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: withdrawn.revision,
        sections: [{ sectionId: section.id, expectedContentVersion: section.contentVersion }],
      }),
    ),
  );
  assert.equal(fConfirm.code, "INVALID_TRANSITION");
  const fFlag = asFailure(
    await store.execute(cmd("flagSectionIssue", { entityId: draft.id, expectedRevision: withdrawn.revision, sectionId: section.id, issue: "迟到的批注" })),
  );
  assert.equal(fFlag.code, "INVALID_TRANSITION");
  const fMaterial = asFailure(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: withdrawn.revision,
        name: "撤回后的材料",
        content: "局部文本",
        readPermission: "granted",
        sectionIds: [section.id],
        version: 1,
      }),
    ),
  );
  assert.equal(fMaterial.code, "INVALID_TRANSITION", "material registration must not resurrect or mutate a withdrawn draft");

  const afterState = store.getState();
  assert.equal(jsonOf(afterState.drafts[draft.id]), jsonOf(withdrawn), "withdrawn draft byte-stable after all rejected mutations");
  assert.equal(afterState.events.length, guardState.events.length, "rejected mutations publish no events");
  assert.equal(Object.keys(afterState.materials).length, Object.keys(guardState.materials).length, "no material created against a withdrawn draft");
  assert.equal(jsonOf(afterState.operations), jsonOf(guardState.operations), "operations untouched by rejected mutations");
});

test("withdrawDraft rejects wrong actor, stale first revision, sent drafts, and unknown ids", async () => {
  const store = newStore();
  const { draft } = await makeAuthorizedDraft(store);
  const beforeState = structuredClone(store.getState());

  const fActor = asFailure(
    await store.execute(cmd("withdrawDraft", { entityId: draft.id, expectedRevision: draft.revision, actor: "model" })),
  );
  assert.equal(fActor.code, "USER_ONLY", "only the user may withdraw");
  const fStale = asFailure(
    await store.execute(cmd("withdrawDraft", { entityId: draft.id, expectedRevision: draft.revision - 1 })),
  );
  assert.equal(fStale.code, "REVISION_CONFLICT");
  assert.equal(fStale.retryable, true);
  const fUnknown = asFailure(
    await store.execute(cmd("withdrawDraft", { entityId: "draft-does-not-exist", expectedRevision: 1 })),
  );
  assert.equal(fUnknown.code, "ENTITY_NOT_FOUND");

  const afterFailures = store.getState();
  assert.equal(jsonOf(afterFailures.drafts[draft.id]), jsonOf(beforeState.drafts[draft.id]), "rejected withdrawals change nothing");

  const sentState = structuredClone(afterFailures);
  sentState.drafts[draft.id].sentAt = NOW;
  sentState.drafts[draft.id].status = "sent";
  const sentStore = newStore({ initialState: sentState });
  const fSent = asFailure(
    await sentStore.execute(cmd("withdrawDraft", { entityId: draft.id, expectedRevision: sentState.drafts[draft.id].revision })),
  );
  assert.equal(fSent.code, "INVALID_TRANSITION", "local withdrawal cannot unsend a sent draft");
  const sentAfter = sentStore.getState().drafts[draft.id];
  assert.equal(sentAfter.status, "sent");
  assert.equal(sentAfter.withdrawal, undefined, "sent draft gains no withdrawal metadata");
  assert.equal(jsonOf(sentStore.getState().events), jsonOf(sentState.events), "sent rejection publishes no event");
});

test("a failing commit publishes nothing and preserves the prior local state", async () => {
  const fresh = newStore();
  const { draft } = await makeAuthorizedDraft(fresh);
  const stateWithDraft = structuredClone(fresh.getState());
  const before = stateWithDraft.drafts[draft.id];
  const failing = newStoreWithFailingCommit(stateWithDraft);

  const f = asFailure(
    await failing.execute(cmd("withdrawDraft", { entityId: draft.id, expectedRevision: before.revision, reason: "存储失败也要安全" })),
  );
  assert.equal(f.code, "STORAGE_WRITE_FAILED");
  const after = failing.getState().drafts[draft.id];
  assert.equal(jsonOf(after), jsonOf(before), "failed commit leaves the draft byte-unchanged");
  assert.notEqual(after.status, "withdrawn");
  assert.equal(after.withdrawal, undefined);
  assert.equal(failing.getState().events.length, stateWithDraft.events.length, "failed commit appends no event");
  assert.equal(failing.getState().globalRevision, stateWithDraft.globalRevision, "failed commit leaves global revision unchanged");
});
