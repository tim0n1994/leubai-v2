import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryStorage } from "../data/storage.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { attentionDueController, startAttentionDueRuntime } from "./attentionDue.ts";
import { selectAttentionGroups } from "../screens/s09-attention/attentionSurface.ts";
import type { StorageLike } from "../data/storage.ts";

async function prepared(storage: StorageLike = new InMemoryStorage()) {
  let now = "2026-09-13T10:00:00+08:00";
  const handle = await createPersistedDomainStore({ dataMode: "fixture", storage, now: () => now });
  assert.equal(handle.status, "ready");
  if (handle.status !== "ready") throw new Error("test fixture unavailable");
  const delivered = await handle.store.execute({ type: "deliverAttention", commandId: "test-delivery", actor: "user", issuedAt: now, entityId: null, expectedRevision: null, deliveryId: "test-original-delivery", title: "到期本地条目", source: "internal", urgency: "normal" });
  assert.ok(delivered.ok);
  const item = delivered.data.item;
  const deferred = await handle.store.execute({ type: "deferAttention", commandId: "test-defer", actor: "user", issuedAt: now, entityId: item.id, expectedRevision: item.revision, dueAt: "2026-09-13T10:01:00+08:00" });
  assert.ok(deferred.ok);
  let ids = 0;
  const controller = attentionDueController(handle, { now: () => now, uuid: () => "runtime-command-" + ++ids });
  return { handle, controller, itemId: item.id, setNow: (value: string) => { now = value; }, ids: () => ids };
}

test("runtime tick resurfaces only after due and persists original identity across reload", async () => {
  const storage = new InMemoryStorage();
  const fixture = await prepared(storage);
  await fixture.controller.tick();
  assert.equal(fixture.ids(), 0);
  fixture.setNow("2026-09-13T10:01:00+08:00");
  await fixture.controller.tick();
  await fixture.controller.tick();
  assert.equal(fixture.ids(), 1);
  assert.equal(selectAttentionGroups(fixture.handle.store.getState()).judgment[0].id, fixture.itemId);
  const reloaded = await createPersistedDomainStore({ dataMode: "fixture", storage });
  assert.equal(reloaded.status, "ready");
  if (reloaded.status !== "ready") return;
  assert.equal(reloaded.store.getState().attention.items[fixture.itemId].status, "delivered");
  assert.equal(reloaded.store.getState().attention.items[fixture.itemId].deliveryId, "test-original-delivery");
});

test("postwrite unknown retains original command through controller reuse and retries without another write", async () => {
  const memory = new InMemoryStorage();
  let armed = false;
  let failedRead = false;
  let writes = 0;
  const storage: StorageLike = { getItem(key) { if (failedRead) throw new Error("test readback failure"); return memory.getItem(key); }, setItem(key, raw) { writes++; memory.setItem(key, raw); if (armed) { armed = false; failedRead = true; } }, removeItem(key) { memory.removeItem(key); } };
  const fixture = await prepared(storage);
  fixture.setNow("2026-09-13T10:01:00+08:00");
  armed = true;
  const before = writes;
  await fixture.controller.tick();
  const pending = fixture.controller.getSnapshot().pending;
  assert.ok(pending);
  assert.equal(fixture.controller.getSnapshot().error?.code, "STORAGE_READBACK_UNVERIFIED");
  assert.equal(fixture.handle.store.getState().attention.items[fixture.itemId].status, "deferred");
  failedRead = false;
  const same = attentionDueController(fixture.handle);
  assert.equal(same, fixture.controller);
  await same.tick();
  assert.equal(writes, before + 1);
  assert.equal(fixture.ids(), 1);
  assert.equal(same.getSnapshot().pending, null);
  assert.equal(fixture.handle.store.getState().attention.items[fixture.itemId].status, "delivered");
});

test("an unrelated pending write blocks new due automation until exact user command settles", async () => {
  const memory = new InMemoryStorage();
  let rejectWrite = false;
  const storage: StorageLike = { getItem: key => memory.getItem(key), setItem(key, raw) { if (rejectWrite) throw new Error("test prewrite failure"); memory.setItem(key, raw); }, removeItem: key => memory.removeItem(key) };
  const fixture = await prepared(storage);
  const cmd = { type: "saveCaptureDraft" as const, commandId: "other-user-write", actor: "user" as const, issuedAt: "2026-09-13T10:00:00+08:00", entityId: null, expectedRevision: null, raw: "用户未决原文", channel: "text" as const };
  rejectWrite = true;
  assert.equal((await fixture.handle.store.execute(cmd)).ok, false);
  assert.equal(fixture.handle.store.hasPendingWrites(), true);
  rejectWrite = false;
  fixture.setNow("2026-09-13T10:01:00+08:00");
  await fixture.controller.tick();
  assert.equal(fixture.ids(), 0);
  assert.ok((await fixture.handle.store.execute(cmd)).ok);
  await fixture.controller.tick();
  assert.equal(fixture.ids(), 1);
});

test("paused automation waits, then resumes the original due schedule after explicit unpause", async () => {
  const fixture = await prepared();
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:01:00+08:00", entityId: null, expectedRevision: null };
  assert.ok((await fixture.handle.store.execute({ ...base, type: "pauseAutomation", commandId: "pause-before-due" })).ok);
  fixture.setNow("2026-09-13T10:01:00+08:00");
  await fixture.controller.tick();
  assert.equal(fixture.ids(), 0);
  assert.ok((await fixture.handle.store.execute({ ...base, type: "resumeAutomation", commandId: "resume-after-due" })).ok);
  await fixture.controller.tick();
  assert.equal(fixture.ids(), 1);
});

test("one runtime timer and focus handler are reused and trigger the persisted due transition", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const fixture = await prepared();
  const events = new EventTarget();
  const host = { setInterval, clearInterval, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  const stop = startAttentionDueRuntime(fixture.handle, host);
  assert.equal(startAttentionDueRuntime(fixture.handle, host), stop);
  fixture.setNow("2026-09-13T10:01:00+08:00");
  events.dispatchEvent(new Event("focus"));
  t.mock.timers.tick(1000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(fixture.ids(), 1);
  assert.equal(fixture.handle.store.getState().attention.items[fixture.itemId].status, "delivered");
  stop();
});
