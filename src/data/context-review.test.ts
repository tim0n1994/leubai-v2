import test from "node:test";
import assert from "node:assert/strict";
import { createPersistedDomainStore } from "./persistedStore.ts";
import { InMemoryStorage } from "./storage.ts";
import { parseEnvelope, storageKeyFor } from "./persistence.ts";
import { createInitialState } from "../domain/state.ts";
import type { ContextReviewAction } from "../domain/contextReviewModel.ts";
import type { DomainStore } from "../domain/store.ts";

const now = "2026-09-13T12:00:00Z";
let sequence = 0;
async function open(storage: InMemoryStorage) {
	const handle = await createPersistedDomainStore({
		storage,
		dataMode: "fixture",
		now: () => now,
		uuid: () => "review-id-" + ++sequence,
	});
	if (handle.status !== "ready") throw new Error(handle.reason);
	return handle.store;
}
function dispatch(store: DomainStore, action: ContextReviewAction) {
	return store.execute({
		type: "contextReviewAction",
		action,
		commandId: "command-" + ++sequence,
		actor: "user",
		entityId: null,
		expectedRevision: store.getState().globalRevision,
		issuedAt: now,
	});
}
test("S11 rejection, S12 skip and S13 local fallback survive a fresh persistence handle", async () => {
	const storage = new InMemoryStorage();
	const store = await open(storage);
	assert.equal(
		(
			await dispatch(store, {
				type: "createInference",
				actor: "user",
				statement: "演示推测",
				evidenceRefs: ["fixture-choice-1"],
				evidenceSummary: "合成选择记录",
				provenance: { origin: "fixture" },
				reviewDueAt: null,
			})
		).ok,
		true,
	);
	const inference = Object.values(store.getState().contextReview.inferences)[0];
	assert.equal(
		(
			await dispatch(store, {
				type: "rejectInference",
				actor: "user",
				inferenceId: inference.id,
				expectedRevision: inference.revision,
			})
		).ok,
		true,
	);
	assert.equal(
		(
			await dispatch(store, {
				type: "upsertWeeklyFeedback",
				actor: "user",
				weekStart: "2026-09-07",
				timezone: "Asia/Shanghai",
				value: "skipped",
				expectedRevision: null,
			})
		).ok,
		true,
	);
	assert.equal(
		(await dispatch(store, { type: "enterLocalOnly", actor: "user" })).ok,
		true,
	);
	const restored = await open(storage);
	assert.equal(
		restored.getState().contextReview.inferences[inference.id].status,
		"rejected",
	);
	assert.equal(
		restored.getState().contextReview.weeklyFeedback["2026-09-07@Asia/Shanghai"]
			.value,
		"skipped",
	);
	assert.equal(restored.getState().contextReview.localOnly?.enabled, true);
	assert.deepEqual(
		restored.getState().protectedBlocks,
		createInitialState("fixture").protectedBlocks,
	);
});
test("legacy envelope reads context as empty without changing existing records or stored bytes", () => {
	const { contextReview: _unused, ...legacy } = createInitialState("fixture");
	const raw = JSON.stringify({
		schemaVersion: 1,
		dataMode: "fixture",
		savedAt: now,
		state: legacy,
	});
	const parsed = parseEnvelope(raw, "fixture");
	assert.equal(parsed.kind, "ok");
	if (parsed.kind !== "ok") throw new Error("legacy read failed");
	assert.deepEqual(parsed.envelope.state.contextReview.inferences, {});
	assert.deepEqual(parsed.envelope.state.intents, legacy.intents);
});
test("malformed context is preserved and rejected; never silently reset", async () => {
	const storage = new InMemoryStorage();
	const raw = JSON.stringify({
		schemaVersion: 1,
		dataMode: "fixture",
		savedAt: now,
		state: {
			...createInitialState("fixture"),
			contextReview: { localOnly: true },
		},
	});
	storage.setItem(storageKeyFor("fixture"), raw);
	const handle = await createPersistedDomainStore({
		storage,
		dataMode: "fixture",
	});
	assert.equal(handle.status, "corrupt");
	assert.equal(storage.getItem(storageKeyFor("fixture")), raw);
});
test("actor mismatch and stale revision cannot mutate shared context", async () => {
	const store = await open(new InMemoryStorage());
	const before = store.getState();
	const mismatch = await store.execute({
		type: "contextReviewAction",
		commandId: "mismatch",
		actor: "automation",
		entityId: null,
		expectedRevision: before.globalRevision,
		issuedAt: now,
		action: { type: "enterLocalOnly", actor: "user" },
	});
	assert.equal(mismatch.ok, false);
	const stale = await store.execute({
		type: "contextReviewAction",
		commandId: "stale",
		actor: "user",
		entityId: null,
		expectedRevision: 0,
		issuedAt: now,
		action: { type: "enterLocalOnly", actor: "user" },
	});
	assert.equal(stale.ok, false);
	assert.deepEqual(store.getState(), before);
});
test("local mode cannot be exited using a success snapshot from before it was entered", async () => {
	const store = await open(new InMemoryStorage());
	assert.equal(
		(await dispatch(store, { type: "enterLocalOnly", actor: "user" })).ok,
		true,
	);
	const result = await dispatch(store, {
		type: "returnToConnected",
		actor: "user",
	});
	assert.equal(result.ok, false);
	assert.equal(store.getState().contextReview.localOnly?.enabled, true);
});
