import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { MobileChrome } from "../mobile/MobileChrome";
import "./s16-m-plan.css";

export function S16MPlan() {
  const navigate = useNavigate();
  const [planBOpen, setPlanBOpen] = useState(false);
  return (
    <MobileChrome time="17:00" active="plan">
      <section className="s16" data-page="s16" aria-label="移动端自适应方案">
        <h1 className="s16-title">不挤掉自己，换一种做法。</h1>
        <p className="s16-capacity">120 分钟可用 / 130 分钟预计投入</p>

        <article className="s16-card">
          <h2 className="s16-plan-title">方案 A · 先准备，再判断</h2>
          <p className="s16-range">60 → 40 分钟</p>
          <p className="s16-note">
            报告的预计人工投入，包含你检查和修改草稿的时间。
          </p>
          <div className="s16-delta">
            <div>
              <p className="s16-delta-label">预计减少</p>
              <p className="s16-delta-value">20 分钟</p>
            </div>
            <div>
              <p className="s16-delta-label">外部承诺</p>
              <p className="s16-delta-value">不变</p>
            </div>
          </div>
          <p className="s16-note">下一步仅准备草稿，仍需你检查。</p>
        </article>

        <div className="s16-planb">
          <button
            type="button"
            className="s16-planb-toggle"
            aria-expanded={planBOpen}
            onClick={() => setPlanBOpen(!planBOpen)}
          >
            方案 B · 行政事项移到明天
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={planBOpen ? "is-open" : ""}
            />
          </button>
          <p className="s16-planb-static">延期 40 分钟，不算净节省。</p>
          {planBOpen ? (
            <p className="s16-planb-debt">
              未来仍欠 40 分钟，不能显示为节省。
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className="s16-cta"
          onClick={() => navigate("/m/auth")}
        >
          预览方案 A 的授权
        </button>
        <p className="s16-demo">界面演示 · 非真实账户数据</p>
      </section>
    </MobileChrome>
  );
}
