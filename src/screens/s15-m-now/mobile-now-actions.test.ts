import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../domain/state.ts";
import { FIXTURE_IDS } from "../../domain/ids.ts";
import { buildNowSurfaceModel } from "../s04-plan/planSurfaces.ts";
import { buildMobileNowActions } from "./mobile-now-actions.ts";

test("time card carries the displayed date, exact intent and stable protected block identifier", () => {
  const state = createInitialState("fixture");
  state.protectedBlocks[FIXTURE_IDS.protectedBlock].blockId = "reserved time / private";
  const model = buildNowSurfaceModel(state, [FIXTURE_IDS.intent]);
  const before = JSON.stringify(state);
  assert.ok(model.ready);
  const actions = buildMobileNowActions(state, model);
  assert.ok(actions.ledgerHref);
  const target = new URL(actions.ledgerHref, "http://local.test");
  assert.equal(target.pathname, "/ledger");
  assert.equal(target.searchParams.get("intentId"), model.intentId);
  assert.equal(target.searchParams.get("date"), model.capacity.date);
  assert.equal(target.searchParams.get("blockId"), "reserved time / private");
  assert.equal(actions.setupHref, null);
  assert.equal(JSON.stringify(state), before);
});

test("time card selects the same earliest active protection and never links a released or unrelated block", () => {
  const state = createInitialState("fixture");
  const original = state.protectedBlocks[FIXTURE_IDS.protectedBlock];
  state.protectedBlocks.later = { ...original, id: "later", blockId: "later", range: { ...original.range, start: "2026-09-12T20:00:00+08:00", end: "2026-09-12T21:00:00+08:00" } };
  state.protectedBlocks.earlier = { ...original, id: "earlier", blockId: "earlier", status: "released", range: { ...original.range, start: "2026-09-12T18:00:00+08:00" } };
  state.protectedBlocks.other = { ...original, id: "other", blockId: "other", intentId: "different-intent" };
  const actions = buildMobileNowActions(state, buildNowSurfaceModel(state, [FIXTURE_IDS.intent]));
  assert.equal(new URL(actions.ledgerHref!, "http://local.test").searchParams.get("blockId"), original.blockId);
});

test("empty protection exposes capture setup without inventing a block or losing failure boundaries", () => {
  const state = createInitialState("fixture");
  state.protectedBlocks = {};
  assert.deepEqual(buildMobileNowActions(state, buildNowSurfaceModel(state, [])), { ledgerHref: null, setupHref: "/capture" });
  state.intents = {};
  assert.deepEqual(buildMobileNowActions(state, buildNowSurfaceModel(state, [])), { ledgerHref: null, setupHref: "/capture" });
  assert.deepEqual(buildMobileNowActions(state, buildNowSurfaceModel(state, ["missing"])), { ledgerHref: null, setupHref: null });
});
