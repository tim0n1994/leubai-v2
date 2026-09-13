import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLlmSettingsText, suggestLlmEndpoints } from "../../src/settings/parser.ts";

const FAKE_KEY = "sk-leubai-fake-unit-key-0001";

test("parses plain labelled lines with mixed Chinese and English labels", () => {
  const text = [
    "Base URL: http://127.0.0.1:65396",
    "Messages URL: http://127.0.0.1:65396/v1/messages",
    "模型列表地址: http://127.0.0.1:65396/v1/models",
    "API 密钥: " + FAKE_KEY,
    "Model: glm-5.3-flash",
  ].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396");
  assert.equal(parsed.messagesUrl, "http://127.0.0.1:65396/v1/messages");
  assert.equal(parsed.modelsUrl, "http://127.0.0.1:65396/v1/models");
  assert.equal(parsed.apiKey, FAKE_KEY);
  assert.equal(parsed.model, "glm-5.3-flash");
  assert.deepEqual(parsed.errors, []);
});

test("parses markdown links on one line without eating labels", () => {
  const md =
    "- [Base URL](http://127.0.0.1:65396/v1) [Messages URL](http://127.0.0.1:65396/v1/messages) 和 [Models URL](http://127.0.0.1:65396/v1/models) 以及 [API Key](sk-leubai-fake-unit-key-0002) [模型](glm-5.3-flash)";
  const parsed = parseLlmSettingsText(md);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396/v1");
  assert.equal(parsed.messagesUrl, "http://127.0.0.1:65396/v1/messages");
  assert.equal(parsed.modelsUrl, "http://127.0.0.1:65396/v1/models");
  assert.equal(parsed.apiKey, "sk-leubai-fake-unit-key-0002");
  assert.equal(parsed.model, "glm-5.3-flash");
});

test("supports common Chinese label aliases", () => {
  const text = [
    "服务地址: http://127.0.0.1:65396",
    "消息接口: http://127.0.0.1:65396/v1/messages",
    "模型列表: http://127.0.0.1:65396/v1/models",
    "密钥: sk-leubai-fake-unit-key-0003",
    "模型: glm-5.3-flash",
  ].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396");
  assert.equal(parsed.messagesUrl, "http://127.0.0.1:65396/v1/messages");
  assert.equal(parsed.modelsUrl, "http://127.0.0.1:65396/v1/models");
  assert.equal(parsed.apiKey, "sk-leubai-fake-unit-key-0003");
  assert.equal(parsed.model, "glm-5.3-flash");
});

test("preserves non-default paths verbatim and strips quotes or backticks", () => {
  const text = [
    'Base URL: "http://127.0.0.1:65396/custom/v1"',
    "Messages URL: `http://127.0.0.1:65396/custom/v1/chat`",
  ].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396/custom/v1");
  assert.equal(parsed.messagesUrl, "http://127.0.0.1:65396/custom/v1/chat");
});

test("empty input reports an error and no fields", () => {
  const parsed = parseLlmSettingsText("   \n  ");
  assert.equal(parsed.baseUrl, undefined);
  assert.equal(parsed.apiKey, undefined);
  assert.ok(parsed.errors.length > 0);
});

test("unrecognised free text reports an error instead of guessing", () => {
  const parsed = parseLlmSettingsText("今天天气不错，出去走走。");
  assert.equal(parsed.baseUrl, undefined);
  assert.ok(parsed.errors.some((e) => e.includes("未识别")));
});

test("label with empty value reports an error for that field", () => {
  const parsed = parseLlmSettingsText("Base URL:   \nModel: glm-5.3-flash");
  assert.equal(parsed.baseUrl, undefined);
  assert.equal(parsed.model, "glm-5.3-flash");
  assert.ok(parsed.errors.some((e) => e.includes("Base URL")));
});

test("unknown labelled lines are ignored without failing", () => {
  const text = ["备注: 下周再看", "Base URL: http://127.0.0.1:65396"].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396");
  assert.deepEqual(parsed.errors, []);
});

