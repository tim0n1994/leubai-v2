/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_DAY,
  FIXTURE_IDS,
  createDomainStore,
  createInitialState,
} from "./index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
} from "./index.ts";
import { InMemoryStorage } from "../data/storage.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";

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

function expectReady(handle: { status: string }) {
  if (handle.status !== "ready") throw new Error("expected ready, got " + handle.status);
}

const FULL_GRANTS = ["readMaterial", "createLocalDraft", "updateEstimate"] as const;

async function runAuthorizedPlanA(store: ReturnType<typeof newStore>) {
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
  if (!draft) throw new Error("operation created no draft");
  return { sel, grant, run, draft };
}

test("seed fixture matches the 2026-09-12 design day, protected 19:00-20:00", () => {
  assert.equal(FIXTURE_DAY, "2026-09-12");
  const state = createInitialState("fixture");
  const block = state.protectedBlocks[FIXTURE_IDS.protectedBlock];
  assert.equal(block.range.start, "2026-09-12T19:00:00+08:00");
  assert.equal(block.range.end, "2026-09-12T20:00:00+08:00");
  assert.equal(block.purpose, null);
  const source = state.sources[FIXTURE_IDS.sourceCalendar];
  assert.deepEqual(source.coverage.intervals, [
    { start: "2026-09-12T17:00:00+08:00", end: "2026-09-12T19:00:00+08:00", timezone: "Asia/Shanghai" },
  ]);
  const intent = state.intents[FIXTURE_IDS.intent];
  assert.ok(intent.verbatim.includes("7到8点"), "verbatim must state 19:00-20:00, not 19:00-21:00");
  assert.equal(intent.parsedFields.startTime, "19:00");
  assert.equal(intent.parsedFields.endTime, "20:00");
  const ledger = state.ledger.find((e) => e.category === "protectedDuration");
  assert.equal(ledger?.minutes, 60);
});

test("seed commitments are meeting 30 fixed + report 60 flexible + admin 40 flexible with budget 2/1", () => {
  const state = createInitialState("fixture");
  const report = state.commitments[FIXTURE_IDS.commitmentReport];
  const meeting = state.commitments[FIXTURE_IDS.commitmentMeeting];
  const admin = state.commitments[FIXTURE_IDS.commitmentAdmin];
  assert.deepEqual([report.effortEstimateMinutes, report.mobility], [60, "flexible"]);
  assert.deepEqual([meeting.effortEstimateMinutes, meeting.mobility], [30, "fixed"]);
  assert.deepEqual([admin.effortEstimateMinutes, admin.mobility], [40, "flexible"]);
  const total = Object.values(state.commitments).reduce((s, c) => s + (c.effortEstimateMinutes ?? 0), 0);
  assert.equal(total, 130);
  assert.equal(state.ruleset.dailyCapacityMinutes, 120);
  assert.deepEqual(
    [state.attention.budget.dailyMax, state.attention.budget.used],
    [2, 1],
  );
});

test("seed schedule matches the verified 2026-09-12 timeline: meeting 17:00-17:30, report 17:30-18:30 due 19:00, admin 18:30-19:10", () => {
  const state = createInitialState("fixture");
  const meeting = state.commitments[FIXTURE_IDS.commitmentMeeting];
  const report = state.commitments[FIXTURE_IDS.commitmentReport];
  const admin = state.commitments[FIXTURE_IDS.commitmentAdmin];
  assert.ok(meeting.schedule, "meeting must carry a schedule");
  assert.ok(report.schedule, "report must carry a schedule");
  assert.ok(admin.schedule, "admin must carry a schedule");
  assert.deepEqual([meeting.schedule.startMinute, meeting.schedule.endMinute], [1020, 1050]);
  assert.deepEqual([report.schedule.startMinute, report.schedule.endMinute], [1050, 1110]);
  assert.equal(report.deadline, "2026-09-12T19:00:00+08:00");
  assert.deepEqual([admin.schedule.startMinute, admin.schedule.endMinute], [1110, 1150]);
});

