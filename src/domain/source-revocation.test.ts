import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, createInitialState, FIXTURE_IDS } from "./index.ts";
import type { Actor, ProviderOutcome, SourceProvider } from "./types.ts";
import { planHandlers } from "./handlers/plan.ts";
import { revokeSourceAccess, revokeSourceAtProvider } from "./handlers/sourceRevocation.ts";
import type { RevokeSourceAccessCommand, RevokeSourceAtProviderCommand } from "./handlers/sourceRevocation.ts";

const NOW = "2026-09-13T10:00:00+08:00";
let seq = 0;
const ctx = { now: NOW, uuid: () => "revoke-" + ++seq };
const localCommand = (actor: Actor = "user", expectedRevision: number | null = 1): RevokeSourceAccessCommand => ({
  type: "revokeSourceAccess", commandId: "local-revoke", entityId: FIXTURE_IDS.sourceCalendar, expectedRevision, actor, issuedAt: NOW,
});
const providerCommand = (provider?: Pick<SourceProvider, "revokeAccess">, expectedRevision = 2): RevokeSourceAtProviderCommand => ({
  type: "revokeSourceAtProvider", commandId: "remote-revoke", entityId: FIXTURE_IDS.sourceCalendar,
  expectedRevision, actor: "user", issuedAt: NOW, provider,
});

test("registered store dispatches both revocation stages", async () => {
  const store = createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: ctx.uuid });
  const local = await store.execute(localCommand());
  assert.ok(local.ok);
  assert.equal(local.data.source.status, "revoked");
  const remote = await store.execute(providerCommand(undefined, local.data.source.revision));
  assert.ok(remote.ok);
  assert.equal(remote.data.remoteOutcome, "unavailable");
  assert.equal(store.getState().sources[FIXTURE_IDS.sourceCalendar].status, "revoked");
});

test("local revocation preserves historical source snapshot and intent but stops later provider reads", async () => {
  const state = createInitialState("fixture");
  const original = JSON.stringify(state);
  const result = revokeSourceAccess(state, localCommand(), ctx);
  assert.ok(result.ok); assert.ok(result.nextState);
  assert.equal(result.data.source.status, "revoked");
  assert.equal(result.data.source.accessRevokedAt, NOW);
  assert.equal(result.data.source.coverage.known, false);
  assert.equal(result.data.source.lastUsableSnapshot?.stale, true);
  assert.deepEqual(result.data.source.lastUsableSnapshot?.intervals, state.sources[FIXTURE_IDS.sourceCalendar].lastUsableSnapshot?.intervals);
  assert.deepEqual(result.nextState.intents, state.intents);
  assert.equal(result.data.remoteOutcome, "pending");
  assert.equal(result.data.copyRecallClaim, "none");
  assert.equal(JSON.stringify(state), original);
  let calls = 0;
  const provider: SourceProvider = {
    async sync() { calls++; return { ok: false, reason: "not called" }; },
    async readSnapshot() { calls++; return { ok: false, reason: "not called" }; },
    async executeAllowedAction() { calls++; return { ok: false, reason: "not called" }; },
    async readback() { calls++; return { ok: false, reason: "not called" }; },
    async revokeAccess() { calls++; return { ok: true, value: { revoked: true } }; },
  };
  const sync = planHandlers.syncSource; assert.ok(sync);
  const read = await sync(result.nextState, { type: "syncSource", commandId: "sync", entityId: result.data.source.id,
    expectedRevision: result.data.source.revision, actor: "user", issuedAt: NOW, provider }, ctx);
  assert.equal(read.ok, false); assert.equal(calls, 0);
});

test("only user with exact non-null revision can revoke; rejected attempts preserve state", () => {
  for (const command of [localCommand("automation"), localCommand("model"), localCommand("user", 2), localCommand("user", 0), localCommand("user", null)]) {
    const state = createInitialState("fixture"); const before = JSON.stringify(state);
    const result = revokeSourceAccess(state, command, ctx);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, command.actor === "user" ? command.expectedRevision === null || command.expectedRevision < 1 ? "INVALID_INPUT" : "REVISION_CONFLICT" : "USER_ONLY");
    assert.equal(JSON.stringify(state), before);
  }
});

test("provider result is distinct from local revocation and never recalls copies or restores access", async () => {
  const outcomes: Array<{ expected: string; response: ProviderOutcome<{ revoked: boolean }> }> = [
    { expected: "confirmed", response: { ok: true, value: { revoked: true } } },
    { expected: "failed", response: { ok: true, value: { revoked: false } } },
    { expected: "failed", response: { ok: false, reason: "remote denied" } },
    { expected: "unknown", response: { ok: false, reason: "timeout", mayHaveSideEffects: true } },
  ];
  for (const outcome of outcomes) {
    const state = createInitialState("fixture");
    const local = revokeSourceAccess(state, localCommand(), ctx); assert.ok(local.ok); assert.ok(local.nextState);
    const result = await revokeSourceAtProvider(local.nextState, providerCommand({ async revokeAccess() { return outcome.response; } }), ctx);
    assert.ok(result.ok); assert.ok(result.nextState);
    assert.equal(result.data.remoteOutcome, outcome.expected);
    assert.equal(result.data.source.revocation.remoteOutcome, outcome.expected);
    assert.equal(result.data.source.status, "revoked");
    assert.equal(result.data.source.coverage.known, false);
    assert.equal(result.data.source.revocation.copyRecallClaim, "none");
    assert.deepEqual(result.nextState.intents, state.intents);
  }
});

