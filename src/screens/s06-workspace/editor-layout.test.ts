import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./s06-workspace.css", import.meta.url), "utf8");
const rule = (selector: string) => css.slice(css.indexOf(selector + " {"), css.indexOf("}", css.indexOf(selector + " {")) + 1);

test("editor footer and its button group can wrap and shrink within their grid column", () => {
  for (const selector of [".s06-editor-actions", ".s06-editor-buttons"]) {
    assert.match(rule(selector), /flex-wrap: wrap;/, selector);
    assert.match(rule(selector), /min-width: 0;/, selector);
  }
  const button = rule(".s06-editor-actions .s06-btn-ghost");
  assert.match(button, /max-width: 100%;/);
  assert.match(button, /flex-shrink: 1;/);
  assert.match(button, /overflow-wrap: anywhere;/);
});

test("narrow desktop changes to one readable column before the fixed sidebar crowds editing", () => {
  assert.match(css, /@media \(max-width: 1200px\)\s*\{\s*\.s06-layout\s*\{\s*grid-template-columns: 1fr;/);
});
