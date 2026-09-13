// Outbound upstream client. The server is the only component that talks to the
// configured endpoint. Errors are sanitized to stable codes; upstream bodies
// are never surfaced or logged. Response bodies are size-bounded, redirects are
// never followed, and the generated text is capped.

import { UpstreamUrlError } from "./urlguard.mjs";

const ANTHROPIC_VERSION = "2023-06-01";
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_MODELS = 100;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_GENERATED_CHARS = 20000;

export class UpstreamError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "UpstreamError";
    this.code = code;
    this.status = status;
  }
}

function authHeaders(protocol, apiKey) {
  if (protocol === "openai") {
    return { authorization: "Bearer " + apiKey };
  }
  // Supplied Messages protocol uses x-api-key + anthropic-version; Authorization
  // Bearer is sent alongside for compatibility endpoints that only read Bearer.
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    authorization: "Bearer " + apiKey,
  };
}

function mapHttpError(status) {
  if (status === 401 || status === 403) return "auth_error";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "upstream_error";
}

async function upstreamFetch(url, init, timeoutMs, externalSignal) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (externalSignal) signals.push(externalSignal);
  let res;
  try {
    res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.any(signals) });
  } catch (err) {
    if (externalSignal && externalSignal.aborted) throw new UpstreamError("cancelled");
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new UpstreamError("timeout");
    }
    throw new UpstreamError("network_error");
  }
  if (REDIRECT_CODES.has(res.status)) throw new UpstreamError("redirect_blocked", res.status);
  return res;
}

// Bounded reader: enforces the response-size limit while streaming and keeps
// abort/timeout semantics correct (a timeout during body read stays "timeout",
// never a misleading JSON-format error).
async function readBoundedBody(res, maxBytes, externalSignal) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel(); } catch {}
    throw new UpstreamError("response_too_large", res.status);
  }
  if (!res.body) throw new UpstreamError("bad_response", res.status);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new UpstreamError("response_too_large", res.status);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (externalSignal && externalSignal.aborted) throw new UpstreamError("cancelled");
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new UpstreamError("timeout");
    }
    throw new UpstreamError("network_error");
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseBoundedJson(res, maxBytes, externalSignal) {
  const raw = await readBoundedBody(res, maxBytes, externalSignal);
  try {
    return JSON.parse(raw);
  } catch {
    throw new UpstreamError("bad_response", res.status);
  }
}

export async function fetchModelList(candidate, apiKey, { timeoutMs = 45000, signal, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) {
  const url = new URL(candidate.modelsUrl);
  const res = await upstreamFetch(
    url,
    { method: "GET", headers: { ...authHeaders(candidate.protocol, apiKey), accept: "application/json" } },
    timeoutMs,
    signal,
  );
  if (!res.ok) throw new UpstreamError(mapHttpError(res.status), res.status);
  const data = await parseBoundedJson(res, maxResponseBytes, signal);
  const list = data && Array.isArray(data.data) ? data.data : null;
  if (!list) throw new UpstreamError("bad_response", res.status);
  const models = [];
  for (const item of list) {
    if (item && typeof item.id === "string" && item.id.length > 0) models.push(item.id);
    if (models.length >= MAX_MODELS) break;
  }
  return { ok: true, models };
}

export async function runLlmInference(candidate, apiKey, prompt, { maxTokens = 32, timeoutMs = 45000, signal, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) {
  const url = new URL(candidate.messagesUrl);
  let body;
  if (candidate.protocol === "openai") {
    body = {
      model: candidate.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    };
  } else {
    body = {
      model: candidate.model,
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    };
  }
  const res = await upstreamFetch(
    url,
    {
      method: "POST",
      headers: { ...authHeaders(candidate.protocol, apiKey), "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
    signal,
  );
  if (!res.ok) throw new UpstreamError(mapHttpError(res.status), res.status);
  const data = await parseBoundedJson(res, maxResponseBytes, signal);
  let text = "";
  if (candidate.protocol === "openai") {
    const content = data && data.choices && data.choices[0] && data.choices[0].message;
    text = content && typeof content.content === "string" ? content.content : "";
  } else {
    if (data && Array.isArray(data.content)) {
      text = data.content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
    }
  }
  if (!text.trim()) throw new UpstreamError("bad_response", res.status);
  if (text.length > MAX_GENERATED_CHARS) throw new UpstreamError("text_too_large", res.status);
  // The configured model and the upstream-reported model are kept separate:
  // serving the request does not prove the provider ran the requested model.
  const responseModel = data && typeof data.model === "string" && data.model ? data.model : undefined;
  return { ok: true, text, model: candidate.model, responseModel };
}

export function upstreamUrlOrThrow(raw) {
  try {
    return new URL(raw);
  } catch {
    throw new UpstreamUrlError("invalid_url");
  }
}
