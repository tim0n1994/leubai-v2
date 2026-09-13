import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, type DomainStore } from "../../domain/store.ts";
import type {
  AttentionItem,
  DeliverAttentionCommand,
  DeferAttentionCommand,
  DismissAttentionCommand,
  RiskBasis,
} from "../../domain/types.ts";
import {
  attentionDisclosure,
  basisLines,
  dayRemaining,
  isAttentionEmpty,
  parseDeferredDueAt,
  planAttentionRetry,
  selectAttentionGroups,
  selectAttentionItemRef,
  silentTag,
  urgencyLabel,
  verifyDeferReadback,
  verifyDismissReadback,
} from "./attentionSurface.ts";

const FIXED_NOW = "2026-09-12T01:00:00.000Z";
let uuidSeq = 0;
let commandSeq = 0;

function makeStore(): DomainStore {
  uuidSeq = 0;
  commandSeq = 0;
  return createDomainStore({
    dataMode: "fixture",
    now: () => FIXED_NOW,
    uuid: () => {
      uuidSeq += 1;
      return "uuid-" + String(uuidSeq);
    },
  });
}

function deliver(params: {
  deliveryId: string;
  source: DeliverAttentionCommand["source"];
  urgency: DeliverAttentionCommand["urgency"];
  riskBasis?: RiskBasis | null;
}): DeliverAttentionCommand {
  commandSeq += 1;
  return {
    type: "deliverAttention",
    commandId: "cmd-deliver-" + String(commandSeq),
    entityId: null,
    expectedRevision: null,
    actor: "automation",
    issuedAt: FIXED_NOW,
    title: "测试条目 " + params.deliveryId,
    ...params,
  };
}

function makeItem(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: "item-x",
    revision: 1,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    dataMode: "fixture",
    provenance: { origin: "system" },
    deliveryId: "dx",
    mergeKey: "mk",
    title: "测试条目",
    body: "",
    source: "ai",
    urgency: "normal",
    riskBasis: null,
    status: "deferred",
    deliveredAt: null,
    budgetCharged: false,
    ...overrides,
  };
}

test("silent tags never imply a refund for previously charged items", () => {
  assert.match(silentTag(makeItem({ status: "deferred", budgetCharged: false })), /未占用提醒预算/);
  const chargedDeferred = silentTag(makeItem({ status: "deferred", budgetCharged: true }));
  assert.match(chargedDeferred, /已计入今日已用提醒/);
  assert.doesNotMatch(chargedDeferred, /未占用提醒预算/);
  assert.match(silentTag(makeItem({ status: "merged", budgetCharged: true })), /已计入今日已用提醒/);
  assert.match(silentTag(makeItem({ status: "pending", budgetCharged: false })), /没有触发提醒/);
});

function dismiss(item: AttentionItem): DismissAttentionCommand {
  commandSeq += 1;
  return {
    type: "dismissAttention",
    commandId: "cmd-dismiss-" + String(commandSeq),
    entityId: item.id,
    expectedRevision: item.revision,
    actor: "user",
    issuedAt: FIXED_NOW,
  };
}

function defer(item: AttentionItem, dueAt: string | null): DeferAttentionCommand {
  commandSeq += 1;
  return {
    type: "deferAttention",
    commandId: "cmd-defer-" + String(commandSeq),
    entityId: item.id,
    expectedRevision: item.revision,
    actor: "user",
    issuedAt: FIXED_NOW,
    dueAt,
  };
}

test("fixture seed state is an honest empty queue", () => {
  const store = makeStore();
  const groups = selectAttentionGroups(store.getState());
  assert.equal(groups.judgment.length, 0);
  assert.equal(groups.queue.length, 0);
  assert.equal(groups.silent.length, 0);
  assert.equal(isAttentionEmpty(groups), true);
});

test("queue entries without a matching item surface as missing, not fabricated", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-1", source: "external", urgency: "normal" }));
  await store.execute(deliver({ deliveryId: "d-2", source: "external", urgency: "normal" }));
  await store.execute(deliver({ deliveryId: "d-3", source: "external", urgency: "normal" }));
  const full = selectAttentionGroups(store.getState());
  assert.equal(full.queue.length, 2);
  const broken = structuredClone(store.getState());
  const queuedItem = full.queue[1].item;
  assert.ok(queuedItem);
  delete broken.attention.items[queuedItem.id];
  const groups = selectAttentionGroups(broken);
  assert.equal(groups.queue.length, 2);
  assert.ok(groups.queue[0].item);
  assert.equal(groups.queue[1].item, null);
  assert.equal(groups.queue[1].entry.deliveryId, "d-3");
});

