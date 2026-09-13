import type { ChangeSet, DomainCommand, DomainState, DomainStore, Plan, PlanKind } from "../../domain/index.ts";
import { selectChangeSetFreshness, selectLatestChangeSetForPlan, selectLatestPlanForKind, selectLatestPlanOperation } from "./planSurfaces.ts";
import { workflowAttemptKey, workflowCommands } from "./workflow-command.ts";

export interface ReviewedProposal {
  plan: Plan;
  changeSet: ChangeSet;
}

export function reviewedProposal(state: DomainState, plan: Plan | null): ReviewedProposal | null {
  if (!plan) return null;
  const changeSet = selectLatestChangeSetForPlan(state, plan.id);
  return changeSet ? { plan, changeSet } : null;
}

export function assertReviewedProposal(state: DomainState, reviewed: ReviewedProposal | null): ReviewedProposal {
  if (!reviewed) throw new Error("请先准备方案并检查实际变更，再批准。");
  const plan = state.plans[reviewed.plan.id];
  const changeSet = state.changeSets[reviewed.changeSet.id];
  if (!plan || !changeSet || plan.revision !== reviewed.plan.revision ||
      changeSet.revision !== reviewed.changeSet.revision || changeSet.hash !== reviewed.changeSet.hash ||
      selectLatestPlanForKind(state, plan.intentId ?? "", plan.kind)?.id !== plan.id ||
      plan.status === "invalid") {
    throw new Error("方案已变化，请重新预览后批准。");
  }
  const operation = selectLatestPlanOperation(state, plan.id);
  if (!operation && !selectChangeSetFreshness(state, changeSet).fresh) {
    throw new Error("方案依据已变化，请重新准备并预览后批准。");
  }
  return { plan, changeSet };
}

export async function preparePlan(store: DomainStore, intentId: string, kind: PlanKind): Promise<ReviewedProposal> {
  const workflow = workflowCommands(store);
  const key = workflowAttemptKey(intentId, kind);
  const pending = workflow.getSnapshot().pending;
  const state = store.getState();
  const intent = state.intents[intentId];
  if (!intent || intent.status !== "saved") throw new Error("没有这条已保存意图。");
  const previous = selectLatestPlanForKind(state, intentId, kind);
  const operation = previous ? selectLatestPlanOperation(state, previous.id) : null;
  if (operation && operation.status !== "failed") throw new Error("已有执行记录，请查看原方案结果，不能重复准备。");
  const commandId = "prepare-" + intentId + "-" + kind + "-r" + state.globalRevision;
  const command: Extract<DomainCommand, { type: "selectPlan" }> = pending?.key === key && pending.command.type === "selectPlan"
    ? pending.command
    : { type: "selectPlan", commandId, entityId: intent.id, expectedRevision: intent.revision, actor: "user", issuedAt: new Date().toISOString(), kind };
  const result = await workflow.run(key, command);
  if (!result.ok) throw new Error(result.code + ": " + result.reason);
  const saved = reviewedProposal(store.getState(), store.getState().plans[result.data.plan.id] ?? null);
  if (!saved || saved.plan.intentId !== intentId || saved.plan.kind !== kind || saved.changeSet.hash !== result.data.changeSet.hash) {
    throw new Error("保存方案的回读与请求不一致，未批准或执行。");
  }
  return saved;
}
