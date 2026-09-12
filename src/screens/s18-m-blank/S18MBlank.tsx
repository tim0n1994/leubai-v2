import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { MobileChrome } from "../mobile/MobileChrome";
import "./s18-m-blank.css";

export function S18MBlank() {
  const navigate = useNavigate();
  const [chosen, setChosen] = useState(false);
  return (
    <div data-page="s18">
      <MobileChrome time="19:00" active="">
        <section className="s18" aria-label="移动端留白时刻">
        <header className="s18-top">
          <span className="s18-brand">留白</span>
          <button
            type="button"
            className="s18-exit"
            aria-label="退出留白时刻"
            onClick={() => navigate("/m/now")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <p className="s18-en">A SPACE OF YOUR OWN</p>
        <h1 className="s18-title">这段时间，不必证明什么。</h1>
        <p className="s18-range">19:00—20:00</p>
        <p className="s18-note">不自动填入工作，也不催促你选择。</p>

        <button
          type="button"
          className="s18-quiet"
          disabled={chosen}
          onClick={() => setChosen(true)}
        >
          什么也不安排
        </button>
        {chosen ? (
          <p className="s18-kept">已保留。不会再提醒你做选择。</p>
        ) : null}

        <p className="s18-demo">只保护已接入渠道 · 设计演示</p>
        </section>
      </MobileChrome>
    </div>
  );
}
