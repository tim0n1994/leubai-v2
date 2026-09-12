import { useState } from "react";
import "./s08-blank.css";

export function BlankScreen() {
  const [keptEmpty, setKeptEmpty] = useState(false);
  const [music, setMusic] = useState(false);
  const [explore, setExplore] = useState(false);

  return (
    <div className="s08" data-page="s08">
      <div className="s08-topline">
        <span className="s08-chip">今晚 · 留给自己</span>
        <span className="s08-protected">已接入渠道内受保护</span>
      </div>
      <div className="s08-stage">
        <div className="s08-content">
          <h1>
            这段时间，
            <br />
            不必证明什么。
          </h1>
          <p className="s08-time">19:00 — 20:00</p>
          <p className="s08-note">按你的边界保留。不自动补入下一件事。</p>
          <p className="s08-invite">你可以继续重要的事，也可以什么都不安排。</p>
          <div className="s08-actions">
            <button
              type="button"
              className="s08-btn-primary"
              onClick={() => setKeptEmpty(true)}
            >
              什么也不安排
            </button>
            <button
              type="button"
              className="s08-btn-ghost"
              onClick={() => setMusic(true)}
            >
              继续上次的音乐
            </button>
          </div>
          <button
            type="button"
            className="s08-explore"
            onClick={() => setExplore((v) => !v)}
          >
            更多可能性
            <span aria-hidden="true">→</span>
          </button>
          {keptEmpty && (
            <p className="s08-feedback">好的，这段时间由你决定。</p>
          )}
          {music && (
            <p className="s08-feedback">
              音乐会在这里继续（演示环境不会真正播放）。
            </p>
          )}
          {explore && (
            <div className="s08-possibilities" aria-label="更多可能性">
              <p className="s08-possibility">记下一个想法（只保存在本页演示中）</p>
              <p className="s08-possibility">看看最近保存的一段话</p>
              <p className="s08-possibility">继续什么都不做</p>
              <p className="s08-possibility-note">
                这些只是可能性，不会替你安排。
              </p>
            </div>
          )}
          <p className="s08-promise">不会因为没有选择，而再次提醒你。</p>
        </div>
        <div className="s08-art" role="presentation" />
      </div>
    </div>
  );
}
