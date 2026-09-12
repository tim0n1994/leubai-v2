import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  AlertTriangle,
  ArrowRight,
  Clock,
  FileText,
  Inbox,
  Lock,
} from "lucide-react";
import "./s02-ledger.css";

const HOURS = [
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
];

export function S02Ledger() {
  const navigate = useNavigate();
  const [view, setView] = useState<"today" | "week">("today");
  return (
    <section className="s02" data-page="s02" aria-label="时间账本 · 责任与边界">
      <header className="s02-head">
        <h1 className="s02-title">时间有去向，也有边界。</h1>
        <p className="s02-sub">
          固定约定、可变计划与留白分开记录；空白不自动意味着可占用。
        </p>
      </header>

      <div className="s02-grid">
        <article className="s02-board" aria-label="9月12日 时间安排">
          <div className="s02-board-head">
            <h2 className="s02-date">9月12日</h2>
            <div className="s02-toggle" role="group" aria-label="时间范围">
              <button
                type="button"
                aria-pressed={view === "today"}
                className={view === "today" ? "is-on" : ""}
                onClick={() => setView("today")}
              >
                今日
              </button>
              <button
                type="button"
                aria-pressed={view === "week"}
                className={view === "week" ? "is-on" : ""}
                onClick={() => setView("week")}
              >
                本周
              </button>
            </div>
            <span className="s02-tz">
              <Clock size={14} aria-hidden="true" />
              当前时区 · UTC+8
            </span>
          </div>

          {view === "today" ? (
            <div className="s02-table">
              <div className="s02-cols" aria-hidden="true">
                <span>时间</span>
                <span>安排与责任</span>
                <span>你选择的边界</span>
              </div>
              <div className="s02-track-wrap">
                <div className="s02-hours">
                  {HOURS.map((h) => (
                    <span key={h}>{h}</span>
                  ))}
                </div>
                <div className="s02-track" aria-hidden="true">
                  {HOURS.map((h, i) => (
                    <span
                      key={h}
                      className="s02-gridline"
                      style={{ top: `${(i / (HOURS.length - 1)) * 100}%` }}
                    />
                  ))}
                  <span className="s02-boundary" style={{ top: "57.14%" }} />
                  <div className="s02-blocks">
                    <div className="s02-block is-meeting" style={{ top: 0, height: 61 }}>
                      <p className="s02-block-title">
                        已确认会议
                        <Lock size={14} aria-hidden="true" />
                      </p>
                      <p className="s02-block-meta">30 分钟 · 固定约定</p>
                    </div>
                    <div className="s02-block is-report" style={{ top: 61, height: 123 }}>
                      <p className="s02-block-title">报告交付</p>
                      <p className="s02-block-meta">预计投入 60 分钟</p>
                      <span className="s02-chip">19:00 前提交</span>
                    </div>
                    <div className="s02-block is-admin" style={{ top: 184, height: 82 }}>
                      <p className="s02-block-title">行政事项</p>
                      <p className="s02-block-meta">40 分钟 · 暂定计划</p>
                    </div>
                    <p className="s02-overwarn">
                      <AlertTriangle size={14} aria-hidden="true" />
                      超出边界 10 分钟
                    </p>
                  </div>
                </div>
                <div className="s02-edge">
                  <div className="s02-blank" style={{ top: 246 }}>
                    <p className="s02-blank-title">
                      <Lock size={14} aria-hidden="true" />
                      受保护的留白
                    </p>
                    <p className="s02-blank-time">19:00—20:00</p>
                    <p className="s02-blank-note">没有用途，也不接受自动填充。</p>
                  </div>
                </div>
              </div>
              <p className="s02-board-note">
                需要改变完成路径，或由你重新决定可变事项。
              </p>
            </div>
          ) : (
            <div className="s02-week" role="status">
              <p className="s02-week-empty">本周还没有可核验的汇总。</p>
              <p className="s02-week-src">数据来源：工作日历、任务清单。</p>
            </div>
          )}
        </article>

        <div className="s02-side">
          <aside className="s02-panel" aria-label="今天的容量">
            <p className="s02-panel-kicker">01 · 今天的容量</p>
            <dl className="s02-rows">
              <div className="s02-row">
                <dt>19:00 前可用</dt>
                <dd>120 分钟</dd>
              </div>
              <div className="s02-row">
                <dt>当前预计投入</dt>
                <dd>130 分钟</dd>
              </div>
              <div className="s02-row is-gap">
                <dt>容量缺口</dt>
                <dd>10 分钟</dd>
              </div>
            </dl>
          </aside>

          <aside className="s02-panel" aria-label="每件事都保留来源">
            <p className="s02-panel-kicker">02 · 每件事都保留来源</p>
            <dl className="s02-rows">
              <div className="s02-row">
                <dt>
                  <Calendar size={15} aria-hidden="true" />
                  工作日历
                </dt>
                <dd className="is-ok">17:00 已同步</dd>
              </div>
              <div className="s02-row">
                <dt>
                  <FileText size={15} aria-hidden="true" />
                  任务清单
                </dt>
                <dd className="is-ok">17:00 已同步</dd>
              </div>
              <div className="s02-row">
                <dt>
                  <Inbox size={15} aria-hidden="true" />
                  其他安排
                </dt>
                <dd className="is-miss">未覆盖</dd>
              </div>
            </dl>
          </aside>

          <aside className="s02-panel is-action" aria-label="移动，不等于节省">
            <h2 className="s02-panel-title">移动，不等于节省。</h2>
            <p className="s02-panel-body">
              如果把工作移到明天，今天会更宽裕，但未来责任仍在。
            </p>
            <button
              type="button"
              className="s02-primary"
              onClick={() => navigate("/plan")}
            >
              查看可行方案
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </aside>
        </div>
      </div>
    </section>
  );
}
