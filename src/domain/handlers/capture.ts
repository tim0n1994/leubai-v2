import { fail, ok } from "../store.ts";
import type { Handler, HandlerFailure } from "../store.ts";
import type { CommandType } from "../types.ts";
import type {
  ArchiveRequestCommand,
  CaptureDraft,
  CheckConflictCommand,
  Commitment,
  ConflictOutcome,
  DiscardCaptureDraftCommand,
  EntityId,
  FieldConfirmation,
  Intent,
  IntentStatus,
  ParsedFields,
  SaveCaptureDraftCommand,
  SaveIntentCommand,
  UpdateCommitmentCommand,
} from "../types.ts";
import { bump, finish, lookupEntity, overlapsMs, requireRevision, requireUser, scheduleToMs, timeRangeToMs } from "./shared.ts";

const TIME_PATTERN = /^\d{2}:\d{2}$/;
const KNOWN_FIELD_KEYS = ["date", "startTime", "endTime", "timezone", "topic"];

function emptyParsedFields(overrides?: Partial<ParsedFields>): ParsedFields {
  return { date: null, startTime: null, endTime: null, timezone: null, topic: null, ...overrides };
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function isValidHhMm(value: string): boolean {
  if (!TIME_PATTERN.test(value)) return false;
  return Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59;
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parsedFieldsFailure(fields: unknown): HandlerFailure | null {
  if (fields === undefined) return null;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return fail("INVALID_INPUT", "parsedFields must be an object of known capture fields", false);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!KNOWN_FIELD_KEYS.includes(key)) {
      return fail("INVALID_INPUT", "parsedFields contains unknown field: " + key, false);
    }
    if (value !== null && typeof value !== "string") {
      return fail("INVALID_INPUT", "parsedFields." + key + " must be a string or null", false);
    }
  }
  return null;
}

export function constraintsFailure(constraints: unknown): HandlerFailure | null {
  if (constraints === undefined) return null;
  if (!Array.isArray(constraints)) {
    return fail("INVALID_INPUT", "constraints must be an array of {kind, expression, confirmed}", false);
  }
  for (const entry of constraints) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail("INVALID_INPUT", "each constraint must be an object with kind, expression, confirmed", false);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.kind !== "string" || typeof record.expression !== "string" || typeof record.confirmed !== "boolean") {
      return fail("INVALID_INPUT", "each constraint requires kind: string, expression: string, confirmed: boolean", false);
    }
  }
  return null;
}

function mergeParsedFields(base: ParsedFields, overrides?: Partial<ParsedFields>): ParsedFields {
  const merged: ParsedFields = { ...base };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      merged[key as keyof ParsedFields] = value;
    }
  }
  return merged;
}

export function suppliedSemanticFailure(fields: ParsedFields): HandlerFailure | null {
  if (fields.date !== null && !isValidCalendarDate(fields.date)) {
    return fail("INVALID_INPUT", "date must be a real calendar date in YYYY-MM-DD form, got " + fields.date, false);
  }
  for (const key of ["startTime", "endTime"] as const) {
    if (fields[key] !== null && !isValidHhMm(fields[key])) {
      return fail("INVALID_INPUT", key + " must be an HH:MM time between 00:00 and 23:59, got " + fields[key], false);
    }
  }
  if (fields.startTime !== null && fields.endTime !== null && fields.endTime <= fields.startTime) {
    return fail("INVALID_INPUT", "intent interval is invalid: end must be a later HH:MM time than start", false);
  }
  if (fields.timezone !== null && !isValidTimezone(fields.timezone)) {
    return fail("INVALID_INPUT", "timezone must be a valid IANA timezone, got " + fields.timezone, false);
  }
  return null;
}

export function missingFieldGroups(fields: ParsedFields): string[] {
  const missing: string[] = [];
  if (!fields.date) missing.push("date");
  if (!fields.startTime || !fields.endTime) missing.push("time");
  if (!fields.timezone) missing.push("timezone");
  return missing;
}

