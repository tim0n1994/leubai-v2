import type { DomainState } from "../../domain/types.ts";
import { resolveNowContext } from "../s01-now/now-context.ts";
import { formatCapacityWarning, formatMinuteOfDay, formatModificationHint, selectCapacityView } from "../s01-now/timeSurfaces.ts";
import { buildNowSurfaceModel, formatSurfaceDateLabel } from "../s04-plan/planSurfaces.ts";
import type { NowSurfaceReadyModel } from "../s04-plan/planSurfaces.ts";

export type MobileNowSurfaceModel = NowSurfaceReadyModel | {
  ready: false;
  reason: string;
  explicitQuery: boolean;
  title: string;
  detail: string;
};

export function buildMobileNowSurfaceModel(state: DomainState, explicitIntentIds: readonly string[]): MobileNowSurfaceModel {
  const model = buildNowSurfaceModel(state, explicitIntentIds);
  if (explicitIntentIds.length === 0 || !model.ready) return model;
  const context = resolveNowContext(state, explicitIntentIds);
  if (!context.ok) {
    return { ready: false, reason: context.reason, explicitQuery: true, title: "无法打开这条意图", detail: context.detail };
  }
  const capacity = selectCapacityView(state, context.date);
  const block = context.hero.protectedInterval;
  const timezone = block?.timezone ?? state.intents[model.intentId].parsedFields.timezone;
  return {
    ...model,
    dateLabel: formatSurfaceDateLabel(context.date) + (timezone ? " · " + timezone : " · 时区未知"),
    capacity,
    heroRangeLabel: block ? formatMinuteOfDay(block.startMinute) + "—" + formatMinuteOfDay(block.endMinute) : null,
    heroNote: block ? block.purpose ? "用途：" + block.purpose + "。不自动填满。" : "不自动填满。没有用途，也成立。" : "这一天还没有已保存的保护时段；空白不自动意味着可占用。",
    warningText: formatCapacityWarning(capacity),
    warningTone: capacity.kind === "deficit" || capacity.kind === "unknown" ? "warm" : "ok",
    modificationFootnote: formatModificationHint(context.modification.kind),
  };
}
