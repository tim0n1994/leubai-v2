import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useDomainState } from "../../data/react.ts";
import type { DomainStore } from "../../domain/index.ts";
import { retryDomainRuntime, useDomainRuntime } from "../../runtime/index.ts";
import { MobileChrome } from "../mobile/MobileChrome";
import { formatIsoDateCn } from "../s01-now/timeSurfaces.ts";
import {
  buildPlanSurfaceModel,
  formatMobileCapacityStrip,
  mobileAuthHref,
} from "../s04-plan/planSurfaces.ts";
import type { PlanCardView, PlanSurfaceModel } from "../s04-plan/planSurfaces.ts";
import "./s16-m-plan.css";
import { PreparePlanButton } from "../s04-plan/PreparePlanButton.tsx";

export function S16MPlan() {
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  return (
    <MobileChrome time="17:00" active="plan">
      <S16RuntimeBody
        key={runtimeEpoch}
        onRetrySettled={() => setRuntimeEpoch((epoch) => epoch + 1)}
      />
    </MobileChrome>
  );
}

function S16RuntimeBody({ onRetrySettled }: { onRetrySettled: () => void }) {
  const runtime = useDomainRuntime("fixture");
  const [retrying, setRetrying] = useState(false);
  if (runtime.status === "loading") {
    return (
      <section className="s16" data-page="s16" aria-label="移动端自适应方案">
        <p className="s16-note" role="status" data-runtime-state="loading">
          正在连接本地领域数据…
        </p>
      </section>
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
      <section className="s16" data-page="s16" aria-label="移动端自适应方案">
        <p className="s16-note" role="status" data-runtime-state="unavailable">
          本地领域数据当前不可读：{runtime.reason}。原始数据已保留，未被清除。
        </p>
        <button
          type="button"
          className="s16-cta"
          data-runtime-retry
          onClick={retry}
          disabled={retrying}
        >
          {retrying ? "正在重试连接…" : "重试连接本地数据"}
        </button>
      </section>
    );
  }
  return <S16Ready store={runtime.runtime.store} />;
}

function planBDebtLine(card: PlanCardView): { state: string; text: string } {
  if (card.planId === null) {
    return { state: "none", text: card.emptyNote ?? "还没有已保存的方案 B。" };
  }
  if (card.remainingFutureDebtMinutes !== null) {
    return {
      state: "debt-recorded",
      text:
        "未来仍欠 " +
        card.remainingFutureDebtMinutes +
        " 分钟（账本估计），不能显示为节省。",
    };
  }
  if (card.applied) {
    return {
      state: "applied-no-ledger",
      text: "方案显示已应用，但账本中还没有对应的未来欠账记录；以账本为准。",
    };
  }
  return {
    state: "pending",
    text:
      "若批准并执行，这 " + card.headline + " 会记入未来欠账；不算净节省。",
  };
}

function S16Ready({ store }: { store: DomainStore }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useDomainState(store);
  const [planBOpen, setPlanBOpen] = useState(false);
  const searchParams = new URLSearchParams(location.search);
  const model: PlanSurfaceModel = buildPlanSurfaceModel(
    state,
    searchParams.getAll("intentId"),
  );
  if (!model.ready) {
    return (
      <section className="s16" data-page="s16" aria-label="移动端自适应方案">
        <h1 className="s16-title">不挤掉自己，<br />换一种做法。</h1>
        <p
          className="s16-note"
          role="alert"
          data-s16-intent-routing="fail-closed"
          data-s16-intent-routing-reason={model.reason}
        >
          {model.detail}
        </p>
      </section>
    );
  }
  const cardA = model.cardA;
  const cardB = model.cardB;
  const debt = planBDebtLine(cardB);
  const comparison = /^(\d+) → (\d+) 分钟$/.exec(cardA.headline);
  return (
    <section className="s16" data-page="s16" aria-label="移动端自适应方案">
      <h1 className="s16-title">不挤掉自己，<br />换一种做法。</h1>
      <p className="s16-capacity" data-s16-intent={model.intentId}>
        {formatMobileCapacityStrip(model.capacity)}
      </p>

      <article className="s16-card" aria-label="方案 A · 先准备，再判断">
        <h2 className="s16-plan-title">方案 A · 先准备，再判断</h2>
        <p className={comparison ? "s16-range is-comparison" : "s16-range"}>{comparison ? <><span>{comparison[1]}</span><span className="s16-range-arrow">→</span><span>{comparison[2]}</span><span className="s16-range-unit">分钟</span></> : cardA.headline}</p>
        {cardA.subnote !== null ? (
          <p className="s16-note">{cardA.subnote}</p>
        ) : (
          <p className="s16-note">{cardA.emptyNote}</p>
        )}
        <div className="s16-delta">
          <div>
            <p className="s16-delta-label">预计减少</p>
            <p className="s16-delta-value" data-s16-plan-a-reduction>
              {cardA.estimateReductionMinutes === null
                ? "以变更集为准"
                : cardA.estimateReductionMinutes + " 分钟"}
            </p>
          </div>
          <div>
            <p className="s16-delta-label">外部承诺</p>
            <p className="s16-delta-value" data-s16-plan-a-external>
              {cardA.externalCommitmentUnchanged ? "不变" : "以变更集为准"}
            </p>
          </div>
        </div>
        {cardA.appliedRows.map((row) => (
          <p className="s16-note" key={row.term}>
            {row.term}：{row.detail}
          </p>
        ))}
        {cardA.statusWord !== null ? (
          <p className="s16-note" data-s16-plan-status={cardA.planStatus ?? "none"}>
            {cardA.statusWord}
          </p>
        ) : null}
        <p className="s16-note">下一步仅准备草稿，仍需你检查。</p>
      </article>

      <div className="s16-planb">
        <button
          type="button"
          className="s16-planb-toggle"
          aria-expanded={planBOpen}
          onClick={() => setPlanBOpen(!planBOpen)}
        >
          方案 B · 行政事项移到以后
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={planBOpen ? "is-open" : ""}
          />
        </button>
        {cardB.planId !== null ? (
          <p className="s16-planb-static" data-s16-plan-b-headline>
            {cardB.deferToDate !== null
              ? "延期到 " + formatIsoDateCn(cardB.deferToDate) + "，"
              : "延期 "}
            {cardB.headline}，不算净节省。
          </p>
        ) : (
          <p className="s16-planb-static" data-s16-plan-b-headline>
            {cardB.emptyNote}
          </p>
        )}
        {planBOpen ? (
          <>
            <p className="s16-planb-debt" data-s16-planb-state={debt.state}>
              {debt.text}
            </p>
            <PreparePlanButton store={store} intentId={model.intentId} kind="B" offer={cardB.offer} href={mobileAuthHref(model.intentId, "B")} className="s16-cta s16-planb-auth" navigate={navigate} />
          </>
        ) : null}
      </div>

      <PreparePlanButton store={store} intentId={model.intentId} kind="A" offer={cardA.offer} href={mobileAuthHref(model.intentId, "A")} className="s16-cta" navigate={navigate} />
      <p className="s16-demo">界面演示 · 非真实账户数据</p>
    </section>
  );
}