test("provider throws or is absent keeps local access blocked with truthful outcome", async () => {
  const local = revokeSourceAccess(createInitialState("fixture"), localCommand(), ctx); assert.ok(local.ok); assert.ok(local.nextState);
  for (const [provider, expected] of [[undefined, "unavailable"], [{ async revokeAccess(): Promise<ProviderOutcome<{ revoked: boolean }>> { throw new Error("timeout"); } }, "unknown"]] as const) {
    const result = await revokeSourceAtProvider(local.nextState, providerCommand(provider), ctx);
    assert.ok(result.ok); assert.equal(result.data.remoteOutcome, expected); assert.equal(result.data.localReadBlocked, true);
  }
});

test("provider command requires local revocation first and rejects stale or non-user commands without provider calls", async () => {
  let calls = 0;
  const provider = { async revokeAccess(): Promise<ProviderOutcome<{ revoked: boolean }>> { calls++; return { ok: true, value: { revoked: true } }; } };
  const fresh = createInitialState("fixture");
  const noLocal = await revokeSourceAtProvider(fresh, providerCommand(provider, 1), ctx);
  assert.equal(noLocal.ok, false);
  const local = revokeSourceAccess(fresh, localCommand(), ctx); assert.ok(local.ok); assert.ok(local.nextState);
  assert.equal((await revokeSourceAtProvider(local.nextState, providerCommand(provider, 1), ctx)).ok, false);
  assert.equal((await revokeSourceAtProvider(local.nextState, { ...providerCommand(provider), actor: "model" }, ctx)).ok, false);
  assert.equal(calls, 0);
});

test("local revocation invalidates pending approvals without undoing existing responsibilities", async () => {
  const store = createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: ctx.uuid });
  const selected = await store.execute({ type: "selectPlan", commandId: "select", entityId: FIXTURE_IDS.intent,
    expectedRevision: 1, actor: "user", issuedAt: NOW, kind: "A" }); assert.ok(selected.ok);
  const approved = await store.execute({ type: "grantApproval", commandId: "grant", entityId: selected.data.plan.id,
    expectedRevision: 1, actor: "user", issuedAt: NOW, changeSetId: selected.data.changeSet.id,
    grants: ["readMaterial", "createLocalDraft", "updateEstimate"] }); assert.ok(approved.ok);
  const before = store.getState();
  const result = revokeSourceAccess(before, localCommand(), ctx); assert.ok(result.ok); assert.ok(result.nextState);
  assert.equal(result.nextState.plans[selected.data.plan.id].status, "invalid");
  assert.equal(result.nextState.approvals[approved.data.approval.id].status, "invalid");
  assert.deepEqual(result.nextState.commitments, before.commitments);
  assert.deepEqual(result.nextState.protectedBlocks, before.protectedBlocks);
  assert.deepEqual(result.nextState.ledger, before.ledger);
});

test("repeated local revocation or confirmed remote result does not re-contact provider", async () => {
  const local = revokeSourceAccess(createInitialState("fixture"), localCommand(), ctx); assert.ok(local.ok); assert.ok(local.nextState);
  const repeated = revokeSourceAccess(local.nextState, localCommand("user", 2), ctx); assert.ok(repeated.ok);
  assert.equal(repeated.nextState, null);
  let calls = 0;
  const provider = { async revokeAccess(): Promise<ProviderOutcome<{ revoked: boolean }>> { calls++; return { ok: true, value: { revoked: true } }; } };
  const remote = await revokeSourceAtProvider(local.nextState, providerCommand(provider), ctx); assert.ok(remote.ok); assert.ok(remote.nextState);
  const repeatedRemote = await revokeSourceAtProvider(remote.nextState, providerCommand(provider, 3), ctx); assert.ok(repeatedRemote.ok);
  assert.equal(repeatedRemote.nextState, null); assert.equal(calls, 1);
});

test("provider timeout records unknown without reopening locally blocked access", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const local = revokeSourceAccess(createInitialState("fixture"), localCommand(), ctx); assert.ok(local.ok); assert.ok(local.nextState);
  const pending = revokeSourceAtProvider(local.nextState, providerCommand({ revokeAccess: () => new Promise(() => {}) }), ctx);
  t.mock.timers.tick(10000);
  const result = await pending; assert.ok(result.ok);
  assert.equal(result.data.remoteOutcome, "unknown"); assert.equal(result.data.source.status, "revoked");
});
