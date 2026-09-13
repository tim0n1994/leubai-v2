import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceScreen.tsx", import.meta.url), "utf8");
const nowCss = readFileSync(new URL("../s01-now/s01-now.css", import.meta.url), "utf8");
const ledgerCss = readFileSync(new URL("../s02-ledger/s02-ledger.css", import.meta.url), "utf8");

test("wide desktop restores measured hero height and responsibility lead space", () => {
  assert.match(nowCss, /@media \(min-width: 1600px\)/);
  assert.match(nowCss, /min-height: var\(--[\w-]+, 508px\)/);
  assert.match(nowCss, /margin-top: var\(--[\w-]+, 40px\)/);
});

test("wide desktop restores ledger proportions without changing the exact time scale", () => {
  assert.match(ledgerCss, /@media \(min-width: 1600px\)/);
  assert.match(ledgerCss, /minmax\(0, var\(--reference-ledger-ratio, 2\.73fr\)\) minmax\(0, 1fr\)/);
  assert.match(ledgerCss, /minmax\(220px, var\(--[\w-]+, 400px\)\)/);
  assert.match(ledgerCss, /\.s02-track-wrap[\s\S]*?height: 630px;/);
});

test("issue disclosure retains mounted controlled inputs and respects unresolved command lock", () => {
  assert.match(source, /const \[flagEditors, setFlagEditors\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(source, /data-flag-open=\{section\.id\}[\s\S]*?aria-expanded=\{Boolean\(flagEditors\[section\.id\]\)\}/);
  assert.match(source, /data-flag-open=\{section\.id\}[\s\S]*?disabled=\{busy !== null \|\| interactionsLocked\}/);
  assert.match(source, /hidden=\{!flagEditors\[section\.id\]\}[\s\S]*?data-flag-input=\{section\.id\}[\s\S]*?value=\{flagDrafts\[section\.id\] \?\? ""\}/);
});

test("material disclosure retains mounted values and stays locked during exact retry", () => {
  assert.match(source, /const \[materialExpanded, setMaterialExpanded\] = useState\(false\)/);
  assert.match(source, /data-material-open[\s\S]*?aria-expanded=\{materialExpanded\}[\s\S]*?disabled=\{materialLocked\}/);
  assert.match(source, /hidden=\{!materialExpanded\}[\s\S]*?data-material-name[\s\S]*?value=\{materialName\}/);
  assert.match(source, /data-material-add[\s\S]*?onClick=\{registerMaterial\}[\s\S]*?disabled=\{materialLocked \|\| !materialFormComplete/);
});
