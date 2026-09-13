import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createAppServer } from "../../server/app.mjs";
import { createAuthService } from "../../server/auth/service.mjs";
import { readAuthConfig } from "../../server/auth/config.mjs";
import { createWorkspaceStore } from "../../server/workspaceStore.mjs";

function state(label = "My own time", globalRevision = 1) {
  const base = { id: "shared-id", revision: 1, dataMode: "live" };
  return {
    schemaVersion: 1, dataMode: "live", globalRevision,
    sources: {}, intents: { "shared-id": { ...base, verbatim: label } }, captureDrafts: {},
    protectedBlocks: {}, requests: {}, commitments: {}, plans: {}, changeSets: {}, approvals: {},
    operations: {}, drafts: {}, checkpoints: {}, materials: {}, quietSessions: {},
    ruleset: {}, attention: { items: {}, budget: {} }, ledger: [], events: [],
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "leubai-workspace-"));
  const databaseFile = join(directory, "auth.sqlite");
  const config = readAuthConfig({ LEUBAI_AUTH_SECRET: "test-only-workspace-secret-at-least-32-bytes", EMAIL_TRANSPORT: "console", ADMIN_EMAILS: "admin@example.test" });
  let auth;
  let app;
  let port;
  const sent = [];
  async function start() {
    auth = createAuthService({ databaseFile, config, sendEmail: async (message) => sent.push(message) });
    app = createAppServer({ auth, settingsFile: join(directory, "settings.json") });
    port = await app.start();
  }
  await start();
  t.after(async () => { await app.close(); auth.close(); await rm(directory, { recursive: true, force: true }); });
  async function api(path, { method = "GET", cookie, body, headers = {} } = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-leubai-client": "leubai-settings/1", ...(cookie ? { cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  async function register(email) {
    assert.equal((await api("/api/auth/send-code", { method: "POST", body: { email } })).status, 200);
    const response = await api("/api/auth/register", { method: "POST", body: { email, code: sent.at(-1).code, password: "workspace-test-password" } });
    assert.equal(response.status, 200);
    return { cookie: response.cookie, user: response.body.user };
  }
  return { api, register, databaseFile, async restart() { await app.close(); auth.close(); await start(); } };
}

test("account workspaces persist across restart and ignore another user's query identifier", async (t) => {
  const f = await fixture(t);
  const a = await f.register("first@example.test");
  const b = await f.register("second@example.test");
  assert.deepEqual((await f.api("/api/workspace", a)).body, { ownerId: a.user.id, revision: 0, state: null, updatedAt: null });
  const saved = await f.api("/api/workspace", { ...a, method: "PUT", body: { expectedRevision: 0, state: state() } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal((await f.api(`/api/workspace?ownerId=${a.user.id}`, b)).body.state, null);
  assert.equal((await f.api("/api/workspace", { ...b, method: "PUT", body: { ownerId: a.user.id, expectedRevision: 0, state: state("forged") } })).status, 400);
  assert.equal((await f.api("/api/workspace", { ...b, method: "PUT", body: { expectedRevision: 0, state: state("Second person's content") } })).status, 200);
  await f.restart();
  assert.equal((await f.api("/api/workspace", a)).body.state.intents["shared-id"].verbatim, "My own time");
  assert.equal((await f.api("/api/workspace", b)).body.state.intents["shared-id"].verbatim, "Second person's content");
  assert.equal((await f.api("/api/resources/intents", a)).body.items[0].verbatim, "My own time");
  assert.deepEqual((await f.api("/api/resources/commitments", a)).body.items, []);
});

test("concurrent account writes have one winner and a stale revision never overwrites it", async (t) => {
  const f = await fixture(t);
  const user = await f.register("writer@example.test");
  const responses = await Promise.all(["one", "two"].map((label) => f.api("/api/workspace", { ...user, method: "PUT", body: { expectedRevision: 0, state: state(label) } })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(responses.find((r) => r.status === 409).body.error, "REVISION_CONFLICT");
  assert.equal(responses.find((r) => r.status === 409).body.revision, 1);
  const winner = responses.find((r) => r.status === 200).body.state;
  assert.deepEqual((await f.api("/api/workspace", user)).body.state, winner);
  assert.equal((await f.api("/api/workspace", { ...user, method: "PUT", body: { expectedRevision: 1, state: state("next", 2) } })).body.revision, 2);
});

test("workspace rejects anonymous, hostile-origin, fixture, malformed and regressing writes", async (t) => {
  const f = await fixture(t);
  const user = await f.register("validate@example.test");
  assert.equal((await f.api("/api/workspace")).status, 401);
  assert.equal((await f.api("/api/resources/intents")).status, 401);
  assert.equal((await f.api("/api/workspace", { ...user, headers: { origin: "https://hostile.example.test" } })).status, 403);
  for (const candidate of [null, [], { state: {} }, { expectedRevision: 0, state: { ...state(), dataMode: "fixture" } }, { expectedRevision: 0, state: { ...state(), intents: { wrong: { id: "other", dataMode: "live", revision: 1 } } } }]) {
    assert.equal((await f.api("/api/workspace", { ...user, method: "PUT", body: candidate })).status, 400);
  }
  assert.equal((await f.api("/api/workspace", { ...user, method: "PUT", body: { expectedRevision: 0, state: state() } })).status, 200);
  assert.equal((await f.api("/api/workspace", { ...user, method: "PUT", body: { expectedRevision: 1, state: state("stale", 1) } })).status, 400);
  assert.equal((await f.api("/api/workspace", { ...user, method: "PUT", body: { expectedRevision: 1, state: state("x".repeat(2 * 1024 * 1024), 2) } })).status, 413);
  assert.equal((await f.api("/api/workspace", user)).body.revision, 1);
});

test("admin resource counts and deletion use real account data with atomic cascading cleanup", async (t) => {
  const f = await fixture(t);
  const admin = await f.register("admin@example.test");
  const user = await f.register("delete@example.test");
  await f.api("/api/workspace", { ...user, method: "PUT", body: { expectedRevision: 0, state: state() } });
  const listed = await f.api("/api/admin/users", admin);
  assert.equal(listed.body.users.find((row) => row.id === user.user.id).resourceCount, 1);
  assert.equal((await f.api(`/api/admin/users/${user.user.id}`, { ...admin, method: "DELETE" })).status, 200);
  assert.equal((await f.api("/api/workspace", user)).status, 401);
  const db = new DatabaseSync(f.databaseFile);
  try { assert.equal(db.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE owner_id = ?").get(user.user.id).count, 0); }
  finally { db.close(); }
});

test("workspace migration preserves legacy users and fails closed for a future schema", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('existing')");
    const store = createWorkspaceStore(db);
    store.save("existing", { expectedRevision: 0, state: state() });
    assert.equal(createWorkspaceStore(db).read("existing").revision, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
    db.exec("INSERT INTO workspace_schema_migrations VALUES (99, 'future')");
    assert.throws(() => createWorkspaceStore(db), /newer than this server/);
    assert.equal(store.read("existing").revision, 1);
  } finally { db.close(); }
});
