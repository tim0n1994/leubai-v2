import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "../domain/store.ts";
import type { DomainState, CreateProtectedBlockCommand } from "../domain/types.ts";
import { saveProtectedBlock } from "./protected-block-form.ts";

const command: CreateProtectedBlockCommand = { type: "createProtectedBlock", commandId: "explicit-create", blockId: "stable-boundary", entityId: null, expectedRevision: null, actor: "user", issuedAt: "2026-09-13T00:00:00Z", intentId: null, purpose: null, date: "2026-09-14", startTime: "19:00", endTime: "20:00", timezone: "Asia/Shanghai" };

test("confirmed persistence returns complete unassigned block after both readbacks", async () => {
  let durable: DomainState | null = null;
  const store = createDomainStore({ dataMode: "fixture", commit: async (_revision, next) => { durable = next; return { ok: true }; } });
  const result = await saveProtectedBlock(store, () => durable, command);
  assert.ok(result.ok);
  assert.equal(result.block.blockId, command.blockId);
  assert.equal(result.block.intentId, null);
  assert.equal(result.block.purpose, null);
  assert.deepEqual(result.block, store.getState().protectedBlocks[result.block.id]);
});

test("landed write then unknown response keeps exact command and candidate; retry does not create a duplicate", async () => {
  let durable: DomainState | null = null;
  let writes = 0;
  const store = createDomainStore({ dataMode: "fixture", commit: async (_revision, next) => {
    if (durable) assert.deepEqual(next, durable);
    durable = next;
    if (++writes === 1) throw new Error("response lost after writing");
    return { ok: true };
  } });
  const failed = await saveProtectedBlock(store, () => durable, command);
  assert.deepEqual(failed.ok, false);
  assert.ok(!failed.ok && failed.retryExact);
  assert.equal(Object.values(store.getState().protectedBlocks).filter(block => block.blockId === command.blockId).length, 0);
  const settled = await saveProtectedBlock(store, () => durable, command);
  assert.ok(settled.ok);
  assert.equal(writes, 2);
  assert.equal(Object.values(store.getState().protectedBlocks).filter(block => block.blockId === command.blockId).length, 1);
});

test("null, throwing or mismatched persistent readback never claims success and exact retry can confirm later", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const missing = await saveProtectedBlock(store, () => null, command);
  assert.ok(!missing.ok && missing.retryExact);
  const broken = await saveProtectedBlock(store, () => { throw new Error("unavailable"); }, command);
  assert.ok(!broken.ok && broken.retryExact);
  const wrong = await saveProtectedBlock(store, () => ({ ...store.getState(), protectedBlocks: {} }), command);
  assert.ok(!wrong.ok && wrong.retryExact);
  const settled = await saveProtectedBlock(store, () => store.getState(), command);
  assert.ok(settled.ok);
  assert.equal(Object.values(store.getState().protectedBlocks).filter(block => block.blockId === command.blockId).length, 1);
});

test("runtime readback mismatch also fails even when persistence contains the expected block", async () => {
  const real = createDomainStore({ dataMode: "fixture" });
  const store = { ...real, getState: () => ({ ...real.getState(), protectedBlocks: {} }) };
  const result = await saveProtectedBlock(store, () => real.getState(), command);
  assert.ok(!result.ok && result.retryExact);
});

test("definitive invalid input allows user correction instead of retaining an impossible exact retry", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const result = await saveProtectedBlock(store, () => store.getState(), { ...command, date: "2026-02-30" });
  assert.ok(!result.ok && !result.retryExact);
});
