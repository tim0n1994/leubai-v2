import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { resolveAttentionDraftRef } from "../../domain/attentionDraftRef.ts";
import { attentionWorkspaceHref } from "./attentionDraftLink.ts";
import "./s09-attention.css";
import { useDomainState } from "../../data/react.ts";
import type { DomainStore } from "../../domain/store.ts";
import type {
  AttentionItem,
  DeferAttentionCommand,
  DismissAttentionCommand,
  DomainCommand,
  DomainState,
} from "../../domain/types.ts";
import {
  retryDomainRuntime,
  useDomainRuntime,
  type ReadyDomainRuntime,
} from "../../runtime/index.ts";
import {
  attentionDisclosure,
  basisLines,
  excerptBody,
  formatBasisDeadline,
  formatIsoClock,
  isAttentionEmpty,
  parseDeferredDueAt,
  planAttentionRetry,
  selectAttentionGroups,
  selectAttentionItemRef,
  silentTag,
  sourceLabel,
  urgencyLabel,
  verifyDeferReadback,
  verifyDismissReadback,
  type AttentionActionReadback,
  type AttentionRetryPlan,
  type QueueRow,
} from "./attentionSurface.ts";

const DATA_MODE = "fixture" as const;
const RULES_ROUTE = "/boundaries?tab=打扰规则";
const READBACK_UNVERIFIED_CODE = "STORAGE_READBACK_UNVERIFIED";

interface ItemActionError {
  itemId: string;
  itemTitle: string;
  code: string;
  reason: string;
  plan: AttentionRetryPlan;
  command: DomainCommand | null;
  persistedUnknown: boolean;
}

export function AttentionScreen() {
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  return (
    <AttentionRuntime
      key={runtimeEpoch}
      onRetrySettled={() => setRuntimeEpoch((epoch) => epoch + 1)}
    />
  );
}

interface AttentionRuntimeProps {
  onRetrySettled: () => void;
}

