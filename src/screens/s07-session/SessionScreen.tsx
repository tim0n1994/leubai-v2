import { useState } from "react";
import "./s07-session.css";

export function SessionScreen() {
  const [showDiff, setShowDiff] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [deferred, setDeferred] = useState(false);

  return (
    <div className="s07" data-page="s07">
      <header className="s07-head">
        <h1>从刚才那个判断继续。</h1>
        <p>恢复的不只是任务名字，而是你上次离开的工作现场。</p>
      </header>
      <div className="s07-layout">
        <section className="s07-checkpoint" aria-label="工作检查点">
          <span className="s07-chip">工作检查点 · 17:26</span>
          <h2 className="s07-serif-lg">你不必再讲一遍。</h2>
          <p className="s07-body">
            上次确认的取舍、正在看的材料、还没有决定的问题，都在这里。
          </p>
          <div className="s07-ring" role="presentation" />
          <div className="s07-checkpoint-foot">
            <p className="s07-serif-md">先完成一个判断。</p>
            <p className="s07-note">不必一次重启整个项目。</p>
          </div>
        </section>
        <section className="s07-restore" aria-label="恢复工作现场">
          <h3 className="s07-kicker">
            <span className="s07-num">01</span>上次停在这里
          </h3>
          <h4 className="s07-serif-md">个人协调层 · 首版范围</h4>
          <div className="s07-confirmed">
            <span className="s07-status-ok">已确认</span>
            <p>不要求迁移整套任务，只接一个真实来源。</p>
          </div>
          <div className="s07-divider" role="presentation" />
          <h3 className="s07-kicker">
            <span className="s07-num">02</span>现在需要你决定
          </h3>
          <h4 className="s07-serif-lg">草稿可以先准备，还是每次都询问?</h4>
          <p className="s07-body">
            当前边界允许整理指定材料，但不允许对外发送。你可以调整准备阶段的主动程度。
          </p>
          <div className="s07-rule-card">
            <p className="s07-rule-title">只在已选来源内，自动准备可撤回草稿</p>
            <p className="s07-rule-note">这是一个候选规则，还没有生效。</p>
          </div>
          <div className="s07-actions">
            <button
              type="button"
              className="s07-btn-primary"
              onClick={() => setShowDiff((v) => !v)}
            >
              查看规则差异
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="s07-btn-ghost"
              onClick={() => setShowDictation((v) => !v)}
            >
              先口述我的想法
            </button>
          </div>
          {showDiff && (
            <ul className="s07-diff" aria-label="规则差异">
              <li>现在：每次准备前都需要你确认。</li>
              <li>候选：只在已选来源内自动准备，随时可撤回。</li>
              <li>边界不变：仍不允许对外发送。</li>
            </ul>
          )}
          {showDictation && (
            <div className="s07-dictation">
              <label htmlFor="s07-dictation-input">口述记录（演示）</label>
              <textarea
                id="s07-dictation-input"
                rows={3}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteSaved(false);
                }}
              />
              <button
                type="button"
                className="s07-btn-ghost s07-save"
                onClick={() => setNoteSaved(true)}
                disabled={note.trim() === ""}
              >
                保存为附注
              </button>
              {noteSaved && (
                <p className="s07-note-strong">
                  已保存为本次附注（演示，仅保留在本页）。
                </p>
              )}
            </div>
          )}
          <div className="s07-defer">
            <button
              type="button"
              className="s07-btn-ghost s07-btn-quiet"
              onClick={() => setDeferred(true)}
            >
              暂不处理
            </button>
            {deferred && <p className="s07-note-strong">已保留。稍后回到这里也可以。</p>}
          </div>
          <div className="s07-divider" role="presentation" />
          <div className="s07-materials">
            <span className="s07-materials-label">相关材料</span>
            <div className="s07-material-chips">
              <span className="s07-chip-plain">方案比较草稿</span>
              <span className="s07-chip-plain">上次的两项确认</span>
            </div>
            <a className="s07-link" href="#records" onClick={(e) => e.preventDefault()}>
              查看完整记录
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
