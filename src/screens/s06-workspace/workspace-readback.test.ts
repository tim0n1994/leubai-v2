import assert from "node:assert/strict";
import test from "node:test";
import { createPersistedDomainStore } from "../../data/persistedStore.ts";
import { InMemoryStorage } from "../../data/storage.ts";
import { readWorkspaceSavedState } from "./workspace-readback.ts";

test("workspace readback refreshes account state before returning it and updates the store", async () => {
  let remoteCapacity = 40;
  let reads = 0;
  const handle = await createPersistedDomainStore({
    dataMode: "live", owner: "account-a",
    fetch: async () => {
      reads += 1;
      if (reads === 1) return Response.json({ ownerId: "account-a", revision: 0, state: null });
      const current = handle.status === "ready" ? handle.store.getState() : null;
      assert.ok(current);
      return Response.json({ ownerId: "account-a", revision: 1, state: {
        ...current, globalRevision: current.globalRevision + 1,
        ruleset: { ...current.ruleset, dailyCapacityMinutes: remoteCapacity },
      } });
    },
  });
  assert.equal(handle.status, "ready");
  if (handle.status !== "ready") return;
  remoteCapacity = 73;
  const saved = await readWorkspaceSavedState(handle.persistence);
  assert.equal(reads, 2);
  assert.equal(saved.ruleset.dailyCapacityMinutes, 73);
  assert.equal(handle.store.getState().ruleset.dailyCapacityMinutes, 73);
});

test("workspace readback rejects failed remote refresh even when cached state exists", async () => {
  let failed = false;
  const handle = await createPersistedDomainStore({
    dataMode: "live", owner: "account-a",
    fetch: async () => failed
      ? Response.json({}, { status: 503 })
      : Response.json({ ownerId: "account-a", revision: 0, state: null }),
  });
  assert.equal(handle.status, "ready");
  if (handle.status !== "ready") return;
  assert.ok(handle.persistence.getState());
  failed = true;
  await assert.rejects(readWorkspaceSavedState(handle.persistence));
});

test("fixture workspace readback reads the runtime owner's latest saved state", async () => {
  const storage = new InMemoryStorage();
  const selected = await createPersistedDomainStore({ dataMode: "fixture", owner: "account-a", storage });
  const writer = await createPersistedDomainStore({ dataMode: "fixture", owner: "account-a", storage });
  const other = await createPersistedDomainStore({ dataMode: "fixture", owner: "account-b", storage });
  assert.equal(selected.status, "ready");
  assert.equal(writer.status, "ready");
  assert.equal(other.status, "ready");
  if (selected.status !== "ready" || writer.status !== "ready" || other.status !== "ready") return;
  const before = writer.persistence.getState()!;
  assert.equal((await writer.persistence.commit(before.globalRevision, {
    ...before, globalRevision: before.globalRevision + 1,
    ruleset: { ...before.ruleset, dailyCapacityMinutes: 73 },
  })).ok, true);
  const saved = await readWorkspaceSavedState(selected.persistence);
  assert.equal(saved.ruleset.dailyCapacityMinutes, 73);
  assert.equal(saved.dataMode, "fixture");
  assert.notEqual((await readWorkspaceSavedState(other.persistence)).ruleset.dailyCapacityMinutes, 73);
});
