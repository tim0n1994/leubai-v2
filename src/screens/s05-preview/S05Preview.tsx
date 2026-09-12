import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  FileText,
  Minus,
  Plus,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import "./s05-preview.css";

const EXCLUSIONS = ["外部约会", "邮件发送", "付款与购买"];

type Row = { label: string; before: string; after: string; tone: "ok" | "warm" };

const PLAN_ROWS: Row[] = [
  { label: "报告工作草稿", before: "尚未创建", after: "生成 · 待检查", tone: "ok" },
  { label: "报告投入估计", before: "60 分钟", after: "暂估 40 分钟", tone: "ok" },
  { label: "日历、消息与交付", before: "没有变更", after: "仍然没有变更", tone: "ok" },
];

const DELAY_ROWS: Row[] = [
  { label: "行政事项 · 本次处理", before: "今天执行", after: "明天 · 待重新安排", tone: "warm" },
  { label: "预计净节省", before: "130 分钟投入", after: "没有发生", tone: "warm" },
  { label: "边界检查", before: "留白 19:00—20:00", after: "未来仍欠 40 分钟", tone: "warm" },
];

export function S05Preview() {
  const navigate = useNavigate();
  const location = useLocation();
  const isDelay =
    (location.state as { variant?: string } | null)?.variant === "delay";
  const [approved, setApproved] = useState(false);
  const rows = isDelay ? DELAY_ROWS : PLAN_ROWS;

  return (
    <section className="s05" data-page="s05" aria-label="变更预览 · 有限授权">
      <header className="s05-head">
        <span className="s05-pill">
          <ShieldCheck size={14} aria-hidden="true" />
          {isDelay ? "待批准 · 延期版本" : "待批准 · 方案版本 03"}
        </span>
        <h1 className="s05-title">授权这一次，不是以后每一次。</h1>
      </header>

      <div className="s05-grid">
        <div className="s05-main">
          <article className="s05-card" aria-label={isDelay ? "延期影响预览" : "变更对象"}>
            <h2 className="s05-object">{isDelay ? "行政事项" : "准备报告草稿"}</h2>
            <dl className="s05-diff">
              {rows.map((row) => (
                <div className="s05-diff-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>
                    <span className="s05-before">
                      <Minus size={13} aria-hidden="true" />
                      {row.before}
                    </span>
                    <span className={row.tone === "ok" ? "s05-after" : "s05-after is-warm"}>
                      <Plus size={13} aria-hidden="true" />
                      {row.after}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </article>

          <section className="s05-card" aria-label="重新检查条件">
            <h2 className="s05-kicker">
              <RefreshCcw size={15} aria-hidden="true" />
              任何参数改变，都重新检查
            </h2>
            <div className="s05-exclusions">
              <ul className="s05-ex-list" aria-label="不包含的操作">
                {EXCLUSIONS.map((item) => (
                  <li key={item} className="s05-ex-pill">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="s05-ex-note">本次均不包含</p>
            </div>
          </section>
        </div>

        <aside className="s05-side" aria-label="这次允许做什么">
          <h2 className="s05-side-title">这次允许做什么</h2>
          <ul className="s05-allows">
            <li className="s05-allow">
              <Check size={15} aria-hidden="true" />
              读取指定材料
            </li>
            <li className="s05-allow">
              <Check size={15} aria-hidden="true" />
              创建一份本地草稿
            </li>
            <li className="s05-allow">
              <Check size={15} aria-hidden="true" />
              更新内部投入估计
            </li>
          </ul>
          <p className="s05-side-note">不包含发送、提交或移动会议。</p>
          <div className="s05-scope">
            <p className="s05-scope-line">有效范围：本次准备任务</p>
            <p className="s05-scope-sub">
              <CalendarClock size={13} aria-hidden="true" />
              下一次需要新的批准。
            </p>
          </div>
        </aside>
      </div>

      <footer className="s05-actions">
        {approved ? (
          <p className="s05-approved" role="status">
            <FileText size={15} aria-hidden="true" />
            已批准 · 本次准备任务
            <span className="s05-approved-note">尚未执行</span>
          </p>
        ) : (
          <button
            type="button"
            className="s05-primary"
            onClick={() => setApproved(true)}
          >
            批准并准备草稿
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="s05-secondary"
          onClick={() => navigate("/plan")}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          返回修改方案
        </button>
      </footer>
    </section>
  );
}
