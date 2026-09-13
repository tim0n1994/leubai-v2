import type { Actor, DataMode, EntityBase, LedgerEntry, ProtectedBlock, Provenance } from "./types.ts";

// allow: SIZE_OK — this isolated module is the complete persistence-boundary state machine requested for S11–S13 integration.
export interface Inference extends EntityBase {
  statement: string | null;
  evidenceRefs: string[];
  evidenceSummary: string | null;
  reviewDueAt: string | null;
  status: "pending" | "acknowledged" | "rejected" | "deleted";
  deletedAt: string | null;
}
export type WeeklyFeedbackValue = "more-control" | "same" | "harder" | "skipped";
export interface WeeklyFeedback extends EntityBase {
  weekStart: string;
  timezone: string;
  value: WeeklyFeedbackValue;
  actor: "user";
}
export interface RetainedObservation extends EntityBase {
  protectedBlockId: string;
  blockRevision: number;
  date: string;
  timezone: string;
  observedMinutes: number;
  outcome: "retained" | "partly" | "not-retained";
  actor: "user";
  supersedesId: string | null;
  supersededBy: string | null;
}
export interface WeekConfirmation extends EntityBase {
  weekStart: string;
  timezone: string;
  actor: "user";
  reviewedLedgerVersions: Record<string, number>;
  reviewedObservationVersions: Record<string, number>;
}
export interface LocalOnlyPreference {
  revision: number;
  enabled: boolean;
  changedAt: string;
  changedBy: "user";
}
export interface ContextReviewState {
  inferences: Record<string, Inference>;
  weeklyFeedback: Record<string, WeeklyFeedback>;
  retainedObservations: Record<string, RetainedObservation>;
  weekConfirmations: Record<string, WeekConfirmation>;
  localOnly: LocalOnlyPreference | null;
}
export interface ContextReviewSourceRecheckReceipt {
  readonly checkedAt: string;
  readonly outcome: "success" | "failure";
  readonly sourceVersions: Record<string, number>;
}
export interface ContextReviewContext {
  readonly actor: Actor;
  readonly now: string;
  readonly uuid: () => string;
  readonly dataMode: DataMode;
  readonly protectedBlocks: Record<string, ProtectedBlock>;
  readonly ledger: readonly LedgerEntry[];
  readonly currentSourceVersions: Record<string, number>;
  readonly sourceRecheck: ContextReviewSourceRecheckReceipt | null;
}
export interface CreateInferenceAction {
  readonly type: "createInference";
  readonly actor: Actor;
  readonly statement: string;
  readonly evidenceRefs: string[];
  readonly evidenceSummary: string;
  readonly reviewDueAt: string | null;
  readonly provenance: Provenance;
}
export interface UpsertWeeklyFeedbackAction {
  readonly type: "upsertWeeklyFeedback";
  readonly actor: Actor;
  readonly weekStart: string;
  readonly timezone: string;
  readonly value: WeeklyFeedbackValue;
  readonly expectedRevision: number | null;
}
export interface RecordObservationAction {
  readonly type: "recordObservation";
  readonly actor: Actor;
  readonly blockId: string;
  readonly blockRevision: number;
  readonly date: string;
  readonly observedMinutes: number;
  readonly outcome: RetainedObservation["outcome"];
}
type InferenceDecisionAction = {
  readonly type: "acknowledgeInference" | "rejectInference" | "deleteInference";
  readonly inferenceId: string;
  readonly expectedRevision: number;
  readonly actor: Actor;
};
export type ContextReviewAction = CreateInferenceAction | UpsertWeeklyFeedbackAction | RecordObservationAction
  | InferenceDecisionAction
  | (Omit<InferenceDecisionAction, "type"> & { readonly type: "renewInferenceReview"; readonly reviewDueAt: string })
  | (Omit<RecordObservationAction, "type"> & { readonly type: "correctObservation"; readonly observationId: string; readonly expectedRevision: number })
  | { readonly type: "confirmWeek"; readonly weekStart: string; readonly timezone: string; readonly actor: Actor }
  | { readonly type: "enterLocalOnly" | "returnToConnected"; readonly actor: Actor };
