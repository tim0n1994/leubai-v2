export function proposalSummaryLabel(used = false): string {
  return used ? "本次授权对应变更" : "待批准的实际变更";
}
