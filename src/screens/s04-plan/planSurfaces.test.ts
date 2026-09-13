/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_IDS, createDomainStore } from "../../domain/index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
} from "../../domain/index.ts";
import {
  buildNowSurfaceModel,
  buildPlanSurfaceModel,
  deferReceiptComplete,
  mobileAuthHref,
  mobilePlanHref,
  parseExplicitIntentValues,
  parsePlanKindValues,
  planBCompletionConfirmed,
  resolvePlanIntent,
  selectFutureDebtLedgerForOperation,
  workflowRequestKey,
} from "./planSurfaces.ts";
import { assertReviewedProposal, preparePlan } from "./planPreparation.ts";

const NOW = "2026-09-12T10:00:00+08:00";
let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "s16-uuid-" + uuidSeq;
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
    commandId: rest.commandId ?? "s16-cmd-" + commandSeq,
    actor: "user",
    issuedAt: NOW,
    ...rest,
  } as Extract<DomainCommand, { type: T }>;
}

function asOk<T extends DomainCommand>(result: CommandResult<T>): CommandDataOf<T> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

async function runPlanBToVerified(store: ReturnType<typeof newStore>) {
  const sel = asOk(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "B" })),
  );
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", { entityId: null, expectedRevision: null, changeSetId: sel.changeSet.id, grants: ["internalReschedule"] }),
    ),
  );
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const readback = asOk(
    await store.execute(
      cmd("readbackOperation", { entityId: run.operation.id, expectedRevision: run.operation.revision }),
    ),
  );
  return { sel, grant, operation: readback.operation };
}

async function runPlanAToVerified(store: ReturnType<typeof newStore>) {
  const sel = asOk(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 1, kind: "A" })),
  );
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: sel.changeSet.id,
        grants: ["readMaterial", "createLocalDraft", "updateEstimate"],
      }),
    ),
  );
  const run = asOk(
    await store.execute(cmd("startOperation", { entityId: null, expectedRevision: null, approvalId: grant.approval.id })),
  );
  const readback = asOk(
    await store.execute(
      cmd("readbackOperation", { entityId: run.operation.id, expectedRevision: run.operation.revision }),
    ),
  );
  return { sel, grant, operation: readback.operation };
}

test("seed plan surface resolves the fixture intent with deficit capacity and unselected offers", () => {
  const store = newStore();
  const model = buildPlanSurfaceModel(store.getState(), []);
  assert.equal(model.ready, true);
  if (!model.ready) return;
  assert.equal(model.intentSource, "fixture");
  assert.equal(model.intentId, FIXTURE_IDS.intent);
  assert.equal(model.capacity.capacityMinutes, 120);
  assert.equal(model.capacity.committedKnownMinutes, 130);
  assert.equal(model.capacity.kind, "deficit");
  assert.ok(model.capacityHeadline.includes("120"));
  assert.ok(model.capacityHeadline.includes("130"));
  assert.equal(model.cardA.planId, null);
  assert.equal(model.cardA.offer.action, "create");
  assert.equal(model.cardA.estimateReductionMinutes, null);
  assert.equal(model.cardA.applied, false);
  assert.equal(model.cardB.planId, null);
  assert.equal(model.cardB.offer.action, "create");
  assert.equal(model.cardB.headline, "尚未保存");
  assert.equal(model.cardB.applied, false);
});

