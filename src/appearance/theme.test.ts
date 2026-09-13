/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  APPEARANCE_STORAGE_KEY,
  InMemoryStorage,
  createAppearanceStore,
  parseStoredAppearance,
} from "./theme.ts";
import type {
  AppearanceDocumentLike,
  AppearanceStorageLike,
  AppearanceStore,
} from "./theme.ts";

type DocCall = { op: "set"; value: string } | { op: "remove" };

function createDocumentSpy(): { doc: AppearanceDocumentLike; calls: DocCall[] } {
  const calls: DocCall[] = [];
  return {
    doc: {
      setAttribute: (_name: string, value: string) => {
        calls.push({ op: "set", value });
      },
      removeAttribute: (_name: string) => {
        calls.push({ op: "remove" });
      },
    },
    calls,
  };
}

function lastCall(calls: DocCall[]): DocCall {
  assert.ok(calls.length > 0, "expected at least one document call");
  return calls[calls.length - 1];
}

function createNotifier(store: AppearanceStore): { count(): number } {
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  return { count: () => notified };
}

class FailingWriteStorage implements AppearanceStorageLike {
  getItem(_key: string): string | null {
    return null;
  }

  setItem(key: string, _value: string): void {
    if (key === APPEARANCE_STORAGE_KEY) throw new Error("simulated quota failure");
  }
}

test("resolveKey routes reads and writes to the active owner namespace", () => {
  const storage = new InMemoryStorage();
  const { doc } = createDocumentSpy();
  let key = APPEARANCE_STORAGE_KEY;
  const store = createAppearanceStore({ storage, doc, resolveKey: () => key });

  store.setTheme("ink");
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), "ink");

  key = APPEARANCE_STORAGE_KEY + ":u:account-a";
  store.refreshFromStorage();
  assert.equal(store.getStatus().theme, "porcelain");

  store.setTheme("ink");
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), "ink");
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY + ":u:account-a"), "ink");

  key = APPEARANCE_STORAGE_KEY;
  store.refreshFromStorage();
  assert.equal(store.getStatus().theme, "ink");
});

class ThrowingReadStorage implements AppearanceStorageLike {
  getItem(_key: string): string | null {
    throw new Error("simulated privacy-mode failure");
  }

  setItem(_key: string, _value: string): void {
    throw new Error("simulated privacy-mode failure");
  }
}

test("parse: only the plain enum is valid; anything stored otherwise is corrupted", () => {
  assert.deepEqual(parseStoredAppearance(null), { state: "absent" });
  assert.deepEqual(parseStoredAppearance("porcelain"), { state: "valid", theme: "porcelain" });
  assert.deepEqual(parseStoredAppearance("ink"), { state: "valid", theme: "ink" });
  assert.equal(parseStoredAppearance("").state, "corrupted");
  assert.equal(parseStoredAppearance("{not-valid-json").state, "corrupted");
  assert.equal(parseStoredAppearance("INK").state, "corrupted");
  assert.equal(parseStoredAppearance("ink ").state, "corrupted");
});

test("fresh store defaults to porcelain and clears any theme attribute on refresh", () => {
  const { doc, calls } = createDocumentSpy();
  const store = createAppearanceStore({ storage: new InMemoryStorage(), doc });
  assert.deepEqual(store.getStatus(), { theme: "porcelain", issue: null });
  store.refreshFromStorage();
  assert.deepEqual(store.getStatus(), { theme: "porcelain", issue: null });
  assert.deepEqual(lastCall(calls), { op: "remove" });
});

test("setTheme ink: applied to document, persisted, and subscribers notified", () => {
  const { doc, calls } = createDocumentSpy();
  const storage = new InMemoryStorage();
  const store = createAppearanceStore({ storage, doc });
  const notify = createNotifier(store);
  store.setTheme("ink");
  assert.deepEqual(store.getStatus(), { theme: "ink", issue: null });
  assert.deepEqual(lastCall(calls), { op: "set", value: "ink" });
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), "ink");
  assert.equal(notify.count(), 1);
});

test("setTheme porcelain: removes the attribute so default rules are untouched", () => {
  const { doc, calls } = createDocumentSpy();
  const storage = new InMemoryStorage();
  const store = createAppearanceStore({ storage, doc });
  store.setTheme("ink");
  store.setTheme("porcelain");
  assert.deepEqual(store.getStatus(), { theme: "porcelain", issue: null });
  assert.deepEqual(lastCall(calls), { op: "remove" });
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), "porcelain");
});

test("write failure: session theme applies with honest issue and nothing persists", () => {
  const { doc, calls } = createDocumentSpy();
  const storage = new FailingWriteStorage();
  const store = createAppearanceStore({ storage, doc });
  const notify = createNotifier(store);
  store.setTheme("ink");
  assert.deepEqual(store.getStatus(), { theme: "ink", issue: "write-failed" });
  assert.deepEqual(lastCall(calls), { op: "set", value: "ink" });
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), null);
  assert.equal(notify.count(), 1);
  store.refreshFromStorage();
  assert.deepEqual(store.getStatus(), { theme: "porcelain", issue: null });
});

test("corrupted stored value: porcelain fallback, honest notice, bytes not rewritten", () => {
  const { doc, calls } = createDocumentSpy();
  const storage = new InMemoryStorage();
  storage.setItem(APPEARANCE_STORAGE_KEY, "{not-valid-json");
  const store = createAppearanceStore({ storage, doc });
  store.refreshFromStorage();
  assert.deepEqual(store.getStatus(), { theme: "porcelain", issue: "corrupted" });
  assert.deepEqual(lastCall(calls), { op: "remove" });
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), "{not-valid-json");
});

test("read failure: porcelain fallback with honest read-failed issue", () => {
  const { doc, calls } = createDocumentSpy();
  const store = createAppearanceStore({ storage: new ThrowingReadStorage(), doc });
  store.refreshFromStorage();
  assert.deepEqual(store.getStatus(), { theme: "porcelain", issue: "read-failed" });
  assert.deepEqual(lastCall(calls), { op: "remove" });
});

test("external storage change is picked up on refresh (cross-tab sync core)", () => {
  const { doc, calls } = createDocumentSpy();
  const storage = new InMemoryStorage();
  const store = createAppearanceStore({ storage, doc });
  storage.setItem(APPEARANCE_STORAGE_KEY, "ink");
  store.refreshFromStorage();
  assert.deepEqual(store.getStatus(), { theme: "ink", issue: null });
  assert.deepEqual(lastCall(calls), { op: "set", value: "ink" });
});

test("no redundant notifications for unchanged state", () => {
  const { doc } = createDocumentSpy();
  const storage = new InMemoryStorage();
  storage.setItem(APPEARANCE_STORAGE_KEY, "porcelain");
  const store = createAppearanceStore({ storage, doc });
  const notify = createNotifier(store);
  store.refreshFromStorage();
  store.refreshFromStorage();
  store.setTheme("porcelain");
  assert.equal(notify.count(), 0);
  store.setTheme("ink");
  assert.equal(notify.count(), 1);
});
