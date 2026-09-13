/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, createInitialState } from "./index.ts";
import type { StoreCommitOutcome } from "./store.ts";
import type {
  AttentionItem,
  AttentionStatus,
  CommandDataOf,
  CommandResult,
  DeferAttentionCommand,
  DomainCommand,
  DomainState,
  QueueEntry,
} from "./types.ts";

const NOW = "2026-09-12T10:00:00+08:00";
const DUE_AT = "2026-09-13T09:30:00+08:00";
const DUE_LATER = "2026-09-14T15:00:00+08:00";

let itemSeq = 0;
let cmdSeq = 0;

function craftItem(status: AttentionStatus, over: Partial<AttentionItem> = {}): AttentionItem {
  itemSeq += 1;
  return {
    id: "att-" + itemSeq,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    dataMode: "fixture",
    provenance: { origin: "fixture" },
    deliveryId: "delivery-" + itemSeq,
    mergeKey: "merge-" + itemSeq,
    title: "条目 " + itemSeq,
    body: "正文",
    source: "internal",
    urgency: "normal",
    riskBasis: null,
    status,
    deliveredAt: status === "delivered" ? NOW : null,
    budgetCharged: status === "delivered",
    ...over,
  };
}

function craftQueueRow(item: AttentionItem, over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "queue-for-" + item.deliveryId,
    deliveryId: item.deliveryId,
    mergeKey: item.mergeKey,
    title: item.title,
    reason: "daily attention budget exhausted",
    queuedAt: "2026-09-12T08:00:00+08:00",
    dueAt: null,
    ...over,
  };
}

function stateWith(items: AttentionItem[], queue: QueueEntry[]): DomainState {
  const state = structuredClone(createInitialState("fixture"));
  state.attention.items = Object.fromEntries(items.map((i) => [i.id, i]));
  state.attention.budget = { ...state.attention.budget, queue };
  return state;
}

function newStore(
  state: DomainState,
  commit?: (expectedGlobalRevision: number, next: DomainState) => Promise<StoreCommitOutcome>,
) {
  let uuidSeq = 0;
  return createDomainStore({
    dataMode: "fixture",
    initialState: structuredClone(state),
    now: () => NOW,
    uuid: () => {
      uuidSeq += 1;
      return "test-uuid-" + uuidSeq;
    },
    commit,
  });
}

function deferCmd(
  item: AttentionItem,
  expectedRevision: number | null,
  dueAt: string | null,
  over: Partial<Pick<DeferAttentionCommand, "commandId" | "actor">> = {},
): DeferAttentionCommand {
  cmdSeq += 1;
  return {
    type: "deferAttention",
    commandId: over.commandId ?? "defer-cmd-" + cmdSeq,
    entityId: item.id,
    expectedRevision,
    actor: over.actor ?? "user",
    issuedAt: NOW,
    dueAt,
  };
}

function asOk<C extends DomainCommand>(result: CommandResult<C>): CommandDataOf<C> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