test("resolvePlanIntent fails closed on empty, duplicate, unknown, unsaved, and missing intents", () => {
  const store = newStore();
  const state = store.getState();
  assert.deepEqual(resolvePlanIntent(state, [""]), {
    ok: false,
    reason: "malformedQuery",
    explicitQuery: true,
  });
  assert.deepEqual(resolvePlanIntent(state, ["x", "x"]), {
    ok: false,
    reason: "malformedQuery",
    explicitQuery: true,
  });
  assert.deepEqual(resolvePlanIntent(state, ["no-such-intent"]), {
    ok: false,
    reason: "explicitIntentNotFound",
    explicitQuery: true,
  });
  const ambiguous = { ...state, intents: { ...state.intents, [FIXTURE_IDS.intent]: { ...state.intents[FIXTURE_IDS.intent], status: "ambiguous" as const } } };
  assert.deepEqual(resolvePlanIntent(ambiguous, [FIXTURE_IDS.intent]), {
    ok: false,
    reason: "explicitIntentNotSaved",
    explicitQuery: true,
  });
  const noIntents = { ...state, intents: {} };
  assert.deepEqual(resolvePlanIntent(noIntents, []), {
    ok: false,
    reason: "noApplicableIntent",
    explicitQuery: false,
  });
  const failed = buildPlanSurfaceModel(noIntents, []);
  assert.equal(failed.ready, false);
});

test("a newly saved intent routes explicitly and selectPlan binds the plan to it", async () => {
  const store = newStore();
  const saved = asOk(
    await store.execute(
      cmd("saveIntent", {
        raw: "周五晚写报告",
        channel: "shortcut",
        entityId: null,
        expectedRevision: null,
        parsedFields: {
          date: "2026-09-12",
          startTime: "19:00",
          endTime: "20:00",
          timezone: "Asia/Shanghai",
          topic: "报告",
        },
      }),
    ),
  );
  assert.equal(saved.intent.status, "saved");
  const sel = asOk(
    await store.execute(
      cmd("selectPlan", { entityId: saved.intent.id, expectedRevision: saved.intent.revision, kind: "A" }),
    ),
  );
  assert.equal(sel.plan.intentId, saved.intent.id);
  const model = buildPlanSurfaceModel(store.getState(), [saved.intent.id]);
  assert.equal(model.ready, true);
  if (!model.ready) return;
  assert.equal(model.intentSource, "explicit");
  assert.equal(model.intentId, saved.intent.id);
  assert.equal(model.cardA.planId, sel.plan.id);
  assert.equal(model.cardA.offer.action, "view");
  assert.equal(model.cardA.offer.label, "查看已保存的方案");
  assert.equal(model.cardB.planId, null);
});

test("applied plan A blocks repeating the same reduction and reports verified status", async () => {
  const store = newStore();
  const { operation } = await runPlanAToVerified(store);
  assert.equal(operation.status, "verified");
  const model = buildPlanSurfaceModel(store.getState(), []);
  assert.equal(model.ready, true);
  if (!model.ready) return;
  assert.equal(model.cardA.applied, true);
  assert.equal(model.cardA.statusWord, "已应用 · 实际节省未测量");
  assert.equal(model.cardA.estimateReductionMinutes, 20);
  assert.equal(model.cardA.offer.action, "blocked");
  assert.equal(model.cardA.offer.label, "不会重复提出同样的调整");
  assert.equal(model.capacity.committedKnownMinutes, 110);
  await assert.rejects(preparePlan(store, FIXTURE_IDS.intent, "A"), /不能重复准备/);
});

test("prepare A and B saves only a proposal; approval requires the exact reviewed hash and revision", async () => {
  for (const kind of ["A", "B"] as const) {
    const store = newStore();
    const prepared = await preparePlan(store, FIXTURE_IDS.intent, kind);
    const state = store.getState();
    assert.equal(prepared.plan.kind, kind);
    assert.equal(Object.keys(state.approvals).length, 0);
    assert.equal(Object.keys(state.operations).length, 0);
    assert.equal(Object.keys(state.drafts).length, 0);
    assert.equal(assertReviewedProposal(state, prepared).changeSet.hash, prepared.changeSet.hash);
    assert.throws(() => assertReviewedProposal(state, null), /先准备方案/);
    assert.throws(() => assertReviewedProposal({ ...state, changeSets: { ...state.changeSets,
      [prepared.changeSet.id]: { ...prepared.changeSet, hash: "changed" } } }, prepared), /方案已变化/);
    const target = state.commitments[prepared.plan.commitmentId];
    assert.throws(() => assertReviewedProposal({ ...state, commitments: { ...state.commitments,
      [target.id]: { ...target, revision: target.revision + 1 } } }, prepared), /依据已变化/);
    const grant = asOk(await store.execute(cmd("grantApproval", { entityId: prepared.plan.id,
      expectedRevision: prepared.plan.revision, changeSetId: prepared.changeSet.id,
      grants: kind === "B" ? ["internalReschedule"] : ["readMaterial", "createLocalDraft", "updateEstimate"] })));
    const run = asOk(await store.execute(cmd("startOperation", { entityId: grant.approval.id,
      expectedRevision: grant.approval.revision, approvalId: grant.approval.id })));
    const readback = asOk(await store.execute(cmd("readbackOperation", { entityId: run.operation.id,
      expectedRevision: run.operation.revision })));
    assert.equal(readback.operation.status, "verified");
    if (kind === "B") assert.equal(planBCompletionConfirmed(store.getState(), prepared.plan, readback.operation), true);
    await assert.rejects(preparePlan(store, FIXTURE_IDS.intent, kind), /不能重复准备/);
  }
});

