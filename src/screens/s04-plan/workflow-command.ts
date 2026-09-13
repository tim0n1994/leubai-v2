import type { DomainStore } from "../../domain/store.ts";
import type { CommandResult, DomainCommand, DomainState, GrantKey, PlanKind } from "../../domain/types.ts";

export interface WorkflowAttempt {
  readonly key: string;
  readonly command: DomainCommand;
  readonly grants: readonly GrantKey[];
  readonly uncertain: boolean;
}
interface WorkflowSnapshot { readonly pending: WorkflowAttempt | null; readonly busy: boolean }

export function workflowAttemptKey(intentId: string, kind: PlanKind): string {
  return JSON.stringify([intentId, kind]);
}

export function assertWorkflowResumeTarget(state: DomainState, attempt: WorkflowAttempt | null, planId: string | undefined): void {
  if (!attempt || attempt.command.type === "selectPlan") return;
  const command = attempt.command;
  let originalPlanId: string | undefined;
  if (command.type === "grantApproval") originalPlanId = state.changeSets[command.changeSetId]?.planId;
  if (command.type === "startOperation") originalPlanId = state.approvals[command.approvalId]?.planId;
  if (command.type === "readbackOperation" && command.entityId) {
    const operation = state.operations[command.entityId];
    originalPlanId = operation ? state.approvals[operation.approvalId]?.planId : undefined;
  }
  if (!originalPlanId || originalPlanId !== planId) throw new Error("原未决操作不属于当前预览的方案；已停止后续步骤，不会批准另一方案。");
}

function createWorkflowCommands(store: DomainStore) {
  let snapshot: WorkflowSnapshot = { pending: null, busy: false };
  const commands = new Map<string, DomainCommand>();
  const listeners = new Set<() => void>();
  const publish = (next: WorkflowSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const sameGrants = (a: readonly GrantKey[], b: readonly GrantKey[]) => [...a].sort().join("|") === [...b].sort().join("|");
  const run = async <C extends DomainCommand>(key: string, requested: C, grants: readonly GrantKey[] = []): Promise<CommandResult<C>> => {
    const pending = snapshot.pending;
    if (snapshot.busy || (pending && (pending.key !== key || pending.command.type !== requested.type || !sameGrants(pending.grants, grants)))) {
      throw new Error("已有未决操作，请先在原意图与范围下重试；不能改换授权或准备新方案。");
    }
    const retained = pending?.command ?? commands.get(requested.commandId);
    if (retained && retained.type !== requested.type) throw new Error("命令标识与原操作类型不一致。");
    const command = (retained ?? structuredClone(requested)) as C;
    commands.set(command.commandId, command);
    const attempt: WorkflowAttempt = { key, command, grants: [...grants], uncertain: pending?.uncertain ?? false };
    publish({ pending: attempt, busy: true });
    try {
      const result = await store.execute(command);
      const uncertain = attempt.uncertain || (!result.ok && (result.code === "STORAGE_READBACK_UNVERIFIED" || result.details?.stage === "unknown" || result.details?.stage === "postwrite"));
      const definitiveConflict = !result.ok && result.details?.stage !== "postwrite" && (result.code === "REVISION_CONFLICT" || result.details?.stage === "prewrite");
      const unresolved = !result.ok && (uncertain || (result.retryable && !definitiveConflict));
      if (!result.ok && !unresolved) commands.delete(command.commandId);
      publish({ pending: unresolved ? { ...attempt, uncertain } : null, busy: false });
      return result;
    } catch (error) {
      publish({ pending: { ...attempt, uncertain: true }, busy: false });
      throw error;
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run,
    async retryPending(key: string): Promise<DomainCommand["type"] | null> {
      const pending = snapshot.pending;
      if (!pending) return null;
      if (pending.key !== key) throw new Error("其他意图存在未决操作，请先返回原意图解决，未提交新操作。");
      const result = await run(key, pending.command, pending.grants);
      if (!result.ok) throw new Error(result.code + ": " + result.reason);
      return pending.command.type;
    },
  };
}

const controllers = new WeakMap<DomainStore, ReturnType<typeof createWorkflowCommands>>();
export function workflowCommands(store: DomainStore): ReturnType<typeof createWorkflowCommands> {
  const existing = controllers.get(store);
  if (existing) return existing;
  const controller = createWorkflowCommands(store);
  controllers.set(store, controller);
  return controller;
}
