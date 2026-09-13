import type {
  AttentionBudget,
  AttentionItem,
  AttentionSource,
  DomainState,
  QueueEntry,
  RiskBasis,
} from "../../domain/types.ts";

export interface QueueRow {
  entry: QueueEntry;
  item: AttentionItem | null;
}

export interface AttentionGroups {
  judgment: AttentionItem[];
  queue: QueueRow[];
  silent: AttentionItem[];
}

export interface BudgetDisclosure {
  remaining: number;
  dailyMax: number;
  used: number;
  budgetDay: string;
  timezone: string;
  deliveredCount: number;
  queueCount: number;
}

export interface BasisLines {
  deadline: string | null;
  consequence: string | null;
  credible: boolean;
}

export type DueAtParse =
  | { ok: true; dueAt: string | null }
  | { ok: false; reason: string };

export function dayRemaining(budget: AttentionBudget): number {
  return Math.max(0, budget.dailyMax - budget.used);
}

export function isCredibleBasis(basis: RiskBasis | null | undefined): boolean {
  return (
    !!basis &&
    basis.credibleSource &&
    basis.deadline.trim().length > 0 &&
    basis.consequence.trim().length > 0
  );
}

export function sourceLabel(source: AttentionSource): string {
  switch (source) {
    case "internal":
      return "内部来源";
    case "external":
      return "外部请求";
    case "ai":
      return "AI 建议";
    case "payment":
      return "付费来源";
    case "risk":
      return "责任风险";
  }
}

export function urgencyLabel(urgency: AttentionItem["urgency"]): string {
  switch (urgency) {
    case "normal":
      return "普通提醒";
    case "urgentClaim":
      return "自称紧急（未经核实）";
    case "risk":
      return "责任风险";
  }
}

export function silentTag(item: AttentionItem): string {
  const charge = item.budgetCharged ? "已计入今日已用提醒" : "未占用提醒预算";
  switch (item.status) {
    case "deferred":
      return "已延后 · " + charge;
    case "merged":
      return "已并入同主题条目 · " + charge;
    default:
      return "静默准备 · 没有触发提醒";
  }
}

export function basisLines(item: AttentionItem): BasisLines {
  const basis = item.riskBasis;
  if (!basis) return { deadline: null, consequence: null, credible: false };
  return {
    deadline: basis.deadline.trim() || null,
    consequence: basis.consequence.trim() || null,
    credible: isCredibleBasis(basis),
  };
}

export function selectAttentionGroups(state: DomainState): AttentionGroups {
  const items = Object.values(state.attention.items);
  const queueDeliveryIds = new Set(
    state.attention.budget.queue.map((entry) => entry.deliveryId),
  );
  const judgment = items
    .filter((item) => item.status === "delivered")
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""));
  const queue: QueueRow[] = state.attention.budget.queue.map((entry) => ({
    entry,
    item: items.find((it) => it.deliveryId === entry.deliveryId) ?? null,
  }));
  const silent = items.filter(
    (item) =>
      (item.status === "pending" ||
        item.status === "deferred" ||
        item.status === "merged") &&
      !queueDeliveryIds.has(item.deliveryId),
  );
  return { judgment, queue, silent };
}

export function attentionDisclosure(budget: AttentionBudget): BudgetDisclosure {
  return {
    remaining: dayRemaining(budget),
    dailyMax: budget.dailyMax,
    used: budget.used,
    budgetDay: budget.budgetDay,
    timezone: budget.timezone,
    deliveredCount: budget.deliveredIds.length,
    queueCount: budget.queue.length,
  };
}

export function formatIsoClock(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

export function formatBasisDeadline(deadline: string, timeZone: string): string {
  const trimmed = deadline.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const clock = formatIsoClock(trimmed, timeZone);
    if (clock !== null) return clock;
  }
  return trimmed;
}

export function excerptBody(body: string, max = 60): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "…";
}

export function parseDeferredDueAt(raw: string): DueAtParse {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, dueAt: null };
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: "无法识别的日期时间；请使用日期选择器或 ISO 8601 格式。" };
  }
  return { ok: true, dueAt: new Date(ms).toISOString() };
}

export function isAttentionEmpty(groups: AttentionGroups): boolean {
  return groups.judgment.length === 0 && groups.queue.length === 0 && groups.silent.length === 0;
}

export type AttentionRetryPlan = "replayExact" | "recapture";

export function planAttentionRetry(failureCode: string): AttentionRetryPlan {
  return failureCode === "REVISION_CONFLICT" ? "recapture" : "replayExact";
}

export type AttentionActionReadback =
  | { ok: true; dueAtRecorded: boolean | null }
  | { ok: false; persistedUnknown: boolean; reason: string };

export interface AttentionItemRef {
  id: string;
  deliveryId: string;
}

export function selectAttentionItemRef(
  state: DomainState,
  itemId: string,
): AttentionItemRef | null {
  const item = state.attention.items[itemId];
  return item ? { id: item.id, deliveryId: item.deliveryId } : null;
}

export function verifyDismissReadback(
  storeState: DomainState,
  persisted: DomainState | null,
  item: AttentionItemRef,
): AttentionActionReadback {
  const inStore = storeState.attention.items[item.id];
  if (!inStore || inStore.status !== "dismissed") {
    return { ok: false, persistedUnknown: false, reason: "本地状态尚未显示该条目已不再提醒。" };
  }
  const stillQueued = storeState.attention.budget.queue.some(
    (entry) => entry.deliveryId === item.deliveryId,
  );
  if (stillQueued) {
    return { ok: false, persistedUnknown: false, reason: "合并队列中仍存在该条目，未确认移除。" };
  }
  if (persisted === null) {
    return { ok: false, persistedUnknown: true, reason: "本地持久层读回未知；确认之前不会当作已保存。" };
  }
  const inPersisted = persisted.attention.items[item.id];
  if (!inPersisted || inPersisted.status !== "dismissed") {
    return { ok: false, persistedUnknown: true, reason: "持久层尚未确认该条目已不再提醒。" };
  }
  return { ok: true, dueAtRecorded: null };
}

export function verifyDeferReadback(
  storeState: DomainState,
  persisted: DomainState | null,
  item: AttentionItemRef,
  dueAt: string | null,
): AttentionActionReadback {
  const inStore = storeState.attention.items[item.id];
  if (!inStore || inStore.status !== "deferred") {
    return { ok: false, persistedUnknown: false, reason: "本地状态尚未显示该条目已延后。" };
  }
  let dueAtRecorded: boolean | null = null;
  if (dueAt !== null) {
    const entry = storeState.attention.budget.queue.find(
      (row) => row.deliveryId === item.deliveryId,
    );
    if (entry && entry.dueAt !== dueAt) {
      return { ok: false, persistedUnknown: false, reason: "队列中的延后时间与提交值不一致。" };
    }
    dueAtRecorded = entry ? true : false;
  }
  if (persisted === null) {
    return { ok: false, persistedUnknown: true, reason: "本地持久层读回未知；确认之前不会当作已保存。" };
  }
  const inPersisted = persisted.attention.items[item.id];
  if (!inPersisted || inPersisted.status !== "deferred") {
    return { ok: false, persistedUnknown: true, reason: "持久层尚未确认该条目已延后。" };
  }
  return { ok: true, dueAtRecorded };
}