test("B success requires completed receipt, matching readback, exact binding and ledger", async () => {
  const store = newStore();
  const { sel, operation } = await runPlanBToVerified(store);
  const state = store.getState();
  assert.equal(planBCompletionConfirmed(state, sel.plan, operation), true);
  assert.equal(planBCompletionConfirmed(state, sel.plan, { ...operation, readback: null }), false);
  assert.equal(planBCompletionConfirmed(state, sel.plan, { ...operation, stepReceipts: [] }), false);
  assert.equal(planBCompletionConfirmed(state, sel.plan, { ...operation, changeSetHash: "other" }), false);
  assert.equal(planBCompletionConfirmed({ ...state, ledger: [] }, sel.plan, operation), false);
  assert.equal(planBCompletionConfirmed(state, sel.plan, { ...operation, readback: { at: NOW, resultRefs: [], items: [
    { objectId: sel.plan.commitmentId, field: "schedule.date", revision: 2, value: null, matchesExpected: null },
  ] } }), false);
});

test("null estimate and debt remain unknown; superseded debt is counted only once and explicit IDs stay exact", async () => {
  const store = newStore();
  const prepared = await preparePlan(store, FIXTURE_IDS.intent, "A");
  const state = store.getState();
  const changed = { ...prepared.changeSet, objectDiffs: prepared.changeSet.objectDiffs.map((diff) => ({ ...diff, before: null })) };
  const view = buildPlanSurfaceModel({ ...state, changeSets: { ...state.changeSets, [changed.id]: changed } }, []);
  assert.ok(view.ready);
  assert.equal(view.cardA.estimateReductionMinutes, null);
  assert.equal(resolvePlanIntent(state, [" " + FIXTURE_IDS.intent]).ok, false);
  const bStore = newStore();
  const { operation } = await runPlanBToVerified(bStore);
  const bState = bStore.getState();
  const debt = selectFutureDebtLedgerForOperation(bState, operation.id);
  assert.ok(debt);
  const corrected = { ...debt, id: "corrected-debt", minutes: 15, supersedesId: debt.id };
  const debtView = buildPlanSurfaceModel({ ...bState, ledger: [...bState.ledger, corrected] }, []);
  assert.ok(debtView.ready);
  assert.equal(debtView.cardB.remainingFutureDebtMinutes, 15);
  const unknownView = buildPlanSurfaceModel({ ...bState, ledger: [...bState.ledger, { ...corrected, minutes: null }] }, []);
  assert.ok(unknownView.ready);
  assert.equal(unknownView.cardB.remainingFutureDebtMinutes, null);
});

