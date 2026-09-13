// Parser for user-pasted LLM connection settings.
// Accepts labelled plain lines ("Base URL: http://...") and Markdown links
// ("Base URL: [http://a](http://a)" or inline "[Base URL](http://a)").
// Conflicting duplicate fields fail clearly instead of picking one endpoint.

export interface ParsedLlmSettings {
  protocol?: string;
  baseUrl?: string;
  messagesUrl?: string;
  modelsUrl?: string;
  apiKey?: string;
  model?: string;
  errors: string[];
}

type Field = "protocol" | "baseUrl" | "messagesUrl" | "modelsUrl" | "apiKey" | "model";

const FIELD_LABELS: Record<Field, string> = {
  protocol: "Protocol",
  baseUrl: "Base URL",
  messagesUrl: "Messages URL",
  modelsUrl: "Models URL",
  apiKey: "API Key",
  model: "Model",
};

const ALIASES: Record<string, Field> = {
  "base url": "baseUrl",
  "服务地址": "baseUrl",
  "基础地址": "baseUrl",
  "接口地址": "baseUrl",
  "messages url": "messagesUrl",
  "消息接口": "messagesUrl",
  "消息地址": "messagesUrl",
  "models url": "modelsUrl",
  "模型列表地址": "modelsUrl",
  "模型列表": "modelsUrl",
  "api key": "apiKey",
  "api 密钥": "apiKey",
  "密钥": "apiKey",
  "model": "model",
  "模型": "model",
  "protocol": "protocol",
  "协议": "protocol",
};

const MARKDOWN_LINK = /\[([^\]\n]{1,80})\]\(([^)\n]{1,2048})\)/g;

function normalizeLabel(rawLabel: string): string {
  return rawLabel
    .replace(/^[*_`#\s>-]+/, "")
    .replace(/[*_`\s]+$/, "")
    .trim()
    .toLowerCase();
}

function cleanValue(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^[`"']+/, "").replace(/[`"']+$/, "").trim();
  return value;
}

function fieldForLabel(rawLabel: string): Field | null {
  const label = normalizeLabel(rawLabel);
  if (!label) return null;
  return ALIASES[label] ?? null;
}

type Candidate = { field: Field; value: string };

function extractCandidates(text: string): { candidates: Candidate[]; sawContent: boolean } {
  const candidates: Candidate[] = [];
  const lines = text.split(/\r?\n/);
  let sawContent = false;
  for (const line of lines) {
    if (line.trim()) sawContent = true;
    const links = [...line.matchAll(MARKDOWN_LINK)];
    const labelMatch = line.match(/^[\s>*-]*([^:：]{1,40})[:：]\s*(.*)$/);
    if (labelMatch) {
      const field = fieldForLabel(labelMatch[1]);
      if (field) {
        const rest = labelMatch[2];
        if (links.length > 0) {
          if (links.length > 1) {
            candidates.push({ field, value: "" });
            continue;
          }
          candidates.push({ field, value: cleanValue(links[0][2]) });
          continue;
        }
        const plain = cleanValue(rest);
        candidates.push({ field, value: plain });
        continue;
      }
    }
    // Standalone markdown links labelled by their link text.
    for (const link of links) {
      const field = fieldForLabel(link[1]);
      if (field) candidates.push({ field, value: cleanValue(link[2]) });
    }
  }
  return { candidates, sawContent };
}

export function parseLlmSettingsText(text: string): ParsedLlmSettings {
  const errors: string[] = [];
  const { candidates, sawContent } = extractCandidates(String(text ?? ""));
  const perField = new Map<Field, string[]>();
  for (const candidate of candidates) {
    const list = perField.get(candidate.field) ?? [];
    list.push(candidate.value);
    perField.set(candidate.field, list);
  }

  const result: ParsedLlmSettings = { errors };
  let anyField = false;
  for (const [field, values] of perField) {
    const label = FIELD_LABELS[field];
    const distinct = [...new Set(values)];
    if (distinct.length > 1) {
      errors.push(label + " 出现多个不同的值，已忽略该字段以避免误配");
      continue;
    }
    const value = distinct[0];
    if (!value) {
      errors.push(label + " 的值为空");
      continue;
    }
    if (field === "protocol") {
      const normalized = value.toLowerCase();
      if (normalized !== "anthropic" && normalized !== "openai") {
        errors.push("Protocol 仅支持 anthropic 或 openai");
        continue;
      }
      result.protocol = normalized;
    } else {
      result[field] = value;
    }
    anyField = true;
  }

  if (!anyField && errors.length === 0) {
    if (!sawContent) {
      errors.push("未识别到任何配置字段；请粘贴包含 Base URL / Messages URL / Models URL / API Key / Model 的文本");
    } else {
      errors.push("未识别到任何配置字段；请检查标签拼写（Base URL / Messages URL / Models URL / API Key / Model）");
    }
  }
  return result;
}
