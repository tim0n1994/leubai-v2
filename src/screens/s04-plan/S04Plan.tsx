import { useNavigate } from "react-router-dom";
import { ArrowRight, CircleDashed, Clock3, Eye, Layers } from "lucide-react";
import "./s04-plan.css";

const CONSTRAINTS = ["会议不动", "交付标准不变", "19:00—20:00 留白", "方案未执行"];

export function S04Plan() {
  const navigate = useNavigate();

  return (
    <section className="s04" data-page="s04" aria-label="自适应方案 · 改变方法与分工">
      <header className="s04-head">
        <h1 className="s04-title">换一种做法，不挤掉自己。</h1>
        <p className="s04-strip">
          19:00 前可用 120 分钟；当前预计投入 130 分钟。
        </p>
        <ul className="s04-pills" aria-label="固定约束">
          {CONSTRAINTS.map((c) => (
            <li key={c} className="s04-pill">
              {c}
            </li>
          ))}
        </ul>
      </header>

      <div className="s04-grid">
        <article className="s04-card" aria-label="方案 A · 减少人的投入">
          <span className="s04-card-pill">
            <Layers size={14} aria-hidden="true" />
            方案 A · 减少人的投入
          </span>
          <h2 className="s04-card-title">先准备，再由你判断。</h2>
          <p className="s04-big">
            60 → 40 分钟
          </p>
          <dl className="s04-rows">
            <div className="s04-row">
              <dt>预计减少人工投入</dt>
              <dd>20 分钟</dd>
            </div>
            <div className="s04-row">
              <dt>19:00 前预计总投入</dt>
              <dd>110 / 120 分钟</dd>
            </div>
            <div className="s04-row">
              <dt>仍需你完成</dt>
              <dd>内容检查与最终确认</dd>
            </div>
          </dl>
          <div className="s04-cta">
            <button
              type="button"
              className="s04-primary"
              onClick={() => navigate("/preview")}
            >
              选择这条路径
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </article>

        <article className="s04-card" aria-label="方案 B · 把负担移到未来">
          <span className="s04-card-pill is-delay">
            <Clock3 size={14} aria-hidden="true" />
            方案 B · 把负担移到未来
          </span>
          <h2 className="s04-card-title">今天放下，明天仍在。</h2>
          <p className="s04-big is-delay">40 分钟</p>
          <dl className="s04-rows">
            <div className="s04-row">
              <dt>预计净节省</dt>
              <dd className="is-warm">没有发生</dd>
            </div>
            <div className="s04-row">
              <dt>19:00 前预计总投入</dt>
              <dd>90 / 120 分钟</dd>
            </div>
            <div className="s04-row">
              <dt>明天新增负担</dt>
              <dd className="is-warm">40 分钟</dd>
            </div>
          </dl>
          <div className="s04-cta is-column">
            <button
              type="button"
              className="s04-secondary"
              onClick={() =>
                navigate("/preview", { state: { variant: "delay" } })
              }
            >
              <Eye size={17} aria-hidden="true" />
              预览延期的影响
            </button>
            <p className="s04-cta-note">不会算作节省时间</p>
          </div>
        </article>
      </div>

      <footer className="s04-foot">
        <p className="s04-foot-note">
          <CircleDashed size={15} aria-hidden="true" />
          估计不是事实。执行期间会更新人工投入，必要时重新检查可行性。
        </p>
      </footer>
    </section>
  );
}
