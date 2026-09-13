import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "../../domain/store.ts";
import { FIXTURE_IDS } from "../../domain/ids.ts";
import { createPersistedDomainStore } from "../../data/persistedStore.ts";
import { InMemoryStorage } from "../../data/storage.ts";
import { describeSourceRevocation, executeSourceRevocation, makeLocalRevocation, makeProviderRevocation } from "./source-revocation-surface.ts";

const NOW = "2026-09-13T12:00:00Z";
let seq = 0;
const identity = () => ({ commandId: "revoke-surface-" + ++seq, issuedAt: NOW });

test("local unconfirmed write retains exact command before any provider request", async () => {
  let commits = 0;
  const store = createDomainStore({ dataMode: "fixture", commit: async () => ++commits === 1 ? { ok: false, code: "STORAGE_WRITE_FAILED", reason: "uncertain", retryable: true } : { ok: true } });
  const command = makeLocalRevocation(store.getState().sources[FIXTURE_IDS.sourceCalendar], identity());
  const failed = await executeSourceRevocation(store, command, identity);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.pending, command);
  assert.equal(store.getState().sources[FIXTURE_IDS.sourceCalendar].status, "connected");
  const retried = await executeSourceRevocation(store, failed.pending!, identity);
  assert.equal(retried.ok, true);
  assert.equal(store.getState().sources[FIXTURE_IDS.sourceCalendar].revision, 3);
});

test("provider receipt retry reuses original provider command without recontacting provider", async () => {
  let commits = 0;
  let calls = 0;
  const store = createDomainStore({ dataMode: "fixture", commit: async () => ++commits === 2 ? { ok: false, code: "STORAGE_WRITE_FAILED", reason: "uncertain receipt", retryable: true } : { ok: true } });
  const local = await store.execute(makeLocalRevocation(store.getState().sources[FIXTURE_IDS.sourceCalendar], identity()));
  assert.ok(local.ok);
  const command = { ...makeProviderRevocation(local.data.source, identity()), provider: { revokeAccess: async () => { calls++; return { ok: true as const, value: { revoked: true } }; } } };
  const failed = await executeSourceRevocation(store, command, identity);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.pending, command);
  assert.equal(calls, 1);
  assert.equal((await executeSourceRevocation(store, failed.pending!, identity)).ok, true);
  assert.equal(calls, 1);
  assert.equal(store.getState().sources[FIXTURE_IDS.sourceCalendar].revocation?.remoteOutcome, "confirmed");
});

test("write landed but durable readback failed can reconcile the original local command", async () => {
  class UncertainStorage extends InMemoryStorage {
    armed = false;
    failRead = false;
    override setItem(key: string, value: string) {
      super.setItem(key, value);
      if (this.armed) { this.armed = false; this.failRead = true; }
    }
    override getItem(key: string) {
      if (this.failRead) { this.failRead = false; throw new Error("readback unavailable"); }
      return super.getItem(key);
    }
  }
  const storage = new UncertainStorage();
  const handle = await createPersistedDomainStore({ dataMode: "fixture", storage });
  if (handle.status !== "ready") throw new Error(handle.status);
  const command = makeLocalRevocation(handle.store.getState().sources[FIXTURE_IDS.sourceCalendar], identity());
  storage.armed = true;
  const failed = await executeSourceRevocation(handle.store, command, identity);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.pending, command);
  const retried = await executeSourceRevocation(handle.store, failed.pending!, identity);
  assert.ok(retried.ok);
  assert.equal(retried.source.revision, 3);
  assert.equal(retried.source.revocation?.remoteOutcome, "confirmed");
});

test("restored receipt remains visible and fixture qualification is explicit", async () => {
  const storage = new InMemoryStorage();
  const handle = await createPersistedDomainStore({ dataMode: "fixture", storage });
  if (handle.status !== "ready") throw new Error(handle.status);
  await executeSourceRevocation(handle.store, makeLocalRevocation(handle.store.getState().sources[FIXTURE_IDS.sourceCalendar], identity()), identity);
  const restored = await createPersistedDomainStore({ dataMode: "fixture", storage });
  if (restored.status !== "ready") throw new Error(restored.status);
  const receipt = describeSourceRevocation(restored.store.getState().sources[FIXTURE_IDS.sourceCalendar]);
  assert.match(receipt.status, /合成演示回执.*已确认/);
  assert.match(receipt.detail, /不代表真实账户权限/);
  assert.match(receipt.detail, /副本.*召回/);
  assert.notEqual(receipt.checkedAt, null);
});

test("unconfirmed provider outcome remains explicitly retryable without reopening local access", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const local = await store.execute(makeLocalRevocation(store.getState().sources[FIXTURE_IDS.sourceCalendar], identity()));
  assert.ok(local.ok);
  const unavailable = await executeSourceRevocation(store, { ...makeProviderRevocation(local.data.source, identity()), provider: undefined }, identity);
  assert.ok(unavailable.ok);
  assert.equal(unavailable.source.revocation?.remoteOutcome, "unavailable");
  assert.equal(unavailable.source.status, "revoked");
  const retried = await executeSourceRevocation(store, makeProviderRevocation(unavailable.source, identity()), identity);
  assert.ok(retried.ok);
  assert.equal(retried.source.revocation?.remoteOutcome, "confirmed");
  assert.equal(retried.source.status, "revoked");
});
