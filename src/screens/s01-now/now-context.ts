import type { DomainState } from "../../domain/types.ts";
import { resolvePlanIntent } from "../s04-plan/planSurfaces.ts";
import { resolveIntentCalendarContext } from "../s04-plan/intent-calendar-context.ts";
import { selectHeroView, selectModificationView, selectSurfaceDate } from "./timeSurfaces.ts";

export function resolveNowContext(state: DomainState, explicitIntentIds: readonly string[]) {
  if (explicitIntentIds.length === 0) {
    const date = selectSurfaceDate(state);
    return { ok: true as const, intentId: null, date, hero: selectHeroView(state, date), modification: selectModificationView(state), planHref: "/plan" };
  }
  const resolution = resolvePlanIntent(state, explicitIntentIds);
  if (!resolution.ok) {
    return { ok: false as const, reason: resolution.reason, detail: "意图链接为空、重复、不存在或已暂停/删除，未选择任何替代意图。" };
  }
  const intent = state.intents[resolution.intentId];
  const protectedBlocks = Object.fromEntries(Object.entries(state.protectedBlocks).filter(([, block]) => block.intentId === intent.id && block.status === "active"));
  const calendar = resolveIntentCalendarContext(state, intent);
  if (!calendar.ok) return calendar;
  const { date } = calendar;
  const planIds = new Set(Object.values(state.plans).filter(plan => plan.intentId === intent.id).map(plan => plan.id));
  const changeSetIds = new Set(Object.values(state.changeSets).filter(changeSet => planIds.has(changeSet.planId)).map(changeSet => changeSet.id));
  const operations = Object.fromEntries(Object.entries(state.operations).filter(([, operation]) => changeSetIds.has(operation.changeSetId)));
  const scopedState = { ...state, protectedBlocks, operations };
  return {
    ok: true as const,
    intentId: intent.id,
    date,
    hero: selectHeroView(scopedState, date),
    modification: selectModificationView(scopedState),
    planHref: "/plan?intentId=" + encodeURIComponent(intent.id),
  };
}