test("credible risk bypasses an exhausted budget; unsupported urgent claims do not", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-base", source: "internal", urgency: "normal" }));
  assert.equal(store.getState().attention.budget.used, 2);
  const urgent = await store.execute(
    deliver({ deliveryId: "d-urgent", source: "external", urgency: "urgentClaim" }),
  );
  assert.ok(urgent.ok);
  if (urgent.ok) {
    assert.equal(urgent.data.outcome.budgetCharged, false);
    assert.equal(urgent.data.item.status, "queued");
  }
  const risk = await store.execute(
    deliver({
      deliveryId: "d-risk",
      source: "risk",
      urgency: "risk",
      riskBasis: { deadline: "2026-09-15T18:00:00+08:00", consequence: "逾期将产生滞纳金", credibleSource: true },
    }),
  );
  assert.ok(risk.ok);
  if (risk.ok) {
    assert.equal(risk.data.outcome.budgetCharged, true);
    assert.equal(risk.data.item.status, "delivered");
  }
  const groups = selectAttentionGroups(store.getState());
  assert.equal(groups.judgment.length, 2);
  assert.ok(groups.judgment.some((item) => item.deliveryId === "d-base"));
  const riskItem = groups.judgment.find((item) => item.deliveryId === "d-risk");
  assert.ok(riskItem);
  assert.deepEqual(basisLines(riskItem), {
    deadline: "2026-09-15T18:00:00+08:00",
    consequence: "逾期将产生滞纳金",
    credible: true,
  });
  assert.match(urgencyLabel("urgentClaim"), /未经核实/);
});

test("AI suggestions share the same daily budget as other sources", async () => {
  const store = makeStore();
  const first = await store.execute(deliver({ deliveryId: "ai-1", source: "ai", urgency: "normal" }));
  assert.ok(first.ok);
  if (first.ok) assert.equal(first.data.outcome.budgetCharged, true);
  const disclosureAfterFirst = attentionDisclosure(store.getState().attention.budget);
  assert.equal(disclosureAfterFirst.used, 2);
  assert.equal(disclosureAfterFirst.remaining, 0);
  const second = await store.execute(deliver({ deliveryId: "ai-2", source: "ai", urgency: "normal" }));
  assert.ok(second.ok);
  if (second.ok) {
    assert.equal(second.data.outcome.budgetCharged, false);
    assert.equal(second.data.outcome.queued, true);
  }
  const disclosureAfterSecond = attentionDisclosure(store.getState().attention.budget);
  assert.equal(disclosureAfterSecond.deliveredCount, 2);
  assert.equal(disclosureAfterSecond.queueCount, 1);
  assert.equal(disclosureAfterSecond.remaining, 0);
});

test("day remaining clamps at zero instead of going negative", () => {
  const store = makeStore();
  const state = structuredClone(store.getState());
  state.attention.budget.used = 5;
  const budget = state.attention.budget;
  assert.equal(dayRemaining(budget), 0);
  assert.equal(attentionDisclosure(budget).remaining, 0);
  budget.used = 1;
  assert.equal(dayRemaining(budget), 1);
});

test("defer input parsing rejects unparseable text and accepts empty as no fixed time", () => {
  const bad = parseDeferredDueAt("next friday maybe");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /无法识别/);
  const empty = parseDeferredDueAt("   ");
  assert.deepEqual(empty, { ok: true, dueAt: null });
  const good = parseDeferredDueAt("2026-09-20T10:00");
  assert.ok(good.ok);
  if (good.ok) assert.equal(good.dueAt, "2026-09-20T02:00:00.000Z");
});

test("dismiss lands, readback verifies, and the item leaves every queue group", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-1", source: "external", urgency: "normal" }));
  const item = selectAttentionGroups(store.getState()).judgment[0];
  const result = await store.execute(dismiss(item));
  assert.ok(result.ok);
  const ref = selectAttentionItemRef(store.getState(), item.id);
  assert.ok(ref);
  if (ref) {
    assert.deepEqual(verifyDismissReadback(store.getState(), store.getState(), ref), {
      ok: true,
      dueAtRecorded: null,
    });
  }
  const after = selectAttentionGroups(store.getState());
  assert.equal(after.judgment.length, 0);
  assert.equal(after.queue.length, 0);
  assert.equal(after.silent.length, 0);
  assert.equal(store.getState().attention.items[item.id].status, "dismissed");
});

