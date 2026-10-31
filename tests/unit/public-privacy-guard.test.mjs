import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const guardScript = join(root, "scripts/check-public-privacy.mjs");

function runGuard(fixtureModel, modelPatterns = null, externalMarkers = null) {
  mkdirSync(join(root, ".tmp"), { recursive: true });
  const repo = mkdtempSync(join(root, ".tmp", "public-privacy-guard-"));
  const fixturePath = join(repo, "tests/unit/llm-parser.test.mjs");
  try {
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, "Model: " + fixtureModel + "\n");
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["add", "tests/unit/llm-parser.test.mjs"], { cwd: repo, stdio: "ignore" });

    const env = { ...process.env, TZ: "Asia/Shanghai" };
    delete env.PRIVACY_MODEL_PATTERNS_PATH;
    delete env.PRIVACY_MARKERS_PATH;
    if (modelPatterns) {
      const patternPath = join(repo, "external-model-patterns.private.json");
      writeFileSync(patternPath, JSON.stringify(modelPatterns));
      env.PRIVACY_MODEL_PATTERNS_PATH = patternPath;
    }
    if (externalMarkers) {
      const markerPath = join(repo, "external-markers.private.json");
      writeFileSync(markerPath, JSON.stringify(externalMarkers));
      env.PRIVACY_MARKERS_PATH = markerPath;
    }
    return spawnSync(process.execPath, [guardScript], {
      cwd: repo,
      env,
      encoding: "utf8",
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("privacy guard accepts synthetic parser fixtures without private files", () => {
  const safeModel = ["synthetic-", "model-", "flash"].join("");
  const result = runGuard(safeModel);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /privacy check passed/);
});

test("privacy guard rejects specific synthetic models by default", () => {
  const blockedModel = ["synthetic-", "vendor-", "9.9"].join("");
  const result = runGuard(blockedModel);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-synthetic-model-fixture/);
  assert.equal(result.stderr.includes(blockedModel), false);
});

test("invalid external patterns fail without leaking their values", () => {
  const invalidPattern = ["[", "unclosed"].join("");
  const categoryAttempt = ["external-", "category"].join("");
  const result = runGuard("synthetic-model-flash", [
    { pattern: invalidPattern, category: categoryAttempt },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pattern that failed to compile/);
  assert.equal(result.stderr.includes(invalidPattern), false);
  assert.equal(result.stderr.includes(categoryAttempt), false);
});

test("external model findings use a fixed safe category", () => {
  const matchedModel = ["synthetic-", "model-", "guarded"].join("");
  const customCategory = ["custom-", "category"].join("");
  const result = runGuard(matchedModel, [
    { pattern: "synthetic-model-guarded", category: customCategory },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployment-model/);
  assert.equal(result.stderr.includes(customCategory), false);
});

test("external marker findings use a fixed safe category", () => {
  const matchedModel = ["synthetic-", "model-", "flash"].join("");
  const customCategory = ["marker-", "category"].join("");
  const result = runGuard(matchedModel, null, [
    { value: matchedModel, category: customCategory },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /external-marker/);
  assert.equal(result.stderr.includes(customCategory), false);
  assert.equal(result.stderr.includes(matchedModel), false);
});
