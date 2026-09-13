import type { PlanAction, GrantKey, ActionKind } from "../../domain/types.ts";
import { executableActionIds } from "../../domain/approvalScope.ts";

type ApprovalPrimary = "draft" | "estimate" | "defer" | "read" | "none";
export const APPROVAL_LABELS: Readonly<Record<ApprovalPrimary, string>> = {
  draft: "批准并准备草稿", estimate: "批准并更新投入估计", defer: "批准并推迟承诺", read: "批准并读取材料", none: "当前选择没有可执行动作",
};

export function approvalPreflight(actions: readonly PlanAction[], grants: readonly GrantKey[]) {
  const executable = executableActionIds(actions, grants);
  const effective = actions.filter(action => executable.has(action.id));
  const excluded = actions.filter(action => !executable.has(action.id)).map(action => ({
    id: action.id,
    kind: action.kind,
    reason: grants.includes(action.requiredGrant) ? "dependency" : "permission",
    dependencies: action.dependsOn.filter(id => !executable.has(id)).map(id => {
      const dependency = actions.find(candidate => candidate.id === id);
      return dependency ? ACTION_LABELS[dependency.kind] : "未包含的前置步骤";
    }),
  }));
  const kinds = new Set(effective.map(action => action.kind));
  const primary: ApprovalPrimary = kinds.has("createDraft") ? "draft" : kinds.has("updateEstimate") ? "estimate" : kinds.has("deferCommitment") ? "defer" : kinds.has("readMaterial") ? "read" : "none";
  return { effective, excluded, primary, canApprove: effective.length > 0 };
}
export const ACTION_LABELS: Readonly<Record<ActionKind, string>> = { readMaterial: "读取指定材料", createDraft: "准备本地草稿", updateEstimate: "更新内部投入估计", deferCommitment: "推迟内部承诺" };