test("deferAttention persists dueAt for pending, delivered, queued, and merged items", async () => {
  for (const status of ["pending", "delivered", "queued", "merged"] as const) {
    const item = craftItem(status);
    const hasPriorRow = status === "queued" || status === "merged";
    const priorRow = hasPriorRow ? craftQueueRow(item) : null;
    const base = stateWith([item], priorRow ? [priorRow] : []);
    const store = newStore(base);

    const data = asOk(await store.execute(deferCmd(item, item.revision, DUE_AT)));
    assert.equal(data.item.status, "deferred");

    const next = store.getState();
    const stored = next.attention.items[item.id];
    assert.equal(stored.status, "deferred");
    assert.equal(stored.revision, item.revision + 1);
    assert.equal(stored.budgetCharged, item.budgetCharged);
    assert.equal(stored.deliveredAt, item.deliveredAt);

    const rows = next.attention.budget.queue.filter((q) => q.deliveryId === item.deliveryId);
    assert.equal(rows.length, 1, status + " must keep exactly one queue row for its deliveryId");
    assert.equal(rows[0].dueAt, DUE_AT);
    if (priorRow) {
      assert.equal(rows[0].id, priorRow.id);
      assert.equal(rows[0].queuedAt, priorRow.queuedAt);
      assert.equal(rows[0].title, priorRow.title);
      assert.equal(rows[0].mergeKey, priorRow.mergeKey);
      assert.equal(rows[0].reason, priorRow.reason);
    } else {
      assert.ok(rows[0].id.length > 0);
      assert.equal(rows[0].deliveryId, item.deliveryId);
      assert.equal(rows[0].mergeKey, item.mergeKey);
      assert.equal(rows[0].title, item.title);
      assert.equal(rows[0].queuedAt, NOW);
      assert.ok(/defer/i.test(rows[0].reason), "new row must carry an honest deferral reason");
    }

    assert.equal(next.attention.budget.used, base.attention.budget.used);
    assert.deepEqual(next.attention.budget.deliveredIds, base.attention.budget.deliveredIds);
    assert.equal(next.attention.budget.budgetDay, base.attention.budget.budgetDay);
    assert.equal(next.attention.budget.timezone, base.attention.budget.timezone);

    assert.equal(next.attention.budget.revision, base.attention.budget.revision + 1);
    const lastEvent = next.events[next.events.length - 1];
    assert.equal(lastEvent.type, "attention.deferred");
    const changed = new Set(lastEvent.entityRevisions.map((c) => c.entityId));
    assert.ok(changed.has(item.id), "event must include the item revision");
    assert.ok(changed.has(next.attention.budget.id), "event must include the budget revision");
  }
});

test("deferAttention upserts only the exact deliveryId row and preserves unrelated rows", async () => {
  const target = craftItem("pending");
  const other = craftItem("queued");
  const otherRow = craftQueueRow(other);
  const decoyRow = craftQueueRow(target, { id: "queue-decoy", deliveryId: target.deliveryId + "-near" });
  const base = stateWith([target, other], [otherRow, decoyRow]);
  const store = newStore(base);

  asOk(await store.execute(deferCmd(target, target.revision, DUE_AT)));

  const queue = store.getState().attention.budget.queue;
  assert.equal(queue.length, 3);
  assert.deepEqual(queue.find((q) => q.deliveryId === other.deliveryId), otherRow);
  assert.deepEqual(queue.find((q) => q.deliveryId === decoyRow.deliveryId), decoyRow);
  const targetRows = queue.filter((q) => q.deliveryId === target.deliveryId);
  assert.equal(targetRows.length, 1);
  assert.equal(targetRows[0].dueAt, DUE_AT);
  assert.equal(targetRows[0].mergeKey, target.mergeKey);
  assert.equal(targetRows[0].title, target.title);
});

test("deferAttention with null dueAt still persists the schedule row", async () => {
  const item = craftItem("pending");
  const store = newStore(stateWith([item], []));

  const data = asOk(await store.execute(deferCmd(item, item.revision, null)));
  assert.equal(data.item.status, "deferred");

  const rows = store.getState().attention.budget.queue.filter((q) => q.deliveryId === item.deliveryId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dueAt, null);
});

test("deferAttention rejects invalid dueAt with INVALID_INPUT and no mutation", async () => {
  for (const badDueAt of ["not-a-date", "", "2026-09-13", "2026-09-13T09:00:00"]) {
    const item = craftItem("pending");
    const base = stateWith([item], []);
    const store = newStore(base);

    const result = await store.execute(deferCmd(item, item.revision, badDueAt));
    assert.equal(result.ok, false, badDueAt + " must be rejected");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    assert.deepEqual(store.getState(), base);
  }
});

test("deferAttention requires the current non-null revision envelope", async () => {
  const item = craftItem("pending");
  const base = stateWith([item], []);

  const nullStore = newStore(base);
  const nullResult = await nullStore.execute(deferCmd(item, null, DUE_AT));
  assert.equal(nullResult.ok, false);
  if (!nullResult.ok) assert.equal(nullResult.code, "INVALID_INPUT");
  assert.deepEqual(nullStore.getState(), base);

  const staleStore = newStore(base);
  const staleResult = await staleStore.execute(deferCmd(item, item.revision - 1, DUE_AT));
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.code, "REVISION_CONFLICT");
  assert.deepEqual(staleStore.getState(), base);
});

