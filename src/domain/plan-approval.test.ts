/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_IDS,
  computeChangeSetHash,
  createDomainStore,
} from "./index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
  FailureCode,
  SourceProvider,
} from "./index.ts";
import { InMemoryStorage } from "../data/storage.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import type { PersistedDomainHandle } from "../data/persistedStore.ts";

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

function expectReady(handle: PersistedDomainHandle) {
  if (handle.status !== "ready") throw new Error("expected ready, got " + handle.status);
  return handle;
}

const FULL_GRANTS = ["readMaterial", "createLocalDraft", "updateEstimate"] as const;

function providerOk(version: number): SourceProvider {
  return {
    async readSnapshot() {
      return { ok: true as const, value: { intervals: [], version } };
    },
    async sync() {
      return {
        ok: true as const,
        value: {
          intervals: [
            { start: "2026-09-14T09:00:00+08:00", end: "2026-09-14T19:00:00+08:00", timezone: "Asia/Shanghai" },
          ],
          version,
        },
      };
    },
    async executeAllowedAction() {
      return { ok: false as const, reason: "fixture provider never executes external actions" };
    },
    async readback() {
      return { ok: false as const, reason: "fixture provider has no external objects" };
    },
    async revokeAccess() {
      return { ok: false as const, reason: "not used in this test" };
    },
  };
}

function providerFailing(reason: string): SourceProvider {
  return {
    async readSnapshot() {
      return { ok: false as const, reason };
    },
    async sync() {
      return { ok: false as const, reason };
    },
    async executeAllowedAction() {
      return { ok: false as const, reason };
    },
    async readback() {
      return { ok: false as const, reason };
    },
    async revokeAccess() {
      return { ok: false as const, reason };
    },
  };
}

async function selectA(store: ReturnType<typeof newStore>) {
  return asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })));
}

test("selectPlan A reduces fx-commitment-01 with readable diffs and a hash-bound change set", async () => {
  const store = newStore();
  const { plan, changeSet } = await selectA(store);
  assert.equal(plan.kind, "A");
  assert.equal(plan.status, "pendingApproval");
  assert.equal(plan.estimateMinutes, 110);
  assert.equal(plan.capacityBeforeMinutes, 130);
  assert.equal(plan.capacityAfterMinutes, 110);
  assert.equal(plan.futureDebtMinutes, 0);
  assert.equal(plan.summary.netSavingClaim, "none");
  assert.deepEqual(plan.sourceVersionSet, { [FIXTURE_IDS.sourceCalendar]: 1 });
  assert.equal(plan.ruleRevision, 1);
  assert.equal(changeSet.planId, plan.id);
  assert.equal(changeSet.hash, computeChangeSetHash(changeSet));
  const estimateDiff = changeSet.objectDiffs.find(
    (d) => d.objectId === FIXTURE_IDS.commitmentReport && d.field === "effortEstimateMinutes",
  );
  assert.ok(estimateDiff, "readable estimate diff expected");
  assert.equal(estimateDiff.before, 60);
  assert.equal(estimateDiff.after, 40);
  assert.ok(changeSet.exclusions.some((e) => e.includes("externalCalendarWrite")));
  assert.deepEqual(changeSet.targetRevisions, { [FIXTURE_IDS.intent]: 1, [FIXTURE_IDS.commitmentReport]: 1 });
  assert.ok(store.getState().plans[plan.id]);
  assert.ok(store.getState().changeSets[changeSet.id]);
});

test("selectPlan B defers fx-commitment-03 to 2026-09-14 and never claims net saving", async () => {
  const store = newStore();
  const { plan, changeSet } = asOk(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "B" })),
  );
  assert.equal(plan.kind, "B");
  assert.equal(plan.estimateMinutes, 90);
  assert.equal(plan.futureDebtMinutes, 40);
  assert.equal(plan.capacityAfterMinutes, 90);
  assert.equal(plan.summary.netSavingClaim, "none");
  assert.ok(plan.summary.futureDebt, "future debt must be stated, not hidden");
  const deferDiff = changeSet.objectDiffs.find((d) => d.objectId === FIXTURE_IDS.commitmentAdmin);
  assert.ok(deferDiff, "readable defer diff expected");
  assert.ok(JSON.stringify(deferDiff.after).includes("2026-09-14"));
  assert.ok(changeSet.requiredGrants.includes("internalReschedule"));
  assert.deepEqual(changeSet.targetRevisions, { [FIXTURE_IDS.intent]: 1, [FIXTURE_IDS.commitmentAdmin]: 1 });
});

