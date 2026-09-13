import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AuthError, authErrorMessage } from "./auth-client";
import { authFlowReducer, initialAuthFlow } from "./auth-flow";
import type { AuthMode } from "./auth-flow";
import { useAuth } from "./use-auth";
import "./auth.css";

export function AuthDialog({ onClose }: { onClose: () => void }) {
  const { user, status, loading, busy, error: serviceError, actions } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [flow, dispatch] = useReducer(authFlowReducer, initialAuthFlow);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const remainingSeconds = Math.max(0, Math.ceil((resendUntil - clock) / 1000));
  const minLength = Math.max(12, status?.passwordMinLength ?? 12);
  const disabled = busy || loading;
  const canUseEmail = Boolean(status?.enabled && status.emailDelivery !== "unavailable");
  const showDevCode = status?.emailDelivery === "console" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  useEffect(() => {
    if (!resendUntil) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [resendUntil]);

  function startResendWait() {
    const now = Date.now();
    setClock(now);
    setResendUntil(now + (status?.codeResendSeconds ?? 60) * 1000);
  }

  async function sendCode(destination: string) {
    try {
      const result = await actions.sendCode(destination, flow.mode === "register" ? "register" : "reset");
      startResendWait();
      setCode("");
      dispatch({ type: "sent", email: destination, devCode: result.devCode, showDevCode });
    } catch (failure) {
      if (failure instanceof AuthError && failure.code === "CODE_COOLDOWN") startResendWait();
      throw failure;
    }
  }

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function changeMode(mode: AuthMode) {
    dispatch({ type: "mode", mode, registrationEnabled: Boolean(status?.registrationEnabled) });
    setPassword(""); setCode(""); setError(null); setNotice(null); setResendUntil(0);
  }

  async function run(action: () => Promise<unknown>, success?: () => void) {
    setError(null); setNotice(null);
    try { await action(); success?.(); }
    catch (failure) { setError(authErrorMessage(failure)); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !status?.enabled) return;
    if (flow.mode === "login") {
      void run(() => actions.login(email.trim(), password), onClose);
    } else if (flow.step === "email") {
      if (remainingSeconds > 0) return;
      void run(() => sendCode(email.trim()));
    } else if (flow.mode === "register") {
      void run(() => actions.register(flow.email, code, password, displayName.trim()), onClose);
    } else {
      void run(() => actions.resetPassword(flow.email, code, password), () => {
        dispatch({ type: "reset-complete" }); setPassword(""); setCode("");
        setNotice("密码已重置，请使用新密码登录。");
      });
    }
  }

  return (
    <dialog ref={dialog} className="auth-dialog" aria-labelledby="auth-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="auth-heading">
        <div><p className="auth-eyebrow"><img className="auth-brand-mark" src="/brand/leubai-mark-256.png" alt="" width={22} height={22} draggable={false} />LeuBai / 留白</p><h2 id="auth-title">{user ? "我的账号" : flow.mode === "reset" ? "找回密码" : "进入你的留白"}</h2></div>
        <button type="button" className="auth-close" aria-label="关闭账号面板" disabled={busy} onClick={onClose}>×</button>
      </div>
      {loading && <p className="auth-note" role="status">正在确认登录状态…</p>}
      {!loading && (!status || !status.enabled) && <div className="auth-feedback" role="status"><p>{serviceError ?? "账号服务尚未启用，请联系管理员。"}</p><button type="button" className="auth-secondary" onClick={() => void actions.refresh()}>重新连接</button></div>}
      {user ? <>
        <p className="auth-account-email">{user.email}</p>
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void run(() => actions.updateProfile({ displayName: displayName.trim() }), () => setNotice("称呼已保存。")); }}>
          <label>称呼<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoComplete="nickname" disabled={disabled} /></label>
          <button className="auth-secondary" disabled={disabled}>保存称呼</button>
        </form>
        <details className="auth-password-details"><summary>修改密码</summary>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void run(() => actions.updatePassword(oldPassword, password), () => { setOldPassword(""); setPassword(""); setNotice("密码已更新，其他设备需要重新登录。"); }); }}>
            <label>原密码<input type="password" autoComplete="current-password" required value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} disabled={disabled} /></label>
            <label>新密码<span className="auth-field-hint">至少 {minLength} 个字符</span><input type="password" autoComplete="new-password" required minLength={minLength} value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} /></label>
            <button className="auth-primary" disabled={disabled}>更新密码</button>
          </form>
        </details>
        <button type="button" className="auth-text-button auth-logout" disabled={disabled} onClick={() => void run(actions.logout, onClose)}>退出登录</button>
      </> : status?.enabled && <>
        {flow.mode !== "reset" && <div className="auth-tabs" aria-label="账号操作">
          <button type="button" aria-pressed={flow.mode === "login"} disabled={disabled} onClick={() => changeMode("login")}>登录</button>
          {status.registrationEnabled && <button type="button" aria-pressed={flow.mode === "register"} disabled={disabled} onClick={() => changeMode("register")}>注册</button>}
        </div>}
        {!status.registrationEnabled && <p className="auth-note">注册暂未开放</p>}
        <form className="auth-form" onSubmit={submit}>
          {flow.step === "verify" && flow.mode !== "login" ? <div className="auth-code-destination"><p>{flow.devCode && showDevCode ? "正在本地验证邮箱" : "请检查邮箱"} <strong>{flow.email}</strong></p><p className="auth-note">{flow.mode === "reset" ? "若该邮箱已注册，你会收到重置验证码。" : "若该邮箱可用于注册，你会收到验证码；已有账号请返回登录。"}未收到时，请检查垃圾邮件。</p><button type="button" className="auth-text-button" disabled={disabled} onClick={() => { dispatch({ type: "edit-email" }); setCode(""); setPassword(""); setError(null); setNotice(null); setResendUntil(0); }}>更换邮箱</button></div>
            : <label>邮箱<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={disabled} /></label>}
          {flow.step === "verify" && flow.mode !== "login" && <>
            {flow.devCode && showDevCode && <p className="auth-dev-code">本地调试验证码：<strong>{flow.devCode}</strong>（未发送邮件）</p>}
            <label>邮箱验证码<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required minLength={6} maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={disabled} /></label>
            <button type="button" className="auth-text-button" disabled={disabled || remainingSeconds > 0 || !canUseEmail} onClick={() => void run(() => sendCode(flow.email), () => setNotice(showDevCode ? "本地验证码已更新。" : "已重新请求验证码，请查看邮箱。"))}>{remainingSeconds > 0 ? `${remainingSeconds} 秒后可重新发送` : "重新发送验证码"}</button>
          </>}
          {(flow.mode === "login" || flow.step === "verify") && <label>{flow.mode === "reset" ? "新密码" : "密码"}{flow.mode !== "login" && <span className="auth-field-hint">至少 {minLength} 个字符</span>}<input name="password" type="password" autoComplete={flow.mode === "login" ? "current-password" : "new-password"} required minLength={flow.mode === "login" ? undefined : minLength} value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} /></label>}
          {flow.mode === "register" && flow.step === "verify" && <label>称呼（选填）<input name="displayName" autoComplete="nickname" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={disabled} /></label>}
          <button className="auth-primary" disabled={disabled || (flow.mode !== "login" && (!canUseEmail || (flow.step === "email" && remainingSeconds > 0)))}>{busy ? "正在处理…" : flow.mode === "login" ? "登录" : flow.step === "email" ? (remainingSeconds > 0 ? `${remainingSeconds} 秒后可重新发送` : "发送验证码") : flow.mode === "register" ? "完成注册" : "重置密码"}</button>
        </form>
        {flow.mode === "login" ? <button type="button" className="auth-text-button auth-bottom-action" disabled={disabled || !canUseEmail} onClick={() => changeMode("reset")}>忘记密码</button>
          : <button type="button" className="auth-text-button auth-bottom-action" disabled={disabled} onClick={() => changeMode("login")}>返回登录</button>}
        {!canUseEmail && <p className="auth-note">邮箱验证服务尚未配置，暂不能注册或找回密码。</p>}
      </>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-feedback" role="status">{notice}</p>}
      {busy && <p className="auth-note" role="status">账号操作进行中，请稍候。</p>}
    </dialog>
  );
}
