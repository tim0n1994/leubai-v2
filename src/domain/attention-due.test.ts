import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "./store.ts";
import { createInitialState } from "./state.ts";
import { dueAttentionItems } from "./attentionDue.ts";
import type { AttentionItem, DomainState, ResurfaceAttentionCommand } from "./types.ts";

const NOW = "2026-09-13T10:00:00+08:00";
function fixture(): DomainState {
  const state = createInitialState("fixture");
  const item: AttentionItem = { id: "due-item", revision: 2, createdAt: NOW, updatedAt: NOW, dataMode: "fixture", provenance: { origin: "user" }, deliveryId: "original-delivery", mergeKey: "", title: "到时再看", body: "保留原文", source: "internal", urgency: "normal", riskBasis: null, status: "deferred", deliveredAt: null, budgetCharged: false };
  state.attention.items = { [item.id]: item };
  state.attention.budget = { ...state.attention.budget, budgetDay: "2026-09-13", used: 0, dailyMax: 2, deliveredIds: [], queue: [{ id: "original-queue", deliveryId: item.deliveryId, title: item.title, mergeKey: "", reason: "user deferred", queuedAt: NOW, dueAt: NOW }] };
  return state;
}
function command(state: DomainState, id = "resurface-original"): ResurfaceAttentionCommand {
  return { type: "resurfaceAttention", commandId: id, actor: "automation", issuedAt: NOW, entityId: "due-item", expectedRevision: state.attention.items["due-item"].revision };
}

test("due resurface keeps original item and delivery IDs, removes only its schedule and charges once", async () => {
  const state = fixture();
  state.attention.budget.queue.push({ ...state.attention.budget.queue[0], id: "other-queue", deliveryId: "other-delivery", dueAt: null });
  const store = createDomainStore({ dataMode: "fixture", initialState: state, now: () => NOW });
  const cmd = command(state);
  const result = await store.execute(cmd);
  assert.ok(result.ok);
  assert.equal(result.data.resurfaced, true);
  const item = store.getState().attention.items["due-item"];
  assert.equal(item.status, "delivered");
  assert.equal(item.deliveryId, "original-delivery");
  assert.equal(item.body, "保留原文");
  assert.equal(Object.keys(store.getState().attention.items).length, 1);
  assert.deepEqual(store.getState().attention.budget.queue.map(entry => entry.id), ["other-queue"]);
  assert.equal(store.getState().attention.budget.used, 1);
  assert.ok((await store.execute(cmd)).ok);
  assert.ok((await store.execute(command(store.getState(), "second-command"))).ok);
  assert.equal(store.getState().attention.budget.used, 1);
});

test("before due, indefinite, paused, dismissed and exhausted normal entries do not resurface", async () => {
  for (const scenario of ["future", "indefinite", "paused", "dismissed", "budget"] as const) {
    const state = fixture();
    if (scenario === "future") state.attention.budget.queue[0].dueAt = "2026-09-13T10:00:01+08:00";
    if (scenario === "indefinite") state.attention.budget.queue[0].dueAt = null;
    if (scenario === "paused") state.ruleset.paused = true;
    if (scenario === "dismissed") state.attention.items["due-item"].status = "dismissed";
    if (scenario === "budget") state.attention.budget.used = 2;
    assert.deepEqual(dueAttentionItems(state, NOW), [], scenario);
    const store = createDomainStore({ dataMode: "fixture", initialState: state, now: () => NOW });
    const result = await store.execute(command(state));
    assert.ok(result.ok);
    assert.equal(result.data.resurfaced, false, scenario);
    assert.equal(store.getState(), state, scenario);
  }
});

test("same-day previously charged delivery resurfaces without another budget charge", async () => {
  const state = fixture();
  state.attention.budget.used = 2;
  state.attention.budget.deliveredIds = ["original-delivery", "other"];
  state.attention.items["due-item"].budgetCharged = true;
  const store = createDomainStore({ dataMode: "fixture", initialState: state, now: () => NOW });
  const result = await store.execute(command(state));
  assert.ok(result.ok);
  assert.equal(result.data.resurfaced, true);
  assert.equal(store.getState().attention.budget.used, 2);
  assert.deepEqual(store.getState().attention.budget.deliveredIds, state.attention.budget.deliveredIds);
});

test("timezone day rollover resets budget without losing deferred queue, including regular delivery rollover", async () => {
  const state = fixture();
  state.attention.budget.budgetDay = "2026-09-12";
  state.attention.budget.used = 2;
  state.attention.budget.deliveredIds = ["original-delivery"];
  const store = createDomainStore({ dataMode: "fixture", initialState: state, now: () => "2026-09-12T16:00:00Z" });
  const result = await store.execute({ type: "deliverAttention", commandId: "new-day-other", actor: "automation", issuedAt: NOW, entityId: null, expectedRevision: null, deliveryId: "new-day-other", title: "另一个条目", source: "internal", urgency: "normal" });
  assert.ok(result.ok);
  assert.equal(store.getState().attention.budget.budgetDay, "2026-09-13");
  assert.equal(store.getState().attention.budget.queue.length, 1, "rollover must preserve future deferred entries");
  const dueStore = createDomainStore({ dataMode: "fixture", initialState: state, now: () => NOW });
  assert.ok((await dueStore.execute(command(state))).ok);
  assert.equal(dueStore.getState().attention.budget.used, 1);
});

test("rescheduling invalidates an old resurfacing revision and model cannot trigger delivery", async () => {
  const state = fixture();
  const store = createDomainStore({ dataMode: "fixture", initialState: state, now: () => NOW });
  const old = command(state);
  await store.execute({ type: "deferAttention", commandId: "move-due", actor: "user", issuedAt: NOW, entityId: "due-item", expectedRevision: 2, dueAt: "2026-09-14T10:00:00+08:00" });
  const stale = await store.execute(old);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "REVISION_CONFLICT");
  assert.equal((await store.execute({ ...command(store.getState()), actor: "model" })).ok, false);
  assert.equal(store.getState().attention.items["due-item"].status, "deferred");
});

test("due timestamps compare instants across offsets and credible risk alone can bypass budget", () => {
  const state = fixture();
  state.attention.budget.queue[0].dueAt = "2026-09-13T02:00:00Z";
  assert.equal(dueAttentionItems(state, NOW).length, 1);
  state.attention.budget.used = 2;
  state.attention.items["due-item"].urgency = "urgentClaim";
  assert.equal(dueAttentionItems(state, NOW).length, 0);
  state.attention.items["due-item"].urgency = "risk";
  state.attention.items["due-item"].riskBasis = { deadline: NOW, consequence: "test risk", credibleSource: true };
  assert.equal(dueAttentionItems(state, NOW).length, 1);
});
