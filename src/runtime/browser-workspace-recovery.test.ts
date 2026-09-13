import assert from "node:assert/strict";
import test from "node:test";
import { readBrowserWorkspaceRecovery, serializeBrowserWorkspaceRecovery } from "../data/browserWorkspaceRecovery.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { storageKeyFor } from "../data/persistence.ts";
import { InMemoryStorage } from "../data/storage.ts";
import { createInitialState } from "../domain/state.ts";

const owner = "account-a";
const rawFixture = JSON.stringify({ schemaVersion: 1, dataMode: "fixture", state: createInitialState("fixture") });

test("recovery preserves exact account payloads, including corrupt data, without reading guest or other accounts", () => {
  const storage = new InMemoryStorage();
  storage.setItem(storageKeyFor("fixture", owner), rawFixture);
  storage.setItem(storageKeyFor("live", owner), "{broken original bytes");
  const readKeys: string[] = [];
  const recovery = readBrowserWorkspaceRecovery(owner, () => ({
    getItem: (key) => { readKeys.push(key); return storage.getItem(key); },
    setItem: () => { throw new Error("must not write"); },
    removeItem: () => { throw new Error("must not delete"); },
  }));
  assert.ok(recovery);
  assert.deepEqual(readKeys, [storageKeyFor("fixture", owner), storageKeyFor("live", owner)]);
  assert.deepEqual(recovery.backups.map((backup) => backup.status), ["ok", "corrupt"]);
  const exported = JSON.parse(serializeBrowserWorkspaceRecovery(recovery));
  assert.equal(exported.backups[0].rawPayload, rawFixture);
  assert.equal(exported.backups[1].rawPayload, "{broken original bytes");
  assert.equal(storage.getItem(storageKeyFor("fixture", owner)), rawFixture);
});

test("guest and absent browser data do not create or suggest a migration", () => {
  assert.equal(readBrowserWorkspaceRecovery("guest", () => { throw new Error("must not inspect"); }), null);
  assert.equal(readBrowserWorkspaceRecovery(owner, () => new InMemoryStorage()), null);
  assert.equal(readBrowserWorkspaceRecovery(owner, () => null), null);
});

test("storage access failures remain explicit and retain any readable backup", () => {
  assert.equal(readBrowserWorkspaceRecovery(owner, () => { throw new Error("SecurityError"); })?.readErrors.length, 1);
  const recovery = readBrowserWorkspaceRecovery(owner, () => ({
    getItem: (key) => { if (key.endsWith(":live")) throw new Error("read failed"); return rawFixture; },
    setItem: () => { throw new Error("must not write"); },
    removeItem: () => { throw new Error("must not delete"); },
  }));
  assert.equal(recovery?.readErrors.length, 1);
  assert.equal(recovery?.backups[0].rawPayload, rawFixture);
});

test("authenticated server runtime exposes browser recovery but never uploads or seeds old fixture work", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new InMemoryStorage();
  storage.setItem(storageKeyFor("fixture", owner), rawFixture);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    let calls = 0;
    const handle = await createPersistedDomainStore({ dataMode: "live", owner, fetch: async (_url, init) => {
      calls += 1;
      assert.equal(init?.method, "GET");
      return Response.json({ ownerId: owner, revision: 0, state: null });
    } });
    assert.equal(handle.status, "ready");
    if (handle.status !== "ready") return;
    assert.equal(handle.browserRecovery?.backups[0].rawPayload, rawFixture);
    assert.equal(Object.keys(handle.store.getState().commitments).length, 0);
    assert.equal(calls, 1);
    assert.equal(storage.getItem(storageKeyFor("fixture", owner)), rawFixture);
    const unavailable = await createPersistedDomainStore({ dataMode: "live", owner, fetch: async () => Response.json({}, { status: 503 }) });
    assert.equal(unavailable.status, "readFailed");
    assert.equal(unavailable.browserRecovery?.backups[0].rawPayload, rawFixture);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
