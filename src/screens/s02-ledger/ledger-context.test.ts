import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../domain/state.ts";
import { FIXTURE_IDS } from "../../domain/ids.ts";
import { buildNowSurfaceModel } from "../s04-plan/planSurfaces.ts";
import { buildMobileNowActions } from "../s15-m-now/mobile-now-actions.ts";
import { resolveLedgerContext } from "./ledger-context.ts";

test("S15 time-card URL resolves the identical active block, intent and displayed date", () => {
  const state = createInitialState("fixture");
  const block = state.protectedBlocks[FIXTURE_IDS.protectedBlock];
  block.blockId = "stable / id";
  const href = buildMobileNowActions(state, buildNowSurfaceModel(state, [])).ledgerHref!;
  const before = JSON.stringify(state);
  const context = resolveLedgerContext(state, new URL(href, "http://local.test").searchParams);
  assert.ok(context.ok);
  assert.equal(context.date, "2026-09-12");
  assert.equal(context.block?.id, block.id);
  assert.equal(context.block?.blockId, "stable / id");
  assert.equal(context.intent?.id, FIXTURE_IDS.intent);
  assert.equal(JSON.stringify(state), before);
});

test("an explicit date wins over the global earliest ledger date and a paused intent keeps its existing boundary", () => {
  const state = createInitialState("fixture");
  const original = state.protectedBlocks[FIXTURE_IDS.protectedBlock];
  state.protectedBlocks.tomorrow = { ...original, id: "tomorrow", blockId: "next-day", range: { ...original.range, start: "2026-09-13T08:00:00+08:00", end: "2026-09-13T09:00:00+08:00" } };
  state.intents[FIXTURE_IDS.intent].status = "paused";
  const context = resolveLedgerContext(state, new URLSearchParams({ intentId: FIXTURE_IDS.intent, date: "2026-09-13", blockId: "next-day" }));
  assert.ok(context.ok);
  assert.equal(context.date, "2026-09-13");
  assert.equal(context.block?.id, "tomorrow");
});

test("default ledger has no artificial focus and any partial, duplicate or malformed explicit context fails closed", () => {
  const state = createInitialState("fixture");
  assert.deepEqual(resolveLedgerContext(state, new URLSearchParams()), { ok: true, date: "2026-09-12", intent: null, block: null });
  const valid = { intentId: FIXTURE_IDS.intent, date: "2026-09-12", blockId: state.protectedBlocks[FIXTURE_IDS.protectedBlock].blockId };
  for (const query of ["date=2026-09-12", "intentId=&date=2026-09-12&blockId=x", new URLSearchParams({ ...valid, date: "2026-02-30" }).toString(), new URLSearchParams(valid).toString() + "&blockId=duplicate"]) {
    assert.equal(resolveLedgerContext(state, new URLSearchParams(query)).ok, false);
  }
});

test("missing intent, mismatched date/intent, released and ambiguous stable block targets fail closed", () => {
  for (const mode of ["missing-intent", "wrong-intent", "wrong-date", "released", "duplicate-block"] as const) {
    const state = createInitialState("fixture");
    const block = state.protectedBlocks[FIXTURE_IDS.protectedBlock];
    const query = new URLSearchParams({ intentId: FIXTURE_IDS.intent, date: "2026-09-12", blockId: block.blockId });
    if (mode === "missing-intent") delete state.intents[FIXTURE_IDS.intent];
    if (mode === "wrong-intent") block.intentId = "different";
    if (mode === "wrong-date") query.set("date", "2026-09-13");
    if (mode === "released") block.status = "released";
    if (mode === "duplicate-block") state.protectedBlocks.duplicate = { ...block, id: "duplicate" };
    assert.equal(resolveLedgerContext(state, query).ok, false, mode);
  }
});
