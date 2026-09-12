import { useEffect, useState } from "react";
import "./s14-capture.css";

const SENTENCE = "明晚七点到八点留给自己，客户会议别动。";

export function S14Capture() {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <section className="s14" data-page="s14" aria-label="快捷输入">
        <div className="s14-closed">
          <p className="s14-closed-note">
            快捷入口已关闭。可从菜单或分享重新进入。
          </p>
          <button
            type="button"
            className="s14-btn"
            onClick={() => setOpen(true)}
          >
            重新打开快捷入口
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="s14" data-page="s14" aria-label="快捷输入">
      <div className="s14-modal">
        <header className="s14-head">
          <span className="s14-entry">快捷入口</span>
          <span className="s14-esc">ESC 关闭</span>
        </header>
        <h1 className="s14-title">一句话，保留你的原意。</h1>
        <p className="s14-sub">
          轻量输入不意味着草率执行。先理解，再检查可行性。
        </p>

        <label className="s14-field">
          <span className="s14-field-label">用一句话记录</span>
          <textarea
            className="s14-input"
            aria-label="用一句话记录"
            rows={2}
            defaultValue={SENTENCE}
          />
        </label>

        <p className="s14-parse-label">系统理解为</p>
        <div className="s14-cards">
          <article className="s14-card">
            <h2 className="s14-card-title">个人时间意图</h2>
            <p className="s14-card-line">9 月 13 日 · 19:00—20:00</p>
            <p className="s14-card-note">
              当前时区 UTC+8 · 可修改 · 尚未创建日历事件
            </p>
          </article>
          <article className="s14-card">
            <h2 className="s14-card-title">不可擅自改变</h2>
            <p className="s14-card-line">现有客户会议</p>
            <p className="s14-card-note">
              没有自动授予改会或发消息权限。
            </p>
          </article>
        </div>

        <p className="s14-next">
          下一步只检查冲突。需要改变安排时，再向你展示具体差异。
        </p>

        {saved ? (
          <p className="s14-saved">
            已保存为意图。尚未创建日历事件，也不会通知任何人。
          </p>
        ) : null}

        <div className="s14-actions">
          <button type="button" className="s14-btn">
            检查这段时间
          </button>
          <button
            type="button"
            className="s14-btn s14-btn-ghost"
            onClick={() => setSaved(true)}
          >
            只保存为意图
          </button>
          <span className="s14-kbd">⌘ Enter</span>
        </div>

        <p className="s14-foot">
          快速记录 / 自然语言 / 语音 / 分享到留白 · 同一套语义与授权边界
        </p>
      </div>
    </section>
  );
}
