import { useEffect, useRef, useState } from "react";
import { parseLlmSettingsText, suggestLlmEndpoints } from "./parser";
import { applySaveSuccess, type ProofState } from "./saveState";
import { AppearanceSettings } from "../appearance/AppearanceSettings";
import {
  LlmApiError,
  describeLlmError,
  disconnectLlm,
  getLlmSettings,
  saveLlmSettings,
  testLlmCandidate,
} from "./llmClient";
import type { LlmProtocol, LlmSettingsMeta, LlmTestResult } from "./llmClient";
import "./settings.css";

interface SettingsForm {
  protocol: LlmProtocol;
  baseUrl: string;
  messagesUrl: string;
  modelsUrl: string;
  model: string;
  apiKey: string;
}

const EMPTY_FORM: SettingsForm = {
  protocol: "anthropic",
  baseUrl: "",
  messagesUrl: "",
  modelsUrl: "",
  model: "",
  apiKey: "",
};

function formatVerifiedAt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

export function SettingsPage({ embedded = false }: { embedded?: boolean }) {
  const [meta, setMeta] = useState<LlmSettingsMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);
  const [paste, setPaste] = useState("");
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [proof, setProof] = useState<ProofState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const formRef = useRef(form);
  const editedRef = useRef(false);
  const operationRef = useRef(false);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const refreshMeta = async () => {
    try {
      const next = await getLlmSettings();
      setMeta(next);
      setMetaError(null);
    } catch (err) {
      const code = err instanceof LlmApiError ? err.code : "request_failed";
      setMetaError(describeLlmError(code));
    }
  };

  useEffect(() => {
    let active = true;
    void getLlmSettings().then(next => {
      if (!active) return;
      setMeta(next);
      setMetaError(null);
      if (!editedRef.current && (next.protocol === "openai" || next.protocol === "anthropic")) {
        const restored: SettingsForm = { protocol: next.protocol, baseUrl: next.baseUrl, messagesUrl: next.messagesUrl, modelsUrl: next.modelsUrl, model: next.model, apiKey: "" };
        formRef.current = restored;
        setForm(restored);
      }
    }, err => {
      if (!active) return;
      const code = err instanceof LlmApiError ? err.code : "request_failed";
      setMetaError(describeLlmError(code));
    });
    return () => { active = false; };
  }, []);

  const proofValid = proof !== null && JSON.stringify(form) === proof.formSnapshot;
  const working = testing || saving || disconnecting;

  const updateField = (field: keyof SettingsForm, value: string) => {
    editedRef.current = true;
    const next = { ...formRef.current, [field]: value };
    formRef.current = next;
    setForm(next);
    setSaveMessage(null);
    setSaveError(null);
  };

  const handleParse = () => {
    const parsed = parseLlmSettingsText(paste);
    setPasteErrors(parsed.errors);
    setPasteMessage(null);
    if (parsed.errors.length > 0) return;
    const updates: Partial<SettingsForm> = {};
    if (parsed.protocol === "anthropic" || parsed.protocol === "openai") {
      updates.protocol = parsed.protocol;
    }
    for (const field of ["baseUrl", "messagesUrl", "modelsUrl", "model", "apiKey"] as const) {
      const value = parsed[field];
      if (typeof value === "string" && value.length > 0) {
        updates[field] = value;
      }
    }
    if (Object.keys(updates).length > 0) {
      const next = { ...EMPTY_FORM, ...updates };
      if (!parsed.protocol && parsed.messagesUrl?.includes("/chat/completions")) next.protocol = "openai";
      const suggested = suggestLlmEndpoints(next.baseUrl, next.protocol);
      if (suggested) {
        next.messagesUrl ||= suggested.messagesUrl;
        next.modelsUrl ||= suggested.modelsUrl;
      }
      editedRef.current = true;
      formRef.current = next;
      setForm(next);
      setPaste("");
      setProof(null);
      setTestResult(null);
      setTestError(null);
      setSaveMessage(null);
      setSaveError(null);
      setPasteMessage("已填入新配置，请确认协议、地址与模型后测试连接。密钥不会保存在浏览器中。");
    }
  };

  const missingFields = [
    !form.baseUrl.trim() && "Base URL",
    !form.messagesUrl.trim() && "Messages URL",
    !form.modelsUrl.trim() && "Models URL",
    !form.model.trim() && "模型",
    !form.apiKey.trim() && "API Key",
  ].filter((v): v is string => Boolean(v));

  const handleTest = async () => {
    if (operationRef.current) return;
    if (missingFields.length > 0) {
      setTestError("请先完整填写：" + missingFields.join("、"));
      setTestResult(null);
      return;
    }
    operationRef.current = true;
    setTesting(true);
    setProof(null);
    setTestResult(null);
    setSaveMessage(null);
    setSaveError(null);
    setTestError(null);
    try {
      const result = await testLlmCandidate(
        {
          protocol: form.protocol,
          baseUrl: form.baseUrl.trim(),
          messagesUrl: form.messagesUrl.trim(),
          modelsUrl: form.modelsUrl.trim(),
          model: form.model.trim(),
        },
        form.apiKey,
      );
      setTestResult(result);
      if (result.ok && result.proofToken) {
        setProof({ token: result.proofToken, formSnapshot: JSON.stringify(form) });
      } else {
        setProof(null);
      }
    } catch (err) {
      setTestResult(null);
      setProof(null);
      const code = err instanceof LlmApiError ? err.code : "request_failed";
      setTestError(describeLlmError(code));
    } finally {
      setTesting(false);
      operationRef.current = false;
    }
  };

  const handleSave = async () => {
    if (!proofValid || operationRef.current || !proof) return;
    operationRef.current = true;
    const submittedForm = form;
    const submittedSnapshot = JSON.stringify(submittedForm);
    const proofToken = proof.token;
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await saveLlmSettings(
        {
          protocol: submittedForm.protocol,
          baseUrl: submittedForm.baseUrl.trim(),
          messagesUrl: submittedForm.messagesUrl.trim(),
          modelsUrl: submittedForm.modelsUrl.trim(),
          model: submittedForm.model.trim(),
        },
        submittedForm.apiKey,
        proofToken,
      );
      const formChangedSinceSubmit =
        JSON.stringify(formRef.current) !== submittedSnapshot;
      const outcome = applySaveSuccess({
        formChangedSinceSubmit,
        formApiKey: formRef.current.apiKey,
      });
      setTestResult(outcome.testResult);
      setTestError(outcome.testError);
      setProof(outcome.proof);
      if (outcome.apiKey !== formRef.current.apiKey) {
        setForm((prev) => ({ ...prev, apiKey: outcome.apiKey }));
      }
      setSaveMessage(outcome.saveMessage);
      await refreshMeta();
    } catch (err) {
      const code = err instanceof LlmApiError ? err.code : "request_failed";
      setSaveError(describeLlmError(code));
    } finally {
      setSaving(false);
      operationRef.current = false;
    }
  };

  const handleDisconnect = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setDisconnecting(true);
    try {
      await disconnectLlm();
      setProof(null);
      setTestResult(null);
      setSaveMessage("已断开并禁用模型连接");
      setSaveError(null);
      await refreshMeta();
    } catch (err) {
      const code = err instanceof LlmApiError ? err.code : "request_failed";
      setSaveError(describeLlmError(code));
    } finally {
      setDisconnecting(false);
      operationRef.current = false;
    }
  };

  return (
    <div className={embedded ? "settings-page is-embedded" : "settings-page"} data-page="settings">
      {embedded ? null : (
        <header className="settings-header">
          <h1 className="settings-title">设置</h1>
          <span className="settings-brand">留白 LeuBai · 模型连接</span>
        </header>
      )}
      {metaError ? (
        <p className="settings-message is-error" role="alert">
          {metaError}
        </p>
      ) : null}
      <section className="settings-section" aria-label="连接状态">
        <h2 className="settings-section-title">连接状态</h2>
        {meta ? (
          meta.enabled && meta.verified ? (
            <p className="settings-message is-ok" data-testid="settings-state">
              已连接 · {meta.model} · 验证于 {formatVerifiedAt(meta.verifiedAt)}
            </p>
          ) : meta.hasApiKey ? (
            <p className="settings-message" data-testid="settings-state">
              已保存但未启用验证连接
            </p>
          ) : (
            <p className="settings-message" data-testid="settings-state">
              未配置模型连接
            </p>
          )
        ) : metaError ? (
          <p className="settings-message" data-testid="settings-state">
            暂时无法读取连接状态
          </p>
        ) : (
          <p className="settings-message" data-testid="settings-state">
            正在读取本地连接状态…
          </p>
        )}
      </section>
      <section className="settings-section" aria-label="外观">
        <AppearanceSettings />
      </section>
      <section className="settings-section" aria-label="粘贴配置">
        <h2 className="settings-section-title">粘贴配置</h2>
        <p className="settings-hint">支持标签文本、Markdown 链接、JSON 和环境变量。解析会替换当前草稿；缺少的常用端点会根据协议补全，请核对后测试。</p>
        <textarea
          className="settings-textarea"
          data-testid="settings-paste"
          aria-label="粘贴 LLM 配置文本"
          rows={5}
          autoComplete="off"
          spellCheck={false}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"Base URL: http://127.0.0.1:65396\nMessages URL: …\nModels URL: …\nAPI Key: …\nModel: …"}
        />
        {pasteErrors.length > 0 ? (
          <ul className="settings-error-list" role="alert">
            {pasteErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {pasteMessage && <p className="settings-message" role="status">{pasteMessage}</p>}
        <button type="button" className="settings-btn" data-testid="settings-parse" onClick={handleParse} disabled={paste.trim().length === 0}>
          解析并填入
        </button>
      </section>
      <section className="settings-section" aria-label="连接配置">
        <h2 className="settings-section-title">连接配置</h2>
        <div className="settings-grid">
          <label className="settings-field">
            <span>协议</span>
            <select
              className="settings-select"
              data-testid="settings-protocol"
              value={form.protocol}
              onChange={(e) => updateField("protocol", e.target.value)}
            >
              <option value="anthropic">anthropic（/v1/messages）</option>
              <option value="openai">openai（chat/completions）</option>
            </select>
          </label>
          <label className="settings-field">
            <span>Base URL</span>
            <input className="settings-input" data-testid="settings-base-url" type="text" value={form.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="settings-field">
            <span>Messages URL</span>
            <input className="settings-input" data-testid="settings-messages-url" type="text" value={form.messagesUrl} onChange={(e) => updateField("messagesUrl", e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="settings-field">
            <span>Models URL</span>
            <input className="settings-input" data-testid="settings-models-url" type="text" value={form.modelsUrl} onChange={(e) => updateField("modelsUrl", e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="settings-field">
            <span>模型</span>
            <input className="settings-input" data-testid="settings-model" type="text" value={form.model} onChange={(e) => updateField("model", e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="settings-field">
            <span>API Key{meta?.hasApiKey ? "（已保存，不回显）" : ""}</span>
            <input
              className="settings-input"
              data-testid="settings-api-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => updateField("apiKey", e.target.value)}
              autoComplete="off"
              placeholder={meta?.hasApiKey ? "输入新值以更换" : "sk-…"}
            />
          </label>
        </div>
      </section>
      <section className="settings-section" aria-label="测试与保存">
        <h2 className="settings-section-title">测试与保存</h2>
        <div className="settings-actions">
          <button type="button" className="settings-btn" data-testid="settings-test" disabled={working} onClick={() => void handleTest()}>
            {testing ? "测试中…" : "测试连接（模型列表 + 真实推理）"}
          </button>
          <button type="button" className="settings-btn is-primary" data-testid="settings-save" disabled={!proofValid || working} onClick={() => void handleSave()}>
            {saving ? "保存中…" : "保存并启用"}
          </button>
          {meta?.enabled ? (
            <button type="button" className="settings-btn is-danger" data-testid="settings-disconnect" disabled={working} onClick={() => void handleDisconnect()}>
              {disconnecting ? "断开中…" : "断开并禁用"}
            </button>
          ) : null}
        </div>
        <p className="settings-hint">测试会向所填服务发送一次简短请求，可能消耗少量额度。两项测试通过后才可保存启用；修改配置后需要重新测试。</p>
        {testing && <p className="settings-message" role="status">正在读取模型列表并验证真实推理，请稍候…</p>}
        {testResult ? (
          <ul className="settings-stages" data-testid="settings-stages">
            <li className={"settings-stage " + (testResult.models.ok ? "is-ok" : "is-fail")}>
              <span>模型列表</span>
              <span>
                {testResult.models.ok
                  ? "通过 · " + (testResult.models.models?.length ?? 0) + " 个模型"
                  : describeLlmError(testResult.models.error ?? "upstream_error")}
              </span>
            </li>
            <li className={"settings-stage " + (testResult.inference.ok ? "is-ok" : "is-fail")}>
              <span>推理测试</span>
              <span>
                {testResult.inference.ok
                  ? "通过 · 配置模型 " + testResult.inference.model + (testResult.inference.responseModel ? " · 上游报告 " + testResult.inference.responseModel : "")
                  : describeLlmError(testResult.inference.error ?? "upstream_error")}
              </span>
            </li>
          </ul>
        ) : null}
        {testResult?.ok && !proofValid ? (
          <p className="settings-message is-error" role="status">
            配置已修改，本次测试结果失效，请重新测试。
          </p>
        ) : null}
        {testError ? (
          <p className="settings-message is-error" role="alert">
            {testError}
          </p>
        ) : null}
        {saveMessage ? (
          <p className="settings-message is-ok" role="status">
            {saveMessage}
          </p>
        ) : null}
        {saveError ? (
          <p className="settings-message is-error" role="alert">
            {saveError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
