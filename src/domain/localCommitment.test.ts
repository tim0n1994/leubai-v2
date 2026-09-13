import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, FIXTURE_IDS } from "./index.ts";
import type { DomainStore } from "./store.ts";
import type {
  Actor,
  CommitmentSchedule,
  GrantApprovalCommand,
  GrantKey,
  PlanKind,
  SaveIntentCommand,
  SaveLocalCommitmentCommand,
  SelectPlanCommand,
  StartOperationCommand,
} from "./types.ts";

const NOW = "2026-09-13T10:00:00+08:00";
const PLAN_DAY = "2026-09-12";
const INDEPENDENT_DAY = "2026-10-07";
const UNRELATED_DAY = "2026-11-03";
const USER: Actor = "user";

let seq = 0;
const nextId = (prefix: string) => prefix + "-" + String(++seq).padStart(4, "0");
const newStore = () => createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: () => nextId("uuid") });

const localCommitmentCommand = (overrides: Partial<SaveLocalCommitmentCommand> = {}): SaveLocalCommitmentCommand => ({
  type: "saveLocalCommitment",
  commandId: nextId("cmd"),
  entityId: null,
  expectedRevision: null,
  actor: USER,
  issuedAt: NOW,
  scope: "临时安排",
  effortEstimateMinutes: 30,
  schedule: { date: UNRELATED_DAY, startMinute: 600, endMinute: 660, timezone: "Asia/Shanghai" },
  mobility: "fixed",
  status: "active",
  ...overrides,
});

const selectPlanCommand = (intentId: string, kind: PlanKind): SelectPlanCommand => ({
  type: "selectPlan",
  commandId: nextId("cmd"),
  entityId: intentId,
  expectedRevision: 1,
  kind,
  actor: USER,
  issuedAt: NOW,
});

const grantApprovalCommand = (changeSetId: string, grants: GrantKey[]): GrantApprovalCommand => ({
  type: "grantApproval",
  commandId: nextId("cmd"),
  entityId: null,
  expectedRevision: null,
  changeSetId,
  grants,
  actor: USER,
  issuedAt: NOW,
});

const startOperationCommand = (approvalId: string): StartOperationCommand => ({
  type: "startOperation",
  commandId: nextId("cmd"),
  entityId: null,
  expectedRevision: null,
  approvalId,
  actor: USER,
  issuedAt: NOW,
});

const saveIntentCommand = (date: string, startTime: string, endTime: string, topic: string): SaveIntentCommand => ({
  type: "saveIntent",
  commandId: nextId("cmd"),
  entityId: null,
  expectedRevision: null,
  actor: USER,
  issuedAt: NOW,
  raw: "",
  channel: "manual",
  parsedFields: { date, startTime, endTime, timezone: "Asia/Shanghai", topic },
  constraints: [{ kind: "protect", expression: "不被打扰", confirmed: true }],
});

const planAGrants: GrantKey[] = ["readMaterial", "createLocalDraft", "updateEstimate"];

async function selectAndApprove(store: DomainStore, intentId: string, kind: PlanKind, grants: GrantKey[]) {
  const selected = await store.execute(selectPlanCommand(intentId, kind));
  assert.ok(selected.ok, "selectPlan failed: " + (selected.ok ? "" : selected.reason));
  const granted = await store.execute(grantApprovalCommand(selected.data.changeSet.id, grants));
  assert.ok(granted.ok, "grantApproval failed: " + (granted.ok ? "" : granted.reason));
  return { plan: selected.data.plan, approval: granted.data.approval };
}

async function buildIndependentPair(store: DomainStore) {
  const saved = await store.execute(localCommitmentCommand({
    scope: "外地合作方晚餐",
    effortEstimateMinutes: 90,
    schedule: { date: INDEPENDENT_DAY, startMinute: 1140, endMinute: 1230, timezone: "Asia/Shanghai" },
    mobility: "flexible",
  }));
  assert.ok(saved.ok, "independent commitment save failed");
  const intent = await store.execute(saveIntentCommand(INDEPENDENT_DAY, "19:00", "20:30", "晚餐"));
  assert.ok(intent.ok, "saveIntent failed: " + (intent.ok ? "" : intent.reason));
  return selectAndApprove(store, intent.data.intent.id, "B", ["internalReschedule"]);
}

test("saving a commitment on an unrelated date leaves existing plan and approval untouched", async () => {
  const store = newStore();
  const { plan, approval } = await selectAndApprove(store, FIXTURE_IDS.intent, "A", planAGrants);
  const planBefore = JSON.stringify(plan);
  const approvalBefore = JSON.stringify(approval);

  const command = localCommitmentCommand({ scope: "十一月的远程课程" });
  const saved = await store.execute(command);
  assert.ok(saved.ok);
  const state = store.getState();
  assert.equal(JSON.stringify(state.plans[plan.id]), planBefore);
  assert.equal(JSON.stringify(state.approvals[approval.id]), approvalBefore);
  const event = state.events.at(-1);
  assert.ok(event);
  assert.equal(event.type, "commitment.created");
  assert.deepEqual(event.entityRevisions, [{ entityId: saved.data.commitment.id, before: 0, after: 1 }]);

  const eventsBefore = state.events.length;
  const replay = await store.execute(command);
  assert.ok(replay.ok);
  assert.equal(store.getState().events.length, eventsBefore);
  assert.equal(JSON.stringify(store.getState().plans[plan.id]), planBefore);
  assert.equal(JSON.stringify(store.getState().approvals[approval.id]), approvalBefore);
});

