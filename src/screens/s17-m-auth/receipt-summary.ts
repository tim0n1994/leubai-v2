import type { ActionKind, StepReceipt } from "../../domain/types.ts";

type ReceiptSummaryInput = Readonly<Pick<StepReceipt, "actionKind" | "status" | "detail">>;

function exactMatch(pattern: RegExp, detail: string): RegExpExecArray | null {
  const match = pattern.exec(detail);
  return match?.[0] === detail ? match : null;
}

const SUMMARY_FORMATTERS: Readonly<Record<ActionKind, (detail: string) => string | null>> = {
  readMaterial(detail) {
    const match = exactMatch(/^read source snapshot captured at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/, detail);
    return match && Number.isFinite(Date.parse(match[1])) ? "已读取来源快照，采集时间：" + match[1] + "。" : null;
  },
  createDraft(detail) {
    return detail === "draft generated from source snapshot" ? "已依据来源快照生成草稿，仍待检查。" : null;
  },
  updateEstimate(detail) {
    const match = exactMatch(/^estimate (\d+(?:\.\d+)?) -> (\d+(?:\.\d+)?)$/, detail);
    return match ? "内部投入估计由 " + match[1] + " 调整为 " + match[2] + " 分钟；尚非实测。" : null;
  },
  deferCommitment(detail) {
    const match = exactMatch(/^deferred to (\d{4}-\d{2}-\d{2})$/, detail);
    return match && Number.isFinite(Date.parse(match[1])) ? "已延期至 " + match[1] + "；未来负担仍需承担。" : null;
  },
};

const STATUS_SUMMARIES: Readonly<Record<Exclude<StepReceipt["status"], "completed">, string>> = {
  failed: "此步骤失败，请查看原始记录。",
  unknown: "此步骤结果未知，请查看原始记录。",
  skipped: "此步骤已跳过，请查看原始记录。",
};

export function summarizeReceipt(receipt: ReceiptSummaryInput): string {
  if (receipt.status !== "completed") return STATUS_SUMMARIES[receipt.status];
  return SUMMARY_FORMATTERS[receipt.actionKind](receipt.detail) ?? "此回执暂无中文摘要，请查看原始记录。";
}
