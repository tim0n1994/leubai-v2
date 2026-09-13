import type {
  DomainState,
  GrantKey,
  ProtectedBlock,
  RuleSet,
} from "../../domain/types.ts";

export const GRANT_KEYS: readonly GrantKey[] = [
  "readMaterial",
  "createLocalDraft",
  "updateEstimate",
  "internalReschedule",
  "attentionRemind",
  "externalCalendarWrite",
];

export interface GrantRow {
  key: GrantKey;
  title: string;
  desc: string;
}

export const GRANT_ROWS: readonly GrantRow[] = [
  {
    key: "readMaterial",
    title: "读取指定来源",
    desc: "只读工作日历、任务清单与手动选择的文件",
  },
  {
    key: "createLocalDraft",
    title: "准备可撤回的本地草稿",
    desc: "限定材料范围；不代表内容已核验或交付已完成",
  },
  {
    key: "updateEstimate",
    title: "改写估时",
    desc: "只更新你自己的估时；不改外部约定与他人时间",
  },
  {
    key: "internalReschedule",
    title: "改写内部计划",
    desc: "只在已授权时段内；不得移动外部约定",
  },
  {
    key: "attentionRemind",
    title: "主动提醒",
    desc: "受每日提醒预算约束；AI 与付费来源共用同一预算，没有例外通道",
  },
  {
    key: "externalCalendarWrite",
    title: "写入外部日历",
    desc: "权限已记录；当前没有已实现的操作使用它，开启不产生任何外部写入",
  },
];

export interface CapabilityRow {
  title: string;
  desc: string;
  note: string;
}

export const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  {
    title: "移动外部会议",
    desc: "涉及他人的时间，必须按共同约定确认",
    note: "当前版本没有对应权限项；这里不提供复选框，也不能从其他授权推导",
  },
  {
    title: "发送消息或提交交付",
    desc: "批准对象与内容；发送不视为可完全撤回",
    note: "当前版本没有对应权限项；这里不提供复选框，也不能从其他授权推导",
  },
  {
    title: "付款、购买与新增承诺",
    desc: "当前未开放；不得从其他许可推导授权",
    note: "当前版本没有对应权限项；这里不提供复选框，也不能从其他授权推导",
  },
];

export type GrantStatusTone = "ok" | "locked";

export interface GrantStatus {
  label: string;
  tone: GrantStatusTone;
}

export function grantStatusLabel(granted: boolean): GrantStatus {
  return granted
    ? { label: "已授权", tone: "ok" }
    : { label: "未授权", tone: "locked" };
}

export type CapacityParse =
  | { ok: true; value: number }
  | { ok: false; reason: string };

export function parseDailyCapacityMinutes(raw: string): CapacityParse {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "请输入每日可用分钟数。" };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: "每日可用分钟数必须是正整数。" };
  }
  return { ok: true, value };
}

export function parseDailyReminderMax(raw: string): CapacityParse {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "请输入每日提醒上限。" };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    return { ok: false, reason: "每日提醒上限必须是 0 到 10 之间的整数。" };
  }
  return { ok: true, value };
}

export function selectActiveProtectedBlocks(
  state: DomainState,
): ProtectedBlock[] {
  return Object.values(state.protectedBlocks)
    .filter((block) => block.status === "active")
    .sort((a, b) => a.range.start.localeCompare(b.range.start));
}

export function formatRulesTime(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

export function formatBlockRange(
  block: ProtectedBlock,
  timeZone: string,
): string {
  const start = formatRulesTime(block.range.start, timeZone) ?? block.range.start;
  const end = formatRulesTime(block.range.end, timeZone) ?? block.range.end;
  return start + "—" + end;
}

export interface RulesetHistoryRow {
  revision: number;
  at: string;
  actor: RuleSet["history"][number]["actor"];
  changes: string[];
  description: string;
}

export function actorLabel(actor: RuleSet["history"][number]["actor"]): string {
  switch (actor) {
    case "user":
      return "由你确认";
    case "automation":
      return "自动化记录";
    case "model":
      return "AI 建议记录";
  }
}

export function selectRulesHistory(ruleset: RuleSet): RulesetHistoryRow[] {
  return [...ruleset.history].sort((a, b) => b.revision - a.revision);
}

export function selectLatestConfirmation(
  ruleset: RuleSet,
): RulesetHistoryRow | null {
  const userRows = ruleset.history.filter((row) => row.actor === "user");
  if (userRows.length === 0) return null;
  const latest = userRows.reduce((best, row) =>
    row.revision > best.revision ? row : best,
  );
  return {
    revision: latest.revision,
    at: latest.at,
    actor: latest.actor,
    changes: latest.changes,
    description: latest.description,
  };
}

export type RulesRetryPlan = "replayExact" | "recapture";

export function planRulesRetry(failureCode: string): RulesRetryPlan {
  return failureCode === "REVISION_CONFLICT" ? "recapture" : "replayExact";
}

export function describeRulesFailure(
  failure: Readonly<{ code: string; details?: unknown }>,
  previouslyUncertain = false,
): Readonly<{ persistedUnknown: boolean; plan: RulesRetryPlan }> {
  const stageUnknown = typeof failure.details === "object" && failure.details !== null &&
    "stage" in failure.details && (failure.details.stage === "unknown" || failure.details.stage === "postwrite");
  const persistedUnknown = previouslyUncertain || failure.code === "STORAGE_READBACK_UNVERIFIED" || stageUnknown;
  return { persistedUnknown, plan: persistedUnknown ? "replayExact" : planRulesRetry(failure.code) };
}

export type RulesActionReadback =
  | { ok: true }
  | { ok: false; persistedUnknown: boolean; reason: string };

export function verifyGrantReadback(
  storeState: DomainState,
  persisted: DomainState | null,
  grants: Partial<Record<GrantKey, boolean>>,
  expectedRevision: number,
): RulesActionReadback {
  const rs = storeState.ruleset;
  if (rs.revision !== expectedRevision) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: "本地规则版本与提交时的期望版本不一致。",
    };
  }
  for (const key of GRANT_KEYS) {
    const wanted = grants[key];
    if (wanted === undefined) continue;
    if (rs.grants[key] !== wanted) {
      return {
        ok: false,
        persistedUnknown: false,
        reason: "本地权限状态与提交值不一致：" + key + "。",
      };
    }
  }
  if (persisted === null) {
    return {
      ok: false,
      persistedUnknown: true,
      reason: "本地持久层读回未知；确认之前不会当作已保存。",
    };
  }
  const prs = persisted.ruleset;
  if (prs.revision !== expectedRevision) {
    return { ok: false, persistedUnknown: true, reason: "持久层规则版本尚未确认。" };
  }
  for (const key of GRANT_KEYS) {
    const wanted = grants[key];
    if (wanted === undefined) continue;
    if (prs.grants[key] !== wanted) {
      return { ok: false, persistedUnknown: true, reason: "持久层权限状态尚未确认：" + key + "。" };
    }
  }
  return { ok: true };
}

