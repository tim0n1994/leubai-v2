import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useDomainState } from "../../data/react.ts";
import type {
  ActionKind,
  Approval,
  DomainState,
  Draft,
  GrantKey,
  Intent,
  LedgerEntry,
  Operation,
  Plan,
  PlanKind,
} from "../../domain/types.ts";
import { useDomainRuntime } from "../../runtime/index.ts";
import type { ReadyDomainRuntime } from "../../runtime/index.ts";
import { MobileChrome } from "../mobile/MobileChrome";
import { formatIsoDateCn } from "../s01-now/timeSurfaces.ts";
import {
  deferReceiptComplete,
  planBCompletionConfirmed,
  selectChangeSetFreshness,
  mobilePlanHref,
  parseExplicitIntentValues,
  parsePlanKindValues,
  selectFutureDebtLedgerForOperation,
  selectLatestApprovalForPlan,
  selectLatestOperationForApproval,
  selectLatestPlanForKind,
  selectUniqueDraftRef,
  selectWorkflowIntent,
  workflowRequestKey,
} from "../s04-plan/planSurfaces.ts";
import type {
  ExplicitIntentRequest,
  PlanKindRequest,
} from "../s04-plan/planSurfaces.ts";
import "./s17-m-auth.css";
import { assertReviewedProposal, preparePlan, reviewedProposal } from "../s04-plan/planPreparation.ts";
import { ProposalSummary } from "../s04-plan/ProposalSummary.tsx";
import { ACTION_LABELS, APPROVAL_LABELS, approvalPreflight } from "./approval-preflight.ts";
import { summarizeReceipt } from "./receipt-summary.ts";
import { assertWorkflowResumeTarget, workflowAttemptKey, workflowCommands } from "../s04-plan/workflow-command.ts";

type UiGrant = Extract<GrantKey, "readMaterial" | "createLocalDraft" | "updateEstimate">;

type SelectedGrants = Record<UiGrant, boolean>;

const SCOPES: Array<{ id: UiGrant; label: string; desc: string }> = [
  {
    id: "readMaterial",
    label: "读取方案指定材料",
    desc: "不扩展到全部文件与邮件",
  },
  {
    id: "createLocalDraft",
    label: "创建待检查的草稿",
    desc: "不代表已完成或已发送",
  },
  {
    id: "updateEstimate",
    label: "更新内部投入估计",
    desc: "依方案变更集更新，仍可修正",
  },
];

const GRANT_LABELS: Record<GrantKey, string> = {
  readMaterial: "读取材料",
  createLocalDraft: "创建草稿",
  updateEstimate: "更新投入估计",
  internalReschedule: "内部改期",
  attentionRemind: "注意力提醒",
  externalCalendarWrite: "外部日历写入",
};

const RECEIPT_LABELS: Record<ActionKind, string> = {
  readMaterial: "已读取材料",
  createDraft: "已创建草稿",
  updateEstimate: "已更新投入估计",
  deferCommitment: "已推迟承诺",
};

const ALL_SELECTED: SelectedGrants = {
  readMaterial: true,
  createLocalDraft: true,
  updateEstimate: true,
};

function selectedKeys(selected: SelectedGrants): GrantKey[] {
  return SCOPES.filter((scope) => selected[scope.id]).map((scope) => scope.id);
}

function grantsSignature(grants: GrantKey[]): string {
  return [...grants].sort().join("+");
}

