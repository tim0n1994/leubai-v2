import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Check, CircleDashed, Clock3, Layers, Lock, Moon } from "lucide-react";
import { useDomainState } from "../../data/react.ts";
import type { DomainStore, EntityId } from "../../domain/index.ts";
import { retryDomainRuntime, useDomainRuntime } from "../../runtime/index.ts";
import { buildPlanSurfaceModel } from "./planSurfaces.ts";
import type { PlanCardView, PlanSurfaceModel } from "./planSurfaces.ts";
import "./s04-plan.css";
import { preparePlan } from "./planPreparation.ts";
import { PreparePlanButton } from "./PreparePlanButton.tsx";

export function S04Plan() {
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  return (
    <section className="s04" data-page="s04" aria-label="自适应方案 · 改变方法与分工">
      <S04RuntimeBody
        key={runtimeEpoch}
        onRetrySettled={() => setRuntimeEpoch((epoch) => epoch + 1)}
      />
    </section>
  );
}

function S04RuntimeBody({ onRetrySettled }: { onRetrySettled: () => void }) {
  const runtime = useDomainRuntime();
  const [retrying, setRetrying] = useState(false);
  if (runtime.status === "loading") {
    return (
      <header className="s04-head">
        <h1 className="s04-title">换一种做法，不挤掉自己。</h1>
        <p className="s04-strip" role="status" data-runtime-state="loading">
          正在连接本地领域数据…
        </p>
      </header>
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
      <header className="s04-head">
        <h1 className="s04-title">换一种做法，不挤掉自己。</h1>
        <div data-runtime-state="unavailable">
          <p className="s04-strip" role="status">
            本地领域数据当前不可读：{runtime.reason}。原始数据已保留，未被清除。
          </p>
          <button
            type="button"
            className="s04-primary"
            data-runtime-retry
            onClick={retry}
            disabled={retrying}
          >
            {retrying ? "正在重试连接…" : "重试连接本地数据"}
          </button>
        </div>
      </header>
    );
  }
  return <S04Ready store={runtime.runtime.store} />;
}

function S04Ready({ store }: { store: DomainStore }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useDomainState(store);
  const searchParams = new URLSearchParams(location.search);
  const model: PlanSurfaceModel = buildPlanSurfaceModel(
    state,
    searchParams.getAll("intentId"),
  );
  if (!model.ready) {
    return (
      <>
        <header className="s04-head">
          <h1 className="s04-title">换一种做法，不挤掉自己。</h1>
        </header>
        <div className="s04-grid" data-s04-intent-routing="fail-closed">
          <article className="s04-card" role="alert" data-s04-intent-routing-reason={model.reason}>
            <h2 className="s04-card-title">{model.title}</h2>
            <p className="s04-cta-note">{model.detail}</p>
          </article>
        </div>
      </>
    );
  }
  return (
    <>
      <header className="s04-head">
        <h1 className="s04-title">换一种做法，不挤掉自己。</h1>
        <p className="s04-sub">同一个结果，两条路径。改变的是做法，不是偷偷降低承诺。</p>
      </header>
      <section className="s04-constraints" aria-label="当前约束">
        <div className="s04-capacity">
          <h2>当前约束</h2>
          <p className="s04-strip" data-s04-intent={model.intentId}>{model.capacityHeadline}</p>
        </div>
        <ul className="s04-pills" aria-label="固定约束">
          {model.chips.map((chip) => (
            <li key={chip.kind} className={"s04-pill" + (chip.tone !== "default" ? " is-" + chip.tone : "")}>
              {chip.kind === "meeting" ? <Lock size={14} aria-hidden="true" /> : chip.kind === "delivery" ? <Check size={14} aria-hidden="true" /> : chip.kind === "protected" ? <Moon size={14} aria-hidden="true" /> : null}
              {chip.label}
            </li>
          ))}
        </ul>
      </section>
      <div className="s04-grid">
        <S04PlanCardA
          store={store}
          intentId={model.intentId}
          card={model.cardA}
          onNavigate={navigate}
        />
        <S04PlanCardB store={store} intentId={model.intentId} card={model.cardB} onNavigate={navigate} />
      </div>
      <footer className="s04-foot">
        <p className="s04-foot-note">
          <CircleDashed size={15} aria-hidden="true" />
          估计不是事实。执行期间会更新人工投入，必要时重新检查可行性。
        </p>
      </footer>
    </>
  );
}

function S04Headline({ card }: { card: PlanCardView }) {
  const numeric = card.planId !== null
    ? /^(\d+(?:\.\d+)?)(?: → (\d+(?:\.\d+)?))? 分钟$/u.exec(card.headline)
    : null;
  if (!numeric) {
    return <p className="s04-headline-status">{card.headline}</p>;
  }
  return (
    <p className={"s04-metric" + (card.headlineTone === "delay" ? " is-delay" : "")}>
      <span className="s04-metric-number">{numeric[1]}</span>
      {numeric[2] !== undefined && <>
        <span className="s04-metric-arrow">→</span>
        <span className="s04-metric-number">{numeric[2]}</span>
      </>}
      <span className="s04-metric-unit">分钟</span>
    </p>
  );
}

