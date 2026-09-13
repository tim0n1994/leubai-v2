import type { ReviewedProposal } from "./planPreparation.ts";
import { proposalSummaryLabel } from "./proposal-summary-label.ts";

export function ProposalSummary({ proposal, used = false }: { proposal: ReviewedProposal | null; used?: boolean }) {
  if (!proposal) return <p role="status">尚未准备方案。先生成具体变更，再决定是否批准。</p>;
  const label = proposalSummaryLabel(used);
  return <section aria-label={label} data-reviewed-plan={proposal.plan.id} data-reviewed-hash={proposal.changeSet.hash}>
    <p>方案 {proposal.plan.kind} · {label}</p>
    <ul>{proposal.changeSet.objectDiffs.map((diff) => <li key={diff.objectId + diff.field}>
      {diff.displayName} · {diff.field === "schedule.date" ? "日期" : diff.field === "effortEstimateMinutes" ? "预计投入（分钟）" : diff.field}：
      {diff.before === null ? "未知" : String(diff.before)} → {diff.after === null ? "未知" : String(diff.after)}
    </li>)}</ul>
    {proposal.plan.kind === "B" ? <p>未来新增负担 {proposal.plan.futureDebtMinutes} 分钟；延期不算净节省。</p> : <p>投入变化为估计，实际节省未测量。</p>}
  </section>;
}
