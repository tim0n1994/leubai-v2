import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "./store.ts";
import { createInitialState } from "./state.ts";
import { FIXTURE_IDS } from "./ids.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { InMemoryStorage } from "../data/storage.ts";
import { parseEnvelope } from "../data/persistence.ts";
import type {
	DomainCommand,
	CommandResult,
	CommandDataOf,
	IntentLifecycleCommand,
} from "./types.ts";
import type { DomainStore } from "./store.ts";

const NOW = "2026-09-13T10:00:00Z";
let seq = 0;
const base = () => ({
	commandId: "lifecycle-command-" + ++seq,
	actor: "user" as const,
	issuedAt: NOW,
	entityId: FIXTURE_IDS.intent,
	expectedRevision: 1,
});
const fresh = () =>
	createDomainStore({
		dataMode: "fixture",
		now: () => NOW,
		uuid: () => "lifecycle-id-" + ++seq,
	});
function ok<C extends DomainCommand>(
	result: CommandResult<C>,
): CommandDataOf<C> {
	if (!result.ok) throw new Error(result.code + ": " + result.reason);
	return result.data;
}
async function prepared(store: DomainStore) {
	const selected = ok(
		await store.execute({ ...base(), type: "selectPlan", kind: "A" }),
	);
	const granted = ok(
		await store.execute({
			...base(),
			entityId: null,
			expectedRevision: null,
			type: "grantApproval",
			changeSetId: selected.changeSet.id,
			grants: ["updateEstimate"],
		}),
	);
	return { ...selected, ...granted };
}
test("edit retains intent identity, increments revision and invalidates old plan and unconsumed approval", async () => {
	const store = fresh();
	const proposal = await prepared(store);
	const before = store.getState();
	const source = before.intents[FIXTURE_IDS.intent];
	const edited = ok(
		await store.execute({
			...base(),
			type: "editIntent",
			verbatim: "  晚上保留空白  ",
			parsedFields: { ...source.parsedFields, topic: null },
			constraints: source.constraints,
		}),
	);
	assert.equal(edited.intent.id, source.id);
	assert.equal(edited.intent.revision, 2);
	assert.equal(edited.intent.verbatim, "  晚上保留空白  ");
	assert.equal(edited.intent.parsedFields.topic, null);
	assert.equal(store.getState().plans[proposal.plan.id].status, "invalid");
	assert.equal(
		store.getState().approvals[proposal.approval.id].status,
		"invalid",
	);
	assert.deepEqual(store.getState().protectedBlocks, before.protectedBlocks);
	assert.deepEqual(store.getState().commitments, before.commitments);
	const attempt = await store.execute({
		...base(),
		entityId: null,
		expectedRevision: null,
		type: "startOperation",
		approvalId: proposal.approval.id,
	});
	assert.equal(attempt.ok, false);
});
test("pause and resume cannot revive an old approval or revoke completed responsibility", async () => {
	const store = fresh();
	const proposal = await prepared(store);
	const executed = ok(
		await store.execute({
			...base(),
			entityId: null,
			expectedRevision: null,
			type: "startOperation",
			approvalId: proposal.approval.id,
		}),
	);
	const before = store.getState();
	ok(await store.execute({ ...base(), type: "pauseIntent" }));
	assert.equal(store.getState().intents[FIXTURE_IDS.intent].status, "paused");
	assert.deepEqual(store.getState().commitments, before.commitments);
	assert.deepEqual(store.getState().protectedBlocks, before.protectedBlocks);
	assert.deepEqual(
		store.getState().operations[executed.operation.id],
		before.operations[executed.operation.id],
	);
	assert.equal(
		store.getState().approvals[proposal.approval.id].status,
		"consumed",
	);
	const pausedPlan = await store.execute({
		...base(),
		expectedRevision: 2,
		type: "selectPlan",
		kind: "A",
	});
	assert.equal(pausedPlan.ok, false);
	const resumed = ok(
		await store.execute({
			...base(),
			expectedRevision: 2,
			type: "resumeIntent",
		}),
	);
	assert.equal(resumed.intent.status, "saved");
	assert.equal(resumed.intent.revision, 3);
	assert.equal(store.getState().plans[proposal.plan.id].status, "invalid");
});
test("user and exact revision are required for every lifecycle command", async () => {
	const store = fresh();
	const intent = store.getState().intents[FIXTURE_IDS.intent];
	const commands: IntentLifecycleCommand[] = [
		{
			...base(),
			type: "editIntent",
			verbatim: intent.verbatim,
			parsedFields: intent.parsedFields,
			constraints: intent.constraints,
		},
		{ ...base(), type: "pauseIntent" },
		{ ...base(), type: "resumeIntent" },
		{ ...base(), type: "deleteIntent" },
	];
	const before = structuredClone(store.getState());
	for (const command of commands) {
		const actor = await store.execute({
			...command,
			commandId: "actor-" + ++seq,
			actor: "automation",
		});
		assert.equal(actor.ok, false);
		if (!actor.ok) assert.equal(actor.code, "USER_ONLY");
		const stale = await store.execute({
			...command,
			commandId: "stale-" + ++seq,
			expectedRevision: 99,
		});
		assert.equal(stale.ok, false);
		if (!stale.ok) assert.equal(stale.code, "REVISION_CONFLICT");
		const missing = await store.execute({
			...command,
			commandId: "missing-" + ++seq,
			expectedRevision: null,
		});
		assert.equal(missing.ok, false);
	}
	assert.deepEqual(store.getState(), before);
});
test("pause invalidates unconsumed approval and editing while paused stays paused", async () => {
	const store = fresh();
	const proposal = await prepared(store);
	const intent = store.getState().intents[FIXTURE_IDS.intent];
	ok(await store.execute({ ...base(), type: "pauseIntent" }));
	assert.equal(
		store.getState().approvals[proposal.approval.id].status,
		"invalid",
	);
	ok(
		await store.execute({
			...base(),
			expectedRevision: 2,
			type: "editIntent",
			verbatim: "待确认日期",
			parsedFields: { ...intent.parsedFields, date: null },
			constraints: [],
		}),
	);
	assert.equal(store.getState().intents[FIXTURE_IDS.intent].status, "paused");
	ok(
		await store.execute({
			...base(),
			expectedRevision: 3,
			type: "resumeIntent",
		}),
	);
	assert.equal(
		store.getState().intents[FIXTURE_IDS.intent].status,
		"ambiguous",
	);
	assert.equal(
		store.getState().approvals[proposal.approval.id].status,
		"invalid",
	);
});
test("invalid edit does not change records or invalidate a reviewed plan", async () => {
	const store = fresh();
	await prepared(store);
	const before = structuredClone(store.getState());
	const intent = before.intents[FIXTURE_IDS.intent];
	for (const fields of [
		{ ...intent.parsedFields, date: "2026-02-30" },
		{ ...intent.parsedFields, endTime: "01:00" },
		{ ...intent.parsedFields, timezone: "Not/A_Zone" },
	]) {
		const result = await store.execute({
			...base(),
			type: "editIntent",
			verbatim: intent.verbatim,
			parsedFields: fields,
			constraints: intent.constraints,
		});
		assert.equal(result.ok, false);
	}
	assert.deepEqual(store.getState(), before);
});
test("delete clears intent and linked capture text, keeps tombstone and cannot be reused", async () => {
	const store = fresh();
	const captured = ok(
		await store.execute({
			...base(),
			entityId: null,
			expectedRevision: null,
			type: "saveCaptureDraft",
			raw: "私密文本",
			channel: "text",
		}),
	);
	const saved = ok(
		await store.execute({
			...base(),
			entityId: captured.captureDraft.id,
			type: "saveIntent",
			raw: "私密文本",
			channel: "text",
			parsedFields:
				createInitialState("fixture").intents[FIXTURE_IDS.intent].parsedFields,
		}),
	);
	const before = store.getState();
	const deleted = ok(
		await store.execute({
			...base(),
			entityId: saved.intent.id,
			type: "deleteIntent",
		}),
	);
	assert.equal(deleted.intent.status, "deleted");
	assert.equal(deleted.intent.verbatim, "");
	assert.ok(
		Object.values(deleted.intent.parsedFields).every((value) => value === null),
	);
	assert.deepEqual(deleted.intent.constraints, []);
	assert.deepEqual(deleted.intent.sourceRefs, []);
	assert.equal(deleted.intent.deletedAt, NOW);
	assert.equal(
		store.getState().captureDrafts[captured.captureDraft.id].raw,
		"",
	);
	for (const type of ["resumeIntent", "pauseIntent", "deleteIntent"] as const)
		assert.equal(
			(
				await store.execute({
					...base(),
					entityId: saved.intent.id,
					expectedRevision: 2,
					type,
				})
			).ok,
			false,
		);
	assert.equal(
		(
			await store.execute({
				...base(),
				entityId: saved.intent.id,
				expectedRevision: 2,
				type: "editIntent",
				verbatim: "复活",
				parsedFields: saved.intent.parsedFields,
				constraints: [],
			})
		).ok,
		false,
	);
	assert.equal(
		(
			await store.execute({
				...base(),
				entityId: saved.intent.id,
				expectedRevision: 2,
				type: "selectPlan",
				kind: "A",
			})
		).ok,
		false,
	);
	assert.deepEqual(store.getState().commitments, before.commitments);
});
test("edited, paused, resumed and deleted intent states survive reopening existing persistence", async () => {
	const storage = new InMemoryStorage();
	const opened = async () => {
		const handle = await createPersistedDomainStore({
			storage,
			dataMode: "fixture",
			now: () => NOW,
		});
		if (handle.status !== "ready") throw new Error(handle.reason);
		return handle.store;
	};
	let store = await opened();
	const intent = store.getState().intents[FIXTURE_IDS.intent];
	ok(
		await store.execute({
			...base(),
			type: "editIntent",
			verbatim: "编辑后保存",
			parsedFields: intent.parsedFields,
			constraints: intent.constraints,
		}),
	);
	store = await opened();
	assert.equal(
		store.getState().intents[FIXTURE_IDS.intent].verbatim,
		"编辑后保存",
	);
	ok(
		await store.execute({
			...base(),
			expectedRevision: 2,
			type: "pauseIntent",
		}),
	);
	store = await opened();
	assert.equal(store.getState().intents[FIXTURE_IDS.intent].status, "paused");
	ok(
		await store.execute({
			...base(),
			expectedRevision: 3,
			type: "resumeIntent",
		}),
	);
	store = await opened();
	assert.equal(store.getState().intents[FIXTURE_IDS.intent].status, "saved");
	ok(
		await store.execute({
			...base(),
			expectedRevision: 4,
			type: "deleteIntent",
		}),
	);
	store = await opened();
	assert.equal(store.getState().intents[FIXTURE_IDS.intent].status, "deleted");
});
test("persisted tombstone text and malformed source revocation are rejected without silent repair", () => {
	const initial = createInitialState("fixture");
	const parse = (state: unknown) =>
		parseEnvelope(
			JSON.stringify({
				schemaVersion: 1,
				dataMode: "fixture",
				savedAt: NOW,
				state,
			}),
			"fixture",
		);
	assert.equal(
		parse({
			...initial,
			intents: {
				...initial.intents,
				[FIXTURE_IDS.intent]: {
					...initial.intents[FIXTURE_IDS.intent],
					status: "deleted",
					deletedAt: NOW,
				},
			},
		}).kind,
		"corrupt",
	);
	assert.equal(
		parse({
			...initial,
			sources: {
				...initial.sources,
				[FIXTURE_IDS.sourceCalendar]: {
					...initial.sources[FIXTURE_IDS.sourceCalendar],
					revocation: { remoteOutcome: "confirmed" },
				},
			},
		}).kind,
		"corrupt",
	);
});