function AttentionRuntime({ onRetrySettled }: AttentionRuntimeProps) {
  const runtime = useDomainRuntime(DATA_MODE);
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    void retryDomainRuntime(DATA_MODE).finally(() => {
      setRetrying(false);
      onRetrySettled();
    });
  };

  if (runtime.status === "loading") {
    return (
      <div className="s09" data-page="s09" data-runtime-state="loading">
        <header className="s09-head">
          <h1>少一些声音，重要的仍然可达。</h1>
          <p>正在连接本地领域数据；确认之前不显示任何队列或预算。</p>
        </header>
      </div>
    );
  }
  if (runtime.status === "unavailable") {
    return (
      <div
        className="s09"
        data-page="s09"
        data-runtime-state="unavailable"
        data-runtime-reason={runtime.reason}
      >
        <header className="s09-head">
          <h1>少一些声音，重要的仍然可达。</h1>
        </header>
        <div className="s09-error" role="status">
          <p className="s09-error-title">本地领域数据当前不可读</p>
          <p className="s09-error-reason">原因：{runtime.reason}</p>
          <p className="s09-error-note">
            已保存的数据仍在本地，没有被清除。恢复连接之前，这里不显示队列与预算。
          </p>
          <button
            type="button"
            className="s09-btn-ghost"
            data-runtime-retry="runtime"
            onClick={retry}
            disabled={retrying}
          >
            {retrying ? "正在重试连接…" : "重试连接本地数据"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div data-runtime-state="ready">
      <AttentionReady handle={runtime.runtime} />
    </div>
  );
}

interface AttentionReadyProps {
  handle: ReadyDomainRuntime;
}

function AttentionReady({ handle }: AttentionReadyProps) {
  const store: DomainStore = handle.store;
  const state = useDomainState(store);
  const budget = state.attention.budget;
  const groups = selectAttentionGroups(state);
  const disclosure = attentionDisclosure(budget);
  const empty = isAttentionEmpty(groups);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ItemActionError | null>(null);
  const [detailOpenFor, setDetailOpenFor] = useState<string | null>(null);
  const [deferOpenFor, setDeferOpenFor] = useState<string | null>(null);
  const [deferTargetItem, setDeferTargetItem] = useState<AttentionItem | null>(null);
  const [deferDrafts, setDeferDrafts] = useState<Record<string, string>>({});
  const [deferFieldError, setDeferFieldError] = useState<string | null>(null);
  const [deferNote, setDeferNote] = useState<string | null>(null);
  const attemptRef = useRef(0);

  const busyFor = (itemId: string) => busyKey !== null && busyKey.startsWith(itemId + ":");

  const openDefer = (item: AttentionItem) => {
    setDeferOpenFor((current) => (current === item.id ? null : item.id));
    setDeferTargetItem(item);
  };

  const cancelDefer = () => {
    setDeferOpenFor(null);
    setDeferTargetItem(null);
    setDeferFieldError(null);
  };

  const verifyCommandReadback = (
    command: DomainCommand,
  ): AttentionActionReadback => {
    const storeState = store.getState();
    const persisted = handle.persistence.getState();
    if (command.type === "dismissAttention") {
      if (command.entityId === null) {
        return { ok: false, persistedUnknown: false, reason: "命令缺少条目标识。" };
      }
      const ref = selectAttentionItemRef(storeState, command.entityId);
      return ref === null
        ? { ok: false, persistedUnknown: false, reason: "条目在本地状态中不存在。" }
        : verifyDismissReadback(storeState, persisted, ref);
    }
    if (command.type === "deferAttention") {
      if (command.entityId === null) {
        return { ok: false, persistedUnknown: false, reason: "命令缺少条目标识。" };
      }
      const ref = selectAttentionItemRef(storeState, command.entityId);
      return ref === null
        ? { ok: false, persistedUnknown: false, reason: "条目在本地状态中不存在。" }
        : verifyDeferReadback(storeState, persisted, ref, command.dueAt);
    }
    return { ok: false, persistedUnknown: false, reason: "未知的注意力操作类型。" };
  };

  const runItemAction = (
    item: AttentionItem,
    kind: "dismiss" | "defer",
    dueAt: string | null,
  ) => {
    if (busyKey !== null) return;
    attemptRef.current += 1;
    const base = {
      commandId:
        "s09-" + kind + "-" + item.id + "-r" + item.revision + "-a" + String(attemptRef.current),
      entityId: item.id,
      expectedRevision: item.revision,
      actor: "user" as const,
      issuedAt: new Date().toISOString(),
    };
    const command: DismissAttentionCommand | DeferAttentionCommand =
      kind === "dismiss"
        ? { ...base, type: "dismissAttention" }
        : { ...base, type: "deferAttention", dueAt };
    setBusyKey(item.id + ":" + kind);
    setActionError(null);
    setDeferNote(null);
    void store.execute(command)
      .then((result) => {
      if (!result.ok) {
        setActionError({
          itemId: item.id,
          itemTitle: item.title,
          code: result.code,
          reason: result.reason,
          plan: planAttentionRetry(result.code),
          command,
          persistedUnknown: false,
        });
        return;
      }
      const check = verifyCommandReadback(command);
      if (!check.ok) {
        setActionError({
          itemId: item.id,
          itemTitle: item.title,
          code: READBACK_UNVERIFIED_CODE,
          reason: check.reason,
          plan: "replayExact",
          command,
          persistedUnknown: check.persistedUnknown,
        });
        return;
      }
      if (kind === "defer" && check.dueAtRecorded === false) {
        setDeferNote("已延后；当前数据层没有记录自定义延后时间（该条目不在合并队列中）。");
      }
        if (kind === "defer") {
          setDeferOpenFor(null);
          setDeferTargetItem(null);
        }
      })
      .catch(() => {
        setActionError({
          itemId: item.id,
          itemTitle: item.title,
          code: "RUNTIME_THROWN",
          reason: "执行过程出现异常，无法确认结果是否已保存。",
          plan: "recapture",
          command,
          persistedUnknown: true,
        });
      })
      .finally(() => setBusyKey(null));
  };

  const retryAction = () => {
    const failed = actionError;
    if (failed === null || busyKey !== null) return;
    if (failed.plan === "recapture" || failed.command === null) {
      setActionError(null);
      return;
    }
    const command = failed.command;
    setBusyKey(String(command.entityId ?? "unknown") + ":retry");
    setActionError(null);
    setDeferNote(null);
    void store.execute(command)
      .then((result) => {
      if (!result.ok) {
        setActionError({
          itemId: failed.itemId,
          itemTitle: failed.itemTitle,
          code: result.code,
          reason: result.reason,
          plan: planAttentionRetry(result.code),
          command,
          persistedUnknown: false,
        });
        return;
      }
      const check = verifyCommandReadback(command);
      if (!check.ok) {
        setActionError({
          itemId: failed.itemId,
          itemTitle: failed.itemTitle,
          code: READBACK_UNVERIFIED_CODE,
          reason: check.reason,
          plan: "replayExact",
          command,
          persistedUnknown: check.persistedUnknown,
        });
        return;
      }
      if (command.type === "deferAttention" && check.dueAtRecorded === false) {
        setDeferNote("已延后；当前数据层没有记录自定义延后时间（该条目不在合并队列中）。");
      }
      })
      .catch(() => {
        setActionError({
          itemId: failed.itemId,
          itemTitle: failed.itemTitle,
          code: "RUNTIME_THROWN",
          reason: "执行过程出现异常，无法确认结果是否已保存。",
          plan: "recapture",
          command,
          persistedUnknown: true,
        });
      })
      .finally(() => setBusyKey(null));
  };

  const submitDefer = () => {
    const target = deferTargetItem;
    if (target === null || busyKey !== null) return;
    const parsed = parseDeferredDueAt(deferDrafts[target.id] ?? "");
    if (!parsed.ok) {
      setDeferFieldError(parsed.reason);
      return;
    }
    setDeferFieldError(null);
    runItemAction(target, "defer", parsed.dueAt);
  };

  return (
    <div
      className="s09"
      data-page="s09"
      data-attention-state={empty ? "empty" : "active"}
    >
      <header className="s09-head">
        <h1>少一些声音，重要的仍然可达。</h1>
        <p>外部请求与 AI 建议，共用你设定的注意力预算。</p>
      </header>
      <div className="s09-layout">
        <section className="s09-queue" aria-label="注意力队列">
          <span className="s09-chip">按后果与期限，不按发送者的“紧急”</span>
          <h3 className="s09-kicker">
            <span className="s09-num">01</span>此刻需要你判断
          </h3>
          {groups.judgment.length === 0 ? (
            <p className="s09-empty-line" data-judgment-state="empty">
              现在没有需要你立即判断的条目。这里只显示真实投递的条目，不制造待办。
            </p>
          ) : (
            groups.judgment.map((item) => (
              <AttentionCard
                key={item.id}
                state={state}
                item={item}
                timeZone={budget.timezone}
                busy={busyFor(item.id)}
                actionError={actionError}
                detailOpen={detailOpenFor === item.id}
                deferOpen={deferOpenFor === item.id}
                deferDraft={deferDrafts[item.id] ?? ""}
                deferFieldError={deferOpenFor === item.id ? deferFieldError : null}
                deferTargetRevision={
                  deferTargetItem !== null && deferTargetItem.id === item.id
                    ? deferTargetItem.revision
                    : null
                }
                onToggleDetail={() =>
                  setDetailOpenFor((current) => (current === item.id ? null : item.id))
                }
                onOpenDefer={() => openDefer(item)}
                onCancelDefer={cancelDefer}
                onDeferDraftChange={(value) =>
                  setDeferDrafts((drafts) => ({ ...drafts, [item.id]: value }))
                }
                onSubmitDefer={submitDefer}
                onDismiss={() => runItemAction(item, "dismiss", null)}
                onRetry={retryAction}
                onClearError={() => setActionError(null)}
              />
            ))
          )}
          {deferNote !== null && (
            <p className="s09-empty-line" role="status" data-defer-note="dueat-not-recorded">
              {deferNote}
            </p>
          )}
          <h3 className="s09-kicker">
            <span className="s09-num">02</span>合并到下一次查看
          </h3>
          {groups.queue.length === 0 && groups.silent.length === 0 ? (
            <p className="s09-empty-line" data-later-state="empty">
              现在没有合并或静默的条目。
            </p>
          ) : (
            <ul className="s09-merged">
              {groups.queue.map((row) => {
                const item = row.item;
                return (
                  <QueueLine
                    key={row.entry.id}
                    state={state}
                    row={row}
                    timeZone={budget.timezone}
                    busy={item !== null && busyFor(item.id)}
                    actionError={actionError}
                    detailOpen={item !== null && detailOpenFor === item.id}
                    onToggleDetail={
                      item === null
                        ? null
                        : () => setDetailOpenFor((current) => (current === item.id ? null : item.id))
                    }
                    deferOpen={item !== null && deferOpenFor === item.id}
                    deferDraft={item !== null ? deferDrafts[item.id] ?? "" : ""}
                    deferFieldError={
                      item !== null && deferOpenFor === item.id ? deferFieldError : null
                    }
                    deferTargetRevision={
                      deferTargetItem !== null && item !== null && deferTargetItem.id === item.id
                        ? deferTargetItem.revision
                        : null
                    }
                    onOpenDefer={item === null ? null : () => openDefer(item)}
                    onCancelDefer={cancelDefer}
                    onDeferDraftChange={
                      item === null
                        ? null
                        : (value) => setDeferDrafts((drafts) => ({ ...drafts, [item.id]: value }))
                    }
                    onSubmitDefer={submitDefer}
                    onDismiss={
                      item === null ? null : () => runItemAction(item, "dismiss", null)
                    }
                    onRetry={retryAction}
                    onClearError={() => setActionError(null)}
                  />
                );
              })}
              {groups.silent.map((item) => (
                <SilentLine
                  key={item.id}
                  state={state}
                  item={item}
                  timeZone={budget.timezone}
                  busy={busyFor(item.id)}
                  actionError={actionError}
                  detailOpen={detailOpenFor === item.id}
                  onToggleDetail={() =>
                    setDetailOpenFor((current) => (current === item.id ? null : item.id))
                  }
                  deferOpen={deferOpenFor === item.id}
                  deferDraft={deferDrafts[item.id] ?? ""}
                  deferFieldError={deferOpenFor === item.id ? deferFieldError : null}
                  deferTargetRevision={
                    deferTargetItem !== null && deferTargetItem.id === item.id
                      ? deferTargetItem.revision
                      : null
                  }
                  onOpenDefer={() => openDefer(item)}
                  onCancelDefer={cancelDefer}
                  onDeferDraftChange={(value) =>
                    setDeferDrafts((drafts) => ({ ...drafts, [item.id]: value }))
                  }
                  onSubmitDefer={submitDefer}
                  onDismiss={() => runItemAction(item, "dismiss", null)}
                  onRetry={retryAction}
                  onClearError={() => setActionError(null)}
                />
              ))}
            </ul>
          )}
        </section>
        <aside className="s09-side" aria-label="提醒预算">
          <section className="s09-budget" aria-label="今日预算">
            <h3 className="s09-kicker">
              <span className="s09-num">03</span>你决定主动性的尺度
            </h3>
            <p className="s09-count">
              <span data-remaining>{disclosure.remaining}</span>
              <span className="s09-count-unit">次</span>
            </p>
            <p className="s09-budget-label">今天剩余的主动提醒预算</p>
            <p className="s09-budget-rule" data-budget-max={disclosure.dailyMax}>
              你设定：每天最多 {disclosure.dailyMax} 次非紧急提醒。今日已用{" "}
              {disclosure.used} 次。
            </p>
            <p className="s09-budget-meta" data-budget-day={disclosure.budgetDay}>
              预算日 {disclosure.budgetDay}（{disclosure.timezone}）· 已投递{" "}
              {disclosure.deliveredCount} 条 · 待投递 {disclosure.queueCount} 条。
            </p>
            <div className="s09-divider" role="presentation" />
            <p>真实责任风险单独呈现，不伪装成普通通知。</p>
            <p className="s09-strong">预算不构成遗漏重要承诺的理由。</p>
          </section>
          <section className="s09-noexception" aria-label="预算规则">
            <h3 className="s09-serif">AI 没有例外通道。</h3>
            <p>
              新的建议可以先准备好，不必马上叫你来看。付费推荐也不能购买更高的打扰权限。
            </p>
            <Link className="s09-btn-wide" to={RULES_ROUTE}>
              修改提醒规则
            </Link>
            <p className="s09-note">覆盖：已接入请求；不是全系统通知接管。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

interface AttentionCardProps {
  state: DomainState;
  item: AttentionItem;
  timeZone: string;
  busy: boolean;
  actionError: ItemActionError | null;
  detailOpen: boolean;
  deferOpen: boolean;
  deferDraft: string;
  deferFieldError: string | null;
  deferTargetRevision: number | null;
  onToggleDetail: () => void;
  onOpenDefer: () => void;
  onCancelDefer: () => void;
  onDeferDraftChange: (value: string) => void;
  onSubmitDefer: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onClearError: () => void;
}

function AttentionCard(props: AttentionCardProps) {
  const { item, timeZone } = props;
  const basis = basisLines(item);
  const deadlineText =
    basis.deadline !== null ? formatBasisDeadline(basis.deadline, timeZone) : null;
  const credibleRisk = basis.credible && item.urgency === "risk";
  const error = props.actionError !== null && props.actionError.itemId === item.id
    ? props.actionError
    : null;
  return (
    <article
      className={credibleRisk ? "s09-urgent" : "s09-item"}
      aria-label={credibleRisk ? "有依据的责任风险" : "需要判断的请求"}
      data-attention-item={item.id}
      data-attention-status={item.status}
      data-urgency={item.urgency}
      data-basis-credible={basis.credible ? "true" : "false"}
    >
      <div>
        <h4>{item.title}</h4>
        <p className="s09-meta">
          {credibleRisk
            ? "有依据的期限：" + (deadlineText ?? "未提供") + " · 来源：" + sourceLabel(item.source)
            : urgencyLabel(item.urgency) +
              " · 来源：" +
              sourceLabel(item.source) +
              (deadlineText !== null
                ? " · 声称的期限（未经核实）：" + deadlineText
                : " · 暂无期限依据")}
        </p>
        {credibleRisk && basis.consequence !== null ? (
          <p className="s09-consequence">不查看的可能后果：{basis.consequence}</p>
        ) : null}
        {!basis.credible && item.urgency === "urgentClaim" ? (
          <p className="s09-consequence">
            该条目自称紧急，但没有可核实的期限与后果依据；不按发送者的“紧急”排序处理。
          </p>
        ) : null}
      </div>
      <div className="s09-item-actions">
        <AttentionDraftAction item={item} state={props.state} />
        <button
          type="button"
          className="s09-btn-ghost"
          aria-expanded={props.detailOpen}
          onClick={props.onToggleDetail}
        >
          {props.detailOpen ? "收起详情" : "查看详情"}
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          className="s09-btn-ghost"
          disabled={props.busy}
          onClick={props.onOpenDefer}
        >
          延后
        </button>
        <button
          type="button"
          className="s09-btn-ghost"
          disabled={props.busy}
          onClick={props.onDismiss}
        >
          不再提醒
        </button>
      </div>
      {props.detailOpen ? (
        <div className="s09-diff" data-detail-for={item.id}>
          <p>
            {item.body.trim()
              ? excerptBody(item.body, 200)
              : "该条目没有更多正文。"}
          </p>
          {basis.deadline !== null ? <p>期限依据：{deadlineText ?? "未提供"}</p> : null}
          {basis.consequence !== null ? <p>后果说明：{basis.consequence}</p> : null}
          <p>可信来源：{basis.credible ? "是" : "未核实"}</p>
          <p className="s09-diff-note">
            查看详情不占用提醒预算。
            <AttentionDraftNote item={item} state={props.state} />
          </p>
        </div>
      ) : null}
      {props.deferOpen ? (
        <DeferEditor
          itemId={item.id}
          targetRevision={props.deferTargetRevision}
          draft={props.deferDraft}
          fieldError={props.deferFieldError}
          busy={props.busy}
          onDraftChange={props.onDeferDraftChange}
          onSubmit={props.onSubmitDefer}
          onCancel={props.onCancelDefer}
        />
      ) : null}
      {error !== null ? (
        <ActionErrorBlock
          error={error}
          busy={props.busy}
          onRetry={props.onRetry}
          onClearError={props.onClearError}
        />
      ) : null}
    </article>
  );
}

interface QueueLineProps {
  state: DomainState;
  row: QueueRow;
  timeZone: string;
  busy: boolean;
  actionError: ItemActionError | null;
  detailOpen: boolean;
  onToggleDetail: (() => void) | null;
  deferOpen: boolean;
  deferDraft: string;
  deferFieldError: string | null;
  deferTargetRevision: number | null;
  onOpenDefer: (() => void) | null;
  onCancelDefer: () => void;
  onDeferDraftChange: ((value: string) => void) | null;
  onSubmitDefer: () => void;
  onDismiss: (() => void) | null;
  onRetry: () => void;
  onClearError: () => void;
}

function DeferEditor(props: {
  itemId: string;
  targetRevision: number | null;
  draft: string;
  fieldError: string | null;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="s09-defer" data-defer-for={props.itemId}>
      <label className="s09-defer-field">
        <span>延后到（留空表示不设固定时间）</span>
        <input
          type="datetime-local"
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
        />
      </label>
      {props.fieldError !== null ? (
        <p className="s09-error-reason" role="alert">
          {props.fieldError}
        </p>
      ) : null}
      <div className="s09-defer-actions">
        <button type="button" className="s09-btn-ghost" disabled={props.busy} onClick={props.onSubmit}>
          保存延后
        </button>
        <button type="button" className="s09-btn-ghost" onClick={props.onCancel}>
          取消
        </button>
      </div>
      <p className="s09-diff-note">
        保存使用打开编辑时的条目版本
        {props.targetRevision === null ? "" : " r" + String(props.targetRevision)}
        ；若条目在此期间变化，保存会被拒绝并要求重新读取。延后操作本身不占用提醒预算；已送达条目的已用额度不会退回。
      </p>
    </div>
  );
}

function AttentionDraftAction({ item, state }: { item: AttentionItem; state: DomainState }) {
  const target = resolveAttentionDraftRef(state, item.draftRef);
  const href = attentionWorkspaceHref(target);
  return href === null ? null : (
    <Link className="s09-btn-ghost" data-attention-workspace={item.id} to={href}>
      查看差异<span aria-hidden="true">→</span>
    </Link>
  );
}

function AttentionDraftNote({ item, state }: { item: AttentionItem; state: DomainState }) {
  const target = resolveAttentionDraftRef(state, item.draftRef);
  return <span>{target.ok
    ? "关联到真实草稿" + (target.sectionTitle === null ? "。" : "中的「" + target.sectionTitle + "」。") + "将打开当前已保存内容；没有旧版本时不拼造对照。"
    : target.reason + "这里不拼造旧/新差异。"}</span>;
}

function QueueDetail(props: { item: AttentionItem; timeZone: string; state: DomainState }) {
  const { item } = props;
  const basis = basisLines(item);
  return (
    <div className="s09-diff" data-detail-for={item.id}>
      <p>{item.body.trim() ? item.body : "该条目没有更多正文。"}</p>
      <p>来源：{sourceLabel(item.source)}</p>
      <p className="s09-diff-note"><AttentionDraftNote item={item} state={props.state} /></p>
      <p>
        期限依据：
        {basis.deadline !== null ? formatBasisDeadline(basis.deadline, props.timeZone) : "未提供"}
        {" · "}后果说明：{basis.consequence ?? "未提供"}
        {" · "}可信来源：{basis.credible ? "是" : "未核实"}
      </p>
    </div>
  );
}

function QueueLine(props: QueueLineProps) {
  const { row } = props;
  const { entry, item } = row;
  const dueText =
    entry.dueAt === null
      ? null
      : (formatIsoClock(entry.dueAt, props.timeZone) ?? "已定时");
  const error =
    item !== null && props.actionError !== null && props.actionError.itemId === item.id
      ? props.actionError
      : null;
  return (
    <li data-queue-entry={entry.id} data-queue-item={item === null ? "missing" : item.id}>
      <div>
        <p className="s09-item-title">{entry.title}</p>
        <p className="s09-item-sub">
          {item === null
            ? "对应明细尚未生成；这里不显示猜测内容。"
            : "合并原因：" + entry.reason + " · 来源：" + sourceLabel(item.source)}
        </p>
        {props.detailOpen && item !== null ? (
          <QueueDetail item={item} timeZone={props.timeZone} state={props.state} />
        ) : null}
        {error !== null ? (
          <ActionErrorBlock
            error={error}
            busy={props.busy}
            onRetry={props.onRetry}
            onClearError={props.onClearError}
          />
        ) : null}
      </div>
      <div className="s09-later-side">
        {item !== null ? <AttentionDraftAction item={item} state={props.state} /> : null}
        <span className="s09-tag">
          {dueText === null ? "合并到下一次查看" : dueText + " 合并呈现"}
        </span>
        {item !== null && props.onToggleDetail !== null ? (
          <button
            type="button"
            className="s09-btn-ghost"
            aria-expanded={props.detailOpen}
            onClick={props.onToggleDetail}
          >
            {props.detailOpen ? "收起详情" : "查看详情"}
          </button>
        ) : null}
        {item !== null && props.onOpenDefer !== null ? (
          <button
            type="button"
            className="s09-btn-ghost"
            disabled={props.busy}
            onClick={props.onOpenDefer}
          >
            延后
          </button>
        ) : null}
        {item !== null && props.onDismiss !== null ? (
          <button
            type="button"
            className="s09-btn-ghost"
            disabled={props.busy}
            onClick={props.onDismiss}
          >
            不再提醒
          </button>
        ) : null}
      </div>
    </li>
  );
}

interface SilentLineProps {
  state: DomainState;
  item: AttentionItem;
  timeZone: string;
  busy: boolean;
  actionError: ItemActionError | null;
  detailOpen: boolean;
  onToggleDetail: () => void;
  deferOpen: boolean;
  deferDraft: string;
  deferFieldError: string | null;
  deferTargetRevision: number | null;
  onOpenDefer: () => void;
  onCancelDefer: () => void;
  onDeferDraftChange: (value: string) => void;
  onSubmitDefer: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onClearError: () => void;
}

function SilentLine(props: SilentLineProps) {
  const { item } = props;
  const error =
    props.actionError !== null && props.actionError.itemId === item.id
      ? props.actionError
      : null;
  return (
    <li data-silent-item={item.id} data-attention-status={item.status}>
      <div>
        <p className="s09-item-title">{item.title}</p>
        <p className="s09-item-sub">
          {(item.body.trim() ? excerptBody(item.body, 60) + " · " : "") +
            "来源：" +
            sourceLabel(item.source)}
        </p>
        {props.detailOpen ? <QueueDetail item={item} timeZone={props.timeZone} state={props.state} /> : null}
        {error !== null ? (
          <ActionErrorBlock
            error={error}
            busy={props.busy}
            onRetry={props.onRetry}
            onClearError={props.onClearError}
          />
        ) : null}
      </div>
      <div className="s09-later-side">
        <AttentionDraftAction item={item} state={props.state} />
        <span className="s09-tag">{silentTag(item)}</span>
        <button
          type="button"
          className="s09-btn-ghost"
          aria-expanded={props.detailOpen}
          onClick={props.onToggleDetail}
        >
          {props.detailOpen ? "收起详情" : "查看详情"}
        </button>
        <button
          type="button"
          className="s09-btn-ghost"
          disabled={props.busy}
          onClick={props.onOpenDefer}
        >
          延后
        </button>
        <button
          type="button"
          className="s09-btn-ghost"
          disabled={props.busy}
          onClick={props.onDismiss}
        >
          不再提醒
        </button>
      </div>
    </li>
  );
}

function ActionErrorBlock(props: {
  error: ItemActionError;
  busy: boolean;
  onRetry: () => void;
  onClearError: () => void;
}) {
  const { error } = props;
  return (
    <div
      className="s09-error"
      role="alert"
      data-action-error={error.code}
      data-action-plan={error.plan}
    >
      <p className="s09-error-title">
        {error.code === READBACK_UNVERIFIED_CODE
          ? "读回未确认，未当作已保存"
          : error.persistedUnknown
            ? "结果未确认；不会当作已保存"
          : "操作未完成"}
      </p>
      <p className="s09-error-reason">
        {error.code}：{error.reason}
      </p>
      {error.plan === "replayExact" && error.command !== null ? (
        <button
          type="button"
          className="s09-btn-ghost"
          data-action-retry="exact"
          disabled={props.busy}
          onClick={props.onRetry}
        >
          原样重试同一命令
        </button>
      ) : (
        <button
          type="button"
          className="s09-btn-ghost"
          data-action-retry="recapture"
          onClick={props.onClearError}
        >
          基于最新状态重新操作
        </button>
      )}
    </div>
  );
}
