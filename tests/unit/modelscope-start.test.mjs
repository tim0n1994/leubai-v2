import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const launcher = new URL("../../deploy/modelscope-start.mjs", import.meta.url);

test("ModelScope launcher rejects unsafe origins before creating runtime state", () => {
  for (const origin of [
    "", "http://app.example.test", "https://app.example.test/",
    "https://localhost", "https://127.0.0.1", "https://[::1]",
    "https://user:pass@app.example.test", "https://app.example.test?x=1",
    "https://app.example.test#x", "https://app$host.example.test",
    "https://app;host.example.test",
  ]) {
    const result = spawnSync(process.execPath, [launcher.pathname], {
      env: { ...process.env, LEUBAI_PUBLIC_ORIGIN: origin, LEUBAI_AUTH_DISABLED: "0", LEUBAI_DATA_DIR: "/dev/null/no-runtime-state" },
      encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 1, origin);
    assert.match(result.stderr, /Invalid URL|LEUBAI_PUBLIC_ORIGIN/, origin);
    assert.doesNotMatch(result.stderr, /ENOTDIR|API\+dist/, origin);
  }
});

test("ModelScope launcher cannot disable authentication", () => {
  const result = spawnSync(process.execPath, [launcher.pathname], {
    env: { ...process.env, LEUBAI_PUBLIC_ORIGIN: "https://app.example.test", LEUBAI_AUTH_DISABLED: "1" },
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Authentication cannot be disabled/);
  assert.doesNotMatch(result.stdout, /API\+dist/);
});
