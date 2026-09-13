import type { AttentionBudget, AttentionItem, DomainState } from "./types.ts";

export function attentionDay(now: string, timezone: string): string | null {
  if (!Number.isFinite(Date.parse(now))) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
  } catch { return null; }
}

export function currentAttentionBudget(budget: AttentionBudget, now: string): AttentionBudget | null {
  const day = attentionDay(now, budget.timezone);
  if (day === null) return null;
  return day === budget.budgetDay ? budget : { ...budget, budgetDay: day, used: 0, deliveredIds: [] };
}

export function attentionDueReason(state: DomainState, item: AttentionItem, now: string): string | null {
  if (state.ruleset.paused) return "automation paused";
  if (item.status !== "deferred") return "item is not deferred";
  const entry = state.attention.budget.queue.find(row => row.deliveryId === item.deliveryId);
  if (!entry?.dueAt || !Number.isFinite(Date.parse(entry.dueAt)) || !Number.isFinite(Date.parse(now)) || Date.parse(entry.dueAt) > Date.parse(now)) return "no schedule is due";
  const budget = currentAttentionBudget(state.attention.budget, now);
  if (!budget) return "budget date could not be verified";
  const credibleRisk = item.urgency === "risk" && item.riskBasis?.credibleSource && !!item.riskBasis.deadline.trim() && !!item.riskBasis.consequence.trim();
  if (!budget.deliveredIds.includes(item.deliveryId) && budget.used >= budget.dailyMax && !credibleRisk) return "shared attention budget exhausted";
  return null;
}

export function dueAttentionItems(state: DomainState, now: string): AttentionItem[] {
  return Object.values(state.attention.items)
    .filter(item => attentionDueReason(state, item, now) === null)
    .sort((a, b) => {
      const due = (item: AttentionItem) => Date.parse(state.attention.budget.queue.find(row => row.deliveryId === item.deliveryId)?.dueAt ?? "");
      return due(a) - due(b) || a.id.localeCompare(b.id);
    });
}
