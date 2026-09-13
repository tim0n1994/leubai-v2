import { fail, ok, type Handler } from "../store.ts";
import type { CommandType, Commitment, DomainState, EntityId, Plan, SaveLocalCommitmentCommand } from "../types.ts";
import { scheduleValidationError } from "../calendarTime.ts";
import { bump, finish, minuteOfDayToEpochMs, overlapsMs, requireUser } from "./shared.ts";

interface InstantWindow {
  start: number;
  end: number;
}

function dayMinuteMs(date: string, minute: number, timezone: string): number {
  const dayStart = minuteOfDayToEpochMs(date, 0, timezone);
  return Number.isFinite(dayStart) ? dayStart + minute * 60000 : Number.NaN;
}

function windowOf(start: number, end: number): InstantWindow | null {
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function planWindow(plan: Plan, state: DomainState): InstantWindow | null {
  const parsed = plan.intentId ? state.intents[plan.intentId]?.parsedFields : null;
  if (!parsed?.date || !parsed.timezone || !parsed.startTime || !parsed.endTime) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.endTime)) return null;
  const minuteOfClock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return windowOf(
    dayMinuteMs(parsed.date, minuteOfClock(parsed.startTime), parsed.timezone),
    dayMinuteMs(parsed.date, minuteOfClock(parsed.endTime), parsed.timezone),
  );
}

function scheduleWindow(schedule: NonNullable<Commitment["schedule"]>): InstantWindow | null {
  return windowOf(
    dayMinuteMs(schedule.date, schedule.allDay || schedule.startMinute === null ? 0 : schedule.startMinute, schedule.timezone),
    dayMinuteMs(schedule.endDate ?? schedule.date, schedule.allDay || schedule.endMinute === null ? 1440 : schedule.endMinute, schedule.timezone),
  );
}

function scheduleOverlapsPlanWindow(
  schedule: NonNullable<Commitment["schedule"]>,
  plan: Plan,
  state: DomainState,
): boolean {
  const changed = scheduleWindow(schedule);
  const window = planWindow(plan, state);
  return changed !== null && window !== null && overlapsMs(changed, window);
}

export const localCommitmentHandlers: Partial<Record<CommandType, Handler>> = {
  saveLocalCommitment: (state, command, ctx) => {
    const c = command as SaveLocalCommitmentCommand;
    const actorError = requireUser(c.actor, "edit local responsibility");
    if (actorError) return actorError;
    const existing = c.entityId ? state.commitments[c.entityId] : null;
    if (c.entityId && !existing) return fail("ENTITY_NOT_FOUND", "这条责任已不可用。", false);
    if (existing && (existing.revision !== c.expectedRevision || existing.revision >= Number.MAX_SAFE_INTEGER)) return fail("REVISION_CONFLICT", "记录已改变，请重新打开编辑。", false);
    if (!existing && c.expectedRevision !== null) return fail("INVALID_INPUT", "新增责任不能携带旧版本。", false);
    if (existing && (existing.requestId !== null || !["user", "fixture"].includes(existing.provenance.origin))) return fail("INVALID_TRANSITION", "该责任关联外部请求，请先通过方案确认变更。", false);
    if (typeof c.scope !== "string" || !c.scope.trim() || c.scope.length > 2000 || !["fixed", "flexible"].includes(c.mobility) || !["active", "done", "cancelled", "deferred"].includes(c.status)) return fail("INVALID_INPUT", "请填写责任名称和有效状态。", false);
    if (c.effortEstimateMinutes !== null && (!Number.isInteger(c.effortEstimateMinutes) || c.effortEstimateMinutes <= 0)) return fail("INVALID_INPUT", "预计投入应为正整数分钟，或留空表示未知。", false);
    const scheduleError = scheduleValidationError(c.schedule);
    if (scheduleError) return fail("INVALID_INPUT", scheduleError, false);
    const stableId = "local:" + c.commandId;
    const priorCreation = !existing && state.commitments[stableId];
    if (priorCreation) {
      if (priorCreation.scope !== c.scope.trim() || priorCreation.effortEstimateMinutes !== c.effortEstimateMinutes || JSON.stringify(priorCreation.schedule) !== JSON.stringify(c.schedule) || priorCreation.mobility !== c.mobility || priorCreation.status !== c.status) return fail("CONFLICT", "此保存标识已经用于另一版本，请重新打开记录。", false);
      return ok(null, { commitment: priorCreation });
    }
    const commitment: Commitment = { ...(existing ? bump(existing, ctx.now) : { id: stableId, revision: 1, createdAt: ctx.now, updatedAt: ctx.now, dataMode: state.dataMode, provenance: { origin: "user" as const }, requestId: null, acceptedBy: null, deadline: null, pendingDetails: [] }), scope: c.scope.trim(), scopeStatus: "clarified", effortEstimateMinutes: c.effortEstimateMinutes, schedule: c.schedule, mobility: c.mobility, status: c.status };
    const plans = { ...state.plans }, approvals = { ...state.approvals };
    const changes = [{ entityId: commitment.id, before: existing?.revision ?? 0, after: commitment.revision }];
    const invalidatedPlanIds = new Set<EntityId>();
    for (const plan of Object.values(plans)) {
      if (plan.status === "invalid" || Object.values(state.approvals).some(a => a.planId === plan.id && a.status === "consumed")) continue;
      const directlyBound = plan.commitmentId === commitment.id;
      if (!directlyBound && !(commitment.schedule && scheduleOverlapsPlanWindow(commitment.schedule, plan, state))) continue;
      plans[plan.id] = { ...bump(plan, ctx.now), status: "invalid", invalidReason: "责任或安排已改变，请重新检查方案。" };
      invalidatedPlanIds.add(plan.id);
      changes.push({ entityId: plan.id, before: plan.revision, after: plan.revision + 1 });
    }
    for (const approval of Object.values(approvals)) {
      if (!["valid", "pending"].includes(approval.status)) continue;
      const directlyDependent = Object.hasOwn(state.changeSets[approval.changeSetId]?.targetRevisions ?? {}, commitment.id);
      if (!invalidatedPlanIds.has(approval.planId) && !directlyDependent) continue;
      approvals[approval.id] = { ...bump(approval, ctx.now), status: "invalid", invalidReason: "责任或安排已改变，请重新批准。" };
      changes.push({ entityId: approval.id, before: approval.revision, after: approval.revision + 1 });
    }
    return ok(finish(state, { commitments: { ...state.commitments, [commitment.id]: commitment }, plans, approvals }, changes, { eventId: ctx.uuid(), type: existing ? "commitment.updated" : "commitment.created", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "本人保存私人责任与安排；未修改外部日历" }), { commitment });
  },
};