export function verifyCapacityReadback(
  storeState: DomainState,
  persisted: DomainState | null,
  dailyCapacityMinutes: number,
  expectedRevision: number,
): RulesActionReadback {
  const rs = storeState.ruleset;
  if (rs.revision !== expectedRevision) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: "本地规则版本与提交时的期望版本不一致。",
    };
  }
  if (rs.dailyCapacityMinutes !== dailyCapacityMinutes) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: "本地每日可用时间与提交值不一致。",
    };
  }
  if (persisted === null) {
    return {
      ok: false,
      persistedUnknown: true,
      reason: "本地持久层读回未知；确认之前不会当作已保存。",
    };
  }
  const prs = persisted.ruleset;
  if (prs.revision !== expectedRevision) {
    return { ok: false, persistedUnknown: true, reason: "持久层规则版本尚未确认。" };
  }
  if (prs.dailyCapacityMinutes !== dailyCapacityMinutes) {
    return { ok: false, persistedUnknown: true, reason: "持久层每日可用时间尚未确认。" };
  }
  return { ok: true };
}

export function verifyBudgetMaxReadback(
  storeState: DomainState,
  persisted: DomainState | null,
  dailyReminderMax: number,
  expectedRulesetRevision: number,
  expectedBudgetRevision: number,
): RulesActionReadback {
  const rs = storeState.ruleset;
  if (rs.revision !== expectedRulesetRevision) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: "本地规则版本与提交时的期望版本不一致。",
    };
  }
  const budget = storeState.attention.budget;
  if (budget.revision !== expectedBudgetRevision || budget.dailyMax !== dailyReminderMax) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: "本地提醒预算与提交值不一致。",
    };
  }
  if (persisted === null) {
    return {
      ok: false,
      persistedUnknown: true,
      reason: "本地持久层读回未知；确认之前不会当作已保存。",
    };
  }
  const prs = persisted.ruleset;
  if (prs.revision !== expectedRulesetRevision) {
    return { ok: false, persistedUnknown: true, reason: "持久层规则版本尚未确认。" };
  }
  const pbudget = persisted.attention.budget;
  if (pbudget.revision !== expectedBudgetRevision || pbudget.dailyMax !== dailyReminderMax) {
    return { ok: false, persistedUnknown: true, reason: "持久层提醒预算尚未确认。" };
  }
  return { ok: true };
}

export function verifyPauseReadback(
  storeState: DomainState,
  persisted: DomainState | null,
  expectedPaused: boolean,
  expectedEpoch: number,
): RulesActionReadback {
  const rs = storeState.ruleset;
  if (rs.paused !== expectedPaused) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: expectedPaused
        ? "本地状态尚未显示自动化已暂停。"
        : "本地状态尚未显示自动化已恢复。",
    };
  }
  if (rs.pauseEpoch !== expectedEpoch) {
    return {
      ok: false,
      persistedUnknown: false,
      reason: "本地暂停纪元与提交时的期望值不一致。",
    };
  }
  if (persisted === null) {
    return {
      ok: false,
      persistedUnknown: true,
      reason: "本地持久层读回未知；确认之前不会当作已保存。",
    };
  }
  const prs = persisted.ruleset;
  if (prs.paused !== expectedPaused) {
    return {
      ok: false,
      persistedUnknown: true,
      reason: expectedPaused
        ? "持久层尚未确认自动化已暂停。"
        : "持久层尚未确认自动化已恢复。",
    };
  }
  if (prs.pauseEpoch !== expectedEpoch) {
    return { ok: false, persistedUnknown: true, reason: "持久层暂停纪元尚未确认。" };
  }
  return { ok: true };
}
