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

function newStore() {
  return createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: testUuid });
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

async function makeDraft(store: ReturnType<typeof newStore>): Promise<{ draft: Draft; operationId: string }> {
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const draft = Object.values(store.getState().drafts)[0];
  return { draft, operationId: run.operation.id };
}

test("confirmSections confirms listed sections, keeps open issues, and never marks the draft sent", async () => {
  const store = newStore();
  const { draft } = await makeDraft(store);
  const data = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sections: [{ sectionId: draft.sections[0].id, expectedContentVersion: 1 }],
      }),
    ),
  );
  assert.equal(data.rejected.length, 0);
  assert.equal(data.draft.sections[0].reviewStatus, "confirmed");
  assert.equal(data.draft.sections[0].confirmedBy, "user");
  assert.equal(data.draft.status, "partiallyConfirmed");
  assert.equal(data.draft.sentAt, null);
  assert.deepEqual(data.draft.sections[0].openIssues, []);
});

test("confirmSections rejects stale content versions and leaves the section pending", async () => {
  const store = newStore();
  const { draft } = await makeDraft(store);
  const data = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sections: [{ sectionId: draft.sections[0].id, expectedContentVersion: 99 }],
      }),
    ),
  );
  assert.equal(data.rejected.length, 1);
  assert.equal(data.rejected[0].sectionId, draft.sections[0].id);
  assert.ok(data.rejected[0].reason);
  assert.equal(data.draft.sections[0].reviewStatus, "pendingReview");
});

test("flagSectionIssue keeps the section unconfirmed and records the judgment", async () => {
  const store = newStore();
  const { draft } = await makeDraft(store);
  const flagged = asOk(
    await store.execute(
      cmd("flagSectionIssue", { entityId: draft.id, expectedRevision: draft.revision, sectionId: draft.sections[0].id, issue: "第三段数据与我的记录不一致" }),
    ),
  );
  assert.ok(flagged.draft.sections[0].openIssues.includes("第三段数据与我的记录不一致"));
  assert.equal(flagged.draft.sections[0].reviewStatus, "pendingReview");
  const confirmed = asOk(
    await store.execute(
      cmd("flagSectionIssue", {
        entityId: flagged.draft.id,
        expectedRevision: flagged.draft.revision,
        sectionId: flagged.draft.sections[0].id,
        issue: "补充:时间范围也错了",
      }),
    ),
  );
  assert.equal(confirmed.draft.sections[0].reviewStatus, "pendingReview");
  assert.equal(confirmed.draft.status, "pendingReview");
  assert.equal(confirmed.draft.sentAt, null);
});

test("checkpoint stores actual versions and resume detects stale sources honestly", async () => {
  const store = newStore();
  const { draft } = await makeDraft(store);
  const saved = asOk(
    await store.execute(cmd("saveCheckpoint", { entityId: draft.id, expectedRevision: draft.revision, draftId: draft.id, nextStep: "逐节复核" })),
  );
  assert.equal(saved.checkpoint.draftId, draft.id);
  assert.equal(saved.checkpoint.draftVersion, draft.version);
  assert.deepEqual(saved.checkpoint.sourceVersionSet, { [FIXTURE_IDS.sourceCalendar]: 1 });
  const first = asOk(await store.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: saved.checkpoint.revision })));
  assert.deepEqual(first.validation.staleSourceIds, []);
  assert.equal(first.validation.requiresReview, false);
  asOk(
    await store.execute(cmd("syncSource", { entityId: FIXTURE_IDS.sourceCalendar, expectedRevision: 1, provider: {
      async readSnapshot() { return { ok: true as const, value: { intervals: [], version: 2 } }; },
      async sync() { return { ok: true as const, value: { intervals: [], version: 2 } }; },
      async executeAllowedAction() { return { ok: false as const, reason: "unused" }; },
      async readback() { return { ok: false as const, reason: "unused" }; },
      async revokeAccess() { return { ok: false as const, reason: "unused" }; },
    } })),
  );
  const second = asOk(
    await store.execute(cmd("resumeCheckpoint", { entityId: saved.checkpoint.id, expectedRevision: first.checkpoint.revision })),
  );
  assert.deepEqual(second.validation.staleSourceIds, [FIXTURE_IDS.sourceCalendar]);
  assert.equal(second.validation.requiresReview, true);
});

