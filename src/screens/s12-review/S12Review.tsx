import { useState } from "react";
import "./s12-review.css";

const BARS = [
  { day: "周一", minutes: 50 },
  { day: "周二", minutes: 60 },
  { day: "周三", minutes: 0 },
  { day: "周四", minutes: 60 },
  { day: "周五", minutes: 70 },
];

const LEDGER = [
  {
    label: "得到保留",
    minutes: "240 分钟",
    note: "是观察结果，不等于产品净节省。",
  },
  {
    label: "未能保住",
    minutes: "40 分钟",
    note: "责任仍在，不能冒充已完成。",
  },
  {
    label: "额外投入",
    minutes: "12 分钟",
    note: "作为成本记录，而不是忽略。",
  },
];

const FEELINGS = ["更有掌控", "差不多", "反而更难", "跳过"];

export function S12Review() {
  const [feeling, setFeeling] = useState<string | null>(null);
  return (
    <section className="s12" data-page="s12" aria-label="时间回顾">
      <header className="s12-head">
        <h1 className="s12-title">记下保留的生活，不夸大节省。</h1>
        <p className="s12-sub">
          本周回顾 · 9 月 7 日—11 日 · 以下均为合成演示数据。
        </p>
      </header>

      <div className="s12-grid">
        <article className="s12-card s12-card-main">
          <p className="s12-badge">由你回顾确认</p>
          <p className="s12-kept">4 段想保留的时间，得到了保留。</p>
          <p className="s12-sum">希望保留 300 分钟 · 实际保留 240 分钟</p>
          <div className="s12-chart" aria-hidden="false">
            {BARS.map((bar) => (
              <div key={bar.day} className="s12-bar-slot">
                <div
                  role="img"
                  aria-label={bar.day + " 保留 " + bar.minutes + " 分钟"}
                  className={
                    bar.minutes === 0 ? "s12-bar is-empty" : "s12-bar"
                  }
                  style={{ height: Math.max(bar.minutes, 4) + "px" }}
                />
                <span className="s12-bar-day">{bar.day}</span>
              </div>
            ))}
          </div>
          <p className="s12-note">周三没有保住，不必把它藏起来。</p>
          <p className="s12-note">
            这不是连胜记录，也不是对生活的评分。
          </p>
        </article>

        <div className="s12-side">
          <article className="s12-card">
            <h2 className="s12-card-title">01 三种时间，分别记账</h2>
            <ul className="s12-ledger">
              {LEDGER.map((row) => (
                <li key={row.label}>
                  <span className="s12-ledger-label">{row.label}</span>
                  <span className="s12-ledger-min">{row.minutes}</span>
                  <span className="s12-ledger-note">{row.note}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="s12-card">
            <h2 className="s12-card-title">02 真正的净节省，尚未测量</h2>
            <p className="s12-note">
              需要比较没有留白时的同类任务，并把监督、纠错与未来负担计入。当前不显示一个看似精确的“省时总数”。
            </p>
          </article>

          <article className="s12-card">
            <p className="s12-ask">这一周，你对自己的时间是否更有掌控?</p>
            <div className="s12-feelings">
              {FEELINGS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="s12-feel-btn"
                  disabled={feeling !== null}
                  onClick={() => setFeeling(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            {feeling !== null ? (
              <p className="s12-thanks">已记录你的感受，谢谢。</p>
            ) : null}
          </article>
        </div>
      </div>
    </section>
  );
}
