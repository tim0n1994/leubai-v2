import { useNavigate } from "react-router-dom";
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

const RESPONSIBILITIES = [
  {
    icon: Calendar,
    title: "已确认会议",
    minutes: "30",
    note: "固定约定 · 不自动移动",
  },
  {
    icon: FileText,
    title: "报告交付",
    minutes: "60",
    note: "19:00 截止 · 标准不变",
  },
  {
    icon: Inbox,
    title: "行政事项",
    minutes: "40",
    note: "个人计划 · 可以重新决定",
  },
];

export function S01Now() {
  const navigate = useNavigate();
  return (
    <section className="s01" data-page="s01" aria-label="此刻 · 时间主权">
      <header className="s01-head">
        <h1 className="s01-title">把今晚，留给自己。</h1>
        <p className="s01-sub">先保留你想要的时间，再决定事情怎样完成。</p>
      </header>

      <div className="s01-grid">
        <article className="s01-hero" aria-label="你的时间意图">
          <div className="s01-hero-ring" aria-hidden="true" />
          <p className="s01-kicker">
            <Lock size={14} aria-hidden="true" />
            你的时间意图
          </p>
          <p className="s01-hero-lead">今晚，属于你的</p>
          <p className="s01-hero-time">19:00 — 20:00</p>
          <p className="s01-hero-note">
            不自动填入工作。暂时没有用途，也成立。
          </p>
          <p className="s01-warn">
            <AlertTriangle size={15} aria-hidden="true" />
            当前计划超出容量 10 分钟
          </p>
          <div className="s01-hero-actions">
            <button
              type="button"
              className="s01-primary"
              onClick={() => navigate("/plan")}
            >
              看看可行的做法
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <span className="s01-action-hint">还没有修改任何安排</span>
          </div>
        </article>

        <aside className="s01-side" aria-label="容量与建议">
          <p className="s01-side-kicker">01 · 此刻，只需一个决定</p>
          <h2 className="s01-side-title">怎样把这十分钟找回来？</h2>
          <p className="s01-side-note">不是挤掉休息，而是改变完成路径。</p>
          <div className="s01-stats">
            <div className="s01-stat">
              <span className="s01-stat-num">120</span>
              <span className="s01-stat-label">可用时间 / 分钟</span>
            </div>
            <div className="s01-stat">
              <span className="s01-stat-num">130</span>
              <span className="s01-stat-label">当前投入估计 / 分钟</span>
            </div>
          </div>
          <ul className="s01-options">
            <li className="s01-option">
              <Sparkles size={16} aria-hidden="true" />
              <div>
                <p className="s01-option-title">
                  准备报告草稿，减少从零开始
                </p>
                <p className="s01-option-note">
                  预计减少 20 分钟，仍需你检查确认。
                </p>
              </div>
            </li>
            <li className="s01-option">
              <ArrowRight size={16} aria-hidden="true" />
              <p className="s01-option-title">或者，把可变事项移到明天</p>
            </li>
          </ul>
        </aside>
      </div>

      <section className="s01-duty" aria-label="没有被悄悄改变的责任">
        <p className="s01-duty-kicker">02 · 没有被悄悄改变的责任</p>
        <ul className="s01-duty-list">
          {RESPONSIBILITIES.map((item) => (
            <li key={item.title} className="s01-duty-card">
              <div className="s01-duty-head">
                <span className="s01-duty-icon">
                  <item.icon size={18} aria-hidden="true" />
                </span>
                <span className="s01-duty-title">{item.title}</span>
                <span className="s01-duty-minutes">
                  {item.minutes}
                  <small>分钟</small>
                </span>
              </div>
              <p className="s01-duty-note">{item.note}</p>
            </li>
          ))}
        </ul>
        <p className="s01-coverage">
          <Clock size={14} aria-hidden="true" />
          覆盖范围：工作日历、任务清单、指定文件。其他生活安排仍需你确认。
        </p>
      </section>
    </section>
  );
}
