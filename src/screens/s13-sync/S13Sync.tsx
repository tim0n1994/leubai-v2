import { useEffect, useRef, useState } from "react";
import { CalendarCheck, CloudOff, ExternalLink, RefreshCw } from "lucide-react";
import "./s13-sync.css";

const SOURCES = [
  { name: "工作日历", state: "17:02 已同步", ok: true },
  { name: "任务清单", state: "17:00 已同步", ok: true },
  { name: "个人日历", state: "16:41 后未同步", ok: false },
  { name: "家庭日历", state: "尚未连接", ok: false },
];

export function S13Sync() {
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "failed">(
    "idle",
  );
  const [localMode, setLocalMode] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const retry = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setSyncState("syncing");
    timer.current = window.setTimeout(() => setSyncState("failed"), 1400);
  };

  return (
    <section className="s13" data-page="s13" aria-label="同步异常">
      <header className="s13-head">
        <h1 className="s13-title">不知道的时候，就说不知道。</h1>
        <p className="s13-sub">
          数据未同步不等于没有安排。外部保护未核验，就保持待确认。
        </p>
        <span className="s13-chip">部分来源未同步</span>
      </header>

      <article className="s13-alert">
        <CloudOff size={22} aria-hidden="true" />
        <div>
          <h2 className="s13-alert-title">今晚的保护，尚未完整核验。</h2>
          <p className="s13-alert-body">
            留白中的规则仍然保留。但因为个人日历暂时无法更新，不能确认外部预约是否看见这段不可用时间。
          </p>
        </div>
      </article>

      <div className="s13-grid">
        <article className="s13-card">
          <h2 className="s13-card-title">本地规则仍然有效</h2>
          <p className="s13-card-line">
            19:00—20:00 不接受留白内部的自动填充。
          </p>
        </article>
        <article className="s13-card">
          <h2 className="s13-card-title">外部日历保护待确认</h2>
          <p className="s13-card-line">
            尚未核验闲忙投影与最新冲突。不会显示“已全面保护”。
          </p>
        </article>
      </div>

      <ul className="s13-sources">
        {SOURCES.map((source) => (
          <li key={source.name}>
            <span className="s13-source-name">{source.name}</span>
            <span
              className={
                source.ok ? "s13-source-state is-ok" : "s13-source-state"
              }
            >
              {source.state}
            </span>
          </li>
        ))}
      </ul>

      <p className="s13-note">可以继续，不必假装完整。</p>
      <p className="s13-note">
        暂时使用本地计划时，不会把未知时段分配给新的自动任务；你仍可以在原工具中接管。
      </p>

      <div className="s13-actions">
        <button type="button" className="s13-btn" onClick={retry}>
          <RefreshCw size={15} aria-hidden="true" />
          重新同步与核验
        </button>
        <button type="button" className="s13-btn s13-btn-ghost">
          <ExternalLink size={15} aria-hidden="true" />
          打开原日历
        </button>
        <button
          type="button"
          className="s13-btn s13-btn-ghost"
          disabled={localMode}
          onClick={() => setLocalMode(true)}
        >
          <CalendarCheck size={15} aria-hidden="true" />
          暂用本地计划
        </button>
      </div>

      {syncState === "syncing" ? (
        <p className="s13-live">正在重新同步个人日历并核对冲突。</p>
      ) : null}
      {syncState === "failed" ? (
        <p className="s13-live is-warn">
          最新尝试仍未更新个人日历。保护状态保持待确认。
        </p>
      ) : null}
      {localMode ? (
        <p className="s13-live is-ok">
          已暂用本地计划。未知时段不会分配给新的自动任务。
        </p>
      ) : null}

      <footer className="s13-foot">
        失败记录会保留；重试不会重复创建同一保护事件。
      </footer>
    </section>
  );
}