export type ContextReviewErrorCode = "INVALID_STATE" | "INVALID_INPUT" | "USER_ONLY" | "NOT_FOUND"
  | "REVISION_CONFLICT" | "INVALID_TRANSITION" | "PERIOD_CONFLICT" | "STALE_RECEIPT";
export type ContextReviewResult = { readonly ok: true; readonly state: ContextReviewState }
  | { readonly ok: false; readonly code: ContextReviewErrorCode; readonly reason: string };

const fail = (code: ContextReviewErrorCode, reason: string): ContextReviewResult => ({ ok: false, code, reason });
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const ref = (value: unknown): value is string => text(value) && value !== "__proto__" && value !== "constructor" && value !== "prototype";
const nullableRef = (value: unknown): value is string | null => value === null || ref(value);
const refs = (value: unknown): value is string[] => Array.isArray(value) && value.every(ref) && new Set(value).size === value.length;
const versions = (value: unknown): value is Record<string, number> => object(value) && Object.entries(value).every(([key, v]) => ref(key) && revision(v));
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return date(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60
    && Number(value.slice(17, 19)) < 60 && Number.isFinite(Date.parse(value));
}
function timezone(value: unknown): value is string {
  if (!text(value) || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch (error) { if (error instanceof RangeError) return false; throw error; }
}
const period = (start: unknown, zone: unknown): boolean => date(start) && new Date(start + "T00:00:00Z").getUTCDay() === 1 && timezone(zone);
const provenance = (v: unknown): v is Provenance => object(v) && (v.origin === "fixture" || v.origin === "user" || v.origin === "derived" || v.origin === "system" || v.origin === "model")
  && (v.note === undefined || typeof v.note === "string") && Object.keys(v).every((key) => ["origin", "note"].includes(key));
function base(v: unknown): v is EntityBase & Record<string, unknown> {
  return object(v) && ref(v.id) && revision(v.revision) && timestamp(v.createdAt) && timestamp(v.updatedAt)
    && Date.parse(v.updatedAt) >= Date.parse(v.createdAt) && (v.dataMode === "fixture" || v.dataMode === "live") && provenance(v.provenance)
    && !(v.dataMode === "live" && v.provenance.origin === "fixture");
}
function inference(v: unknown): v is Inference {
  if (!base(v) || !refs(v.evidenceRefs) || !(v.reviewDueAt === null || timestamp(v.reviewDueAt))) return false;
  switch (v.status) {
    case "deleted": return v.statement === null && v.evidenceSummary === null && v.evidenceRefs.length === 0 && timestamp(v.deletedAt);
    case "pending": case "acknowledged": case "rejected":
      return text(v.statement) && text(v.evidenceSummary) && v.evidenceRefs.length > 0 && v.deletedAt === null;
    default: return false;
  }
}
function feedback(v: unknown): v is WeeklyFeedback {
  return base(v) && period(v.weekStart, v.timezone) && feedbackValue(v.value) && v.actor === "user";
}
function feedbackValue(v: unknown): v is WeeklyFeedbackValue { return v === "more-control" || v === "same" || v === "harder" || v === "skipped"; }
function observation(v: unknown): v is RetainedObservation {
  return base(v) && ref(v.protectedBlockId) && revision(v.blockRevision) && date(v.date) && timezone(v.timezone)
    && typeof v.observedMinutes === "number" && Number.isSafeInteger(v.observedMinutes) && v.observedMinutes >= 0
    && outcome(v.outcome) && v.actor === "user" && nullableRef(v.supersedesId) && nullableRef(v.supersededBy);
}
function outcome(v: unknown): v is RetainedObservation["outcome"] { return v === "retained" || v === "partly" || v === "not-retained"; }
function confirmation(v: unknown): v is WeekConfirmation {
  return base(v) && period(v.weekStart, v.timezone) && v.actor === "user" && versions(v.reviewedLedgerVersions) && versions(v.reviewedObservationVersions);
}
function preference(v: unknown): v is LocalOnlyPreference {
  return object(v) && revision(v.revision) && typeof v.enabled === "boolean" && timestamp(v.changedAt) && v.changedBy === "user";
}
function collection<T>(v: unknown, check: (entry: unknown) => entry is T): v is Record<string, T> {
  return object(v) && Object.entries(v).every(([key, entry]) => ref(key) && check(entry));
}
function stateShape(v: unknown): v is ContextReviewState {
  return object(v) && Object.keys(v).length === 5 && Object.keys(v).every((key) => ["inferences", "weeklyFeedback", "retainedObservations", "weekConfirmations", "localOnly"].includes(key))
    && collection(v.inferences, inference) && collection(v.weeklyFeedback, feedback) && collection(v.retainedObservations, observation)
    && collection(v.weekConfirmations, confirmation) && (v.localOnly === null || preference(v.localOnly));
}
export function createEmptyContextReviewState(): ContextReviewState {
  return { inferences: {}, weeklyFeedback: {}, retainedObservations: {}, weekConfirmations: {}, localOnly: null };
}
export function validateContextReviewState(input: unknown): ContextReviewResult {
  if (!stateShape(input)) return fail("INVALID_STATE", "Malformed context review state.");
  for (const records of [input.inferences, input.retainedObservations, input.weekConfirmations]) {
    if (Object.entries(records).some(([key, value]) => value.id !== key)) return fail("INVALID_STATE", "Record key does not match its id.");
  }
  if (Object.entries(input.weeklyFeedback).some(([key, value]) => key !== value.weekStart + "@" + value.timezone)) return fail("INVALID_STATE", "Feedback key does not match its period.");
  const activePeriods = new Set<string>();
  for (const value of Object.values(input.retainedObservations)) {
    const old = value.supersedesId === null ? null : input.retainedObservations[value.supersedesId];
    const next = value.supersededBy === null ? null : input.retainedObservations[value.supersededBy];
    if ((value.supersedesId !== null && (!old || old.supersededBy !== value.id || old.id === value.id))
      || (value.supersededBy !== null && (!next || next.supersedesId !== value.id || next.id === value.id))) return fail("INVALID_STATE", "Observation history is not linked.");
    if ((old && (old.protectedBlockId !== value.protectedBlockId || old.date !== value.date || old.timezone !== value.timezone))
      || (next && (next.protectedBlockId !== value.protectedBlockId || next.date !== value.date || next.timezone !== value.timezone))) return fail("INVALID_STATE", "Observation history changed its binding.");
    if (value.supersededBy === null) {
      const key = value.protectedBlockId + "@" + value.date + "@" + value.timezone;
      if (activePeriods.has(key)) return fail("INVALID_STATE", "Duplicate current observation.");
      activePeriods.add(key);
    }
    const visited = new Set<string>([value.id]);
    let cursor = next;
    while (cursor) {
      if (visited.has(cursor.id)) return fail("INVALID_STATE", "Observation history is cyclic.");
      visited.add(cursor.id);
      cursor = cursor.supersededBy === null ? null : input.retainedObservations[cursor.supersededBy];
    }
  }
  return { ok: true, state: structuredClone(input) };
}
export function normalizeLegacyContextReviewState(input: unknown): ContextReviewResult {
  if (input === undefined) return { ok: true, state: createEmptyContextReviewState() };
  if (!object(input)) return fail("INVALID_STATE", "Expected a persisted state object.");
  return validateContextReviewState({ ...createEmptyContextReviewState(), ...input });
}
export function usableInferences(state: ContextReviewState, now: string): Inference[] {
  if (!timestamp(now)) return [];
  return Object.values(state.inferences).filter((v) => (v.status === "pending" || v.status === "acknowledged") && (v.reviewDueAt === null || Date.parse(v.reviewDueAt) > Date.parse(now)));
}
export function currentRetainedObservations(state: ContextReviewState): RetainedObservation[] {
  return Object.values(state.retainedObservations).filter((v) => v.supersededBy === null);
}
export function isLocalOnly(state: ContextReviewState): boolean { return state.localOnly?.enabled === true; }
const inWeek = (value: string, start: string): boolean => date(value) && value >= start && Date.parse(value + "T00:00:00Z") < Date.parse(start + "T00:00:00Z") + 7 * 86_400_000;
function reviewedVersions(periodValue: Pick<WeekConfirmation, "weekStart" | "timezone">, current: { ledger: readonly LedgerEntry[]; observations: Record<string, RetainedObservation> }) {
  return {
    reviewedLedgerVersions: Object.fromEntries(current.ledger.filter((v) => inWeek(v.effectiveDate, periodValue.weekStart)).map((v) => [v.id, v.revision])),
    reviewedObservationVersions: Object.fromEntries(Object.values(current.observations).filter((v) => v.supersededBy === null && v.timezone === periodValue.timezone && inWeek(v.date, periodValue.weekStart)).map((v) => [v.id, v.revision])),
  };
}
const equalVersions = (a: Record<string, number>, b: Record<string, number>): boolean => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, value]) => Object.hasOwn(b, id) && b[id] === value);
export function isWeekConfirmationStale(value: WeekConfirmation, current: { ledger: readonly LedgerEntry[]; observations: Record<string, RetainedObservation> }): boolean {
  const expected = reviewedVersions(value, current);
  return !equalVersions(value.reviewedLedgerVersions, expected.reviewedLedgerVersions) || !equalVersions(value.reviewedObservationVersions, expected.reviewedObservationVersions);
}
export function latestWeekConfirmationForPeriod(state: ContextReviewState, weekStart: string, zone: string): WeekConfirmation | null {
  return Object.values(state.weekConfirmations).filter((v) => v.weekStart === weekStart && v.timezone === zone)
    .reduce<WeekConfirmation | null>((latest, v) => !latest || Date.parse(v.createdAt) >= Date.parse(latest.createdAt) ? v : latest, null);
}
function localDate(at: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value ?? "").join("-");
}
function baseEntity(context: ContextReviewContext, id: string): EntityBase {
  return { id, revision: 1, createdAt: context.now, updatedAt: context.now, dataMode: context.dataMode, provenance: { origin: "user" } };
}
function freshId(state: ContextReviewState, context: ContextReviewContext): string | null {
  const id = context.uuid();
  return ref(id) && ![...Object.values(state.inferences), ...Object.values(state.weeklyFeedback), ...Object.values(state.retainedObservations), ...Object.values(state.weekConfirmations)].some((v) => v.id === id) ? id : null;
}
function revisionFailure(entity: EntityBase, expected: number): ContextReviewResult | null {
  return !revision(expected) || entity.revision !== expected || entity.revision === Number.MAX_SAFE_INTEGER ? fail("REVISION_CONFLICT", "The reviewed revision is no longer current.") : null;
}
export function applyContextReviewAction(input: ContextReviewState, action: ContextReviewAction, context: ContextReviewContext): ContextReviewResult {
  const validated = validateContextReviewState(input);
  if (!validated.ok) return validated;
  if (action.actor !== "user" || context.actor !== "user") return fail("USER_ONLY", "This decision requires the user.");
  if (!timestamp(context.now) || (context.dataMode !== "fixture" && context.dataMode !== "live")) return fail("INVALID_INPUT", "Invalid action context.");
  const state = validated.state;
  switch (action.type) {
    case "createInference": {
      if (!text(action.statement) || !text(action.evidenceSummary) || !refs(action.evidenceRefs) || action.evidenceRefs.length === 0 || !provenance(action.provenance)
        || (context.dataMode === "live" && action.provenance.origin === "fixture") || !(action.reviewDueAt === null || (timestamp(action.reviewDueAt) && Date.parse(action.reviewDueAt) > Date.parse(context.now)))) return fail("INVALID_INPUT", "Inference content, evidence or review date is invalid.");
      const id = freshId(state, context);
      if (id === null) return fail("INVALID_INPUT", "A unique record id is required.");
      state.inferences[id] = { ...baseEntity(context, id), provenance: structuredClone(action.provenance), statement: action.statement, evidenceRefs: [...action.evidenceRefs], evidenceSummary: action.evidenceSummary, reviewDueAt: action.reviewDueAt, status: "pending", deletedAt: null };
      break;
    }
    case "acknowledgeInference": case "rejectInference": case "deleteInference": case "renewInferenceReview": {
      const value = Object.hasOwn(state.inferences, action.inferenceId) ? state.inferences[action.inferenceId] : undefined;
      if (!value) return fail("NOT_FOUND", "Inference not found.");
      const conflict = revisionFailure(value, action.expectedRevision);
      if (conflict) return conflict;
      if (value.status === "deleted") return fail("INVALID_TRANSITION", "Deleted inferences cannot be changed.");
      switch (action.type) {
        case "acknowledgeInference":
          if (value.status !== "pending") return fail("INVALID_TRANSITION", "Only pending inferences can be acknowledged.");
          value.status = "acknowledged"; break;
        case "rejectInference":
          if (value.status === "rejected") return fail("INVALID_TRANSITION", "Inference is already rejected.");
          value.status = "rejected"; break;
        case "deleteInference":
          value.status = "deleted"; value.statement = null; value.evidenceSummary = null; value.evidenceRefs = []; value.deletedAt = context.now; break;
        case "renewInferenceReview":
          if (value.status === "rejected") return fail("INVALID_TRANSITION", "Rejected inferences cannot be renewed.");
          if (!timestamp(action.reviewDueAt) || Date.parse(action.reviewDueAt) <= Date.parse(context.now)) return fail("INVALID_INPUT", "Review must be in the future.");
          value.reviewDueAt = action.reviewDueAt; break;
        default: return unreachable(action);
      }
      value.revision += 1; value.updatedAt = context.now;
      break;
    }
    case "upsertWeeklyFeedback": {
      if (!period(action.weekStart, action.timezone) || !feedbackValue(action.value) || !(action.expectedRevision === null || revision(action.expectedRevision))) return fail("INVALID_INPUT", "Feedback requires a Monday, an IANA timezone and a valid value.");
      const key = action.weekStart + "@" + action.timezone;
      const current = state.weeklyFeedback[key];
      if (current && action.expectedRevision === null) return fail("PERIOD_CONFLICT", "Feedback already exists for this period.");
      if (!current && action.expectedRevision !== null) return fail("NOT_FOUND", "No feedback exists to revise.");
      if (current && action.expectedRevision !== null) {
        const conflict = revisionFailure(current, action.expectedRevision);
        if (conflict) return conflict;
        current.value = action.value; current.revision += 1; current.updatedAt = context.now;
      } else {
        const id = freshId(state, context);
        if (id === null) return fail("INVALID_INPUT", "A unique record id is required.");
        state.weeklyFeedback[key] = { ...baseEntity(context, id), weekStart: action.weekStart, timezone: action.timezone, value: action.value, actor: "user" };
      }
      break;
    }
    case "recordObservation": case "correctObservation": {
      const block = Object.hasOwn(context.protectedBlocks, action.blockId) ? context.protectedBlocks[action.blockId] : undefined;
      if (!block) return fail("NOT_FOUND", "Protected block not found.");
      if (!revision(action.blockRevision) || block.revision !== action.blockRevision) return fail("REVISION_CONFLICT", "Protected block changed since review.");
      if (block.status !== "active") return fail("INVALID_TRANSITION", "Only active protected blocks can be observed.");
      if (!date(action.date) || !outcome(action.outcome) || !Number.isSafeInteger(action.observedMinutes) || action.observedMinutes < 0
        || !timestamp(block.range.start) || !timestamp(block.range.end) || !timezone(block.range.timezone)
        || Date.parse(block.range.end) <= Date.parse(block.range.start) || action.observedMinutes > (Date.parse(block.range.end) - Date.parse(block.range.start)) / 60_000
        || action.date < localDate(block.range.start, block.range.timezone) || action.date > localDate(new Date(Date.parse(block.range.end) - 1).toISOString(), block.range.timezone)) return fail("INVALID_INPUT", "Observation must fit its protected block and explicitly report minutes.");
      let old: RetainedObservation | undefined;
      if (action.type === "correctObservation") {
        old = Object.hasOwn(state.retainedObservations, action.observationId) ? state.retainedObservations[action.observationId] : undefined;
        if (!old) return fail("NOT_FOUND", "Observation not found.");
        const conflict = revisionFailure(old, action.expectedRevision);
        if (conflict) return conflict;
        if (old.supersededBy !== null) return fail("INVALID_TRANSITION", "This observation was already superseded.");
        if (old.protectedBlockId !== block.id || old.date !== action.date || old.timezone !== block.range.timezone) return fail("INVALID_INPUT", "A correction must retain its original binding.");
      }
      if (currentRetainedObservations(state).some((v) => v.protectedBlockId === block.id && v.date === action.date && v.timezone === block.range.timezone && v.id !== old?.id)) return fail("PERIOD_CONFLICT", "A current observation already exists for this block and date.");
      const id = freshId(state, context);
      if (id === null) return fail("INVALID_INPUT", "A unique record id is required.");
      state.retainedObservations[id] = { ...baseEntity(context, id), protectedBlockId: block.id, blockRevision: block.revision, date: action.date, timezone: block.range.timezone, observedMinutes: action.observedMinutes, outcome: action.outcome, actor: "user", supersedesId: old?.id ?? null, supersededBy: null };
      if (old) { old.supersededBy = id; old.revision += 1; old.updatedAt = context.now; }
      break;
    }
    case "confirmWeek": {
      if (!period(action.weekStart, action.timezone)) return fail("INVALID_INPUT", "Confirmation requires a Monday and an IANA timezone.");
      const id = freshId(state, context);
      if (id === null) return fail("INVALID_INPUT", "A unique record id is required.");
      state.weekConfirmations[id] = { ...baseEntity(context, id), weekStart: action.weekStart, timezone: action.timezone, actor: "user", ...reviewedVersions(action, { ledger: context.ledger, observations: state.retainedObservations }) };
      break;
    }
    case "enterLocalOnly": case "returnToConnected": {
      const enabled = action.type === "enterLocalOnly";
      if (enabled === isLocalOnly(state)) return fail("INVALID_TRANSITION", "Already in the requested connectivity mode.");
      if (!enabled) {
        const receipt = context.sourceRecheck;
        if (!receipt || receipt.outcome !== "success" || !timestamp(receipt.checkedAt) || Date.parse(receipt.checkedAt) > Date.parse(context.now)
          || Date.parse(receipt.checkedAt) < Date.parse(state.localOnly?.changedAt ?? context.now) || !versions(receipt.sourceVersions)
          || !versions(context.currentSourceVersions) || Object.keys(context.currentSourceVersions).length === 0
          || !equalVersions(receipt.sourceVersions, context.currentSourceVersions)) return fail("STALE_RECEIPT", "A successful recheck of all current source versions is required.");
      }
      if (state.localOnly?.revision === Number.MAX_SAFE_INTEGER) return fail("REVISION_CONFLICT", "Preference revision is exhausted.");
      state.localOnly = { revision: (state.localOnly?.revision ?? 0) + 1, enabled, changedAt: context.now, changedBy: "user" };
      break;
    }
    default: return unreachable(action);
  }
  return validateContextReviewState(state);
}
function unreachable(_action: never): ContextReviewResult { return fail("INVALID_INPUT", "Unsupported context review action."); }
