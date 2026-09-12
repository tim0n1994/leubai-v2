import { useState } from "react";
import "./s06-workspace.css";

type Judgment = "none" | "agree" | "disagree";

export function WorkspaceScreen() {
  const [judgment, setJudgment] = useState<Judgment>("none");
  const [materialsAdded, setMaterialsAdded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const statusWord = confirmed
    ? "已确认"
    : judgment !== "none"
      ? "部分确认"
      : "待检查";
  const canConfirm = judgment !== "none" && materialsAdded && !confirmed;

  return (
    <div className="s06" data-page="s06">
      <header className="s06-head">
        <h1>让 AI 准备，让判断回到你。</h1>
        <p>草稿不是完成，确认不是发送；每一步有自己的状态。</p>
      </header>
      <div className="s06-layout">
        <article className="s06-doc" aria-label="工作草稿">
          <div className="s06-doc-top">
            <span className="s06-status" data-draft-status="">
              草稿 · {statusWord}
            </span>
            <span className="s06-saved">自动保存于 17:21</span>
          </div>
          <h2 className="s06-doc-title">方案比较 · 工作草稿</h2>
          <p className="s06-goal">
            目标：为下一轮产品方向讨论，保留可核查的取舍依据。
          </p>
          <ul className="s06-sources">
            <li>产品说明（示例）</li>
            <li>访谈节选（示例）</li>
          </ul>
          <section className="s06-section" aria-label="两种路径，不同的负担">
            <h3>
              <span className="s06-num">01</span>两种路径，不同的负担
            </h3>
            <table className="s06-table">
              <thead>
                <tr>
                  <th scope="col">比较项</th>
                  <th scope="col">完整工作台</th>
                  <th scope="col">个人协调层</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">用户首先需要做什么</th>
                  <td>迁入事项，维护新的系统</td>
                  <td>选择来源，提出一个意图</td>
                </tr>
                <tr>
                  <th scope="row">首版需要验证什么</th>
                  <td>替代既有工具的理由</td>
                  <td>减少协调与监督负担</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="s06-section" aria-label="仍然不能下结论的地方">
            <h3>
              <span className="s06-num">02</span>仍然不能下结论的地方
            </h3>
            <p className="s06-body">
              成本数据尚未核对。不能仅凭功能描述，推断任何路径的留存、盈利或长期效果。
            </p>
          </section>
          <p className="s06-demo-note">本文内容为设计演示，不是实际研究结果</p>
        </article>
        <aside className="s06-rail" aria-label="接下来的判断">
          <h3 className="s06-rail-kicker">
            <span className="s06-num">01</span>接下来，只需两个判断
          </h3>
          <section className="s06-block" aria-label="产品切入点判断">
            <h4>先确认产品切入点</h4>
            <p>
              是否以“一个真实场景的协调减负”作为首版，而非替换全部任务工具？
            </p>
            <div className="s06-judgment-actions">
              <button
                type="button"
                className="s06-btn-ghost"
                onClick={() => setJudgment("agree")}
                disabled={judgment !== "none"}
              >
                同意这个取舍
              </button>
              <button
                type="button"
                className="s06-btn-ghost"
                onClick={() => setJudgment("disagree")}
                disabled={judgment !== "none"}
              >
                我有不同判断
              </button>
            </div>
            {judgment === "disagree" && (
              <p className="s06-note-strong">已记录：你对切入点有不同判断。</p>
            )}
            {judgment === "agree" && (
              <p className="s06-note-strong">已记录：你同意以协调减负作为切入点。</p>
            )}
          </section>
          <div className="s06-divider" role="presentation" />
          <section className="s06-block" aria-label="成本材料">
            <h4>成本核对还没有完成</h4>
            <p>缺少可靠成本材料。可以补充文件，或把它保留为待核对事项。</p>
            <button
              type="button"
              className="s06-btn-ghost s06-btn-wide"
              onClick={() => setMaterialsAdded(true)}
              disabled={materialsAdded}
            >
              补充材料
              <span aria-hidden="true">＋</span>
            </button>
            {materialsAdded && (
              <div className="s06-attached">
                <p className="s06-attached-title">成本估算草表（演示）</p>
                <p className="s06-note">材料已登记，仍需人工核对。</p>
              </div>
            )}
          </section>
          <p className="s06-estimate">预计人工检查 12—20 分钟</p>
          <button
            type="button"
            className="s06-btn-primary"
            onClick={() => setConfirmed(true)}
            disabled={!canConfirm}
          >
            确认已检查的内容
            <span aria-hidden="true">→</span>
          </button>
          {!canConfirm && !confirmed && (
            <p className="s06-warn">先完成切入点判断，才能确认已检查的内容。</p>
          )}
          <p className="s06-note-center">确认后仍不会自动发送或提交</p>
          {confirmed && (
            <div className="s06-attached">
              <p className="s06-attached-title">确认之后仍保留的人工判断</p>
              <p className="s06-note">
                成本估算草表尚未核对，保持为待人工核对项；不会自动发送或提交。
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
