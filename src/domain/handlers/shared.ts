import { withEvent } from "../state.ts";
import { fail } from "../store.ts";
import type { HandlerFailure } from "../store.ts";
import type { Actor, DomainState, EntityBase, EntityId, TimeRange } from "../types.ts";

export interface RevisionChange {
  entityId: EntityId;
  before: number;
  after: number;
}

export type Lookup<T extends EntityBase> = { entity: T; failure: null } | { entity: null; failure: HandlerFailure };

export function lookupEntity<T extends EntityBase>(
  collection: Record<EntityId, T>,
  entityId: EntityId | null,
  label: string,
): Lookup<T> {
  const entity = entityId ? collection[entityId] : undefined;
  if (!entity) {
    return { entity: null, failure: fail("ENTITY_NOT_FOUND", label + " not found: " + String(entityId), false) };
  }
  return { entity, failure: null };
}

export function requireUser(actor: Actor, action: string): HandlerFailure | null {
  if (actor !== "user") return fail("USER_ONLY", action + " requires the user actor, got " + actor, false);
  return null;
}

export function requireRevision(current: number, expected: number | null): HandlerFailure | null {
  if (expected === null) return null;
  if (current !== expected) {
    return fail("REVISION_CONFLICT", "expected revision " + expected + " but current is " + current, true);
  }
  return null;
}

export function bump<T extends EntityBase>(entity: T, now: string): T {
  return { ...entity, revision: entity.revision + 1, updatedAt: now };
}

export function finish(
  state: DomainState,
  patch: Partial<DomainState>,
  changes: RevisionChange[],
  event: { eventId: EntityId; type: string; commandId: string; actor: Actor; at: string; summary: string },
): DomainState {
  return withEvent({ ...state, ...patch }, {
    eventId: event.eventId,
    type: event.type,
    commandId: event.commandId,
    actor: event.actor,
    at: event.at,
    summary: event.summary,
    changes,
  });
}

export function tzOffsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

export function minuteOfDayToEpochMs(date: string, minute: number, timezone: string): number {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  const naive = Date.parse(date + "T" + hh + ":" + mm + ":00Z");
  if (Number.isNaN(naive)) return Number.NaN;
  return naive - tzOffsetMinutes(timezone, new Date(naive)) * 60000;
}

export function scheduleToMs(
  date: string,
  startMinute: number | null,
  endMinute: number | null,
  timezone: string,
): { start: number; end: number } {
  if (startMinute === null || endMinute === null) {
    const dayStart = minuteOfDayToEpochMs(date, 0, timezone);
    return { start: dayStart, end: dayStart + 24 * 60 * 60000 };
  }
  return { start: minuteOfDayToEpochMs(date, startMinute, timezone), end: minuteOfDayToEpochMs(date, endMinute, timezone) };
}

export function timeRangeToMs(range: TimeRange): { start: number; end: number } {
  return { start: Date.parse(range.start), end: Date.parse(range.end) };
}

export function overlapsMs(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return (
    Number.isFinite(a.start) && Number.isFinite(a.end) && Number.isFinite(b.start) && Number.isFinite(b.end) &&
    a.start < b.end && b.start < a.end
  );
}
