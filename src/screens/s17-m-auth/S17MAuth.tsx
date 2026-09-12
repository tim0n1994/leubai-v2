import { useState } from "react";
import { Link } from "react-router-dom";
import { MobileChrome } from "../mobile/MobileChrome";
import "./s17-m-auth.css";

const SCOPES = [
  {
    id: "read",
    label: "读取两份指定材料",
    desc: "不扩展到全部文件与邮件",
  },
  {
    id: "draft",
    label: "创建待检查的草稿",
    desc: "不代表已完成或已发送",
  },
  {
    id: "estimate",
    label: "更新内部投入估计",
    desc: "暂估 40 分钟，允许修正",
  },
];

export function S17MAuth() {
  const [granted, setGranted] = useState<Record<string, boolean>>({
    read: true,
    draft: true,
    estimate: true,
  });
  const [used, setUsed] = useState(false);
  const grantedCount = SCOPES.filter((scope) => granted[scope.id]).length;
  const disabled = used || grantedCount === 0;
  return (
    <MobileChrome time="17:00" active="auth">
      <section className="s17" data-page="s17" aria-label="移动端一次性授权">
        <h1 className="s17-title">只授权这一次。</h1>
        <p className="s17-version">方案版本 03 · 尚未执行</p>

        <p className="s17-scope-label">允许的范围</p>
        <ul className="s17-scopes">
          {SCOPES.map((scope) => (
            <li key={scope.id} className="s17-scope">
              <label className="s17-scope-row">
                <input
                  type="checkbox"
                  aria-label={scope.label}
                  checked={granted[scope.id]}
                  disabled={used}
                  onChange={(event) =>
                    setGranted({ ...granted, [scope.id]: event.target.checked })
                  }
                />
                <span className="s17-scope-text">
                  <span className="s17-scope-name">{scope.label}</span>
                  <span className="s17-scope-desc">{scope.desc}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <p className="s17-exclude">
          不包含：移动会议、发消息、付款或新增承诺。
        </p>

        {used ? (
          <p className="s17-used">
            本次授权已使用。草稿待检查，不会自动发送。
          </p>
        ) : null}
        {grantedCount === 0 ? (
          <p className="s17-empty">至少允许一项动作，或返回修改方案。</p>
        ) : null}

        <button
          type="button"
          className="s17-approve"
          disabled={disabled}
          onClick={() => setUsed(true)}
        >
          批准并准备草稿
        </button>
        <Link to="/m/plan" className="s17-back">
          返回修改方案
        </Link>
      </section>
    </MobileChrome>
  );
}