test("parses the exact label:url markdown-link format for every field", () => {
  const text = [
    "Base URL: [http://127.0.0.1:65396](http://127.0.0.1:65396)",
    "Messages URL: [http://127.0.0.1:65396/v1/messages](http://127.0.0.1:65396/v1/messages)",
    "Models URL: [http://127.0.0.1:65396/v1/models](http://127.0.0.1:65396/v1/models)",
    "API Key: [sk-leubai-fake-unit-key-0007](sk-leubai-fake-unit-key-0007)",
    "Model: [glm-5.3-flash](glm-5.3-flash)",
  ].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396");
  assert.equal(parsed.messagesUrl, "http://127.0.0.1:65396/v1/messages");
  assert.equal(parsed.modelsUrl, "http://127.0.0.1:65396/v1/models");
  assert.equal(parsed.apiKey, "sk-leubai-fake-unit-key-0007");
  assert.equal(parsed.model, "glm-5.3-flash");
  assert.deepEqual(parsed.errors, []);
});

test("duplicate identical values are accepted", () => {
  const text = [
    "Base URL: http://127.0.0.1:65396",
    "Base URL: http://127.0.0.1:65396",
    "Model: glm-5.3-flash",
  ].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:65396");
  assert.equal(parsed.model, "glm-5.3-flash");
  assert.deepEqual(parsed.errors, []);
});

test("conflicting duplicate values fail and drop the conflicting field", () => {
  const text = [
    "Base URL: http://127.0.0.1:65396",
    "Base URL: http://localhost:65396",
    "Model: glm-5.3-flash",
  ].join("\n");
  const parsed = parseLlmSettingsText(text);
  assert.equal(parsed.baseUrl, undefined);
  assert.equal(parsed.model, "glm-5.3-flash");
  assert.ok(parsed.errors.some((e) => e.includes("Base URL")));
});

test("invalid protocol value reports an error", () => {
  const parsed = parseLlmSettingsText("Protocol: graphql\nModel: glm-5.3-flash");
  assert.equal(parsed.protocol, undefined);
  assert.equal(parsed.model, "glm-5.3-flash");
  assert.ok(parsed.errors.some((e) => e.includes("Protocol")));
});

test("parses fenced JSON, camel case keys, and secret values without logging", () => {
  const parsed = parseLlmSettingsText('```json\n' + JSON.stringify({ protocol: "openai", baseUrl: "https://example.test/v1", apiKey: FAKE_KEY, model: "test-model" }) + '\n```');
  assert.equal(parsed.protocol, "openai");
  assert.equal(parsed.baseUrl, "https://example.test/v1");
  assert.equal(parsed.apiKey, FAKE_KEY);
  assert.deepEqual(parsed.errors, []);
});

test("environment-style OpenAI fields infer protocol and preserve equals signs in keys", () => {
  const parsed = parseLlmSettingsText('export OPENAI_BASE_URL="https://example.test/v1"\nOPENAI_API_KEY=example-key==\nMODEL=test-model');
  assert.equal(parsed.protocol, "openai");
  assert.equal(parsed.baseUrl, "https://example.test/v1");
  assert.equal(parsed.apiKey, "example-key==");
  assert.equal(parsed.model, "test-model");
  assert.deepEqual(parsed.errors, []);
});

test("malformed JSON and conflicting protocol formats do not silently become valid configs", () => {
  assert.match(parseLlmSettingsText('{"baseUrl":').errors[0], /JSON/);
  assert.match(parseLlmSettingsText('{"apiKey":42}').errors[0], /必须是文本/);
  assert.match(parseLlmSettingsText('OPENAI_BASE_URL=https://example.test\nProtocol: anthropic').errors[0], /多个不同/);
});

test("endpoint suggestions retain custom path prefixes and never reuse credentials", () => {
  assert.deepEqual(suggestLlmEndpoints("https://example.test/proxy/v1/", "openai"), { messagesUrl: "https://example.test/proxy/v1/chat/completions", modelsUrl: "https://example.test/proxy/v1/models" });
  assert.deepEqual(suggestLlmEndpoints("http://localhost:10101", "anthropic"), { messagesUrl: "http://localhost:10101/v1/messages", modelsUrl: "http://localhost:10101/v1/models" });
  assert.equal(suggestLlmEndpoints("https://user:secret@example.test", "openai"), null);
  assert.equal(suggestLlmEndpoints("https://example.test?key=secret", "openai"), null);
});