test("deferAttention requires the user actor", async () => {
  const item = craftItem("pending");
  const base = stateWith([item], []);
  const store = newStore(base);

  const result = await store.execute(deferCmd(item, item.revision, DUE_AT, { actor: "model" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "USER_ONLY");
  assert.deepEqual(store.getState(), base);
});

test("deferAttention still rejects dismissed items", async () => {
  const item = craftItem("dismissed");
  const base = stateWith([item], []);
  const store = newStore(base);

  const result = await store.execute(deferCmd(item, item.revision, DUE_AT));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_TRANSITION");
  assert.deepEqual(store.getState(), base);
});

test("commit failure leaves both the item and the queue unchanged", async () => {
  const item = craftItem("pending");
  const base = stateWith([item], []);
  let commitCalls = 0;
  const store = newStore(base, async () => {
    commitCalls += 1;
    return { ok: false, code: "STORAGE_WRITE_FAILED", reason: "simulated disk full", retryable: true };
  });

  const result = await store.execute(deferCmd(item, item.revision, DUE_AT));
  assert.equal(result.ok, false);
  assert.equal(commitCalls, 1);
  assert.deepEqual(store.getState(), base);
});

test("same commandId replay adds no duplicate queue row or extra revisions", async () => {
  const item = craftItem("pending");
  const store = newStore(stateWith([item], []));
  const command = deferCmd(item, item.revision, DUE_AT, { commandId: "replay-cmd-1" });

  asOk(await store.execute(command));
  const afterFirst = store.getState();
  assert.equal(afterFirst.attention.items[item.id].revision, item.revision + 1);

  asOk(await store.execute({ ...command }));
  const afterReplay = store.getState();
  assert.equal(afterReplay.globalRevision, afterFirst.globalRevision);
  assert.equal(afterReplay.events.length, afterFirst.events.length);
  assert.equal(afterReplay.attention.items[item.id].revision, item.revision + 1);
  const rows = afterReplay.attention.budget.queue.filter((q) => q.deliveryId === item.deliveryId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dueAt, DUE_AT);
});

test("a fresh defer command upserts the same queue row", async () => {
  const item = craftItem("pending");
  const store = newStore(stateWith([item], []));

  const first = asOk(await store.execute(deferCmd(item, item.revision, DUE_AT)));
  const rowsBefore = store.getState().attention.budget.queue.filter((q) => q.deliveryId === item.deliveryId);
  assert.equal(rowsBefore.length, 1);

  const second = asOk(await store.execute(deferCmd(item, first.item.revision, DUE_LATER)));
  assert.equal(second.item.revision, item.revision + 2);
  const rowsAfter = store.getState().attention.budget.queue.filter((q) => q.deliveryId === item.deliveryId);
  assert.equal(rowsAfter.length, 1);
  assert.equal(rowsAfter[0].id, rowsBefore[0].id);
  assert.equal(rowsAfter[0].dueAt, DUE_LATER);
});

test("the deferred schedule survives store recreation from a cloned saved state", async () => {
  const item = craftItem("pending");
  const store = newStore(stateWith([item], []));
  asOk(await store.execute(deferCmd(item, item.revision, DUE_AT)));

  const savedState = structuredClone(store.getState());
  const reborn = createDomainStore({
    dataMode: "fixture",
    initialState: structuredClone(savedState),
    now: () => NOW,
  });

  assert.equal(reborn.getState().attention.items[item.id].status, "deferred");
  const row = reborn.getState().attention.budget.queue.find((q) => q.deliveryId === item.deliveryId);
  assert.equal(row?.dueAt, DUE_AT);
  assert.deepEqual(reborn.getState().attention.budget.queue, savedState.attention.budget.queue);
});
