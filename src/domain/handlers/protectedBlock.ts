import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import type { CommandType, CreateProtectedBlockCommand, ProtectedBlock } from "../types.ts";
import { suppliedSemanticFailure } from "./capture.ts";
import { bump, finish, requireUser, tzOffsetMinutes } from "./shared.ts";

function uniqueWallTime(date: string, time: string, timezone: string): string | null {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(tzOffsetMinutes(timezone, new Date(naive + hours * 3600000)));
  const matches = [...offsets].filter(offset => {
    const parts = formatter.formatToParts(new Date(naive - offset * 60000));
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}` === date && `${part("hour")}:${part("minute")}` === time;
  });
  if (matches.length !== 1) return null;
  const offset = matches[0];
  return `${date}T${time}:00${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

export const protectedBlockHandlers: Partial<Record<CommandType, Handler>> = {
  createProtectedBlock: (state, command, ctx) => {
    const c = command as CreateProtectedBlockCommand;
    const userFailure = requireUser(c.actor, "create protected time");
    if (userFailure) return userFailure;
    if (c.entityId !== null || c.expectedRevision !== null || typeof c.blockId !== "string" || !c.blockId.trim() || c.blockId.length > 128 || [...c.blockId].some(character => character.charCodeAt(0) < 32)) return fail("INVALID_INPUT", "New protected time requires a stable block ID and no existing entity revision", false);
    if ([c.date, c.startTime, c.endTime, c.timezone].some(value => typeof value !== "string" || !value) || /^[+-]/.test(c.timezone)) return fail("INVALID_INPUT", "Date, start, end and IANA timezone are required", false);
    if (c.intentId !== null && (typeof c.intentId !== "string" || !state.intents[c.intentId] || ["deleted", "discarded"].includes(state.intents[c.intentId].status))) return fail("ENTITY_NOT_FOUND", "Select an existing intent or leave this time unassigned", false);
    if (c.purpose !== null && (typeof c.purpose !== "string" || c.purpose.length > 2000)) return fail("INVALID_INPUT", "Purpose must be text of at most 2000 characters or empty", false);
    const semanticFailure = suppliedSemanticFailure({ date: c.date, startTime: c.startTime, endTime: c.endTime, timezone: c.timezone, topic: null });
    if (semanticFailure) return semanticFailure;
    const start = uniqueWallTime(c.date, c.startTime, c.timezone);
    const end = uniqueWallTime(c.date, c.endTime, c.timezone);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return fail("INVALID_INPUT", "This local time is missing or repeated during a timezone transition; choose an unambiguous interval", false);
    const purpose = c.purpose?.trim() ? c.purpose : null;
    const existing = Object.values(state.protectedBlocks).filter(block => block.blockId === c.blockId);
    if (existing.length) {
      const block = existing[0];
      if (existing.length !== 1 || block.status !== "active" || block.provenance.origin !== "user" || block.intentId !== c.intentId || block.purpose !== purpose || block.range.start !== start || block.range.end !== end || block.range.timezone !== c.timezone) return fail("INVALID_INPUT", "Stable block ID already identifies a different or released protected time", false);
      return ok(null, { protectedBlock: block, coverage: "unknown", externalWrite: "none" });
    }
    const block: ProtectedBlock = { id: ctx.uuid(), revision: 1, createdAt: ctx.now, updatedAt: ctx.now, dataMode: state.dataMode, provenance: { origin: "user", note: "Explicit local protected time" }, blockId: c.blockId, intentId: c.intentId, purpose, range: { start, end, timezone: c.timezone }, sourceRefs: [], status: "active" };
    const plans = { ...state.plans };
    const approvals = { ...state.approvals };
    const startedPlanIds = new Set(Object.values(approvals).filter(approval => approval.status === "consumed").map(approval => approval.planId));
    for (const operation of Object.values(state.operations)) {
      const planId = state.changeSets[operation.changeSetId]?.planId;
      if (planId) startedPlanIds.add(planId);
    }
    const changes = [{ entityId: block.id, before: 0, after: 1 }];
    for (const plan of Object.values(plans)) {
      if (plan.status === "invalid" || startedPlanIds.has(plan.id)) continue;
      if (plan.revision >= Number.MAX_SAFE_INTEGER) return fail("REVISION_CONFLICT", "Plan revision is exhausted", false);
      plans[plan.id] = { ...bump(plan, ctx.now), status: "invalid", invalidReason: "Protected time changed; review the proposal again" };
      changes.push({ entityId: plan.id, before: plan.revision, after: plan.revision + 1 });
    }
    for (const approval of Object.values(approvals)) {
      if (approval.status !== "valid" && approval.status !== "pending") continue;
      if (approval.revision >= Number.MAX_SAFE_INTEGER) return fail("REVISION_CONFLICT", "Approval revision is exhausted", false);
      approvals[approval.id] = { ...bump(approval, ctx.now), status: "invalid", invalidReason: "Protected time changed; review the proposal again" };
      changes.push({ entityId: approval.id, before: approval.revision, after: approval.revision + 1 });
    }
    return ok(finish(state, { protectedBlocks: { ...state.protectedBlocks, [block.id]: block }, plans, approvals }, changes, { eventId: ctx.uuid(), type: "protectedBlock.created", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "User saved local protected time; no external calendar write or coverage claim" }), { protectedBlock: block, coverage: "unknown", externalWrite: "none" });
  },
};
