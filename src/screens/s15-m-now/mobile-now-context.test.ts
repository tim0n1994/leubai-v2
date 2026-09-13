import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, FIXTURE_IDS } from "../../domain/index.ts";
import { buildNowSurfaceModel } from "../s04-plan/planSurfaces.ts";
import { buildMobileNowSurfaceModel } from "./mobile-now-context.ts";
import { buildMobileNowActions } from "./mobile-now-actions.ts";

test("explicit mobile intent keeps different date and America/New_York block into ledger", () => {
  const state = structuredClone(createInitialState("fixture"));
  const original = state.intents[FIXTURE_IDS.intent];
  state.intents.newYork = { ...original, id: "newYork", parsedFields: { ...original.parsedFields, date: "2026-09-14", timezone: "America/New_York" } };
  const block = Object.values(state.protectedBlocks)[0];
  state.protectedBlocks.newYork = { ...block, id: "newYork-block", blockId: "newYork-stable", intentId: "newYork", range: { start: "2026-09-14T21:00:00-04:00", end: "2026-09-14T22:00:00-04:00", timezone: "America/New_York" } };
  const model = buildMobileNowSurfaceModel(state, ["newYork"]);
  assert.equal(model.ready, true);
  if (!model.ready) return;
  assert.equal(model.capacity.date, "2026-09-14");
  assert.equal(model.heroRangeLabel, "21:00—22:00");
  assert.match(model.dateLabel, /America\/New_York/);
  const actions = buildMobileNowActions(state, model);
  assert.ok(actions.ledgerHref);
  const target = new URL(actions.ledgerHref, "https://example.test");
  assert.equal(target.searchParams.get("date"), "2026-09-14");
  assert.equal(target.searchParams.get("intentId"), "newYork");
  assert.equal(target.searchParams.get("blockId"), "newYork-stable");
});

test("no explicit query preserves the default mobile model exactly", () => {
  const state = createInitialState("fixture");
  assert.deepEqual(buildMobileNowSurfaceModel(state, []), buildNowSurfaceModel(state, []));
});

test("invalid, duplicate, paused and deleted mobile intent IDs expose no actions", () => {
  const state = structuredClone(createInitialState("fixture"));
  for (const values of [[""], ["missing"], [FIXTURE_IDS.intent, FIXTURE_IDS.intent]]) {
    const model = buildMobileNowSurfaceModel(state, values);
    assert.equal(model.ready, false);
    assert.deepEqual(buildMobileNowActions(state, model), { ledgerHref: null, setupHref: null });
  }
  for (const status of ["paused", "deleted"] as const) {
    state.intents[FIXTURE_IDS.intent].status = status;
    assert.equal(buildMobileNowSurfaceModel(state, [FIXTURE_IDS.intent]).ready, false);
  }
});

test("explicit mobile intent with unknown date and no linked block does not borrow global fixture date", () => {
  const state = structuredClone(createInitialState("fixture"));
  const original = state.intents[FIXTURE_IDS.intent];
  state.intents.unknown = { ...original, id: "unknown", parsedFields: { ...original.parsedFields, date: null } };
  const model = buildMobileNowSurfaceModel(state, ["unknown"]);
  assert.equal(model.ready, false);
  assert.deepEqual(buildMobileNowActions(state, model), { ledgerHref: null, setupHref: null });
});
