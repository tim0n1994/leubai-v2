import { useState } from "react";
import {
  ArrowRight,
  Ban,
  Bookmark,
  Check,
  FileText,
  Lock,
  Mail,
  UserRound,
} from "lucide-react";
import "./s03-inbox.css";

type RequestItem = {
  id: string;
  list: string;
  source: string;
  tag: string;
  title: string;
  meta: string;
  quote: string;
  proposer: string;
};

const REQUESTS: RequestItem[] = [
  {
    id: "r1",
    list: "竞品分析 · 会议提及",
    source: "来源：项目例会摘录",
    tag: "尚未接受",
    title: "三种方案的差异",
    meta: "例会摘录 · 09:32 · 合成示例",
    quote: "下周可以看看三种方案的差异。",
    proposer: "陈同事（演示人物）",
  },
  {
    id: "r2",
    list: "下周碰一次方案",
    source: "来源：邮件 · 陈同事",
    tag: "时间待确认",
    title: "下周碰一次方案",
    meta: "邮件 · 昨天 · 合成示例",
    quote: "下周可以看看三种方案的差异。",
    proposer: "陈同事（演示人物）",
  },
  {
    id: "r3",
    list: "找个晚上练琴",
    source: "来源：自己 · 快捷记录",
    tag: "个人意向",
    title: "找个晚上练琴",
    meta: "快捷记录 · 08:47 · 合成示例",
    quote: "找个晚上练琴，保持手感。",
    proposer: "自己（演示人物）",
  },
];

type Status = { label: string; note: string; tone: "keep" | "accept" | "reject" };

const STATUS_TEXT: Record<string, Status> = {
  keep: { label: "已保留为想法", note: "未成为责任", tone: "keep" },
  accept: { label: "已接受 · 本地责任", note: "未对外发送", tone: "accept" },
  reject: { label: "已排除 · 不进入计划", note: "没有对外回复", tone: "reject" },
};

export function S03Inbox() {
  const [selectedId, setSelectedId] = useState("r1");
  const [actions, setActions] = useState<Record<string, Status>>({});
  const selected = REQUESTS.find((r) => r.id === selectedId) ?? REQUESTS[0];
  const status = actions[selected.id];

  const act = (key: string) => {
    setActions((prev) => ({ ...prev, [selected.id]: STATUS_TEXT[key] }));
  };

  return (
    <section className="s03" data-page="s03" aria-label="收件箱 · 请求不等于承诺">
      <header className="s03-head">
        <h1 className="s03-title">先理解，再成为责任。</h1>
        <p className="s03-sub">把外界的请求放进收件箱，不直接放进你的人生。</p>
      </header>

      <div className="s03-grid">
        <aside className="s03-list" aria-label="待澄清">
          <div className="s03-list-head">
            <h2 className="s03-list-title">待澄清</h2>
            <span className="s03-count">{REQUESTS.length}</span>
          </div>
          <ul className="s03-items">
            {REQUESTS.map((item) => (
              <li
                key={item.id}
                className={item.id === selectedId ? "s03-entry is-on" : "s03-entry"}
              >
                <button
                  type="button"
                  className="s03-entry-btn"
                  aria-pressed={item.id === selectedId}
                  onClick={() => setSelectedId(item.id)}
                >
                  {item.list}
                </button>
                <p className="s03-entry-src">
                  <FileText size={13} aria-hidden="true" />
                  {item.source}
                </p>
                <span className="s03-entry-tag">{item.tag}</span>
              </li>
            ))}
          </ul>
          <div className="s03-list-foot">
            <p className="s03-foot-title">允许一个想法一直只是想法。</p>
            <p className="s03-foot-note">收集，不等于接受。</p>
          </div>
        </aside>

        <article className="s03-detail" aria-label="请求详情">
          <span className="s03-detail-pill">
            <Mail size={14} aria-hidden="true" />
            请求 · 未确认
          </span>
          <h2 className="s03-detail-title">{selected.title}</h2>
          <p className="s03-detail-meta">{selected.meta}</p>
          <blockquote className="s03-quote">
            <span className="s03-quote-label">原话</span>
            <p className="s03-quote-text">“{selected.quote}”</p>
          </blockquote>
          <h3 className="s03-facts-title">影响判断的四件事</h3>
          <dl className="s03-facts">
            <div className="s03-fact">
              <dt>
                <UserRound size={15} aria-hidden="true" />
                提出者
              </dt>
              <dd>{selected.proposer}</dd>
            </div>
            <div className="s03-fact">
              <dt>谁已接受</dt>
              <dd className="is-warm">尚未确认</dd>
            </div>
            <div className="s03-fact">
              <dt>截止期限</dt>
              <dd className="is-warm">尚未约定</dd>
            </div>
            <div className="s03-fact">
              <dt>预计投入</dt>
              <dd className="is-warm">尚未估计</dd>
            </div>
          </dl>
          <p className="s03-detail-note">
            只有你的确认，才会把它变成你的责任。
            系统不会替你回答“我来做”。
          </p>
          {status ? (
            <p className="s03-status" role="status">
              <Check size={15} aria-hidden="true" />
              {status.label}
              <span className="s03-status-note">{status.note}</span>
            </p>
          ) : null}
          <div className="s03-actions">
            <button
              type="button"
              className="s03-primary"
              onClick={() => act("accept")}
            >
              我接受这件事
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="s03-secondary"
              onClick={() => act("keep")}
            >
              <Bookmark size={16} aria-hidden="true" />
              保留为想法
            </button>
            <button
              type="button"
              className="s03-tertiary"
              onClick={() => act("reject")}
            >
              <Ban size={15} aria-hidden="true" />
              不是我的事项
            </button>
          </div>
        </article>

        <div className="s03-side">
          <aside className="s03-panel" aria-label="提取不是承诺">
            <p className="s03-panel-kicker">01 · 提取不是承诺</p>
            <ol className="s03-steps">
              <li className="s03-step">
                <span className="s03-step-dot is-done" aria-hidden="true" />
                <div>
                  <p className="s03-step-title">已提出</p>
                  <p className="s03-step-note">会议中出现的请求</p>
                </div>
              </li>
              <li className="s03-step">
                <span className="s03-step-dot is-current" aria-hidden="true" />
                <div>
                  <p className="s03-step-title">待确认</p>
                  <p className="s03-step-note">系统提取出的候选事项</p>
                </div>
              </li>
              <li className="s03-step">
                <span className="s03-step-dot" aria-hidden="true" />
                <div>
                  <p className="s03-step-title">已接受</p>
                  <p className="s03-step-note">只有你能建立这份责任</p>
                </div>
              </li>
            </ol>
          </aside>

          <aside className="s03-panel" aria-label="AI 只补问必要的问题">
            <h2 className="s03-panel-title">AI 只补问必要的问题。</h2>
            <p className="s03-panel-q">你是否愿意接受这件事？</p>
            <p className="s03-panel-body">
              确定之后，再讨论范围与时间；不要要求先填写一整套项目表格。
            </p>
            <p className="s03-panel-pill">
              <Lock size={14} aria-hidden="true" />
              不自动向任何人发送消息
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