test("registerMaterial records the material without claiming verification", async () => {
  const store = newStore();
  const { draft } = await makeDraft(store);
  const data = asOk(
    await store.execute(
      cmd("registerMaterial", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        name: "Q2 复盘数据表",
        accessRef: "local://sheets/q2",
        version: 3,
        readPermission: "granted",
        sectionIds: [draft.sections[0].id],
      }),
    ),
  );
  assert.equal(data.material.name, "Q2 复盘数据表");
  assert.equal(data.material.version, 3);
  assert.equal(data.material.accessRef, "local://sheets/q2");
  assert.equal(data.material.verified, false);
});

test("updateRules is user-only, bumps the revision, records history, and invalidates bound approvals", async () => {
  const store = newStore();
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const modelFail = asFailure(
    await store.execute(cmd("updateRules", { actor: "model", entityId: null, expectedRevision: null, dailyCapacityMinutes: 150, summary: "模型试图改规则" })),
  );
  assert.equal(modelFail.code, "USER_ONLY");
  const data = asOk(
    await store.execute(
      cmd("updateRules", { entityId: null, expectedRevision: null, grants: { externalCalendarWrite: true }, dailyCapacityMinutes: 150, summary: "放宽外部写入与容量" }),
    ),
  );
  assert.equal(data.ruleset.revision, 2);
  assert.equal(data.ruleset.dailyCapacityMinutes, 150);
  assert.equal(data.ruleset.grants.externalCalendarWrite, true);
  const last = data.ruleset.history[data.ruleset.history.length - 1];
  assert.equal(last.revision, 2);
  assert.ok(last.changes.includes("grants"));
  assert.ok(last.changes.includes("dailyCapacityMinutes"));
  assert.deepEqual(data.invalidatedApprovalIds, [grant.approval.id]);
  assert.equal(store.getState().approvals[grant.approval.id].status, "invalid");
});

test("submitRuleCandidate never changes rules and becomes an attention item", async () => {
  const store = newStore();
  const before = store.getState().ruleset;
  const data = asOk(
    await store.execute(
      cmd("submitRuleCandidate", { actor: "model", entityId: null, expectedRevision: null, proposedChanges: "把弹性承诺默认压缩到 15 分钟", rationale: "近三周实际用时低于估计" }),
    ),
  );
  assert.equal(store.getState().ruleset.revision, before.revision);
  assert.deepEqual(store.getState().ruleset.grants, before.grants);
  assert.equal(data.attentionItem.source, "ai");
  assert.equal(data.attentionItem.status, "pending");
  assert.equal(data.attentionItem.budgetCharged, false);
});

test("pauseAutomation blocks new automatic steps while retaining data; resume revalidates", async () => {
  const store = newStore();
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const paused = asOk(await store.execute(cmd("pauseAutomation", { entityId: null, expectedRevision: null })));
  assert.equal(paused.ruleset.paused, true);
  assert.equal(paused.ruleset.pauseEpoch, 1);
  const blocked = asFailure(
    await store.execute(cmd("startOperation", { actor: "automation", entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(blocked.code, "AUTOMATION_PAUSED");
  assert.equal(store.getState().commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes, 60);
  const resumed = asOk(await store.execute(cmd("resumeAutomation", { entityId: null, expectedRevision: null })));
  assert.equal(resumed.ruleset.paused, false);
  assert.deepEqual(resumed.invalidatedApprovalIds, []);
  const run = asOk(
    await store.execute(cmd("startOperation", { actor: "automation", entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(run.alreadyExisted, false);
  assert.equal(run.operation.status, "verified");
});

test("deliverAttention charges one shared budget with delivery-id dedupe", async () => {
  const store = newStore();
  const first = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "pay-2026-09-12-01", title: "房租扣款提醒", source: "payment", urgency: "normal" }),
    ),
  );
  assert.equal(first.outcome.delivered, true);
  assert.equal(first.outcome.duplicate, false);
  assert.equal(first.outcome.budgetCharged, true);
  assert.equal(first.outcome.budgetUsed, 2);
  assert.equal(first.outcome.budgetMax, 2);
  assert.equal(first.item.status, "delivered");
  assert.ok(first.item.deliveredAt);
  const dup = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "pay-2026-09-12-01", title: "房租扣款提醒", source: "payment", urgency: "normal" }),
    ),
  );
  assert.equal(dup.outcome.delivered, false);
  assert.equal(dup.outcome.duplicate, true);
  assert.equal(dup.outcome.budgetCharged, false);
  assert.equal(dup.outcome.budgetUsed, 2);
  assert.equal(store.getState().attention.budget.used, 2);
  assert.equal(Object.keys(store.getState().attention.items).length, 1);
});

