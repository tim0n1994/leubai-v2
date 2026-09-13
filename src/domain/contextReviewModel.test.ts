/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import type { Actor, LedgerEntry, ProtectedBlock } from "./types.ts";
import {
  applyContextReviewAction,
  createEmptyContextReviewState,
  currentRetainedObservations,
  isLocalOnly,
  isWeekConfirmationStale,
  latestWeekConfirmationForPeriod,
  normalizeLegacyContextReviewState,
  usableInferences,
  validateContextReviewState,
} from "./contextReviewModel.ts";
import type {
  ContextReviewAction,
  ContextReviewContext,
  ContextReviewErrorCode,
  ContextReviewResult,
  ContextReviewSourceRecheckReceipt,
  ContextReviewState,
  CreateInferenceAction,
  RecordObservationAction,
  UpsertWeeklyFeedbackAction,
  WeeklyFeedbackValue,
} from "./contextReviewModel.ts";

const NOW = "2026-09-12T10:00:00+08:00";
const TZ = "Asia/Shanghai";
const WEEK_MONDAY = "2026-09-07";
const EMPTY_WEEK_MONDAY = "2026-10-05";

const ACTIVE_BLOCK: ProtectedBlock = {
  id: "block-1",
  revision: 3,
  createdAt: "2026-09-05T09:00:00+08:00",
  updatedAt: "2026-09-05T09:00:00+08:00",
  dataMode: "fixture",
  provenance: { origin: "fixture" },
  intentId: null,
  blockId: "protected-evening",
  purpose: null,
  range: {
    start: "2026-09-07T19:00:00+08:00",
    end: "2026-09-07T20:00:00+08:00",
    timezone: TZ,
  },
  sourceRefs: [],
  status: "active",
};

function ledgerEntry(
  id: string,
  revision: number,
  category: LedgerEntry["category"],
  minutes: number,
  certainty: LedgerEntry["certainty"],
  effectiveDate: string,
): LedgerEntry {
  return {
    id,
    revision,
    createdAt: "2026-09-05T09:00:00+08:00",
    updatedAt: "2026-09-05T09:00:00+08:00",
    dataMode: "fixture",
    provenance: { origin: "fixture" },
    commitmentId: null,
    blockId: null,
    operationId: null,
    category,
    minutes,
    certainty,
    effectiveDate,
    note: "",
    supersedesId: null,
  };
}

const LEDGER: LedgerEntry[] = [
  ledgerEntry("led-1", 2, "protectedDuration", 60, "estimated", "2026-09-07"),
  ledgerEntry("led-2", 1, "measuredNetSaving", 30, "measured", "2026-09-08"),
  ledgerEntry("led-3", 5, "futureDebt", 20, "estimated", "2026-09-20"),
];

let uuidSeq = 0;
function testUuid(): string {
  uuidSeq += 1;
  return "uuid-" + uuidSeq;
}

function baseContext(overrides: Partial<ContextReviewContext> = {}): ContextReviewContext {
  return {
    actor: "user",
    now: NOW,
    uuid: testUuid,
    dataMode: "fixture",
    protectedBlocks: { "block-1": ACTIVE_BLOCK },
    ledger: LEDGER,
    currentSourceVersions: { "src-1": 5 },
    sourceRecheck: null,
    ...overrides,
  };
}

function expectOk(result: ContextReviewResult): ContextReviewState {
  assert.equal(result.ok, true, "expected success, got " + JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.state;
}

function expectErr(result: ContextReviewResult, code: ContextReviewErrorCode): void {
  assert.equal(result.ok, false, "expected " + code + ", got " + JSON.stringify(result));
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, code, result.reason);
}

function firstId(record: Record<string, unknown>): string {
  const keys = Object.keys(record);
  assert.equal(keys.length, 1, "expected exactly one record, got " + keys.length);
  return keys[0];
}