function sameGrantSet(a: GrantKey[], b: GrantKey[]): boolean {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

function grantLabels(grants: GrantKey[]): string {
  return grants.map((grant) => GRANT_LABELS[grant] ?? grant).join("、");
}

function pickApprovalForPlanGrants(
  state: DomainState,
  planId: string,
  grants: GrantKey[],
): Approval | null {
  const approvals = Object.values(state.approvals)
    .filter(
      (a) =>
        a.planId === planId &&
        (a.status === "valid" || a.status === "consumed") &&
        sameGrantSet(a.grantedActions, grants),
    )
    .sort((a, b) => a.revision - b.revision);
  return approvals.length > 0 ? approvals[approvals.length - 1] : null;
}

function initialSelectedGrants(
  runtime: ReadyDomainRuntime,
  request: ExplicitIntentRequest,
): SelectedGrants {
  const state = runtime.store.getState();
  const intent = selectWorkflowIntent(state, request);
  const pending = workflowCommands(runtime.store).getSnapshot().pending;
  if (intent && pending?.key === workflowAttemptKey(intent.id, "A") && pending.grants.length > 0) {
    return { readMaterial: pending.grants.includes("readMaterial"), createLocalDraft: pending.grants.includes("createLocalDraft"), updateEstimate: pending.grants.includes("updateEstimate") };
  }
  const plan = intent !== null ? selectLatestPlanForKind(state, intent.id, "A") : null;
  const approval = plan !== null ? selectLatestApprovalForPlan(state, plan.id) : null;
  if (approval === null) return { ...ALL_SELECTED };
  const out: SelectedGrants = {
    readMaterial: false,
    createLocalDraft: false,
    updateEstimate: false,
  };
  let any = false;
  for (const scope of SCOPES) {
    if (approval.grantedActions.includes(scope.id)) {
      out[scope.id] = true;
      any = true;
    }
  }
  return any ? out : { ...ALL_SELECTED };
}

function useS17WorkflowView(
  runtime: ReadyDomainRuntime,
  selected: SelectedGrants,
  request: ExplicitIntentRequest,
  planKindRequest: PlanKindRequest,
): {
  intent: Intent | null;
  plan: Plan | null;
  persistedApproval: Approval | null;
  matchingApproval: Approval | null;
  operation: Operation | null;
  draftRef: string | null;
  draft: Draft | undefined;
  futureDebtLedger: LedgerEntry | null;
} {
  const state = useDomainState(runtime.store);
  const planKind = planKindRequest.kind === "valid" ? planKindRequest.value : null;
  const intent = planKind === null ? null : selectWorkflowIntent(state, request);
  const plan =
    intent !== null && planKind !== null
      ? selectLatestPlanForKind(state, intent.id, planKind)
      : null;
  const persistedApproval = plan !== null ? selectLatestApprovalForPlan(state, plan.id) : null;
  const grants: GrantKey[] =
    planKind === "B" ? ["internalReschedule"] : selectedKeys(selected);
  const matchingApproval =
    plan !== null && grants.length > 0
      ? pickApprovalForPlanGrants(state, plan.id, grants)
      : null;
  const operation =
    matchingApproval !== null
      ? selectLatestOperationForApproval(state, matchingApproval.id)
      : null;
  const draftRef =
    planKind === "A" && operation !== null && operation.status === "verified"
      ? selectUniqueDraftRef(state, operation.id, operation.resultRefs)
      : null;
  const draft = draftRef !== null ? state.drafts[draftRef] : undefined;
  const futureDebtLedger =
    planKind === "B" && operation !== null && planBCompletionConfirmed(state, plan, operation)
      ? selectFutureDebtLedgerForOperation(state, operation.id)
      : null;
  return {
    intent,
    plan,
    persistedApproval,
    matchingApproval,
    operation,
    draftRef,
    draft,
    futureDebtLedger,
  };
}

function S17RuntimeAuth({
  runtime,
  request,
  planKindRequest,
}: {
  runtime: ReadyDomainRuntime;
  request: ExplicitIntentRequest;
  planKindRequest: PlanKindRequest;
}): ReactElement {
  const [selectedDraft, setSelected] = useState<SelectedGrants>(() =>
    initialSelectedGrants(runtime, request),
  );
  const [phase, setPhase] = useState<"idle" | "running" | "failed">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [scopeNote, setScopeNote] = useState<string | null>(null);
  const runningRef = useRef(false);
  const workflow = workflowCommands(runtime.store);
  const workflowSnapshot = useSyncExternalStore(workflow.subscribe, workflow.getSnapshot);
  const selectedIntent = selectWorkflowIntent(runtime.store.getState(), request);
  const pendingGrants = selectedIntent && planKindRequest.kind === "valid" && workflowSnapshot.pending?.key === workflowAttemptKey(selectedIntent.id, planKindRequest.value)
    ? workflowSnapshot.pending.grants : null;
  const selected = pendingGrants?.length ? {
    readMaterial: pendingGrants.includes("readMaterial"),
    createLocalDraft: pendingGrants.includes("createLocalDraft"),
    updateEstimate: pendingGrants.includes("updateEstimate"),
  } : selectedDraft;

  const {
    intent,
    plan,
    persistedApproval,
    matchingApproval,
    operation,
    draftRef,
    draft,
    futureDebtLedger,
  } = useS17WorkflowView(runtime, selected, request, planKindRequest);
  const proposal = reviewedProposal(runtime.store.getState(), plan);
  const needsPreparation = !proposal || (!operation && !selectChangeSetFreshness(runtime.store.getState(), proposal.changeSet).fresh);

  if (planKindRequest.kind === "invalid") {
    return (
      <>
        <p
          className="s17-version"
          data-s17-status="kind-invalid"
          data-s17-kind-routing="fail-closed"
        >
          共享方案 · 链接无效
        </p>
        <div className="s17-card">
          <p className="s17-empty" role="alert">
            URL 中的 kind 为空、重复或未知；未选择方案类型，也不提供批准操作。
          </p>
        </div>
      </>
    );
  }
  const planKind: PlanKind = planKindRequest.value;

  if (intent === null && request.kind !== "none") {
    return (
      <>
        <p
          className="s17-version"
          data-s17-status="intent-invalid"
          data-s17-intent-routing="fail-closed"
        >
          共享方案 · 意图链接无效
        </p>
        <div className="s17-card">
          <p className="s17-empty" role="alert">
            {request.kind === "invalid"
              ? "URL 中的 intentId 为空或重复；未选择任何意图，也不提供批准操作。"
              : "共享状态中没有与该 intentId 完全一致的已保存意图；未选择其他意图，也不提供批准操作。"}
          </p>
        </div>
      </>
    );
  }

  const used = operation !== null;
  const activeGrants: GrantKey[] =
    planKind === "B" ? ["internalReschedule"] : selectedKeys(selected);
  const preflight = proposal ? approvalPreflight(proposal.changeSet.actions, activeGrants) : null;

  const updateGrant = (id: UiGrant, checked: boolean): void => {
    if (runningRef.current || used || workflowSnapshot.pending) return;
    setSelected((prev) => ({ ...prev, [id]: checked }));
    setPhase("idle");
    setFailure(null);
    setScopeNote(null);
  };

  const approveGrants = async (): Promise<void> => {
    if (runningRef.current) return;
    const grants: GrantKey[] =
      planKind === "B" ? ["internalReschedule"] : selectedKeys(selected);
    if (grants.length === 0) return;
    runningRef.current = true;
    setPhase("running");
    setFailure(null);
    setScopeNote(null);
    try {
      const store = runtime.store;
      const requireOk = <T,>(
        result: { ok: true; data: T } | { ok: false; code: string; reason: string },
      ): T => {
        if (!result.ok) {
          throw new Error(result.code + ": " + result.reason);
        }
        return result.data;
      };

      let snapshot = store.getState();
      const currentIntent = selectWorkflowIntent(snapshot, request);
      if (currentIntent === null) {
        throw new Error(
          request.kind === "none"
            ? "共享状态中没有可用的已保存意图。"
            : "显式意图无效：共享状态中没有与该 intentId 完全一致的已保存意图。",
        );
      }
      const workflowKey = workflowAttemptKey(currentIntent.id, planKind);
      const resumedAttempt = workflow.getSnapshot().pending;
      const resumedStage = await workflow.retryPending(workflowKey);
      if (resumedStage === "selectPlan") { setPhase("idle"); return; }
      snapshot = store.getState();
      const reviewed = resumedStage ? reviewedProposal(snapshot, selectLatestPlanForKind(snapshot, currentIntent.id, planKind)) : proposal;
      assertWorkflowResumeTarget(snapshot, resumedAttempt, reviewed?.plan.id);
      if (needsPreparation) {
        await preparePlan(store, currentIntent.id, planKind);
        setPhase("idle");
        return;
      }
      const { plan: currentPlan } = assertReviewedProposal(snapshot, reviewed);

      snapshot = store.getState();
      const rootChangeSet = assertReviewedProposal(snapshot, reviewed).changeSet;
      if (!approvalPreflight(rootChangeSet.actions, grants).canApprove) {
        throw new Error("当前选择没有可执行动作：请允许所需前置步骤，或返回修改方案。");
      }

      const existingPlanApproval = selectLatestApprovalForPlan(snapshot, currentPlan.id);
      if (
        existingPlanApproval !== null &&
        existingPlanApproval.status === "consumed" &&
        !sameGrantSet(existingPlanApproval.grantedActions, grants)
      ) {
        throw new Error(
          "此方案已存在已消耗的批准（范围：" +
            grantLabels(existingPlanApproval.grantedActions) +
            "），与本次选择不同；不能重复授权，请刷新或重新进入此屏幕以使用已提交的范围。",
        );
      }

      let currentApproval = pickApprovalForPlanGrants(snapshot, currentPlan.id, grants);
      if (currentApproval === null) {
        const data = requireOk(
          await workflow.run(workflowKey, {
            type: "grantApproval",
            commandId:
              "s17-grantApproval-" + currentPlan.id + "-kind" + planKind +
              "-" + grantsSignature(grants),
            entityId: currentPlan.id,
            expectedRevision: currentPlan.revision,
            actor: "user",
            issuedAt: new Date().toISOString(),
            changeSetId: rootChangeSet.id,
            grants,
          }, grants),
        );
        currentApproval = data.approval;
        if (data.approval.planId !== currentPlan.id) {
          throw new Error("grantApproval 返回的批准不属于当前方案，已停止后续步骤。");
        }
        if (data.reduced || data.missingDependencies.length > 0) {
          setScopeNote(
            "已按授权范围做领域依赖归约：" +
              (data.missingDependencies.length > 0
                ? data.missingDependencies.join("；")
                : "部分动作未包含在此批准中"),
          );
        }
      }
      if (
        planKind === "B" &&
        !currentApproval.grantedActions.includes("internalReschedule")
      ) {
        throw new Error("当前批准缺少内部改期授权（internalReschedule），已停止后续步骤。");
      }

      snapshot = store.getState();
      let currentOperation = selectLatestOperationForApproval(snapshot, currentApproval.id);
      if (currentOperation === null) {
        const data = requireOk(
          await workflow.run(workflowKey, {
            type: "startOperation",
            commandId: "s17-startOperation-" + currentApproval.id + "-kind" + planKind,
            entityId: currentApproval.id,
            expectedRevision: currentApproval.revision,
            actor: "user",
            issuedAt: new Date().toISOString(),
            approvalId: currentApproval.id,
          }, grants),
        );
        currentOperation = data.operation;
        if (data.operation.approvalId !== currentApproval.id) {
          throw new Error("startOperation 返回的操作不属于当前批准，已停止后续步骤。");
        }
      }

      const readbackData = requireOk(
        await workflow.run(workflowKey, {
          type: "readbackOperation",
          commandId: "s17-readbackOperation-" + currentOperation.id,
          entityId: currentOperation.id,
          expectedRevision: currentOperation.revision,
          actor: "user",
          issuedAt: new Date().toISOString(),
        }, grants),
      );
      if (readbackData.operation.status !== "verified") {
        throw new Error(
          "读回结果未验证（状态：" + readbackData.operation.status + "），不能视为成功。",
        );
      }
      if (planKind === "B") {
        const ledger = selectFutureDebtLedgerForOperation(
          store.getState(),
          readbackData.operation.id,
        );
        if (ledger === null || !deferReceiptComplete(readbackData.operation)) {
          throw new Error(
            "操作已通过读回验证，但缺少已完成的推迟承诺回执或关联的未来欠账台账记录。",
          );
        }
      }

      setPhase("idle");
    } catch (error) {
      setPhase("failed");
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      runningRef.current = false;
    }
  };

  const completedReceipts =
    operation !== null
      ? operation.stepReceipts.filter((receipt) => receipt.status === "completed")
      : [];
  const hasCompletedCreateDraft = completedReceipts.some(
    (receipt) => receipt.actionKind === "createDraft",
  );
  const opStatus = operation !== null ? operation.status : null;
  const successConfirmed =
    phase === "idle" &&
    opStatus === "verified" &&
    (planKind === "A" || planBCompletionConfirmed(runtime.store.getState(), plan, operation));
  const consumedMismatch =
    persistedApproval !== null &&
    persistedApproval.status === "consumed" &&
    !sameGrantSet(persistedApproval.grantedActions, activeGrants);

  let statusCode: string;
  let statusLine: string;
  if (phase === "running") {
    statusCode = "running";
    statusLine = "共享方案 · 正在执行，等待读回确认…";
  } else if (phase === "failed") {
    statusCode = "failed";
    statusLine = "共享方案 · 执行未完成 · 结果未验证";
  } else if (opStatus === "verified") {
    statusCode = "used";
    statusLine =
      planKind === "B"
        ? "共享方案 · 本次延期授权已使用"
        : "共享方案 · 本次授权已使用";
  } else if (opStatus === "failed") {
    statusCode = "operation-failed";
    statusLine = "共享方案 · 批准已消耗 · 操作未完成";
  } else if (opStatus === "unknown") {
    statusCode = "operation-unknown";
    statusLine = "共享方案 · 批准已消耗 · 结果未知";
  } else if (opStatus !== null) {
    statusCode = "operation-" + opStatus;
    statusLine = "共享方案 · 批准已消耗 · 操作状态：" + opStatus;
  } else if (matchingApproval !== null) {
    statusCode = "approved-pending";
    statusLine = "共享方案 · 已批准 · 待执行";
  } else {
    statusCode = "idle";
    statusLine = "共享方案 · 尚未执行";
  }

  let usedMessage: string | null = null;
  if (phase === "failed") {
    usedMessage =
      operation !== null
        ? "共享运行时执行未完成。此批准可能已消耗，读回确认未完成，不能视为已验证成功；详见下方失败信息。"
        : "共享运行时执行未完成，不能视为已验证成功；详见下方失败信息。";
  } else if (phase === "running") {
    usedMessage = null;
  } else if (opStatus === "verified") {
    usedMessage =
      planKind === "B"
        ? futureDebtLedger !== null
          ? "本次授权已使用。承诺已推迟，未来欠账已记入台账；没有净节省。"
          : null
        : draftRef !== null
          ? "本次授权已使用。草稿待检查，不会自动发送。"
          : "本次授权已使用。未创建草稿。";
  } else if (opStatus === "failed") {
    usedMessage = "本次批准已消耗，但操作未完成，原因见下方。";
  } else if (opStatus === "unknown") {
    usedMessage = "本次批准已消耗，但操作结果未知，不能当作成功。";
  }

  const mismatchNote =
    persistedApproval !== null && matchingApproval === null
      ? persistedApproval.status === "consumed"
        ? "共享运行时已有此方案的已消耗批准（范围：" +
          grantLabels(persistedApproval.grantedActions) +
          "），与当前选择不同；不能重复授权。请刷新或重新进入此屏幕，以使用已提交的范围。"
        : "共享运行时已有此方案的批准记录（范围：" +
          grantLabels(persistedApproval.grantedActions) +
          "；已批准待执行）。授权范围与此记录一致时可复用，不会重复批准。"
      : null;

  return (
    <>
      <p className="s17-version" data-s17-status={statusCode}>
        {statusLine}
      </p>

      <div className="s17-card">
        <ProposalSummary proposal={proposal} used={used} />
        <p className="s17-scope-pill"><ShieldCheck size={17} aria-hidden="true" />允许的范围</p>
        {request.kind === "explicit" && intent !== null ? (
          <p className="s17-empty" data-s17-selected-intent={intent.id}>
            已选择意图 {intent.id} · 原文：{intent.verbatim}
          </p>
        ) : null}
        <ul className="s17-scopes">
          {planKind === "B" ? (
            <li className="s17-scope" data-s17-b-scope="internal-reschedule">
              <span className="s17-scope-text">
                <span className="s17-scope-name">仅内部改期（internalReschedule）</span>
                <span className="s17-scope-desc">把已选承诺移到以后日期并记入未来欠账</span>
              </span>
            </li>
          ) : (
            SCOPES.map((scope) => (
              <li key={scope.id} className="s17-scope">
                <label className="s17-scope-row">
                  <input
                    type="checkbox"
                    aria-label={scope.label}
                    checked={selected[scope.id]}
                    disabled={phase === "running" || used || workflowSnapshot.pending !== null}
                    onChange={(event) => updateGrant(scope.id, event.target.checked)}
                  />
                  <span className="s17-scope-text">
                    <span className="s17-scope-name">{scope.label}</span>
                    <span className="s17-scope-desc">{scope.desc}</span>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>

        {!needsPreparation && preflight && !used && <section aria-label="本次批准的实际动作" aria-live="polite" data-s17-effective-scope>
          <p className="s17-scope-label">本次批准实际会做</p>
          {preflight.canApprove ? <ul className="s17-scopes">
            {preflight.effective.map(action => <li key={action.id} className="s17-scope" data-effective-action={action.kind}>{ACTION_LABELS[action.kind]}</li>)}
          </ul> : <p className="s17-empty">没有可执行动作。仅勾选草稿但未允许读取其前置材料时，不能创建草稿；请调整范围或返回修改方案。</p>}
          {preflight.excluded.length > 0 && <ul className="s17-empty">
            {preflight.excluded.map(action => <li key={action.id} data-excluded-action={action.kind}>
              不执行{ACTION_LABELS[action.kind]}：{action.reason === "permission" ? "未授予此权限" : "缺少前置步骤"}{action.dependencies.length ? "（" + action.dependencies.join("、") + "）" : ""}。
            </li>)}
          </ul>}
        </section>}

        <p className="s17-exclude">
          <LockKeyhole size={18} aria-hidden="true" />
          <span>{planKind === "B"
            ? "不包含：读取材料、创建草稿、外部日历写入、付款或新增承诺。"
            : "不包含：移动会议、发消息、付款或新增承诺。"}</span>
        </p>

        {activeGrants.length === 0 && !used ? (
          <p className="s17-empty">至少允许一项动作，或返回修改方案。</p>
        ) : null}
        {usedMessage !== null ? (
          <p
            className={successConfirmed ? "s17-used" : "s17-empty"}
            role="status"
          >
            {usedMessage}
          </p>
        ) : null}

        {mismatchNote !== null ? (
          <p className="s17-empty" role="status" data-s17-persisted-approval="mismatch">
            {mismatchNote}
          </p>
        ) : null}

        {scopeNote !== null ? (
          <p className="s17-empty" role="status" data-s17-scope-note>
            {scopeNote}
          </p>
        ) : null}

        {phase === "running" ? (
          <p className="s17-empty" role="status" data-runtime-phase="running">
            正在通过共享运行时执行批准：绑定方案批准与操作，并等待读回…
          </p>
        ) : null}

      </div>
        <button
          type="button"
          className="s17-approve"
          disabled={phase === "running" || workflowSnapshot.busy || (!workflowSnapshot.pending && (failure?.startsWith("REVISION_CONFLICT") || used || activeGrants.length === 0 || consumedMismatch || (!needsPreparation && !preflight?.canApprove)))}
          onClick={() => void approveGrants()}
        >
          {workflowSnapshot.pending ? "原样重试未决操作" : needsPreparation ? "准备方案并预览" : APPROVAL_LABELS[preflight?.primary ?? "none"]}
        </button>
        {workflowSnapshot.pending && <p className="s17-empty" role="status">未决操作的授权范围已锁定。重试先确认原命令结果，不重新批准；此恢复仅保留于当前应用运行会话。</p>}

        {phase === "failed" && failure !== null ? (
          <div role="alert" data-runtime-phase="failed">
            <p className="s17-empty">共享运行时执行未完成：{failure}</p>
            {!workflowSnapshot.pending && <p className="s17-empty">若为明确未写入的版本冲突，原授权选择仍保留。请返回方案重新预览后再确认，不会原样死循环重试旧版本。</p>}
            {!workflowSnapshot.pending && intent && <Link className="s17-link" to={mobilePlanHref(intent.id)}>返回方案重新预览</Link>}
            {(!failure.startsWith("REVISION_CONFLICT") || workflowSnapshot.pending) &&
            <button
              type="button"
              className="s17-approve"
              onClick={() => void approveGrants()}
            >
              重试执行
            </button>}
          </div>
        ) : null}
      {operation !== null ? (
        <section
          className="s17-receipts"
          data-operation-id={operation.id}
          data-operation-status={operation.status}
          aria-label="真实执行回执"
        >
          {completedReceipts.map((receipt) => (
            <div
              key={receipt.stepId}
              className="s17-result"
              data-receipt-kind={receipt.actionKind}
            >
              <p className="s17-result">{RECEIPT_LABELS[receipt.actionKind]}：{summarizeReceipt(receipt)}</p>
              <details className="s17-draft-note">
                <summary>原始回执</summary>
                <pre className="s17-draft-text">{receipt.detail}</pre>
              </details>
            </div>
          ))}
          {completedReceipts.length === 0 ? (
            <p className="s17-empty">没有已完成的执行回执。</p>
          ) : null}
          {operation.status === "failed" ? (
            <p className="s17-empty" role="alert">
              操作失败：{operation.lastError ?? "原因未知"}
            </p>
          ) : null}
          {operation.status === "unknown" ? (
            <p className="s17-empty" role="alert">
              操作结果未知：{operation.lastError ?? "原因未知"}
            </p>
          ) : null}
          {planKind === "A" && successConfirmed && draftRef === null ? (
            hasCompletedCreateDraft ? (
              <p
                className="s17-empty"
                role="status"
                data-runtime-boundary="draft-ref-missing"
              >
                操作已验证，但无法通过领域草稿引用（resultRefs）唯一确定草稿，暂不能展示草稿。
              </p>
            ) : (
              <p className="s17-result" role="status">
                操作已通过读回验证。本次授权范围内没有创建草稿。
              </p>
            )
          ) : null}
          {planKind === "B" &&
          opStatus === "verified" &&
          futureDebtLedger === null &&
          phase !== "failed" ? (
            <p className="s17-empty" role="alert" data-s17-b-ledger-missing="true">
              操作已通过读回验证，但未找到关联的未来欠账台账记录；不能视为延期已完成。
            </p>
          ) : null}
          {planKind === "B" && successConfirmed && futureDebtLedger !== null && plan !== null ? (
            <p className="s17-result" role="status" data-s17-b-ledger="recorded">
              未来欠账 {futureDebtLedger.minutes ?? 0} 分钟，生效{" "}
              {formatIsoDateCn(futureDebtLedger.effectiveDate)}。
              {plan.summary.netSavingClaim === "none" ? "没有净节省" : "净节省未经测量"}
              ，也没有写入外部日历。
            </p>
          ) : null}
          {opStatus === "verified" && phase === "failed" ? (
            <p className="s17-empty" role="alert" data-runtime-boundary="readback-unconfirmed">
              读回确认未完成，此屏幕不将结果标示为已验证成功；可重试执行或重新进入此屏幕。
            </p>
          ) : null}
          {successConfirmed && operation.readback !== null ? (
            <p className="s17-draft-note">
              读回验证通过（{operation.readback.items.length} 项比对）。
            </p>
          ) : null}
        </section>
      ) : null}

      {successConfirmed && draft !== undefined && draftRef !== null && operation !== null ? (
        <article
          className="s17-draft"
          data-draft-id={draftRef}
          data-operation-id={operation.id}
        >
          <span className="s17-draft-pill">共享领域草稿 · {{ generating: "生成中", pendingReview: "待检查", partiallyConfirmed: "部分确认", confirmed: "已确认", sent: "已发送", withdrawn: "已撤回" }[draft.status]}</span>
          {draft.sections.map((section) => (
            <div key={section.id} className="s17-draft-section">
              <p className="s17-draft-sources">{section.title}</p>
              <p className="s17-draft-text">{section.content}</p>
            </div>
          ))}
          <p className="s17-draft-note">
            草稿来自共享运行时的真实操作记录，此屏幕暂不支持编辑或撤回；草稿未发送、未提交。
          </p>
          <Link
            className="s17-approve s17-workspace-link"
            data-s17-workspace-link
            to={
              "/workspace?draftId=" +
              encodeURIComponent(draftRef) +
              "&operationId=" +
              encodeURIComponent(operation.id)
            }
          >
            打开工作台
          </Link>
        </article>
      ) : null}
    </>
  );
}

export function S17MAuth(): ReactElement {
  const runtime = useDomainRuntime();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const request = parseExplicitIntentValues(searchParams.getAll("intentId"));
  const planKindRequest = parsePlanKindValues(searchParams.getAll("kind"), false);
  return (
    <MobileChrome time="17:00" active="auth">
      <section className="s17" data-page="s17" aria-label="移动端一次性授权">
        <h1 className="s17-title">只授权这一次。</h1>
        {runtime.status !== "ready" ? (
          <p className="s17-version" data-runtime-state={runtime.status}>
            共享方案
          </p>
        ) : null}
        {runtime.status === "loading" ? (
          <p className="s17-empty" role="status" data-runtime-state="loading">
            正在连接本地领域数据…
          </p>
        ) : null}
        {runtime.status === "unavailable" ? (
          <p className="s17-empty" role="alert" data-runtime-state="unavailable">
            本地领域数据暂不可用：{runtime.reason}。
          </p>
        ) : null}
        {runtime.status === "ready" ? (
          <S17RuntimeAuth
            key={workflowRequestKey(request, planKindRequest)}
            runtime={runtime.runtime}
            request={request}
            planKindRequest={planKindRequest}
          />
        ) : null}
        <p className="s17-disclosure">界面演示 · 非真实账户数据</p>
        <Link
          to={request.kind === "explicit" ? mobilePlanHref(request.intentId) : "/m/plan"}
          className="s17-back"
        >
          返回修改方案
        </Link>
      </section>
    </MobileChrome>
  );
}
