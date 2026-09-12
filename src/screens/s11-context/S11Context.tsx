import { useState } from "react";
import { Download, FolderLock, ShieldQuestion } from "lucide-react";
import "./s11-context.css";

const TABS = [
  { id: "intent", label: "我的意图" },
  { id: "sources", label: "事实与来源" },
  { id: "inference", label: "系统推测" },
];

export function S11Context() {
  const [tab, setTab] = useState("intent");
  const [rejected, setRejected] = useState(false);
  return (
    <section className="s11" data-page="s11" aria-label="私人上下文">
      <header className="s11-head">
        <h1 className="s11-title">了解你，不等于占有你。</h1>
        <p className="s11-sub">
          事实、意图与系统推测分开保存。你可以修正，也可以带走。
        </p>
      </header>

      <div className="s11-tablist" role="tablist" aria-label="私人上下文分区">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={
              tab === item.id ? "s11-tab is-active" : "s11-tab"
            }
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="s11-grid">
        <article className="s11-panel">
          <p className="s11-panel-kicker">最近想留给自己的时间</p>
          <p className="s11-badge">由你明确表达 · 可修改、暂停或删除</p>
          <div className="s11-card">
            <p className="s11-card-line">
              工作日晚上，保留一段不被工作填满的时间。
            </p>
            <p className="s11-card-line">
              最近想重新做音乐，但不要变成新的考核。
            </p>
            <p className="s11-card-src">来源：本人确认 · 09.11 20:10</p>
          </div>
        </article>

        <article className="s11-panel">
          <p className="s11-panel-kicker">已接入的来源与范围</p>
          <p className="s11-badge">02 已选择的来源</p>
          <ul className="s11-sources">
            <li>
              <span>日历（只读）</span>
              <span className="s11-src-state">只读 · 17:00 已同步</span>
            </li>
            <li>
              <span>文档摘要</span>
              <span className="s11-src-state">
                读取与内部规划 · 17:00 已同步
              </span>
            </li>
            <li>
              <span>本次任务引用</span>
              <span className="s11-src-state">仅本次任务可用</span>
            </li>
            <li>
              <span>社交与浏览历史</span>
              <span className="s11-src-state is-off">
                未接入 · 不能推断没有安排
              </span>
            </li>
          </ul>
          <p className="s11-note">随时收回未来的访问。</p>
          <p className="s11-note">
            撤销权限会停止后续读取；已经传出的副本不能被假定全部收回。
          </p>
          <div className="s11-actions">
            <button type="button" className="s11-btn">
              <FolderLock size={15} aria-hidden="true" />
              管理来源权限
            </button>
            <button type="button" className="s11-btn s11-btn-ghost">
              <Download size={15} aria-hidden="true" />
              导出我的记录
            </button>
          </div>
        </article>

        <article className="s11-panel">
          <p className="s11-panel-kicker">01 一个尚未确认的推测</p>
          <div className="s11-card">
            <p className="s11-card-line">你可能更愿意从修改草稿开始。</p>
            <p className="s11-note">
              依据：最近两次写作中的选择。样本很少，不代表稳定偏好，更不代表人格判断。
            </p>
            <p className="s11-card-src">系统推测 · 7 天后重新检查</p>
          </div>
          {rejected ? (
            <p className="s11-reject-note">
              已标记为不准确。这条推测不会再被默默套用。
            </p>
          ) : null}
          <div className="s11-actions">
            <button type="button" className="s11-btn">
              这对我大致成立
            </button>
            <button
              type="button"
              className="s11-btn s11-btn-ghost"
              disabled={rejected}
              onClick={() => setRejected(true)}
            >
              并不准确
            </button>
            <button type="button" className="s11-btn s11-btn-ghost">
              <ShieldQuestion size={15} aria-hidden="true" />
              删除这条推测
            </button>
          </div>
        </article>
      </div>

      <footer className="s11-foot">
        不把点击、接受率或使用时长当作你的生活目标。
      </footer>
    </section>
  );
}
