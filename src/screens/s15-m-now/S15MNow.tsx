import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { MobileChrome } from "../mobile/MobileChrome";
import "./s15-m-now.css";

export function S15MNow() {
  const navigate = useNavigate();
  return (
    <div data-page="s15">
      <MobileChrome time="17:00" active="now">
        <section className="s15" aria-label="移动端此刻">
        <p className="s15-date">9 月 12 日 · 星期六</p>
        <h1 className="s15-title">把今晚，留给自己。</h1>

        <article className="s15-card">
          <p className="s15-kicker">你的时间意图</p>
          <p className="s15-range">19:00—20:00</p>
          <p className="s15-note">不自动填满。没有用途，也成立。</p>
          <p className="s15-warn">
            <AlertTriangle size={14} aria-hidden="true" />
            当前计划超出容量 10 分钟
          </p>
        </article>

        <article className="s15-card">
          <h2 className="s15-decide-title">现在，只需一个决定。</h2>
          <p className="s15-decide-lead">换一种做法，保住这一小时。</p>
          <p className="s15-note">
            AI 先准备报告，你从检查开始。预计减少投入，不悄悄降低交付标准。
          </p>
          <button
            type="button"
            className="s15-cta"
            onClick={() => navigate("/m/plan")}
          >
            查看两条路径
          </button>
          <p className="s15-foot-note">
            会议不动 · 期限不变 · 没有执行任何变更
          </p>
        </article>

        <p className="s15-demo">界面演示 · 非真实账户数据</p>
        </section>
      </MobileChrome>
    </div>
  );
}
