import assert from "node:assert/strict";
import test from "node:test";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { openWorkspacePersistence } from "../data/persistence.ts";
import { createInitialState } from "../domain/state.ts";
import type { DomainState } from "../domain/types.ts";

function serverFixture() {
  let owner = "account-a";
  let revision = 0;
  let state: DomainState | null = null;
  let writes = 0;
  let loseResponse = false;
  let race = false;
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(url, "/api/workspace");
    assert.equal(init?.credentials, "same-origin");
    const headers = new Headers(init?.headers);
    if (headers.get("x-leubai-workspace-owner") !== owner) return Response.json({}, { status: 403 });
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (race) {
        race = false;
        state = { ...createInitialState("live"), globalRevision: 4 };
        revision += 1;
      }
      if (body.expectedRevision !== revision) return Response.json({ revision }, { status: 409 });
      writes += 1;
      revision += 1;
      state = body.state;
      if (loseResponse) { loseResponse = false; throw new Error("response lost after durable save"); }
    }
    return Response.json({ ownerId: owner, revision, state, updatedAt: null });
  };
  return {
    fetchImpl,
    snapshot: () => ({ state, revision, writes }),
    loseNextResponse: () => { loseResponse = true; },
    raceNextWrite: () => { race = true; },
    switchOwner: () => { owner = "account-b"; },
  };
}

test("live account opens empty without browser storage or seeding and reloads committed data", async () => {
  const server = serverFixture();
  const handle = await createPersistedDomainStore({ dataMode: "live", owner: "account-a", fetch: server.fetchImpl });
  assert.equal(handle.status, "ready");
  if (handle.status !== "ready") return;
  const base = handle.store.getState();
  assert.equal(base.dataMode, "live");
  assert.equal(Object.keys(base.commitments).length, 0);
  assert.equal(server.snapshot().writes, 0);
  const next = { ...base, globalRevision: base.globalRevision + 1, ruleset: { ...base.ruleset, dailyCapacityMinutes: 73 } };
  assert.deepEqual(await handle.persistence.commit(base.globalRevision, next), { ok: true });
  assert.equal(server.snapshot().revision, 1);
  const reopened = await createPersistedDomainStore({ dataMode: "live", owner: "account-a", fetch: server.fetchImpl });
  assert.equal(reopened.status, "ready");
  if (reopened.status === "ready") assert.equal(reopened.store.getState().ruleset.dailyCapacityMinutes, 73);
  assert.equal((await handle.persistence.resetFixtureOnly()).ok, false);
});

test("stale handle adopts the server winner and cannot overwrite it", async () => {
  const server = serverFixture();
  const a = (await openWorkspacePersistence({ owner: "account-a", fetch: server.fetchImpl })).persistence;
  const b = (await openWorkspacePersistence({ owner: "account-a", fetch: server.fetchImpl })).persistence;
  const base = a.getState()!;
  const winner = { ...base, globalRevision: base.globalRevision + 1 };
  assert.equal((await a.commit(base.globalRevision, winner)).ok, true);
  let notifications = 0;
  b.subscribeExternal(() => { notifications += 1; });
  const loser = await b.commit(base.globalRevision, { ...winner, ruleset: { ...base.ruleset, dailyCapacityMinutes: 15 } });
  assert.equal(loser.ok, false);
  if (!loser.ok) assert.equal(loser.code, "REVISION_CONFLICT");
  assert.deepEqual(b.getState(), winner);
  assert.equal(notifications, 1);
  assert.equal(server.snapshot().writes, 1);
});

test("409 between the read and PUT refreshes the winning state without replay", async () => {
  const server = serverFixture();
  const { persistence } = await openWorkspacePersistence({ owner: "account-a", fetch: server.fetchImpl });
  const base = persistence.getState()!;
  server.raceNextWrite();
  const result = await persistence.commit(base.globalRevision, { ...base, globalRevision: 2 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "REVISION_CONFLICT");
  assert.equal(persistence.getState()?.globalRevision, 4);
  assert.equal(server.snapshot().writes, 0);
});

test("lost save response is resolved by exact candidate retry without a duplicate write", async () => {
  const server = serverFixture();
  const { persistence } = await openWorkspacePersistence({ owner: "account-a", fetch: server.fetchImpl });
  const base = persistence.getState()!;
  const next = { ...base, globalRevision: base.globalRevision + 1 };
  server.loseNextResponse();
  const failed = await persistence.commit(base.globalRevision, next);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.uncertain, true);
  assert.equal(persistence.getState(), base);
  await persistence.refresh?.();
  assert.equal(persistence.getState(), base);
  assert.deepEqual(await persistence.commit(base.globalRevision, next), { ok: true });
  assert.equal(server.snapshot().writes, 1);
  assert.deepEqual(persistence.getState(), next);
});

test("guest, local owner change and changed server session all fail closed", async () => {
  let calls = 0;
  const guest = await openWorkspacePersistence({ owner: "guest", fetch: async () => { calls += 1; throw new Error("must not fetch"); } });
  assert.equal(guest.persistence.openStatus, "readFailed");
  assert.equal(calls, 0);
  const server = serverFixture();
  let currentOwner = "account-a";
  const { persistence } = await openWorkspacePersistence({ owner: currentOwner, currentOwner: () => currentOwner, fetch: server.fetchImpl });
  const base = persistence.getState()!;
  currentOwner = "account-b";
  assert.equal((await persistence.commit(base.globalRevision, { ...base, globalRevision: 2 })).ok, false);
  currentOwner = "account-a";
  server.switchOwner();
  assert.equal((await persistence.commit(base.globalRevision, { ...base, globalRevision: 2 })).ok, false);
  assert.equal(server.snapshot().writes, 0);
});

test("remote read failure does not create a ready local fallback", async () => {
  const handle = await createPersistedDomainStore({ dataMode: "live", owner: "account-a", fetch: async () => Response.json({}, { status: 503 }) });
  assert.equal(handle.status, "readFailed");
});
