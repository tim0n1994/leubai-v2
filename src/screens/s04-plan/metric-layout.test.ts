import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("./S04Plan.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./s04-plan.css", import.meta.url), "utf8");

function renderHeadline(planId: string | null, headline: string) {
  const start = source.indexOf("function S04Headline(");
  const end = source.indexOf("\nfunction S04PlanCardA(", start);
  assert.ok(start >= 0 && end > start, "screen uses one actual shared headline renderer");
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Headline = new Function("React", compiled + "\nreturn S04Headline;")(React);
  return renderToStaticMarkup(React.createElement(Headline, { card: { planId, headline, headlineTone: "default" } }));
}

test("saved comparison emphasizes real values with independent arrow and unit", () => {
  const html = renderHeadline("saved-plan", "83 → 51 分钟");
  assert.match(html, /class="s04-metric-number">83</);
  assert.match(html, /class="s04-metric-arrow">→</);
  assert.match(html, /class="s04-metric-number">51</);
  assert.match(html, /class="s04-metric-unit">分钟</);
});

test("unsaved and unknown headlines never receive numeric emphasis", () => {
  for (const [id, label] of [[null, "尚未保存"], [null, "60 → 40 分钟"], ["saved-plan", "投入未知"], ["saved-plan", "预计总投入 90 分钟"]] as const) {
    const html = renderHeadline(id, label);
    assert.match(html, /s04-headline-status/);
    assert.doesNotMatch(html, /s04-metric-number/);
  }
});

test("saved future debt is a single real number, not a fabricated comparison", () => {
  const html = renderHeadline("saved-defer-plan", "25 分钟");
  assert.match(html, /class="s04-metric-number">25</);
  assert.doesNotMatch(html, /s04-metric-arrow/);
});

test("porcelain wide desktop defines measured number, title, arrow and unit sizes", () => {
  for (const declaration of ["--s04-reference-number: 72px", "--s04-reference-title: 34px", "--s04-reference-arrow: 32px", "--s04-reference-unit: 17px"]) {
    assert.ok(css.includes(declaration), declaration);
  }
  assert.match(css, /@media \(min-width: 1600px\)/);
  assert.match(css, /html:not\(\[data-theme='ink'\]\) \.s04/);
});

test("both cards render the actual optional metric explanation without inventing empty-state copy", () => {
  const start = source.indexOf("function S04Subnote(");
  const end = source.indexOf("\nfunction S04PlanCardA(", start);
  assert.ok(start >= 0 && end > start, "shared optional subnote renderer exists");
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Subnote = new Function("React", compiled + "\nreturn S04Subnote;")(React);
  const render = (subnote: string | null) => renderToStaticMarkup(React.createElement(Subnote, { card: { subnote } }));
  assert.equal(render(null), "");
  assert.equal(render("真实责任 <检查> · 未测量"), '<p class="s04-subnote">真实责任 &lt;检查&gt; · 未测量</p>');
  assert.equal(source.match(/<S04Subnote card=\{card\} \/>/g)?.length, 2);
});

test("wide porcelain ledger aligns its inner columns while preserving the 630px time scale", () => {
  const ledgerCss = readFileSync(new URL("../s02-ledger/s02-ledger.css", import.meta.url), "utf8");
  assert.match(ledgerCss, /html:not\(\[data-theme='ink'\]\) \.s02-track-wrap \{\s*grid-template-columns: 132px/);
  assert.match(ledgerCss, /html:not\(\[data-theme='ink'\]\) \.s02-hours span \{\s*left: 62px;/);
  assert.match(ledgerCss, /html:not\(\[data-theme='ink'\]\) \.s02-cols span:first-child \{\s*padding-left: 62px;/);
  assert.match(ledgerCss, /\.s02-track-wrap \{[\s\S]*?height: 630px;/);
});