test("plan arithmetic follows the real seed: A 60->40 totals 110; B defers admin 40", async () => {
  const store = newStore();
  const a = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
  assert.equal(a.plan.commitmentId, FIXTURE_IDS.commitmentReport);
  assert.equal(a.plan.capacityBeforeMinutes, 130);
  assert.equal(a.plan.capacityAfterMinutes, 110);
  const diff = a.changeSet.objectDiffs.find((d) => d.objectId === FIXTURE_IDS.commitmentReport);
  assert.deepEqual([diff?.before, diff?.after], [60, 40]);
  const b = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "B" })));
  assert.equal(b.plan.commitmentId, FIXTURE_IDS.commitmentAdmin);
  assert.equal(b.plan.capacityAfterMinutes, 90);
  assert.equal(b.plan.futureDebtMinutes, 40);
});

test("operation.resultRefs collect persisted artifacts and agree with readback and draft", async () => {
  const store = newStore();
  const { run, draft } = await runAuthorizedPlanA(store);
  const op = run.operation;
  assert.equal(op.status, "verified");
  assert.deepEqual(op.resultRefs, [draft.id]);
  assert.ok(op.readback, "operation must carry a readback record");
  assert.deepEqual(op.readback?.resultRefs, [draft.id]);
  assert.equal(draft.operationId, op.id);
  const draftReceipt = op.stepReceipts.find((r) => r.actionKind === "createDraft");
  assert.equal(draftReceipt?.resultRef, draft.id);
});

test("resultRefs and draft.operationId reproduce identically through persisted reload", async () => {
  const storage = new InMemoryStorage();
  const first = await createPersistedDomainStore({ dataMode: "fixture", storage });
  expectReady(first);
  if (first.status !== "ready") throw new Error("unreachable");
  const sel = asOk(
    await first.store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })),
  );
  const grant = asOk(
    await first.store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const run = asOk(
    await first.store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const second = await createPersistedDomainStore({ dataMode: "fixture", storage });
  expectReady(second);
  if (second.status !== "ready") throw new Error("unreachable");
  const state = second.store.getState();
  const ops = Object.values(state.operations);
  assert.equal(ops.length, 1);
  const reloadedOp = ops[0];
  const reloadedDraft = Object.values(state.drafts).find((d) => d.operationId === reloadedOp.id);
  assert.ok(reloadedDraft, "reloaded draft must reference the operation");
  assert.equal(reloadedOp.id, run.operation.id);
  assert.deepEqual(reloadedOp.resultRefs, [reloadedDraft.id]);
  assert.deepEqual(reloadedOp.readback?.resultRefs, [reloadedDraft.id]);
});

test("createDraft emits comparison and unresolved cost sections; confirming comparison only keeps cost pending", async () => {
  const store = newStore();
  const { run, draft } = await runAuthorizedPlanA(store);
  assert.equal(draft.sections.length, 2);
  assert.ok(draft.sections.every((s) => s.reviewStatus === "pendingReview"));
  assert.ok(draft.sections.every((s) => s.id.length > 0));
  assert.ok(draft.sections.every((s) => s.sourceRefs.includes(FIXTURE_IDS.sourceCalendar)));
  const comparison = draft.sections.find((s) => s.openIssues.length === 0);
  const cost = draft.sections.find((s) => s.openIssues.length > 0);
  assert.ok(comparison, "comparison section must start clean");
  assert.ok(cost, "unresolved cost section must carry visible open issues");
  assert.ok(comparison.content.includes("17:00"), "comparison content must come from the real source snapshot");
  assert.ok(comparison.content.includes("19:00"));
  assert.ok(!cost.content.includes("结论："), "cost section must not invent a cost conclusion");
  const confirmed = asOk(
    await store.execute(
      cmd("confirmSections", {
        entityId: draft.id,
        expectedRevision: draft.revision,
        sections: [{ sectionId: comparison.id, expectedContentVersion: comparison.contentVersion }],
      }),
    ),
  );
  assert.equal(confirmed.rejected.length, 0);
  assert.equal(confirmed.draft.status, "partiallyConfirmed");
  assert.equal(confirmed.draft.sentAt, null);
  const costAfter = confirmed.draft.sections.find((s) => s.id === cost.id);
  assert.equal(costAfter?.reviewStatus, "pendingReview");
  assert.deepEqual(costAfter?.openIssues, cost.openIssues);
  assert.ok(run.operation.resultRefs.includes(confirmed.draft.id));
});