test("grantApproval with a subset rebuilds a reduced hash-bound change set and lists missing dependencies", async () => {
  const store = newStore();
  const sel = await selectA(store);
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: ["updateEstimate"] }),
    ),
  );
  assert.equal(grant.reduced, true);
  assert.deepEqual(grant.changeSet.actions.map((a) => a.kind), ["updateEstimate"]);
  assert.equal(grant.changeSet.parentChangeSetId, sel.changeSet.id);
  assert.notEqual(grant.changeSet.hash, sel.changeSet.hash);
  assert.equal(grant.changeSet.hash, computeChangeSetHash(grant.changeSet));
  assert.ok(grant.missingDependencies.some((m) => m.includes("readMaterial")));
  assert.ok(grant.missingDependencies.some((m) => m.includes("createLocalDraft")));
  assert.equal(grant.approval.status, "valid");
  assert.equal(grant.approval.changeSetHash, grant.changeSet.hash);
  assert.deepEqual(grant.approval.grantedActions, ["updateEstimate"]);
});

test("grantApproval with no executable action fails NO_EXECUTABLE_ACTIONS and creates no approval", async () => {
  const store = newStore();
  const sel = await selectA(store);
  const f = asFailure(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: sel.changeSet.id,
        grants: ["attentionRemind"],
      }),
    ),
  );
  assert.equal(f.code, "NO_EXECUTABLE_ACTIONS");
  assert.equal(Object.keys(store.getState().approvals).length, 0);
});

test("grantApproval rejects a stale change set after the target commitment moved", async () => {
  const store = newStore();
  const sel = await selectA(store);
  asOk(
    await store.execute(
      cmd("updateCommitment", {
        entityId: FIXTURE_IDS.commitmentReport,
        expectedRevision: 1,
        effortEstimateMinutes: 25,
      }),
    ),
  );
  const f = asFailure(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: sel.changeSet.id,
        grants: [...FULL_GRANTS],
      }),
    ),
  );
  assert.equal(f.code, "CHANGE_SET_STALE");
  assert.equal(Object.keys(store.getState().approvals).length, 0);
});

test("syncSource success bumps the source version and invalidates approvals bound to the old version", async () => {
  const store = newStore();
  const sel = await selectA(store);
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const data = asOk(
    await store.execute(
      cmd("syncSource", { entityId: FIXTURE_IDS.sourceCalendar, expectedRevision: 1, provider: providerOk(2) }),
    ),
  );
  assert.equal(data.syncResult, "success");
  assert.equal(data.source.sourceVersion, 2);
  assert.equal(data.source.lastUsableSnapshot?.sourceVersion, 2);
  assert.equal(data.source.lastUsableSnapshot?.stale, false);
  const approval = store.getState().approvals[grant.approval.id];
  assert.equal(approval.status, "invalid");
  assert.ok(approval.invalidReason);
  const f = asFailure(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(f.code, "APPROVAL_INVALID");
});

test("syncSource failure marks the last usable snapshot stale and coverage unknown", async () => {
  const store = newStore();
  const data = asOk(
    await store.execute(
      cmd("syncSource", {
        entityId: FIXTURE_IDS.sourceCalendar,
        expectedRevision: 1,
        provider: providerFailing("fixture network down"),
      }),
    ),
  );
  assert.equal(data.syncResult, "failed");
  assert.equal(data.source.lastUsableSnapshot?.stale, true);
  assert.equal(data.source.coverage.known, false);
  assert.notEqual(data.source.status, "connected");
});

test("startOperation consumes one approval atomically, executes local steps, and writes the reduction exactly once", async () => {
  const store = newStore();
  const sel = await selectA(store);
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(run.alreadyExisted, false);
  const op = run.operation;
  assert.equal(op.idempotencyKey, grant.approval.id + ":" + grant.changeSet.hash);
  const approval = store.getState().approvals[grant.approval.id];
  assert.equal(approval.status, "consumed");
  assert.equal(approval.consumedByOperationId, op.id);
  assert.deepEqual(
    op.stepReceipts.map((r) => r.actionKind).sort(),
    ["createDraft", "readMaterial", "updateEstimate"],
  );
  const readReceipt = op.stepReceipts.find((r) => r.actionKind === "readMaterial");
  assert.equal(readReceipt?.status, "completed");
  assert.ok(readReceipt?.resultRef);
  assert.equal(store.getState().commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes, 40);
  const drafts = Object.values(store.getState().drafts);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].operationId, op.id);
  assert.equal(drafts[0].status, "pendingReview");
  const reduction = store.getState().ledger.filter(
    (e) => e.operationId === op.id && e.category === "estimatedHumanReduction",
  );
  assert.equal(reduction.length, 1);
  assert.equal(reduction[0].minutes, 20);
  assert.equal(op.status, "verified");
  assert.ok(op.readback && op.readback.items.length > 0);
  assert.ok(op.readback.items.every((i) => i.matchesExpected === true));
  const again = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(again.alreadyExisted, true);
  assert.equal(again.operation.id, op.id);
  assert.equal(
    store.getState().ledger.filter((e) => e.operationId === op.id && e.category === "estimatedHumanReduction").length,
    1,
  );
  assert.equal(store.getState().commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes, 40);
});

