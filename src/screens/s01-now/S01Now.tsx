import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock,
  FileText,
  Inbox,
  Lock,
  Sparkles,
} from "lucide-react";
import "./s01-now.css";
import { QuietArtwork } from "../../components/QuietArtwork.tsx";
import { useDomainState } from "../../data/react.ts";
import { retryDomainRuntime, useDomainRuntime, type ReadyDomainRuntime } from "../../runtime/index.ts";
import { ProtectedBlockForm } from "../../components/ProtectedBlockForm.tsx";
import { resolveNowContext } from "./now-context.ts";
import {
  formatCapacityWarning,
  formatMinuteOfDay,
  formatModificationHint,
  selectCapacityView,
  selectDutyCards,
  selectUnscheduledCommitments,
} from "./timeSurfaces.ts";

export function S01Now() {
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  const [searchParams] = useSearchParams();
  return (
    <section className="s01" data-page="s01" aria-label="此刻 · 时间主权">
      <header className="s01-head">
        <h1 className="s01-title">{searchParams.has("intentId") ? "把这段时间，留给自己。" : "把今晚，留给自己。"}</h1>
        <p className="s01-sub">先保留你想要的时间，再决定事情怎样完成。</p>
      </header>
      <S01RuntimeGate
        key={runtimeEpoch}
        onRetrySettled={() => setRuntimeEpoch((epoch) => epoch + 1)}
      />
    </section>
  );
}

function S01RuntimeGate({ onRetrySettled }: { onRetrySettled: () => void }) {
  const runtime = useDomainRuntime("fixture");
  const [retrying, setRetrying] = useState(false);
  if (runtime.status === "loading") {
    return (
      <p className="s01-runtime" role="status" data-runtime-state="loading">
        正在连接本地领域数据…
      </p>
    );
  }
  if (runtime.status === "unavailable") {
    const retry = () => {
      if (retrying) return;
      setRetrying(true);
      void retryDomainRuntime(runtime.dataMode).finally(() => {
        setRetrying(false);
        onRetrySettled();
      });
    };
    return (
      <div className="s01-runtime is-error" data-runtime-state="unavailable">
        <p role="status">
          本地领域数据当前不可读：{runtime.reason}。原始数据已保留，未被清除。
        </p>
        <button
          type="button"
          className="s01-retry"
          data-runtime-retry
          onClick={retry}
          disabled={retrying}
        >
          {retrying ? "正在重试连接…" : "重试连接本地数据"}
        </button>
      </div>
    );
  }
  return (
    <div data-runtime-state="ready">
      <S01Ready handle={runtime.runtime} />
    </div>
  );
}