test("a commitment overlapping a plan window invalidates only the dependent plan and approval", async () => {
  const store = newStore();
  const first = await selectAndApprove(store, FIXTURE_IDS.intent, "A", planAGrants);
  const firstPlanBefore = JSON.stringify(first.plan);
  const firstApprovalBefore = JSON.stringify(first.approval);
  const second = await buildIndependentPair(store);
  assert.equal(JSON.stringify(store.getState().plans[first.plan.id]), firstPlanBefore);
  assert.equal(JSON.stringify(store.getState().approvals[first.approval.id]), firstApprovalBefore);
  const secondPlanBefore = JSON.stringify(second.plan);
  const secondApprovalBefore = JSON.stringify(second.approval);

  const saved = await store.execute(localCommitmentCommand({
    scope: "临时插入的同步会",
    schedule: { date: PLAN_DAY, startMinute: 1155, endMinute: 1185, timezone: "Asia/Shanghai" },
  }));
  assert.ok(saved.ok);
  const state = store.getState();
  const dependentPlan = state.plans[first.plan.id];
  const dependentApproval = state.approvals[first.approval.id];
  assert.equal(dependentPlan.status, "invalid");
  assert.equal(dependentPlan.revision, first.plan.revision + 1);
  assert.ok(dependentPlan.invalidReason);
  assert.equal(dependentApproval.status, "invalid");
  assert.equal(dependentApproval.revision, first.approval.revision + 1);
  assert.equal(JSON.stringify(state.plans[second.plan.id]), secondPlanBefore);
  assert.equal(JSON.stringify(state.approvals[second.approval.id]), secondApprovalBefore);
  const event = state.events.at(-1);
  assert.ok(event);
  assert.deepEqual(
    event.entityRevisions.map((entry) => entry.entityId),
    [saved.data.commitment.id, dependentPlan.id, dependentApproval.id],
  );
});

test("updating the plan's target commitment invalidates its plan and approval by direct reference", async () => {
  const store = newStore();
  const { plan, approval } = await selectAndApprove(store, FIXTURE_IDS.intent, "A", planAGrants);
  const planBefore = JSON.stringify(plan);
  const approvalBefore = JSON.stringify(approval);

  const updated = await store.execute(localCommitmentCommand({
    entityId: FIXTURE_IDS.commitmentReport,
    expectedRevision: 1,
    scope: "撰写季度复盘报告（范围更新）",
    schedule: null,
  }));
  assert.ok(updated.ok);
  assert.equal(updated.data.commitment.revision, 2);
  const state = store.getState();
  assert.equal(state.plans[plan.id].status, "invalid");
  assert.equal(state.plans[plan.id].revision, plan.revision + 1);
  assert.notEqual(JSON.stringify(state.plans[plan.id]), planBefore);
  assert.equal(state.approvals[approval.id].status, "invalid");
  assert.equal(state.approvals[approval.id].revision, approval.revision + 1);
  assert.notEqual(JSON.stringify(state.approvals[approval.id]), approvalBefore);
});

test("a multi-day all-day commitment spanning the plan date invalidates only the dependent pair", async () => {
  const store = newStore();
  const first = await selectAndApprove(store, FIXTURE_IDS.intent, "A", planAGrants);
  const second = await buildIndependentPair(store);
  const secondPlanBefore = JSON.stringify(second.plan);
  const secondApprovalBefore = JSON.stringify(second.approval);

  const spanning: CommitmentSchedule = {
    date: "2026-09-11",
    endDate: "2026-09-13",
    allDay: true,
    startMinute: null,
    endMinute: null,
    timezone: "Asia/Shanghai",
  };
  const saved = await store.execute(localCommitmentCommand({
    scope: "跨天全天外勤",
    effortEstimateMinutes: null,
    schedule: spanning,
  }));
  assert.ok(saved.ok);
  const state = store.getState();
  assert.equal(state.plans[first.plan.id].status, "invalid");
  assert.equal(state.plans[first.plan.id].revision, first.plan.revision + 1);
  assert.equal(state.approvals[first.approval.id].status, "invalid");
  assert.equal(state.approvals[first.approval.id].revision, first.approval.revision + 1);
  assert.equal(JSON.stringify(state.plans[second.plan.id]), secondPlanBefore);
  assert.equal(JSON.stringify(state.approvals[second.approval.id]), secondApprovalBefore);
});

test("a consumed approval still keeps its plan when an overlapping commitment arrives", async () => {
  const store = newStore();
  const { plan, approval } = await selectAndApprove(store, FIXTURE_IDS.intent, "A", planAGrants);
  const operation = await store.execute(startOperationCommand(approval.id));
  assert.ok(operation.ok, "startOperation failed: " + (operation.ok ? "" : operation.reason));
  const consumedApproval = store.getState().approvals[approval.id];
  assert.equal(consumedApproval.status, "consumed");
  const planBefore = JSON.stringify(store.getState().plans[plan.id]);

  const saved = await store.execute(localCommitmentCommand({
    scope: "临时插入的同步会",
    schedule: { date: PLAN_DAY, startMinute: 1155, endMinute: 1185, timezone: "Asia/Shanghai" },
  }));
  assert.ok(saved.ok);
  const state = store.getState();
  assert.equal(JSON.stringify(state.plans[plan.id]), planBefore);
  assert.equal(state.approvals[approval.id].status, "consumed");
  const event = state.events.at(-1);
  assert.ok(event);
  assert.deepEqual(event.entityRevisions, [{ entityId: saved.data.commitment.id, before: 0, after: 1 }]);
});
