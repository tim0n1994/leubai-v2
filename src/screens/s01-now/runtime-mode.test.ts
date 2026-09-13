import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screens = [
  "s01-now/S01Now.tsx",
  "s02-ledger/S02Ledger.tsx",
  "s03-inbox/S03Inbox.tsx",
  "s04-plan/S04Plan.tsx",
  "s06-workspace/WorkspaceScreen.tsx",
  "s10-boundaries/BoundariesScreen.tsx",
  "s11-context/context-review-runtime.tsx",
  "s15-m-now/S15MNow.tsx",
  "s16-m-plan/S16MPlan.tsx",
] as const;

for (const screen of screens) {
  test(`${screen} delegates account mode selection to the shared runtime`, () => {
    // Given a business screen used by both guests and authenticated accounts.
    const source = readFileSync(new URL(`../${screen}`, import.meta.url), "utf8");
    // When its runtime binding is inspected, no screen may override account mode.
    const calls = [...source.matchAll(/useDomainRuntime\(([^)]*)\)/g)];
    // Then every binding uses the shared authenticated-live / guest-fixture default.
    assert.ok(calls.length > 0);
    assert.ok(calls.every(call => call[1].trim() === ""), screen);
    assert.doesNotMatch(source, /dataMode="fixture"/);
  });
}