test("applied plan B shows real future debt and never claims net saving", async () => {
  const store = newStore();
  const { operation } = await runPlanBToVerified(store);
  assert.equal(operation.status, "verified");
  assert.equal(deferReceiptComplete(operation), true);
  const ledger = selectFutureDebtLedgerForOperation(store.getState(), operation.id);
  assert.ok(ledger, "future debt ledger entry expected");
  assert.equal(ledger.minutes, 40);
  assert.equal(ledger.effectiveDate, "2026-09-14");
  const model = buildPlanSurfaceModel(store.getState(), []);
  assert.equal(model.ready, true);
  if (!model.ready) return;
  assert.equal(model.cardB.applied, true);
  assert.equal(model.cardB.planId !== null, true);
  assert.equal(model.cardB.deferToDate, "2026-09-14");
  assert.equal(model.cardB.headline, "40 分钟");
  assert.equal(model.cardB.remainingFutureDebtMinutes, 40);
  assert.equal(model.cardB.statusWord, "已应用 · 实际节省未测量");
  assert.deepEqual(
    model.cardB.rows.filter((row) => row.term === "预计净节省").map((row) => row.detail),
    ["没有发生"],
  );
  assert.deepEqual(
    model.cardB.appliedRows.map((row) => row.term),
    ["未来仍欠（未清偿）"],
  );
});

test("parsePlanKindValues accepts A and B, keeps legacy delay default, and rejects unknown or duplicate kinds", () => {
  assert.deepEqual(parsePlanKindValues([], false), { kind: "valid", value: "A" });
  assert.deepEqual(parsePlanKindValues([], true), { kind: "valid", value: "B" });
  assert.deepEqual(parsePlanKindValues(["A"], false), { kind: "valid", value: "A" });
  assert.deepEqual(parsePlanKindValues(["B"], false), { kind: "valid", value: "B" });
  assert.deepEqual(parsePlanKindValues(["C"], false), { kind: "invalid" });
  assert.deepEqual(parsePlanKindValues(["a"], false), { kind: "invalid" });
  assert.deepEqual(parsePlanKindValues(["A", "B"], false), { kind: "invalid" });
  assert.deepEqual(parsePlanKindValues(["", ""], false), { kind: "invalid" });
});

test("parseExplicitIntentValues fails closed on empty and duplicate ids", () => {
  assert.deepEqual(parseExplicitIntentValues([]), { kind: "none" });
  assert.deepEqual(parseExplicitIntentValues([""]), { kind: "invalid" });
  assert.deepEqual(parseExplicitIntentValues(["a", "b"]), { kind: "invalid" });
  assert.deepEqual(parseExplicitIntentValues(["abc"]), { kind: "explicit", intentId: "abc" });
});

test("mobile hrefs and workflow keys are exact and kind-aware", () => {
  assert.equal(mobilePlanHref("abc 1"), "/m/plan?intentId=abc%201");
  assert.equal(mobileAuthHref("fx-1", "A"), "/m/auth?intentId=fx-1&kind=A");
  assert.equal(mobileAuthHref("fx-1", "B"), "/m/auth?intentId=fx-1&kind=B");
  const none = parseExplicitIntentValues([]);
  const kindA = parsePlanKindValues(["A"], false);
  const kindB = parsePlanKindValues(["B"], false);
  assert.notEqual(workflowRequestKey(none, kindA), workflowRequestKey(none, kindB));
  assert.equal(
    workflowRequestKey(none, kindA),
    workflowRequestKey(parseExplicitIntentValues(["fx-intent-01"]), kindA).replace("intent:fx-intent-01", "none"),
  );
  assert.equal(
    workflowRequestKey({ kind: "explicit", intentId: "i1" }, { kind: "invalid" }),
    "intent:i1:invalid",
  );
});

test("now surface warns on seed deficit, links the exact plan href, and fails closed without intents", () => {
  const store = newStore();
  const state = store.getState();
  const model = buildNowSurfaceModel(state, []);
  assert.equal(model.ready, true);
  if (!model.ready) return;
  assert.equal(model.warningTone, "warm");
  assert.ok(model.warningText.length > 0);
  assert.equal(model.planHref, mobilePlanHref(FIXTURE_IDS.intent));
  const failed = buildNowSurfaceModel({ ...state, intents: {} }, []);
  assert.equal(failed.ready, false);
  if (failed.ready) return;
  assert.equal(failed.reason, "noApplicableIntent");
});
