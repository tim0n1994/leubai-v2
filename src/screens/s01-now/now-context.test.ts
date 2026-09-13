import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInitialState, FIXTURE_IDS } from "../../domain/index.ts";
import { resolveNowContext } from "./now-context.ts";
import { selectHeroView, selectModificationView, selectSurfaceDate } from "./timeSurfaces.ts";

test("S01 resolves every explicit intent value and keeps all plan actions in context", () => {
  const source = readFileSync(new URL("./S01Now.tsx", import.meta.url), "utf8");
  assert.match(source, /getAll\("intentId"\)/);
  assert.equal((source.match(/navigate\(context\.planHref\)/g) ?? []).length, 3);
  assert.match(source, /intentId=\{context\.intentId\}/);
  assert.doesNotMatch(source, /navigate\("\/plan"\)/);
});

test("capture saved intent provides a real S01 link", () => {
  const source = readFileSync(new URL("../s14-capture/S14Capture.tsx", import.meta.url), "utf8");
  assert.match(source, /data-s14-open-now/);
  assert.match(source, /to=\{"\/\?intentId=" \+ encodeURIComponent\(savedIntentId\)\}/);
});

test("no query preserves the prior default date, hero, operation and plan route", () => {
  const state = createInitialState("fixture");
  const date = selectSurfaceDate(state);
  assert.deepEqual(resolveNowContext(state, []), { ok: true, intentId: null, date, hero: selectHeroView(state, date), modification: selectModificationView(state), planHref: "/plan" });
});

test("explicit intent selects its own date and stable linked block, never earlier unrelated blocks", () => {
  const state = structuredClone(createInitialState("fixture"));
  const intent = state.intents[FIXTURE_IDS.intent];
  state.intents["selected / intent"] = { ...intent, id: "selected / intent", parsedFields: { ...intent.parsedFields, date: "2026-09-14" } };
  const original = Object.values(state.protectedBlocks)[0];
  state.protectedBlocks.selected = { ...original, id: "selected", blockId: "stable-selected", intentId: "selected / intent", range: { ...original.range, start: "2026-09-14T21:00:00+08:00", end: "2026-09-14T22:00:00+08:00" } };
  const model = resolveNowContext(state, ["selected / intent"]);
  assert.equal(model.ok, true);
  if (!model.ok) return;
  assert.equal(model.date, "2026-09-14");
  assert.equal(model.hero.protectedInterval?.blockId, "stable-selected");
  assert.equal(model.hero.protectedInterval?.startMinute, 1260);
  assert.equal(model.planHref, "/plan?intentId=selected%20%2F%20intent");
});

test("empty, duplicate, unknown, whitespace-mutated and non-saved explicit IDs fail closed", () => {
  const state = structuredClone(createInitialState("fixture"));
  for (const values of [[""], [" "], [FIXTURE_IDS.intent, FIXTURE_IDS.intent], ["missing"], [" " + FIXTURE_IDS.intent]]) {
    assert.equal(resolveNowContext(state, values).ok, false);
  }
  for (const status of ["paused", "deleted", "discarded", "ambiguous"] as const) {
    state.intents[FIXTURE_IDS.intent].status = status;
    assert.equal(resolveNowContext(state, [FIXTURE_IDS.intent]).ok, false, status);
  }
});

test("missing linked block keeps selected intent for explicit protected-block creation", () => {
  const state = structuredClone(createInitialState("fixture"));
  const original = state.intents[FIXTURE_IDS.intent];
  state.intents.other = { ...original, id: "other" };
  const model = resolveNowContext(state, ["other"]);
  assert.equal(model.ok, true);
  if (!model.ok) return;
  assert.equal(model.intentId, "other");
  assert.equal(model.hero.protectedInterval, null);
});

test("unknown date may use only the selected intent's active linked block", () => {
  const state = structuredClone(createInitialState("fixture"));
  state.intents[FIXTURE_IDS.intent].parsedFields.date = null;
  const model = resolveNowContext(state, [FIXTURE_IDS.intent]);
  assert.equal(model.ok, true);
  if (model.ok) assert.equal(model.date, Object.values(state.protectedBlocks)[0].range.start.slice(0, 10));
  state.protectedBlocks = {};
  assert.equal(resolveNowContext(state, [FIXTURE_IDS.intent]).ok, false);
});

test("invalid explicit date and other-date linked block cannot masquerade as selected interval", () => {
  const state = structuredClone(createInitialState("fixture"));
  state.intents[FIXTURE_IDS.intent].parsedFields.date = "2026-02-30";
  assert.equal(resolveNowContext(state, [FIXTURE_IDS.intent]).ok, false);
  state.intents[FIXTURE_IDS.intent].parsedFields.date = "2026-09-14";
  const model = resolveNowContext(state, [FIXTURE_IDS.intent]);
  assert.equal(model.ok, true);
  if (model.ok) assert.equal(model.hero.protectedInterval, null);
});

test("explicit context excludes unrelated modification status without mutating shared state", () => {
  const state = structuredClone(createInitialState("fixture"));
  const original = state.intents[FIXTURE_IDS.intent];
  state.intents.other = { ...original, id: "other" };
  state.operations.unrelated = { ...original, id: "unrelated", approvalId: "unrelated-approval", changeSetId: "unrelated-change-set", changeSetHash: "unrelated-hash", idempotencyKey: "unrelated-key", stepReceipts: [], status: "unknown", lastError: null, readback: null, resultRefs: [] };
  assert.equal(selectModificationView(state).kind, "unknown");
  const before = structuredClone(state);
  const model = resolveNowContext(state, ["other"]);
  assert.equal(model.ok, true);
  if (model.ok) assert.equal(model.modification.kind, "none");
  assert.deepEqual(state, before);
});