function snapshot(state: ContextReviewState): ContextReviewState {
  return structuredClone(state);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function createInferenceAction(
  overrides: Partial<CreateInferenceAction> = {},
): ContextReviewAction {
  return {
    type: "createInference",
    actor: "user",
    statement: "近期多个信号指向固定的晚间复盘时间，可能与既定保护冲突（fixture 推断）",
    evidenceRefs: ["intent-1"],
    evidenceSummary: "来自已保存意图与时间线索的引用汇总",
    reviewDueAt: "2026-09-30T00:00:00+08:00",
    provenance: { origin: "derived" },
    ...overrides,
  };
}

function inferenceAction(
  type: "acknowledgeInference" | "rejectInference" | "deleteInference",
  inferenceId: string,
  expectedRevision: number,
  actor: Actor = "user",
): ContextReviewAction {
  return { type, inferenceId, expectedRevision, actor };
}

function feedbackAction(
  value: WeeklyFeedbackValue,
  expectedRevision: number | null,
  overrides: Partial<UpsertWeeklyFeedbackAction> = {},
): ContextReviewAction {
  return {
    type: "upsertWeeklyFeedback",
    weekStart: WEEK_MONDAY,
    timezone: TZ,
    value,
    expectedRevision,
    actor: "user",
    ...overrides,
  };
}

function observeAction(overrides: Partial<RecordObservationAction> = {}): ContextReviewAction {
  return {
    type: "recordObservation",
    blockId: "block-1",
    blockRevision: 3,
    date: "2026-09-07",
    observedMinutes: 45,
    outcome: "partly",
    actor: "user",
    ...overrides,
  };
}

function observationWithObservation(): ContextReviewState {
  const created = expectOk(applyContextReviewAction(createEmptyContextReviewState(), observeAction(), baseContext()));
  return created;
}

const OK_RECEIPT: ContextReviewSourceRecheckReceipt = {
  checkedAt: NOW,
  outcome: "success",
  sourceVersions: { "src-1": 5 },
};

test("createEmptyContextReviewState returns a fresh, empty, valid state", () => {
  const a = createEmptyContextReviewState();
  const b = createEmptyContextReviewState();
  assert.notEqual(a, b, "must not share one state object");
  assert.deepEqual(a, {
    inferences: {},
    weeklyFeedback: {},
    retainedObservations: {},
    weekConfirmations: {},
    localOnly: null,
  });
  assert.equal(Object.keys(a.inferences).length, 0, "no manufactured inference records");
  assert.equal(Object.keys(a.weeklyFeedback).length, 0, "no manufactured feedback records");
  expectOk(validateContextReviewState(a));
  expectOk(validateContextReviewState(JSON.parse(JSON.stringify(a)) as unknown));
});

test("validate rejects malformed persisted collections without defaulting them", () => {
  const empty = createEmptyContextReviewState();
  const { inferences: _dropped, ...missingInferences } = empty;
  expectErr(validateContextReviewState(missingInferences), "INVALID_STATE");
  const { weeklyFeedback: _droppedFeedback, ...missingFeedback } = empty;
  expectErr(validateContextReviewState(missingFeedback), "INVALID_STATE");
  expectErr(validateContextReviewState({ ...empty, weeklyFeedback: [] }), "INVALID_STATE");
  expectErr(validateContextReviewState({ ...empty, extraTopLevel: 1 }), "INVALID_STATE");
});

test("validate rejects unsafe revisions, impossible dates, bad timezones and malformed refs", () => {
  const empty = createEmptyContextReviewState();
  const baseInference = {
    id: "inf-1",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    dataMode: "fixture",
    provenance: { origin: "user" },
    statement: "statement",
    evidenceRefs: ["intent-1"],
    evidenceSummary: "summary",
    reviewDueAt: null,
    status: "pending",
    deletedAt: null,
  };
  for (const revision of [0, -1, 2.5, "3"]) {
    expectErr(
      validateContextReviewState({ ...empty, inferences: { "inf-1": { ...baseInference, revision } } }),
      "INVALID_STATE",
    );
  }
  const baseFeedback = {
    id: "fb-1",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    dataMode: "fixture",
    provenance: { origin: "user" },
    weekStart: WEEK_MONDAY,
    timezone: TZ,
    value: "same",
    actor: "user",
  };
  expectErr(
    validateContextReviewState({
      ...empty,
      weeklyFeedback: { [WEEK_MONDAY + "@" + TZ]: { ...baseFeedback, weekStart: "2026-02-30" } },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      weeklyFeedback: { [WEEK_MONDAY + "@" + TZ]: { ...baseFeedback, weekStart: "2026-09-08" } },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      weeklyFeedback: { [WEEK_MONDAY + "@" + TZ]: { ...baseFeedback, timezone: "Mars/Olympus" } },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      weeklyFeedback: { "wrong-key": baseFeedback },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({ ...empty, inferences: { "inf-1": { ...baseInference, createdAt: "2026-09-12 10:00" } } }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      inferences: { "inf-1": { ...baseInference, reviewDueAt: "2026-13-01T00:00:00+08:00" } },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({ ...empty, inferences: { "inf-1": { ...baseInference, evidenceRefs: [42] } } }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({ ...empty, inferences: { "inf-1": { ...baseInference, evidenceRefs: [""] } } }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      inferences: { "inf-1": { ...baseInference, status: "deleted", deletedAt: NOW, statement: "still here" } },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      inferences: { "inf-1": { ...baseInference, status: "deleted", deletedAt: null, statement: null, evidenceRefs: [], evidenceSummary: null } },
    }),
    "INVALID_STATE",
  );
  expectErr(
    validateContextReviewState({
      ...empty,
      localOnly: { revision: 0, enabled: true, changedAt: NOW, changedBy: "user" },
    }),
    "INVALID_STATE",
  );
});

test("normalizeLegacyContextReviewState defaults only absent collections, never invalid ones", () => {
  const normalized = expectOk(normalizeLegacyContextReviewState(undefined));
  assert.deepEqual(normalized, createEmptyContextReviewState());
  const fromEmpty = expectOk(normalizeLegacyContextReviewState({}));
  assert.deepEqual(fromEmpty, createEmptyContextReviewState());
  const partial = expectOk(normalizeLegacyContextReviewState({ weeklyFeedback: {} }));
  assert.deepEqual(partial.weeklyFeedback, {});
  assert.deepEqual(partial.retainedObservations, {});
  expectErr(normalizeLegacyContextReviewState({ weeklyFeedback: [] }), "INVALID_STATE");
  expectErr(
    normalizeLegacyContextReviewState({
      localOnly: { revision: 0, enabled: true, changedAt: NOW, changedBy: "user" },
    }),
    "INVALID_STATE",
  );
  expectErr(normalizeLegacyContextReviewState("junk"), "INVALID_STATE");
});

test("inference lifecycle: create, acknowledge, expiry, explicit renewal", () => {
  const empty = createEmptyContextReviewState();
  const s1 = expectOk(applyContextReviewAction(empty, createInferenceAction(), baseContext()));
  const id = firstId(s1.inferences);
  const created = s1.inferences[id];
  assert.equal(created.status, "pending");
  assert.equal(created.revision, 1);
  assert.equal(created.createdAt, NOW);
  assert.equal(created.dataMode, "fixture");
  assert.equal(created.reviewDueAt, "2026-09-30T00:00:00+08:00");
  expectOk(validateContextReviewState(s1));
  assert.equal(usableInferences(s1, NOW).length, 1);

  const s2 = expectOk(applyContextReviewAction(s1, inferenceAction("acknowledgeInference", id, 1), baseContext()));
  const acked = s2.inferences[id];
  assert.equal(acked.status, "acknowledged", "acknowledged stays acknowledged, not fact");
  assert.ok(!("isFact" in acked) && !("promoted" in acked), "acknowledgement must not promote to fact");
  assert.equal(acked.statement, created.statement);
  assert.equal(acked.reviewDueAt, created.reviewDueAt, "decision must not extend reviewDueAt");
  assert.equal(acked.revision, 2);
  assert.equal(usableInferences(s2, NOW).length, 1);

  const snapshotBefore = snapshot(s2);
  expectErr(applyContextReviewAction(s2, inferenceAction("acknowledgeInference", id, 2), baseContext()), "INVALID_TRANSITION");
  expectErr(applyContextReviewAction(s2, inferenceAction("acknowledgeInference", id, 1), baseContext()), "REVISION_CONFLICT");
  expectErr(applyContextReviewAction(s2, inferenceAction("acknowledgeInference", id, 2, "model"), baseContext()), "USER_ONLY");
  expectErr(
    applyContextReviewAction(
      s2,
      inferenceAction("acknowledgeInference", id, 2, "user"),
      baseContext({ actor: "automation" }),
    ),
    "USER_ONLY",
  );
  assert.deepEqual(s2, snapshotBefore, "failed actions must not mutate state");

  const renewed = expectOk(
    applyContextReviewAction(
      s2,
      { type: "renewInferenceReview", inferenceId: id, expectedRevision: 2, actor: "user", reviewDueAt: "2026-11-01T00:00:00+08:00" },
      baseContext(),
    ),
  );
  assert.equal(renewed.inferences[id].reviewDueAt, "2026-11-01T00:00:00+08:00");
  assert.equal(usableInferences(renewed, "2026-10-15T00:00:00+08:00").length, 1);

  const expired = usableInferences(s2, "2026-10-15T00:00:00+08:00");
  assert.equal(expired.length, 0, "expired inference is ineligible before renewal");

  expectErr(
    applyContextReviewAction(
      s2,
      { type: "renewInferenceReview", inferenceId: id, expectedRevision: 2, actor: "user", reviewDueAt: "2026-09-01T00:00:00+08:00" },
      baseContext(),
    ),
    "INVALID_INPUT",
  );

  const rejected = expectOk(applyContextReviewAction(renewed, inferenceAction("rejectInference", id, 3), baseContext()));
  assert.equal(rejected.inferences[id].status, "rejected");
  assert.equal(usableInferences(rejected, NOW).length, 0);
  expectErr(
    applyContextReviewAction(
      rejected,
      { type: "renewInferenceReview", inferenceId: id, expectedRevision: 4, actor: "user", reviewDueAt: "2026-12-01T00:00:00+08:00" },
      baseContext(),
    ),
    "INVALID_TRANSITION",
  );

  const noDue = expectOk(applyContextReviewAction(empty, createInferenceAction({ reviewDueAt: null }), baseContext()));
  assert.equal(usableInferences(noDue, "2027-01-01T00:00:00+08:00").length, 1, "null reviewDueAt never expires");

  expectErr(applyContextReviewAction(empty, createInferenceAction({ statement: "" }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, createInferenceAction({ evidenceRefs: [] }), baseContext()), "INVALID_INPUT");
  expectErr(
    applyContextReviewAction(empty, createInferenceAction({ provenance: { origin: "fixture" } }), baseContext({ dataMode: "live" })),
    "INVALID_INPUT",
  );
});

test("inference delete produces a minimal tombstone", () => {
  const empty = createEmptyContextReviewState();
  const s1 = expectOk(applyContextReviewAction(empty, createInferenceAction(), baseContext()));
  const id = firstId(s1.inferences);
  const s2 = expectOk(applyContextReviewAction(s1, inferenceAction("deleteInference", id, 1), baseContext()));
  const tombstone = s2.inferences[id];
  assert.equal(tombstone.status, "deleted");
  assert.equal(tombstone.statement, null, "delete clears statement text");
  assert.equal(tombstone.evidenceSummary, null, "delete clears evidence summary");
  assert.deepEqual(tombstone.evidenceRefs, [], "delete clears evidence refs");
  assert.equal(tombstone.deletedAt, NOW);
  assert.equal(tombstone.revision, 2);
  assert.equal(tombstone.id, id, "tombstone retains id for no-reapplication semantics");
  assert.equal(tombstone.createdAt, s1.inferences[id].createdAt, "tombstone retains creation provenance");
  expectOk(validateContextReviewState(s2));
  assert.equal(usableInferences(s2, NOW).length, 0);
  expectErr(applyContextReviewAction(s2, inferenceAction("deleteInference", id, 2), baseContext()), "INVALID_TRANSITION");
  expectErr(applyContextReviewAction(s2, inferenceAction("deleteInference", "missing", 1), baseContext()), "NOT_FOUND");
});

test("weekly feedback upsert is revision-strict and period-unique", () => {
  const empty = createEmptyContextReviewState();
  const s1 = expectOk(applyContextReviewAction(empty, feedbackAction("harder", null), baseContext()));
  const fb = Object.values(s1.weeklyFeedback)[0];
  assert.equal(fb.weekStart, WEEK_MONDAY);
  assert.equal(fb.timezone, TZ);
  assert.equal(fb.value, "harder");
  assert.equal(fb.actor, "user");
  assert.equal(fb.revision, 1);
  assert.equal(Object.keys(s1.weeklyFeedback).length, 1);
  expectOk(validateContextReviewState(s1));

  expectErr(applyContextReviewAction(s1, feedbackAction("same", null), baseContext()), "PERIOD_CONFLICT");
  const s2 = expectOk(applyContextReviewAction(s1, feedbackAction("same", 1), baseContext()));
  const updated = Object.values(s2.weeklyFeedback)[0];
  assert.equal(updated.value, "same");
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedAt, NOW);
  expectErr(applyContextReviewAction(s2, feedbackAction("skipped", 1), baseContext()), "REVISION_CONFLICT");
  expectErr(applyContextReviewAction(s2, feedbackAction("skipped", 99), baseContext()), "REVISION_CONFLICT");
  expectErr(
    applyContextReviewAction(s2, feedbackAction("skipped", 1, { weekStart: "2026-09-14" }), baseContext()),
    "NOT_FOUND",
  );
  expectErr(applyContextReviewAction(s2, feedbackAction("skipped", 2, { actor: "model" }), baseContext()), "USER_ONLY");
  expectErr(applyContextReviewAction(s2, feedbackAction("skipped", null, { weekStart: "2026-09-08" }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(s2, feedbackAction("skipped", null, { timezone: "Not/AZone" }), baseContext()), "INVALID_INPUT");

  const skipped = expectOk(
    applyContextReviewAction(s2, feedbackAction("skipped", null, { weekStart: "2026-09-14" }), baseContext()),
  );
  const skippedEntries = Object.values(skipped.weeklyFeedback).filter((f) => f.weekStart === "2026-09-14");
  assert.equal(skippedEntries.length, 1, "skipped is a durable normal record");
  assert.equal(skippedEntries[0].value, "skipped");
});

test("retained observations bind real blocks and fail closed", () => {
  const empty = createEmptyContextReviewState();
  const s1 = expectOk(applyContextReviewAction(empty, observeAction(), baseContext()));
  const obs = Object.values(s1.retainedObservations)[0];
  assert.equal(obs.protectedBlockId, "block-1");
  assert.equal(obs.blockRevision, 3);
  assert.equal(obs.observedMinutes, 45, "observed minutes are reported, not inferred from planned 60");
  assert.equal(obs.outcome, "partly");
  assert.equal(obs.revision, 1);
  assert.equal(currentRetainedObservations(s1).length, 1);
  expectOk(validateContextReviewState(s1));

  expectErr(applyContextReviewAction(empty, observeAction({ blockRevision: 2 }), baseContext()), "REVISION_CONFLICT");
  expectErr(applyContextReviewAction(empty, observeAction({ blockId: "missing" }), baseContext()), "NOT_FOUND");
  expectErr(
    applyContextReviewAction(
      empty,
      observeAction(),
      baseContext({ protectedBlocks: { "block-1": { ...ACTIVE_BLOCK, status: "released" } } }),
    ),
    "INVALID_TRANSITION",
  );
  expectErr(applyContextReviewAction(empty, observeAction({ observedMinutes: 61 }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, observeAction({ observedMinutes: -1 }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, observeAction({ observedMinutes: 1.5 }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, observeAction({ date: "2026-09-08" }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, observeAction({ date: "2026-09-06" }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, observeAction({ date: "2026-02-30" }), baseContext()), "INVALID_INPUT");
  expectErr(applyContextReviewAction(empty, observeAction({ actor: "model" }), baseContext()), "USER_ONLY");
  expectErr(applyContextReviewAction(s1, observeAction(), baseContext()), "PERIOD_CONFLICT");
});

test("observation correction supersedes without double counting and preserves history", () => {
  const s1 = observationWithObservation();
  const oldId = firstId(s1.retainedObservations);
  const s2 = expectOk(
    applyContextReviewAction(
      s1,
      {
        type: "correctObservation",
        observationId: oldId,
        expectedRevision: 1,
        blockId: "block-1",
        blockRevision: 3,
        date: "2026-09-07",
        observedMinutes: 30,
        outcome: "partly",
        actor: "user",
      },
      baseContext(),
    ),
  );
  const newId = firstId(currentRetainedObservations(s2).reduce<Record<string, unknown>>((acc, o) => {
    acc[o.id] = o;
    return acc;
  }, {}));
  assert.notEqual(newId, oldId);
  const oldRecord = s2.retainedObservations[oldId];
  const newRecord = s2.retainedObservations[newId];
  assert.equal(oldRecord.supersededBy, newId, "old observation is marked superseded");
  assert.equal(oldRecord.revision, 2, "superseding marks an explicit revision on the old record");
  assert.equal(newRecord.supersedesId, oldId);
  assert.equal(newRecord.observedMinutes, 30);
  assert.equal(s2.retainedObservations[oldId].observedMinutes, 45, "prior history is preserved");
  assert.equal(currentRetainedObservations(s2).length, 1, "selector keeps only latest non-superseded");
  expectOk(validateContextReviewState(s2));

  expectErr(
    applyContextReviewAction(
      s2,
      {
        type: "correctObservation",
        observationId: oldId,
        expectedRevision: 2,
        blockId: "block-1",
        blockRevision: 3,
        date: "2026-09-07",
        observedMinutes: 20,
        outcome: "not-retained",
        actor: "user",
      },
      baseContext(),
    ),
    "INVALID_TRANSITION",
  );
  expectErr(
    applyContextReviewAction(
      s2,
      {
        type: "correctObservation",
        observationId: newId,
        expectedRevision: 1,
        blockId: "block-1",
        blockRevision: 2,
        date: "2026-09-07",
        observedMinutes: 20,
        outcome: "not-retained",
        actor: "user",
      },
      baseContext(),
    ),
    "REVISION_CONFLICT",
  );
});

test("source estimated ledger remains byte-equivalent across observation actions", () => {
  const ledgerCopy = structuredClone(LEDGER);
  const s1 = observationWithObservation();
  const oldId = firstId(s1.retainedObservations);
  const s2 = expectOk(
    applyContextReviewAction(
      s1,
      {
        type: "correctObservation",
        observationId: oldId,
        expectedRevision: 1,
        blockId: "block-1",
        blockRevision: 3,
        date: "2026-09-07",
        observedMinutes: 15,
        outcome: "not-retained",
        actor: "user",
      },
      baseContext(),
    ),
  );
  assert.equal(currentRetainedObservations(s2).length, 1, "correction applied exactly once");
  assert.deepEqual(LEDGER, ledgerCopy, "ledger entries untouched");
  assert.equal(JSON.stringify(LEDGER), JSON.stringify(ledgerCopy), "byte-equivalent ledger");
  for (const entry of LEDGER) {
    assert.equal(entry.certainty, ledgerEntry(entry.id, entry.revision, entry.category, entry.minutes ?? 0, entry.certainty, entry.effectiveDate).certainty);
  }
});

test("week confirmation captures exact period versions and goes stale precisely", () => {
  const withObs = observationWithObservation();
  const obsId = firstId(withObs.retainedObservations);
  const confirmed = expectOk(
    applyContextReviewAction(
      withObs,
      { type: "confirmWeek", weekStart: WEEK_MONDAY, timezone: TZ, actor: "user" },
      baseContext(),
    ),
  );
  const conf = Object.values(confirmed.weekConfirmations)[0];
  assert.deepEqual(conf.reviewedLedgerVersions, { "led-1": 2, "led-2": 1 }, "in-period ledger versions captured exactly");
  assert.deepEqual(conf.reviewedObservationVersions, { [obsId]: 1 });
  assert.equal(conf.weekStart, WEEK_MONDAY);
  assert.equal(conf.timezone, TZ);
  assert.equal(conf.actor, "user");
  expectOk(validateContextReviewState(confirmed));
  assert.equal(latestWeekConfirmationForPeriod(confirmed, WEEK_MONDAY, TZ), conf);

  const current = () => ({ ledger: LEDGER, observations: confirmed.retainedObservations });
  assert.equal(isWeekConfirmationStale(conf, current()), false);

  const bumped = LEDGER.map((e) => (e.id === "led-1" ? { ...e, revision: 3 } : e));
  assert.equal(isWeekConfirmationStale(conf, { ledger: bumped, observations: confirmed.retainedObservations }), true);

  const removed = LEDGER.filter((e) => e.id !== "led-1");
  assert.equal(isWeekConfirmationStale(conf, { ledger: removed, observations: confirmed.retainedObservations }), true);

  const renamed = [
    ...LEDGER.filter((e) => e.id !== "led-1"),
    ledgerEntry("led-1b", 2, "protectedDuration", 60, "estimated", "2026-09-07"),
  ];
  assert.equal(isWeekConfirmationStale(conf, { ledger: renamed, observations: confirmed.retainedObservations }), true, "same count, different ids is stale");

  const outsideChanged = LEDGER.map((e) => (e.id === "led-3" ? { ...e, revision: 6 } : e));
  assert.equal(
    isWeekConfirmationStale(conf, { ledger: outsideChanged, observations: confirmed.retainedObservations }),
    false,
    "out-of-period changes do not stale the confirmation",
  );

  const superseding = expectOk(
    applyContextReviewAction(
      confirmed,
      {
        type: "correctObservation",
        observationId: obsId,
        expectedRevision: 1,
        blockId: "block-1",
        blockRevision: 3,
        date: "2026-09-07",
        observedMinutes: 20,
        outcome: "not-retained",
        actor: "user",
      },
      baseContext(),
    ),
  );
  assert.equal(
    isWeekConfirmationStale(conf, { ledger: LEDGER, observations: superseding.retainedObservations }),
    true,
    "superseding the observed record stales the confirmation",
  );

  const forgedBase: Extract<ContextReviewAction, { type: "confirmWeek" }> = {
    type: "confirmWeek",
    weekStart: WEEK_MONDAY,
    timezone: TZ,
    actor: "user",
  };
  const forged = Object.assign({ ...forgedBase }, { reviewedLedgerVersions: { "led-1": 99 } });
  const forgedResult = expectOk(applyContextReviewAction(withObs, forged, baseContext()));
  const forgedConf = Object.values(forgedResult.weekConfirmations)[0];
  assert.deepEqual(forgedConf.reviewedLedgerVersions, { "led-1": 2, "led-2": 1 }, "fabricated maps in the action are ignored");

  expectErr(
    applyContextReviewAction(withObs, { type: "confirmWeek", weekStart: WEEK_MONDAY, timezone: TZ, actor: "model" }, baseContext()),
    "USER_ONLY",
  );
  expectErr(
    applyContextReviewAction(withObs, { type: "confirmWeek", weekStart: "2026-09-08", timezone: TZ, actor: "user" }, baseContext()),
    "INVALID_INPUT",
  );

  const emptyWeek = expectOk(
    applyContextReviewAction(
      createEmptyContextReviewState(),
      { type: "confirmWeek", weekStart: EMPTY_WEEK_MONDAY, timezone: TZ, actor: "user" },
      baseContext(),
    ),
  );
  const emptyConf = Object.values(emptyWeek.weekConfirmations)[0];
  assert.deepEqual(emptyConf.reviewedLedgerVersions, {}, "honest empty confirmation has empty maps");
  assert.equal(
    isWeekConfirmationStale(emptyConf, { ledger: LEDGER, observations: emptyWeek.retainedObservations }),
    false,
  );
});

test("local-only preference persists and return-connected requires a trusted recheck receipt", () => {
  const empty = createEmptyContextReviewState();
  assert.equal(isLocalOnly(empty), false);
  expectErr(applyContextReviewAction(empty, { type: "returnToConnected", actor: "user" }, baseContext()), "INVALID_TRANSITION");
  expectErr(applyContextReviewAction(empty, { type: "enterLocalOnly", actor: "model" }, baseContext()), "USER_ONLY");

  const local = expectOk(applyContextReviewAction(empty, { type: "enterLocalOnly", actor: "user" }, baseContext()));
  assert.deepEqual(local.localOnly, { revision: 1, enabled: true, changedAt: NOW, changedBy: "user" });
  assert.equal(isLocalOnly(local), true);
  expectOk(validateContextReviewState(local));
  expectErr(applyContextReviewAction(local, { type: "enterLocalOnly", actor: "user" }, baseContext()), "INVALID_TRANSITION");

  const snapshotLocal = snapshot(local);
  expectErr(applyContextReviewAction(local, { type: "returnToConnected", actor: "user" }, baseContext()), "STALE_RECEIPT");
  const payloadBoolean = Object.assign({ type: "returnToConnected" as const, actor: "user" as const }, { toConnected: true });
  expectErr(applyContextReviewAction(local, payloadBoolean, baseContext()), "STALE_RECEIPT", );
  expectErr(
    applyContextReviewAction(local, { type: "returnToConnected", actor: "user" }, baseContext({ sourceRecheck: Object.assign({ ...OK_RECEIPT }, { outcome: "failure" }) })),
    "STALE_RECEIPT",
  );
  expectErr(
    applyContextReviewAction(
      local,
      { type: "returnToConnected", actor: "user" },
      baseContext({ sourceRecheck: { ...OK_RECEIPT, sourceVersions: { "src-1": 4 } } }),
    ),
    "STALE_RECEIPT",
  );
  expectErr(
    applyContextReviewAction(
      local,
      { type: "returnToConnected", actor: "user" },
      baseContext({ sourceRecheck: { ...OK_RECEIPT, sourceVersions: { "src-1": 5, "src-2": 1 } } }),
    ),
    "STALE_RECEIPT",
  );
  expectErr(
    applyContextReviewAction(
      local,
      { type: "returnToConnected", actor: "user" },
      baseContext({ currentSourceVersions: {}, sourceRecheck: { ...OK_RECEIPT, sourceVersions: {} } }),
    ),
    "STALE_RECEIPT",
  );
  expectErr(
    applyContextReviewAction(
      local,
      { type: "returnToConnected", actor: "user" },
      baseContext({ sourceRecheck: { ...OK_RECEIPT, checkedAt: "2026-09-13T10:00:00+08:00" } }),
    ),
    "STALE_RECEIPT",
  );
  assert.deepEqual(local, snapshotLocal, "failed return attempts must not change local-only state");

  const connected = expectOk(
    applyContextReviewAction(local, { type: "returnToConnected", actor: "user" }, baseContext({ sourceRecheck: OK_RECEIPT })),
  );
  assert.deepEqual(connected.localOnly, { revision: 2, enabled: false, changedAt: NOW, changedBy: "user" });
  assert.equal(isLocalOnly(connected), false);
  expectOk(validateContextReviewState(connected));
});

test("model is pure: no Date.now/Math.random, frozen inputs preserved, outputs detached", () => {
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => {
    throw new Error("Date.now must not be called inside pure functions");
  };
  Math.random = () => {
    throw new Error("Math.random must not be called inside pure functions");
  };
  try {
    let state = createEmptyContextReviewState();
    state = expectOk(applyContextReviewAction(state, createInferenceAction(), baseContext()));
    const infId = firstId(state.inferences);
    state = expectOk(applyContextReviewAction(state, inferenceAction("acknowledgeInference", infId, 1), baseContext()));
    state = expectOk(applyContextReviewAction(state, feedbackAction("same", null), baseContext()));
    state = expectOk(applyContextReviewAction(state, observeAction(), baseContext()));
    state = expectOk(applyContextReviewAction(state, { type: "enterLocalOnly", actor: "user" }, baseContext()));
    expectOk(validateContextReviewState(state));
  } finally {
    Date.now = originalDateNow;
    Math.random = originalRandom;
  }

  const frozenState = deepFreeze(createEmptyContextReviewState());
  const frozenContext = deepFreeze(baseContext());
  const frozenSnapshot = snapshot(createEmptyContextReviewState());
  const fromFrozen = expectOk(applyContextReviewAction(frozenState, createInferenceAction(), frozenContext));
  assert.equal(Object.keys(fromFrozen.inferences).length, 1);
  assert.deepEqual(frozenState, frozenSnapshot, "frozen input state untouched");

  const s1 = expectOk(applyContextReviewAction(createEmptyContextReviewState(), createInferenceAction(), baseContext()));
  const infId2 = firstId(s1.inferences);
  const s2 = expectOk(applyContextReviewAction(s1, inferenceAction("acknowledgeInference", infId2, 1), baseContext()));
  s1.inferences[infId2].status = "rejected";
  assert.equal(s2.inferences[infId2].status, "acknowledged", "mutating an earlier output must not affect later output");
});