function S01Ready({ handle }: { handle: ReadyDomainRuntime }) {
  const store = handle.store;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const state = useDomainState(store);
  const context = resolveNowContext(state, searchParams.getAll("intentId"));
  if (!context.ok) {
    return (
      <div className="s01-runtime is-error" data-s01-context-error={context.reason}>
        <p role="alert">无法打开这条意图。{context.detail}</p>
        <button type="button" className="s01-retry" onClick={() => navigate("/capture")}>返回记录</button>
      </div>
    );
  }
  const { date, hero, modification } = context;
  const capacity = selectCapacityView(state, date);
  const duties = selectDutyCards(state, date);
  const unscheduled = selectUnscheduledCommitments(state);
  const warnTone =
    capacity.kind === "deficit" || capacity.kind === "unknown"
      ? "is-warm"
      : "is-ok";
  const sideTitle =
    capacity.kind === "deficit"
      ? "怎样把这" + capacity.gapMinutes + "分钟找回来？"
      : capacity.kind === "unknown"
        ? "先补上未知的投入"
        : "时间已经在容量之内";
  const hasFlexibleDirection = duties.some(
    (item) => item.commitment.mobility === "flexible",
  );
  const protectedInterval = hero.protectedInterval;
  return (
    <>
      <div className="s01-grid" data-s01-intent={context.intentId ?? undefined} data-s01-date={date}>
        <article className="s01-hero" aria-label="你的时间意图" data-protected-block-id={protectedInterval?.blockId}>
          <QuietArtwork className="s01-hero-ring" />
          <p className="s01-kicker">
            <Lock size={14} aria-hidden="true" />
            你的时间意图
          </p>
          <p className="s01-hero-lead">{context.intentId ? date + "，属于你的" : "今晚，属于你的"}</p>
          {protectedInterval ? (
            <p className="s01-hero-time">
              {formatMinuteOfDay(protectedInterval.startMinute)}
              {" — "}
              {formatMinuteOfDay(protectedInterval.endMinute)}
            </p>
          ) : (
            <p className="s01-hero-time" data-protected-missing="true">
              尚未设置
            </p>
          )}
          <p className="s01-hero-note">
            {protectedInterval
              ? protectedInterval.purpose
                ? "用途：" + protectedInterval.purpose + "。不自动填入工作。"
                : "不自动填入工作。暂时没有用途，也成立。"
              : "这一天还没有已保存的保护时段；空白不自动意味着可占用。"}
          </p>
          <p className={"s01-warn " + warnTone} data-capacity-kind={capacity.kind}>
            {capacity.kind === "deficit" || capacity.kind === "unknown" ? (
              <AlertTriangle size={15} aria-hidden="true" />
            ) : (
              <Clock size={15} aria-hidden="true" />
            )}
            {formatCapacityWarning(capacity)}
          </p>
          <div className="s01-hero-actions">
            <button
              type="button"
              className="s01-primary"
              onClick={() => navigate(context.planHref)}
            >
              看看可行的做法
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <span className="s01-action-hint" data-modification-kind={modification.kind}>
              {formatModificationHint(modification.kind)}
            </span>
          </div>
          {!protectedInterval ? (
            <ProtectedBlockForm key={context.intentId ?? "default"} store={store} readPersistedState={() => handle.persistence.readFreshState()} intentId={context.intentId} initialDate={date} />
          ) : null}
        </article>

        <aside className="s01-side" aria-label="容量与建议">
          <p className="s01-side-kicker">01 · 此刻，只需一个决定</p>
          <h2 className="s01-side-title">{sideTitle}</h2>
          <p className="s01-side-note">不是挤掉休息，而是改变完成路径。</p>
          <div className="s01-stats">
            <div className="s01-stat">
              <span className="s01-stat-num">{capacity.capacityMinutes}</span>
              <span className="s01-stat-label">可用时间 / 分钟</span>
            </div>
            <div className="s01-stat">
              <span
                className="s01-stat-num"
                data-effort-unknown={
                  capacity.unknownEffortCount > 0 ? "true" : undefined
                }
              >
                {capacity.unknownEffortCount > 0
                  ? "未知"
                  : capacity.committedKnownMinutes}
              </span>
              <span className="s01-stat-label">当前投入估计 / 分钟</span>
            </div>
          </div>
          {hasFlexibleDirection ? (
            <ul className="s01-options">
              <li className="s01-option">
                <button
                  type="button"
                  className="s01-option-link"
                  data-suggestion="reduce-effort"
                  onClick={() => navigate(context.planHref)}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  <div>
                    <p className="s01-option-title">
                      准备报告草稿，减少从零开始
                    </p>
                    <p className="s01-option-note">
                      预计减少投入，仍需你检查确认；具体数字以方案页计算为准。
                    </p>
                  </div>
                </button>
              </li>
              <li className="s01-option">
                <button
                  type="button"
                  className="s01-option-link"
                  data-suggestion="defer"
                  onClick={() => navigate(context.planHref)}
                >
                  <ArrowRight size={16} aria-hidden="true" />
                  <p className="s01-option-title">
                    或者，把可变事项移到之后的日期
                  </p>
                </button>
              </li>
            </ul>
          ) : (
            <p className="s01-duty-extra">当前没有可重新决定的估计投入。</p>
          )}
        </aside>
      </div>

      <section className="s01-duty" aria-label="没有被悄悄改变的责任">
        <p className="s01-duty-kicker">02 · 没有被悄悄改变的责任</p>
        {duties.length > 0 ? (
          <ul className="s01-duty-list">
            {duties.map((item) => (
              <li
                key={item.commitment.id}
                className="s01-duty-card"
                data-commitment-id={item.commitment.id}
              >
                <div className="s01-duty-head">
                  <span className="s01-duty-icon">
                    {item.icon === "calendar" ? (
                      <Calendar size={18} aria-hidden="true" />
                    ) : item.icon === "file" ? (
                      <FileText size={18} aria-hidden="true" />
                    ) : (
                      <Inbox size={18} aria-hidden="true" />
                    )}
                  </span>
                  <span className="s01-duty-title">
                    {item.commitment.scope ?? "未命名责任"}
                  </span>
                  <span
                    className="s01-duty-minutes"
                    data-effort-unknown={
                      item.commitment.effortEstimateMinutes === null
                        ? "true"
                        : undefined
                    }
                  >
                    {item.minutesLabel}
                    <small>
                      {item.commitment.effortEstimateMinutes === null
                        ? "投入未知"
                        : "分钟"}
                    </small>
                  </span>
                </div>
                <p className="s01-duty-note">{item.note}</p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="s01-duty-empty">
            <p>这一天还没有已保存的责任记录。</p>
            <button
              type="button"
              className="s01-duty-empty-action"
              data-capture-link
              onClick={() => navigate("/capture")}
            >
              去记录一条安排
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        {unscheduled.length > 0 ? (
          <p className="s01-duty-extra">
            另有 {unscheduled.length} 条责任已保存但未安排具体时间。
          </p>
        ) : null}
        <p className="s01-coverage">
          <Clock size={14} aria-hidden="true" />
          覆盖范围以已连接来源为准；其他生活安排仍需你确认。
        </p>
      </section>
    </>
  );
}
