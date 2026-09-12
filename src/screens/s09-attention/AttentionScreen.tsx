import { useState } from "react";
import "./s09-attention.css";

export function AttentionScreen() {
  const [dailyMax, setDailyMax] = useState(2);
  const [usedToday] = useState(1);
  const [showDiff, setShowDiff] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const remaining = dailyMax - usedToday;

  return (
    <div className="s09" data-page="s09">
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
          <article className="s09-urgent" aria-label="需要判断的请求">
            <div>
              <h4>交付材料有更新，可能影响正在确认的报告</h4>
              <p className="s09-meta">
                有依据的期限：19:00 · 来源：你指定的工作材料
              </p>
              <p className="s09-consequence">
                不查看的可能后果：沿用旧材料中的成本说明。
              </p>
            </div>
            <button
              type="button"
              className="s09-btn-ghost"
              onClick={() => setShowDiff((v) => !v)}
            >
              查看差异
              <span aria-hidden="true">→</span>
            </button>
          </article>
          {showDiff && (
            <div className="s09-diff" aria-label="材料差异">
              <p>旧：沿用成本说明（未核对）</p>
              <p>新：材料已更新，成本说明需要重新核对</p>
              <p className="s09-diff-note">查看差异不占用提醒预算。</p>
            </div>
          )}
          <h3 className="s09-kicker">
            <span className="s09-num">02</span>合并到下一次查看
          </h3>
          <ul className="s09-merged">
            <li>
              <div>
                <p className="s09-item-title">三个非紧急请求</p>
                <p className="s09-item-sub">两条会议候选时间 · 一条材料补充</p>
              </div>
              <span className="s09-tag">18:30 合并呈现</span>
            </li>
            <li>
              <div>
                <p className="s09-item-title">一份明日准备摘要</p>
                <p className="s09-item-sub">AI 已默默准备，没有触发提醒</p>
              </div>
              <span className="s09-tag">留在协同工作台</span>
            </li>
            <li>
              <div>
                <p className="s09-item-title">可选的周末活动建议</p>
                <p className="s09-item-sub">与你最近的方向有关；没有真实期限</p>
              </div>
              <span className="s09-tag">不主动打断</span>
            </li>
          </ul>
        </section>
        <aside className="s09-side" aria-label="提醒预算">
          <section className="s09-budget" aria-label="今日预算">
            <h3 className="s09-kicker">
              <span className="s09-num">03</span>你决定主动性的尺度
            </h3>
            <p className="s09-count">
              <span data-remaining>{remaining}</span>
              <span className="s09-count-unit">次</span>
            </p>
            <p className="s09-budget-label">今天剩余的主动提醒预算</p>
            <p className="s09-budget-rule">你设定：每天最多 {dailyMax} 次非紧急提醒。</p>
            <div className="s09-divider" role="presentation" />
            <p>真实责任风险单独呈现，不伪装成普通通知。</p>
            <p className="s09-strong">预算不构成遗漏重要承诺的理由。</p>
          </section>
          <section className="s09-noexception" aria-label="预算规则">
            <h3 className="s09-serif">AI 没有例外通道。</h3>
            <p>
              新的建议可以先准备好，不必马上叫你来看。付费推荐也不能购买更高的打扰权限。
            </p>
            <button
              type="button"
              className="s09-btn-wide"
              onClick={() => setShowRules((v) => !v)}
            >
              修改提醒规则
            </button>
            {showRules && (
              <div className="s09-rules" aria-label="提醒规则">
                <p className="s09-rules-used">
                  今日已用 {usedToday} 次 · 均为真实责任风险。
                </p>
                <p className="s09-rules-current">
                  当前规则：每天最多 {dailyMax} 次非紧急提醒。
                </p>
                <button
                  type="button"
                  className="s09-btn-ghost"
                  onClick={() => setDailyMax((m) => m + 1)}
                >
                  增加提醒上限
                </button>
              </div>
            )}
            <p className="s09-note">覆盖：已接入请求；不是全系统通知接管。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
