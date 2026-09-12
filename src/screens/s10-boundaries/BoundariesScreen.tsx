import { useState } from "react";
import "./s10-boundaries.css";

const TABS = ["行动权限", "时间边界", "打扰规则", "暂停与退出"] as const;

type Tab = (typeof TABS)[number];

const ACTION_RULES = [
  {
    title: "读取指定来源",
    desc: "只读工作日历、任务清单与手动选择的文件",
    status: "已授权",
    tone: "ok",
  },
  {
    title: "准备可撤回的草稿",
    desc: "限定材料范围；不代表内容已核验或交付已完成",
    status: "可自动准备",
    tone: "info",
  },
  {
    title: "改写内部计划",
    desc: "只在已授权时段内；不得移动外部约定",
    status: "先预览",
    tone: "muted",
  },
  {
    title: "移动外部会议",
    desc: "涉及他人的时间，必须按共同约定确认",
    status: "每次确认",
    tone: "warm",
  },
  {
    title: "发送消息或提交交付",
    desc: "批准对象与内容；发送不视为可完全撤回",
    status: "每次确认",
    tone: "warm",
  },
  {
    title: "付款、购买与新增承诺",
    desc: "当前未开放；不得从其他许可推导授权",
    status: "未授权",
    tone: "locked",
  },
] as const;

const NAV_GLYPHS: Record<Tab, string> = {
  行动权限: "◎",
  时间边界: "◷",
  打扰规则: "◔",
  暂停与退出: "‖",
};

export function BoundariesScreen() {
  const [tab, setTab] = useState<Tab>("行动权限");
  const [showHistory, setShowHistory] = useState(false);
  const [paused, setPaused] = useState(false);

  return (
    <div className="s10" data-page="s10">
      <header className="s10-head">
        <h1>智能可以学习，边界由你决定。</h1>
        <p>规则不是提示词。每次读取、写入与打扰，都受它约束。</p>
      </header>
      <div className="s10-layout">
        <aside className="s10-rail" aria-label="我的规则">
          <h2>我的规则</h2>
          <nav className="s10-nav" data-rule-nav aria-label="规则分类">
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                className="s10-nav-btn"
                aria-current={tab === name ? "true" : undefined}
                onClick={() => setTab(name)}
              >
                <span className="s10-nav-glyph" aria-hidden="true">
                  {NAV_GLYPHS[name]}
                </span>
                {name}
              </button>
            ))}
          </nav>
          <div className="s10-version">
            <p>规则版本 08</p>
            <p>由你在 09.12 09:10 确认</p>
          </div>
          <p className="s10-railnote">
            AI 可以提出修改建议，但不能自行让它生效。
          </p>
          <button
            type="button"
            className="s10-btn-ghost"
            onClick={() => setShowHistory((v) => !v)}
          >
            查看规则变更记录
            <span aria-hidden="true">→</span>
          </button>
          {showHistory && (
            <p className="s10-history">
              08 · 09.12 09:10 · 由你确认：付款、购买与新增承诺保持未授权
            </p>
          )}
        </aside>
        <section className="s10-panel" aria-label={tab}>
          <header className="s10-panel-head">
            <h2>{tab}</h2>
            {tab === "行动权限" && (
              <span className="s10-chip">本人的规则优先</span>
            )}
          </header>
          {tab === "行动权限" && (
            <div className="s10-rules">
              {ACTION_RULES.map((rule) => (
                <article
                  key={rule.title}
                  className="s10-rule-row"
                  data-rule-row
                >
                  <div>
                    <h3 className="s10-rule-title">{rule.title}</h3>
                    <p className="s10-rule-desc">{rule.desc}</p>
                  </div>
                  <span className={`s10-status s10-status-${rule.tone}`}>
                    {rule.status}
                  </span>
                </article>
              ))}
            </div>
          )}
          {tab === "时间边界" && (
            <div className="s10-tabbody">
              <p className="s10-tabline">今晚 19:00—20:00 已保护。</p>
              <p className="s10-tabnote">与留白时刻共用同一边界。</p>
            </div>
          )}
          {tab === "打扰规则" && (
            <div className="s10-tabbody">
              <p className="s10-tabline">每天最多 2 次非紧急提醒。</p>
              <p className="s10-tabnote">与注意力队列共用同一份预算。</p>
            </div>
          )}
          {tab === "暂停与退出" && (
            <div className="s10-tabbody">
              <p className="s10-tabline">暂停随时可以恢复。</p>
            </div>
          )}
          <div className="s10-pause">
            <div className="s10-pause-info">
              <h3 className="s10-pause-title">暂停全部自动化</h3>
              <p className="s10-pause-note">
                原始事项与未完成责任仍然可见。
              </p>
              {paused && (
                <p className="s10-paused">
                  自动化已暂停：不再读取来源、不再准备草稿。
                </p>
              )}
            </div>
            {paused ? (
              <button
                type="button"
                className="s10-btn-ghost"
                onClick={() => setPaused(false)}
              >
                恢复自动化
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button
                type="button"
                className="s10-btn-primary"
                onClick={() => setPaused(true)}
              >
                立即暂停
                <span aria-hidden="true">‖</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