test("deferring a queued item with a dueAt records the time in the queue entry", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-base", source: "internal", urgency: "normal" }));
  await store.execute(deliver({ deliveryId: "d-q", source: "external", urgency: "normal" }));
  const queuedGroups = selectAttentionGroups(store.getState());
  assert.equal(queuedGroups.queue.length, 1);
  const queuedItem = queuedGroups.queue[0].item;
  assert.ok(queuedItem);
  const dueAt = "2026-09-14T09:00:00.000Z";
  const result = await store.execute(defer(queuedItem, dueAt));
  assert.ok(result.ok);
  const ref = selectAttentionItemRef(store.getState(), queuedItem.id);
  assert.ok(ref);
  if (ref) {
    const check = verifyDeferReadback(store.getState(), store.getState(), ref, dueAt);
    assert.equal(check.ok, true);
    if (check.ok) assert.equal(check.dueAtRecorded, true);
    assert.equal(store.getState().attention.budget.queue[0].dueAt, dueAt);
    const drifted = structuredClone(store.getState());
    drifted.attention.budget.queue[0].dueAt = "2026-09-15T09:00:00.000Z";
    const mismatch = verifyDeferReadback(drifted, drifted, ref, dueAt);
    assert.equal(mismatch.ok, false);
  }
  const afterDefer = selectAttentionGroups(store.getState());
  assert.equal(afterDefer.queue.length, 1);
  assert.equal(afterDefer.queue[0].item?.status, "deferred");
  assert.equal(afterDefer.silent.length, 0);
});

test("deferring a delivered item records the requested time through a queue entry", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-1", source: "external", urgency: "normal" }));
  const item = selectAttentionGroups(store.getState()).judgment[0];
  const dueAt = "2026-09-16T09:00:00.000Z";
  const result = await store.execute(defer(item, dueAt));
  assert.ok(result.ok);
  const ref = selectAttentionItemRef(store.getState(), item.id);
  assert.ok(ref);
  if (ref) {
    const check = verifyDeferReadback(store.getState(), store.getState(), ref, dueAt);
    assert.equal(check.ok, true);
    if (check.ok) assert.equal(check.dueAtRecorded, true);
    const withoutTime = verifyDeferReadback(store.getState(), store.getState(), ref, null);
    assert.deepEqual(withoutTime, { ok: true, dueAtRecorded: null });
    const drifted = structuredClone(store.getState());
    drifted.attention.budget.queue = drifted.attention.budget.queue.filter(
      (row) => row.deliveryId !== item.deliveryId,
    );
    const honest = verifyDeferReadback(drifted, drifted, ref, dueAt);
    assert.equal(honest.ok, true);
    if (honest.ok) assert.equal(honest.dueAtRecorded, false);
  }
});

test("persisted-null readback never reports success", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-1", source: "external", urgency: "normal" }));
  const item = selectAttentionGroups(store.getState()).judgment[0];
  await store.execute(dismiss(item));
  const ref = selectAttentionItemRef(store.getState(), item.id);
  assert.ok(ref);
  if (ref) {
    const dismissUnknown = verifyDismissReadback(store.getState(), null, ref);
    assert.equal(dismissUnknown.ok, false);
    if (!dismissUnknown.ok) assert.equal(dismissUnknown.persistedUnknown, true);
  }
});

test("mismatched persisted state is caught as unverified", async () => {
  const store = makeStore();
  await store.execute(deliver({ deliveryId: "d-1", source: "external", urgency: "normal" }));
  const item = selectAttentionGroups(store.getState()).judgment[0];
  const persistedBefore = structuredClone(store.getState());
  await store.execute(dismiss(item));
  const ref = selectAttentionItemRef(store.getState(), item.id);
  assert.ok(ref);
  if (ref) {
    const stale = verifyDismissReadback(store.getState(), persistedBefore, ref);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.persistedUnknown, true);
    const stillQueued = structuredClone(store.getState());
    stillQueued.attention.budget.queue.push({
      id: "q-extra",
      deliveryId: item.deliveryId,
      mergeKey: "",
      title: item.title,
      reason: "test",
      queuedAt: FIXED_NOW,
      dueAt: null,
    });
    const queuedCheck = verifyDismissReadback(stillQueued, stillQueued, ref);
    assert.equal(queuedCheck.ok, false);
    if (!queuedCheck.ok) assert.match(queuedCheck.reason, /合并队列/);
  }
});

test("retry planning distinguishes revision conflicts from replayable failures", () => {
  assert.equal(planAttentionRetry("REVISION_CONFLICT"), "recapture");
  assert.equal(planAttentionRetry("STORAGE_WRITE_FAILED"), "replayExact");
  assert.equal(planAttentionRetry("INVALID_TRANSITION"), "replayExact");
});