export const captureHandlers: Partial<Record<CommandType, Handler>> = {
  saveCaptureDraft: (state, command, ctx) => {
    const c = command as SaveCaptureDraftCommand;
    const parsedFail = parsedFieldsFailure(c.parsedFields);
    if (parsedFail) return parsedFail;
    const constraintsFail = constraintsFailure(c.constraints);
    if (constraintsFail) return constraintsFail;
    if (c.entityId !== null) {
      if (c.expectedRevision === null) {
        return fail("INVALID_INPUT", "updating a capture draft requires expectedRevision of that draft", false);
      }
      const lookup = lookupEntity(state.captureDrafts, c.entityId, "capture draft");
      if (lookup.failure) return lookup.failure;
      const revisionFail = requireRevision(lookup.entity.revision, c.expectedRevision);
      if (revisionFail) return revisionFail;
      if (lookup.entity.status !== "open") {
        return fail("INVALID_TRANSITION", "only open capture drafts can be updated, current status is " + lookup.entity.status, false);
      }
      const source = lookup.entity;
      const updated: CaptureDraft = {
        ...bump(source, ctx.now),
        channel: c.channel,
        raw: c.raw,
        parsedFields: mergeParsedFields(source.parsedFields, c.parsedFields),
        ...(c.ambiguityNote !== undefined ? { ambiguityNote: c.ambiguityNote } : {}),
        ...(c.constraints !== undefined ? { constraints: c.constraints } : {}),
      };
      const nextState = finish(
        state,
        { captureDrafts: { ...state.captureDrafts, [updated.id]: updated } },
        [{ entityId: updated.id, before: source.revision, after: updated.revision }],
        { eventId: ctx.uuid(), type: "captureDraft.saved", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "capture draft updated in place" },
      );
      return ok(nextState, { captureDraft: updated });
    }
    if (c.expectedRevision !== null) {
      return fail("INVALID_INPUT", "new capture draft requires expectedRevision null", false);
    }
    const draft: CaptureDraft = {
      id: ctx.uuid(),
      revision: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      dataMode: state.dataMode,
      provenance: { origin: "user", note: "capture channel " + c.channel },
      channel: c.channel,
      raw: c.raw,
      parsedFields: emptyParsedFields(c.parsedFields),
      ambiguityNote: c.ambiguityNote ?? null,
      constraints: c.constraints ?? [],
      status: "open",
    };
    const nextState = finish(
      state,
      { captureDrafts: { ...state.captureDrafts, [draft.id]: draft } },
      [{ entityId: draft.id, before: 0, after: 1 }],
      { eventId: ctx.uuid(), type: "captureDraft.saved", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "capture draft saved" },
    );
    return ok(nextState, { captureDraft: draft });
  },

  discardCaptureDraft: (state, command, ctx) => {
    const c = command as DiscardCaptureDraftCommand;
    const lookup = lookupEntity(state.captureDrafts, c.entityId, "capture draft");
    if (lookup.failure) return lookup.failure;
    const revisionFail = requireRevision(lookup.entity.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (lookup.entity.status !== "open") {
      return fail("INVALID_TRANSITION", "only open capture drafts can be discarded, current status is " + lookup.entity.status, false);
    }
    const updated: CaptureDraft = { ...bump(lookup.entity, ctx.now), status: "discarded" };
    const nextState = finish(
      state,
      { captureDrafts: { ...state.captureDrafts, [updated.id]: updated } },
      [{ entityId: updated.id, before: lookup.entity.revision, after: updated.revision }],
      { eventId: ctx.uuid(), type: "captureDraft.discarded", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "capture draft discarded" },
    );
    return ok(nextState, { captureDraft: updated });
  },

  saveIntent: (state, command, ctx) => {
    const c = command as SaveIntentCommand;
    const parsedFail = parsedFieldsFailure(c.parsedFields);
    if (parsedFail) return parsedFail;
    const constraintsFail = constraintsFailure(c.constraints);
    if (constraintsFail) return constraintsFail;
    const isManual = c.channel === "manual";
    if (isManual) {
      const userFail = requireUser(c.actor, "manual capture");
      if (userFail) return userFail;
      if (c.raw !== "") {
        return fail("INVALID_INPUT", "manual capture is field-only: raw must be exactly empty, not a fabricated sentence", false);
      }
    } else if (!c.raw.trim()) {
      return fail("INVALID_INPUT", "intent verbatim must not be empty", false);
    }
    if (c.entityId === null) {
      if (c.expectedRevision !== null) {
        return fail("INVALID_INPUT", "independent saveIntent requires expectedRevision null for a new intent", false);
      }
    } else if (c.expectedRevision === null) {
      return fail("INVALID_INPUT", "linked saveIntent requires expectedRevision of the target capture draft", false);
    }
    let sourceDraft: CaptureDraft | null = null;
    if (c.entityId !== null) {
      const lookup = lookupEntity(state.captureDrafts, c.entityId, "capture draft");
      if (lookup.failure) return lookup.failure;
      sourceDraft = lookup.entity;
      const revisionFail = requireRevision(sourceDraft.revision, c.expectedRevision);
      if (revisionFail) return revisionFail;
      if (sourceDraft.status === "savedAsIntent") {
        return fail(
          "INVALID_TRANSITION",
          "capture draft was already saved as intent " + (sourceDraft.intentId ?? "with a missing link") + " and cannot create another intent",
          false,
          { intentId: sourceDraft.intentId ?? null },
        );
      }
      if (sourceDraft.status !== "open") {
        return fail("INVALID_TRANSITION", "only open capture drafts can be saved as an intent, current status is " + sourceDraft.status, false);
      }
    }
    const baseFields = sourceDraft ? sourceDraft.parsedFields : emptyParsedFields();
    const parsed = mergeParsedFields(baseFields, c.parsedFields);
    const semanticFail = suppliedSemanticFailure(parsed);
    if (semanticFail) return semanticFail;
    const missing = missingFieldGroups(parsed);
    if (isManual && missing.length > 0) {
      return fail("INVALID_INPUT", "manual field-only capture requires complete structured fields, missing: " + missing.join(", "), false);
    }
    const status: IntentStatus = missing.length > 0 ? "ambiguous" : "saved";
    const fieldStatus: Record<string, FieldConfirmation> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== null) fieldStatus[key] = "confirmed";
    }
    const constraintInputs = c.constraints !== undefined ? c.constraints : sourceDraft?.constraints ?? [];
    const autoNote = missing.length > 0 ? "unconfirmed fields: " + missing.join(", ") : null;
    const fallbackNote = sourceDraft ? sourceDraft.ambiguityNote : autoNote;
    const ambiguityNote = c.ambiguityNote !== undefined ? c.ambiguityNote : fallbackNote;
    const intent: Intent = {
      id: ctx.uuid(),
      revision: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      dataMode: state.dataMode,
      provenance: isManual ? { origin: "user", note: "manual field entry" } : { origin: "user" },
      verbatim: c.raw,
      channel: c.channel,
      parsedFields: parsed,
      fieldStatus,
      constraints: constraintInputs.map((entry) => ({
        id: ctx.uuid(),
        kind: entry.kind,
        expression: entry.expression,
        confirmed: entry.confirmed,
      })),
      status,
      ambiguityNote,
      sourceRefs: [],
    };
    if (!sourceDraft) {
      const nextState = finish(
        state,
        { intents: { ...state.intents, [intent.id]: intent } },
        [{ entityId: intent.id, before: 0, after: 1 }],
        { eventId: ctx.uuid(), type: "intent.saved", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "intent saved as " + status },
      );
      return ok(nextState, { intent });
    }
    const completedDraft: CaptureDraft = {
      ...bump(sourceDraft, ctx.now),
      channel: c.channel,
      raw: c.raw,
      parsedFields: parsed,
      ambiguityNote,
      constraints: constraintInputs,
      status: "savedAsIntent",
      intentId: intent.id,
    };
    const nextState = finish(
      state,
      {
        intents: { ...state.intents, [intent.id]: intent },
        captureDrafts: { ...state.captureDrafts, [completedDraft.id]: completedDraft },
      },
      [
        { entityId: intent.id, before: 0, after: 1 },
        { entityId: completedDraft.id, before: sourceDraft.revision, after: completedDraft.revision },
      ],
      { eventId: ctx.uuid(), type: "intent.saved", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "intent saved as " + status + " from capture draft" },
    );
    return ok(nextState, { intent, captureDraft: completedDraft });
  },

  checkConflict: (state, command) => {
    const c = command as CheckConflictCommand;
    const rangeMs = timeRangeToMs(c.range);
    if (!Number.isFinite(rangeMs.start) || !Number.isFinite(rangeMs.end) || rangeMs.end <= rangeMs.start) {
      return fail("INVALID_INPUT", "conflict range is invalid", false);
    }
    const conflictIds: EntityId[] = [];
    for (const commitment of Object.values(state.commitments)) {
      if (commitment.status !== "active" || !commitment.schedule) continue;
      const ms = scheduleToMs(commitment.schedule.date, commitment.schedule.startMinute, commitment.schedule.endMinute, commitment.schedule.timezone);
      if (overlapsMs(rangeMs, ms)) conflictIds.push(commitment.id);
    }
    for (const block of Object.values(state.protectedBlocks)) {
      if (block.status !== "active") continue;
      if (overlapsMs(rangeMs, timeRangeToMs(block.range))) conflictIds.push(block.id);
    }
    if (conflictIds.length > 0) {
      const outcome: ConflictOutcome = { outcome: "conflict", coverage: "known", conflictIds };
      return ok(null, { outcome });
    }
    const covered = Object.values(state.sources).some((source) =>
      source.coverage.known &&
      source.coverage.intervals.some((interval) => {
        const iv = timeRangeToMs(interval);
        return iv.start <= rangeMs.start && rangeMs.end <= iv.end;
      })
    );
    if (!covered) {
      const outcome: ConflictOutcome = {
        outcome: "unknown",
        coverage: "unknown",
        conflictIds: [],
        note: "range is outside all known source coverage",
      };
      return ok(null, { outcome });
    }
    const outcome: ConflictOutcome = { outcome: "none", coverage: "known", conflictIds: [] };
    return ok(null, { outcome });
  },

  acceptRequest: (state, command, ctx) => {
    const c = command;
    const userFail = requireUser(c.actor, "acceptRequest");
    if (userFail) return userFail;
    const lookup = lookupEntity(state.requests, c.entityId, "request");
    if (lookup.failure) return lookup.failure;
    const revisionFail = requireRevision(lookup.entity.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    const request = lookup.entity;
    if (request.status === "accepted") {
      if (!request.commitmentId || !state.commitments[request.commitmentId]) {
        return fail("INVALID_TRANSITION", "accepted request is missing its commitment", false);
      }
      return ok(null, { request, commitment: state.commitments[request.commitmentId]!, alreadyAccepted: true });
    }
    if (request.status !== "candidate") {
      return fail("INVALID_TRANSITION", "only candidate requests can be accepted, current status is " + request.status, false);
    }
    const commitment: Commitment = {
      id: ctx.uuid(),
      revision: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      dataMode: state.dataMode,
      provenance: { origin: "user" },
      requestId: request.id,
      acceptedBy: "user",
      scope: null,
      scopeStatus: "pendingDetails",
      deadline: null,
      effortEstimateMinutes: null,
      mobility: "flexible",
      schedule: null,
      status: "active",
      pendingDetails: ["scope"],
    };
    const updatedRequest = { ...bump(request, ctx.now), status: "accepted" as const, acceptedBy: "user", commitmentId: commitment.id };
    const nextState = finish(
      state,
      {
        requests: { ...state.requests, [request.id]: updatedRequest },
        commitments: { ...state.commitments, [commitment.id]: commitment },
      },
      [
        { entityId: request.id, before: request.revision, after: updatedRequest.revision },
        { entityId: commitment.id, before: 0, after: 1 },
      ],
      { eventId: ctx.uuid(), type: "request.accepted", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "request accepted into responsibility" },
    );
    return ok(nextState, { request: updatedRequest, commitment, alreadyAccepted: false });
  },

  archiveRequest: (state, command, ctx) => {
    const c = command as ArchiveRequestCommand;
    const userFail = requireUser(c.actor, "archiveRequest");
    if (userFail) return userFail;
    const lookup = lookupEntity(state.requests, c.entityId, "request");
    if (lookup.failure) return lookup.failure;
    const revisionFail = requireRevision(lookup.entity.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    const request = lookup.entity;
    if (request.status !== "candidate") {
      return fail("INVALID_TRANSITION", "only candidate requests can be archived, current status is " + request.status, false);
    }
    const updated = { ...bump(request, ctx.now), status: (c.decision === "keepIdea" ? "archived" : "excluded") as "archived" | "excluded" };
    const nextState = finish(
      state,
      { requests: { ...state.requests, [request.id]: updated } },
      [{ entityId: request.id, before: request.revision, after: updated.revision }],
      { eventId: ctx.uuid(), type: "request.archived", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "request archived as " + updated.status },
    );
    return ok(nextState, { request: updated });
  },

  updateCommitment: (state, command, ctx) => {
    const c = command as UpdateCommitmentCommand;
    const userFail = requireUser(c.actor, "updateCommitment");
    if (userFail) return userFail;
    const lookup = lookupEntity(state.commitments, c.entityId, "commitment");
    if (lookup.failure) return lookup.failure;
    const revisionFail = requireRevision(lookup.entity.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    if (c.effortEstimateMinutes !== undefined && c.effortEstimateMinutes !== null) {
      const minutes = c.effortEstimateMinutes;
      if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isInteger(minutes)) {
        return fail("INVALID_INPUT", "effort estimate must be a positive whole number of minutes, or null for unknown", false);
      }
    }
    const commitment = lookup.entity;
    const updated: Commitment = { ...bump(commitment, ctx.now) };
    if (c.scope !== undefined) {
      updated.scope = c.scope;
      updated.scopeStatus = c.scope === null ? "pendingDetails" : "clarified";
    }
    if (c.deadline !== undefined) updated.deadline = c.deadline;
    if (c.effortEstimateMinutes !== undefined) updated.effortEstimateMinutes = c.effortEstimateMinutes;
    if (c.schedule !== undefined) updated.schedule = c.schedule;
    if (c.mobility !== undefined) updated.mobility = c.mobility;
    const nextState = finish(
      state,
      { commitments: { ...state.commitments, [updated.id]: updated } },
      [{ entityId: updated.id, before: commitment.revision, after: updated.revision }],
      { eventId: ctx.uuid(), type: "commitment.updated", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "commitment details updated" },
    );
    return ok(nextState, { commitment: updated });
  },
};
