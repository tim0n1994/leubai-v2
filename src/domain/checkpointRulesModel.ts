import type { GrantKey, RuleSet } from "./types.ts";

export interface CheckpointRulesSnapshot {
  readonly revision: number;
  readonly grants: Readonly<Record<GrantKey, boolean>>;
  readonly paused: boolean;
  readonly dailyCapacityMinutes: number;
  readonly timezone: string;
}
export const RULE_GRANT_LABELS: Readonly<Record<GrantKey, string>> = {
  readMaterial: "读取材料", createLocalDraft: "创建本地草稿", updateEstimate: "调整投入估计",
  internalReschedule: "内部重新排期", attentionRemind: "注意力提醒", externalCalendarWrite: "写入外部日历",
};
export function captureRulesSnapshot(rules: RuleSet): CheckpointRulesSnapshot {
  return { revision: rules.revision, grants: { ...rules.grants }, paused: rules.paused, dailyCapacityMinutes: rules.dailyCapacityMinutes, timezone: rules.timezone };
}
export function isCheckpointRulesSnapshot(value: unknown): value is CheckpointRulesSnapshot {
  if (typeof value !== "object" || value === null || !("grants" in value) || typeof value.grants !== "object" || value.grants === null) return false;
  const grants = value.grants;
  if (!Object.keys(RULE_GRANT_LABELS).every(key => Object.hasOwn(grants, key) && typeof Reflect.get(grants, key) === "boolean")) return false;
  return "revision" in value && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    "paused" in value && typeof value.paused === "boolean" &&
    "dailyCapacityMinutes" in value && typeof value.dailyCapacityMinutes === "number" && Number.isSafeInteger(value.dailyCapacityMinutes) && value.dailyCapacityMinutes > 0 &&
    "timezone" in value && typeof value.timezone === "string" && value.timezone.length > 0;
}
export function compareCheckpointRules(snapshot: CheckpointRulesSnapshot, current: RuleSet): readonly { readonly label: string; readonly before: string; readonly after: string }[] {
  const differences: { label: string; before: string; after: string }[] = [];
  for (const key of ["readMaterial", "createLocalDraft", "updateEstimate", "internalReschedule", "attentionRemind", "externalCalendarWrite"] as const) {
    if (snapshot.grants[key] !== current.grants[key]) differences.push({ label: RULE_GRANT_LABELS[key], before: snapshot.grants[key] ? "允许" : "不允许", after: current.grants[key] ? "允许" : "不允许" });
  }
  if (snapshot.paused !== current.paused) differences.push({ label: "自动化", before: snapshot.paused ? "暂停" : "运行", after: current.paused ? "暂停" : "运行" });
  if (snapshot.dailyCapacityMinutes !== current.dailyCapacityMinutes) differences.push({ label: "每日容量", before: snapshot.dailyCapacityMinutes + " 分钟", after: current.dailyCapacityMinutes + " 分钟" });
  if (snapshot.timezone !== current.timezone) differences.push({ label: "时区", before: snapshot.timezone, after: current.timezone });
  return differences;
}