function S04Subnote({ card }: { card: PlanCardView }) {
  return card.subnote !== null ? <p className="s04-subnote">{card.subnote}</p> : null;
}

function S04PlanCardA({
  store,
  intentId,
  card,
  onNavigate,
}: {
  store: DomainStore;
  intentId: EntityId;
  card: PlanCardView;
  onNavigate: (href: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const runSelect = async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPending(true);
    setError(null);
    try {
      const intent = store.getState().intents[intentId];
      if (!intent || intent.status !== "saved") {
        throw new Error("共享状态中没有这条已保存意图。");
      }
      await preparePlan(store, intent.id, "A");
      onNavigate(card.previewHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      runningRef.current = false;
      setPending(false);
    }
  };

  return (
    <article className="s04-card" aria-label="方案 A · 减少人的投入">
      <span className="s04-card-pill">
        <Layers size={14} aria-hidden="true" />
        方案 A · 减少人的投入
      </span>
      <h2 className="s04-card-title">先准备，再由你判断。</h2>
      <p className="s04-method-note">先整理材料与比较草稿，你从检查开始。关键判断与最终确认仍由你完成。</p>
      <S04Headline card={card} />
      <S04Subnote card={card} />
      <dl className="s04-rows">
        {[...card.rows, ...card.appliedRows].map((row) => (
          <div className="s04-row" key={row.term}>
            <dt>{row.term}</dt>
            <dd className={row.tone === "warm" ? "is-warm" : undefined}>{row.detail}</dd>
          </div>
        ))}
      </dl>
      {card.statusWord !== null ? (
        <p className="s04-cta-note" data-s04-plan-status={card.planStatus ?? "none"}>
          {card.statusWord}
        </p>
      ) : null}
      <div className="s04-cta">
        {card.offer.action === "view" ? (
          <button
            type="button"
            className="s04-primary"
            onClick={() => onNavigate(card.previewHref)}
          >
            {card.offer.label}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        ) : card.offer.action === "blocked" ? (
          <button type="button" className="s04-primary" disabled>
            {card.offer.label}
          </button>
        ) : (
          <button
            type="button"
            className="s04-primary"
            disabled={pending}
            onClick={() => void runSelect()}
          >
            {card.offer.label}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
        {card.offer.note !== null ? (
          <p className="s04-cta-note">{card.offer.note}</p>
        ) : null}
        {pending ? (
          <p className="s04-cta-note" role="status" data-s04-select="running">
            正在根据当前意图生成真实方案与变更集…
          </p>
        ) : null}
        {error !== null ? (
          <div role="alert" data-s04-select="failed">
            <p className="s04-cta-note">方案生成未完成：{error}</p>
            <button
              type="button"
              className="s04-primary"
              disabled={pending}
              onClick={() => void runSelect()}
            >
              重试生成
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function S04PlanCardB({
  store,
  intentId,
  card,
  onNavigate,
}: {
  store: DomainStore;
  intentId: EntityId;
  card: PlanCardView;
  onNavigate: (href: string) => void;
}) {
  return (
    <article className="s04-card" aria-label="方案 B · 把负担移到未来">
      <span className="s04-card-pill is-delay">
        <Clock3 size={14} aria-hidden="true" />
        方案 B · 把负担移到未来
      </span>
      <h2 className="s04-card-title">今天放下，明天仍在。</h2>
      <p className="s04-method-note">调整可变事项的时间，保留原有责任。移到未来的负担不计为节省。</p>
      <S04Headline card={card} />
      <S04Subnote card={card} />
      <dl className="s04-rows">
        {[...card.rows, ...card.appliedRows].map((row) => (
          <div className="s04-row" key={row.term}>
            <dt>{row.term}</dt>
            <dd className={row.tone === "warm" ? "is-warm" : undefined}>{row.detail}</dd>
          </div>
        ))}
      </dl>
      {card.statusWord !== null ? (
        <p className="s04-cta-note" data-s04-plan-status={card.planStatus ?? "none"}>
          {card.statusWord}
        </p>
      ) : null}
      <div className="s04-cta is-column">
        <PreparePlanButton store={store} intentId={intentId} kind="B" offer={card.offer} href={card.previewHref} className="s04-secondary" navigate={onNavigate} />
        <p className="s04-cta-note">不会算作节省时间</p>
        {card.offer.note !== null ? (
          <p className="s04-cta-note">{card.offer.note}</p>
        ) : null}
      </div>
    </article>
  );
}
