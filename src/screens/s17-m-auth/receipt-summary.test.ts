import assert from "node:assert/strict";
import test from "node:test";
import type { StepReceipt } from "../../domain/types.ts";
import { summarizeReceipt } from "./receipt-summary.ts";

const cases = [
  { actionKind: "readMaterial", detail: "read source snapshot captured at 2026-09-13T08:30:00+08:00", expected: "已读取来源快照，采集时间：2026-09-13T08:30:00+08:00。" },
  { actionKind: "createDraft", detail: "draft generated from source snapshot", expected: "已依据来源快照生成草稿，仍待检查。" },
  { actionKind: "updateEstimate", detail: "estimate 60 -> 40", expected: "内部投入估计由 60 调整为 40 分钟；尚非实测。" },
  { actionKind: "deferCommitment", detail: "deferred to 2026-09-14", expected: "已延期至 2026-09-14；未来负担仍需承担。" },
] as const;

for (const scenario of cases) test("summarizes the completed " + scenario.actionKind + " receipt without changing its original detail", () => {
  const receipt = { actionKind: scenario.actionKind, status: "completed", detail: scenario.detail } as const;
  const summary = summarizeReceipt(receipt);
  assert.equal(summary, scenario.expected);
  assert.equal(receipt.detail, scenario.detail);
});

for (const status of ["unknown", "failed", "skipped"] as const) test("does not infer completed status from familiar detail when receipt is " + status, () => {
  const receipt = { actionKind: "createDraft", status, detail: "draft generated from source snapshot" } as const;
  const summary = summarizeReceipt(receipt);
  assert.doesNotMatch(summary, /已完成|已依据|已创建/);
  assert.match(summary, /未知|失败|跳过/);
});

const unknownDetails: ReadonlyArray<Pick<StepReceipt, "actionKind" | "detail">> = [
  { actionKind: "createDraft", detail: "draft generated from source snapshot\nextra provider content" },
  { actionKind: "createDraft", detail: "draft generated from source snapshot\n" },
  { actionKind: "updateEstimate", detail: "estimate unknown -> 40" },
  { actionKind: "readMaterial", detail: "read source snapshot captured at yesterday" },
  { actionKind: "deferCommitment", detail: "deferred to tomorrow" },
  { actionKind: "readMaterial", detail: "draft generated from source snapshot" },
];
for (const receipt of unknownDetails) test("preserves unknown format for raw inspection: " + JSON.stringify(receipt), () => {
  const summary = summarizeReceipt({ ...receipt, status: "completed" });
  assert.equal(summary, "此回执暂无中文摘要，请查看原始记录。");
});