test("unknown readback marks the operation unknown and recovery never re-executes steps", async () => {
  const store = newStore();
  const sel = await selectA(store);
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: [...FULL_GRANTS] }),
    ),
  );
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const rb = asOk(
    await store.execute(
      cmd("readbackOperation", {
        entityId: run.operation.id,
        expectedRevision: run.operation.revision,
        report: { stepId: run.operation.stepReceipts[0].stepId, status: "unknown", detail: "fixture provider unreachable" },
      }),
    ),
  );
  assert.equal(rb.operation.status, "unknown");
  const receiptsBefore = rb.operation.stepReceipts.length;
  const again = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  assert.equal(again.alreadyExisted, true);
  assert.equal(again.operation.id, run.operation.id);
  assert.equal(again.operation.stepReceipts.length, receiptsBefore);
  assert.equal(again.operation.status, "unknown");
});

test("partial grants execute only granted steps: estimate unchanged and no phantom savings", async () => {
  const store = newStore();
  const sel = await selectA(store);
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: sel.changeSet.id,
        grants: ["readMaterial", "createLocalDraft"],
      }),
    ),
  );
  assert.equal(grant.reduced, true);
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const kinds = run.operation.stepReceipts.map((r) => r.actionKind);
  assert.ok(kinds.includes("readMaterial"));
  assert.ok(kinds.includes("createDraft"));
  assert.ok(!kinds.includes("updateEstimate"));
  assert.equal(store.getState().commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes, 60);
  assert.equal(store.getState().ledger.filter((e) => e.operationId === run.operation.id).length, 0);
  assert.equal(
    Object.values(store.getState().drafts).filter((d) => d.operationId === run.operation.id).length,
    1,
  );
});

test("recheckCapacity above estimate records a conflict and invalidates affected plans", async () => {
  const store = newStore();
  const selA = await selectA(store);
  const selB = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "B" })));
  const within = asOk(
    await store.execute(cmd("recheckCapacity", { entityId: null, expectedRevision: null, actualMinutes: 80 })),
  );
  assert.equal(within.conflictRecorded, false);
  const data = asOk(
    await store.execute(cmd("recheckCapacity", { entityId: null, expectedRevision: null, actualMinutes: 150 })),
  );
  assert.equal(data.conflictRecorded, true);
  assert.ok(data.affectedPlanIds.includes(selA.plan.id));
  assert.ok(data.affectedPlanIds.includes(selB.plan.id));
  const plans = Object.values(store.getState().plans);
  assert.ok(plans.every((p) => p.status === "invalid"));
  const f = asFailure(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: selA.changeSet.id,
        grants: [...FULL_GRANTS],
      }),
    ),
  );
  assert.equal(f.code, "APPROVAL_INVALID");
});

test("plan B operation defers the commitment and records future debt without claiming savings", async () => {
  const store = newStore();
  const sel = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "B" })));
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: ["internalReschedule"] }),
    ),
  );
  assert.equal(grant.reduced, false);
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const commitment = store.getState().commitments[FIXTURE_IDS.commitmentAdmin];
  assert.equal(commitment.schedule?.date, "2026-09-14");
  const debt = store.getState().ledger.filter((e) => e.operationId === run.operation.id && e.category === "futureDebt");
  assert.equal(debt.length, 1);
  assert.equal(debt[0].minutes, 40);
  assert.equal(debt[0].effectiveDate, "2026-09-14");
  assert.equal(
    store.getState().ledger.filter((e) => e.operationId === run.operation.id && e.category === "estimatedHumanReduction")
      .length,
    0,
  );
});

test("operation outcomes survive a full persisted reload", async () => {
  const storage = new InMemoryStorage();
  const first = expectReady(await createPersistedDomainStore({ dataMode: "fixture", storage }));
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
  const second = expectReady(await createPersistedDomainStore({ dataMode: "fixture", storage }));
  const state = second.store.getState();
  assert.equal(state.commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes, 40);
  const ops = Object.values(state.operations);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].id, run.operation.id);
  assert.equal(ops[0].status, "verified");
  assert.ok(state.ledger.some((e) => e.operationId === ops[0].id && e.category === "estimatedHumanReduction"));
  assert.equal(Object.values(state.approvals)[0].status, "consumed");
});