test("over-budget non-urgent items merge into the queue; urgent claims without basis do not bypass", async () => {
  const store = newStore();
  for (let i = 1; i <= 1; i++) {
    asOk(
      await store.execute(
        cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-" + i, title: "提醒 " + i, source: "internal", urgency: "normal" }),
      ),
    );
  }
  assert.equal(store.getState().attention.budget.used, 2);
  const queued = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-9", title: "普通提醒", source: "internal", urgency: "normal", mergeKey: "weekly-digest" }),
    ),
  );
  assert.equal(queued.outcome.delivered, false);
  assert.equal(queued.outcome.queued, true);
  assert.equal(queued.outcome.budgetCharged, false);
  assert.equal(queued.item.status, "queued");
  assert.equal(store.getState().attention.budget.queue.length, 1);
  const merged = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-10", title: "同类提醒", source: "internal", urgency: "normal", mergeKey: "weekly-digest" }),
    ),
  );
  assert.equal(merged.outcome.merged, true);
  assert.equal(merged.outcome.queued, false);
  assert.equal(merged.item.status, "merged");
  assert.equal(store.getState().attention.budget.queue.length, 1);
  assert.equal(store.getState().attention.budget.used, 2);
  const urgent = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-11", title: "号称紧急", source: "external", urgency: "urgentClaim" }),
    ),
  );
  assert.equal(urgent.outcome.delivered, false);
  assert.equal(urgent.item.status, "queued");
  assert.equal(store.getState().attention.budget.used, 2);
});

test("risk items with a credible basis bypass an exhausted budget and charge it", async () => {
  const store = newStore();
  for (let i = 1; i <= 1; i++) {
    asOk(
      await store.execute(
        cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-" + i, title: "提醒 " + i, source: "internal", urgency: "normal" }),
      ),
    );
  }
  const fakeRisk = asOk(
    await store.execute(
      cmd("deliverAttention", {
        entityId: null,
        expectedRevision: null,
        deliveryId: "risk-1",
        title: "不可信的风险",
        source: "risk",
        urgency: "risk",
        riskBasis: { deadline: "2026-09-15T18:00:00+08:00", consequence: "unknown", credibleSource: false },
      }),
    ),
  );
  assert.equal(fakeRisk.outcome.delivered, false);
  assert.equal(fakeRisk.item.status, "queued");
  const realRisk = asOk(
    await store.execute(
      cmd("deliverAttention", {
        entityId: null,
        expectedRevision: null,
        deliveryId: "risk-2",
        title: "可信的风险",
        source: "risk",
        urgency: "risk",
        riskBasis: { deadline: "2026-09-15T18:00:00+08:00", consequence: "合同违约金", credibleSource: true },
      }),
    ),
  );
  assert.equal(realRisk.outcome.delivered, true);
  assert.equal(realRisk.outcome.budgetCharged, true);
  assert.equal(store.getState().attention.budget.used, 3);
});

test("deferAttention and dismissAttention update item and queue state", async () => {
  const store = newStore();
  for (let i = 1; i <= 1; i++) {
    asOk(
      await store.execute(
        cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-" + i, title: "提醒 " + i, source: "internal", urgency: "normal" }),
      ),
    );
  }
  const queuedA = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-9", title: "晚点处理", source: "internal", urgency: "normal", mergeKey: "a" }),
    ),
  );
  const queuedB = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-10", title: "不用了", source: "internal", urgency: "normal", mergeKey: "b" }),
    ),
  );
  const deferred = asOk(
    await store.execute(cmd("deferAttention", { entityId: queuedA.item.id, expectedRevision: queuedA.item.revision, dueAt: "2026-09-13T09:00:00+08:00" })),
  );
  assert.equal(deferred.item.status, "deferred");
  const queueAfterDefer = store.getState().attention.budget.queue;
  const entryA = queueAfterDefer.find((q) => q.deliveryId === "d-9");
  assert.equal(entryA?.dueAt, "2026-09-13T09:00:00+08:00");
  const dismissed = asOk(
    await store.execute(cmd("dismissAttention", { entityId: queuedB.item.id, expectedRevision: queuedB.item.revision })),
  );
  assert.equal(dismissed.item.status, "dismissed");
  assert.equal(store.getState().attention.budget.queue.some((q) => q.deliveryId === "d-10"), false);
});
