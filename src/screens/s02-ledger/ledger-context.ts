import type { DomainState, Intent, ProtectedBlock } from "../../domain/types.ts";
import { isoDateOf, selectSurfaceDate } from "../s01-now/timeSurfaces.ts";

export type LedgerContext =
  | { ok: true; date: string; intent: Intent | null; block: ProtectedBlock | null }
  | { ok: false; reason: string };

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function resolveLedgerContext(state: DomainState, query: URLSearchParams): LedgerContext {
  const keys = ["intentId", "date", "blockId"] as const;
  if (keys.every(key => !query.has(key))) return { ok: true, date: selectSurfaceDate(state), intent: null, block: null };
  if (keys.some(key => query.getAll(key).length !== 1 || !query.get(key)?.trim())) {
    return { ok: false, reason: "链接必须同时且仅包含一组意图、日期和保护时段标识。" };
  }
  const date = query.get("date")!;
  if (!validDate(date)) return { ok: false, reason: "链接日期不是有效的 YYYY-MM-DD 日历日期。" };
  const intent = state.intents[query.get("intentId")!];
  if (!intent || intent.status === "deleted" || intent.status === "discarded") return { ok: false, reason: "链接所指的意图不存在或已删除。" };
  const matches = Object.values(state.protectedBlocks).filter(block => block.blockId === query.get("blockId"));
  if (matches.length !== 1) return { ok: false, reason: "链接所指的保护时段不存在，或标识无法唯一对应一条记录。" };
  const block = matches[0];
  if (block.status !== "active") return { ok: false, reason: "链接所指的保护时段已经解除；这里不会换成其他时段。" };
  if (block.intentId !== intent.id) return { ok: false, reason: "保护时段不属于链接中的意图，无法确认这次定位。" };
  if (!Number.isFinite(Date.parse(block.range.start)) || !Number.isFinite(Date.parse(block.range.end)) || Date.parse(block.range.end) <= Date.parse(block.range.start)) return { ok: false, reason: "保护时段的已保存时间范围无效。" };
  if (date < isoDateOf(block.range.start) || date > isoDateOf(block.range.end)) return { ok: false, reason: "链接日期不在这个保护时段内，无法确认这次定位。" };
  return { ok: true, date, intent, block };
}
