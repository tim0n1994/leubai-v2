import type { DomainState, Intent } from "../../domain/types.ts";
import { isoDateOf } from "../s01-now/timeSurfaces.ts";

export function resolveIntentCalendarContext(state: DomainState, intent: Intent) {
  const linked = Object.values(state.protectedBlocks)
    .filter(block => block.intentId === intent.id && block.status === "active")
    .sort((a, b) => a.range.start.localeCompare(b.range.start));
  const date = intent.parsedFields.date ?? linked.map(block => isoDateOf(block.range.start)).sort()[0];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000") || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    return { ok: false as const, reason: "intentDateUnknown" as const, detail: "这条意图的日期尚未确认或无效，且无法确定对应日期；未借用其他意图的时间。" };
  }
  const timezone = intent.parsedFields.timezone ?? linked.find(block => isoDateOf(block.range.start) <= date && date <= isoDateOf(block.range.end))?.range.timezone ?? null;
  return { ok: true as const, date, timezone };
}
