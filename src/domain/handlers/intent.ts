import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import type { Intent, IntentLifecycleCommand, ParsedFields } from "../types.ts";
import {
	bump,
	finish,
	lookupEntity,
	requireRevision,
	requireUser,
} from "./shared.ts";
import {
	constraintsFailure,
	missingFieldGroups,
	parsedFieldsFailure,
	suppliedSemanticFailure,
} from "./capture.ts";

const emptyFields = (): ParsedFields => ({
	date: null,
	startTime: null,
	endTime: null,
	timezone: null,
	topic: null,
});

const handleIntent: Handler = (state, command, ctx) => {
	if (
		command.type !== "editIntent" &&
		command.type !== "pauseIntent" &&
		command.type !== "resumeIntent" &&
		command.type !== "deleteIntent"
	)
		return fail("INVALID_INPUT", "Unknown intent lifecycle command", false);
	const userFailure = requireUser(command.actor, command.type);
	if (userFailure) return userFailure;
	const found = lookupEntity(state.intents, command.entityId, "intent");
	if (found.failure) return found.failure;
	const intent = found.entity;
	if (
		!Number.isSafeInteger(command.expectedRevision) ||
		command.expectedRevision === null ||
		command.expectedRevision < 1
	)
		return fail(
			"INVALID_INPUT",
			"Intent changes require the exact current revision",
			false,
		);
	const revisionFailure = requireRevision(
		intent.revision,
		command.expectedRevision,
	);
	if (revisionFailure) return revisionFailure;
	if (
		!Number.isSafeInteger(intent.revision) ||
		intent.revision >= Number.MAX_SAFE_INTEGER
	)
		return fail("REVISION_CONFLICT", "Intent revision is exhausted", false);
	if (intent.status === "deleted" || intent.status === "discarded")
		return fail(
			"INVALID_TRANSITION",
			"Deleted or discarded intents cannot be reused",
			false,
		);
	let updated: Intent;
	if (command.type === "editIntent") {
		if (
			typeof command.verbatim !== "string" ||
			(intent.channel === "manual"
				? command.verbatim !== ""
				: !command.verbatim.trim())
		)
			return fail(
				"INVALID_INPUT",
				"Keep manual intent text empty; other intent text must not be blank",
				false,
			);
		const shape = parsedFieldsFailure(command.parsedFields);
		if (shape) return shape;
		if (
			!command.parsedFields ||
			Object.keys(emptyFields()).some(
				(key) => !Object.hasOwn(command.parsedFields, key),
			)
		)
			return fail(
				"INVALID_INPUT",
				"Editing requires all five explicit fields",
				false,
			);
		const semantic = suppliedSemanticFailure(command.parsedFields);
		if (semantic) return semantic;
		const constraints = constraintsFailure(command.constraints);
		if (constraints) return constraints;
		if (
			!Array.isArray(command.constraints) ||
			command.constraints.some(
				(entry) =>
					typeof entry.id !== "string" ||
					!entry.id.trim() ||
					!entry.kind.trim() ||
					!entry.expression.trim(),
			) ||
			new Set(command.constraints.map((entry) => entry.id)).size !==
				command.constraints.length
		)
			return fail(
				"INVALID_INPUT",
				"Constraints require unique ids and nonempty kind and expression",
				false,
			);
		const missing = missingFieldGroups(command.parsedFields);
		if (intent.channel === "manual" && missing.length > 0)
			return fail(
				"INVALID_INPUT",
				"Manual field-only intent requires date, time and timezone",
				false,
			);
		updated = {
			...bump(intent, ctx.now),
			verbatim: command.verbatim,
			parsedFields: { ...command.parsedFields },
			constraints: command.constraints.map((entry) => ({ ...entry })),
			fieldStatus: Object.fromEntries(
				Object.entries(command.parsedFields)
					.filter(([, value]) => value !== null)
					.map(([key]) => [key, "corrected"]),
			),
			status:
				intent.status === "paused"
					? "paused"
					: missing.length
						? "ambiguous"
						: "saved",
			ambiguityNote: missing.length
				? "待确认字段：" + missing.join(", ")
				: null,
		};
	} else if (command.type === "pauseIntent") {
		if (intent.status === "paused")
			return fail("INVALID_TRANSITION", "Intent is already paused", false);
		updated = { ...bump(intent, ctx.now), status: "paused", pausedAt: ctx.now };
	} else if (command.type === "resumeIntent") {
		if (intent.status !== "paused")
			return fail(
				"INVALID_TRANSITION",
				"Only a paused intent can resume",
				false,
			);
		updated = {
			...bump(intent, ctx.now),
			status: missingFieldGroups(intent.parsedFields).length
				? "ambiguous"
				: "saved",
			pausedAt: null,
		};
	} else {
		updated = {
			id: intent.id,
			revision: intent.revision + 1,
			createdAt: intent.createdAt,
			updatedAt: ctx.now,
			dataMode: intent.dataMode,
			provenance: { origin: "user" },
			channel: intent.channel,
			verbatim: "",
			parsedFields: emptyFields(),
			fieldStatus: {},
			constraints: [],
			sourceRefs: [],
			status: "deleted",
			ambiguityNote: null,
			pausedAt: null,
			deletedAt: ctx.now,
		};
	}
	const reason = "意图已变更，需重新预览与授权。";
	const plans = { ...state.plans };
	const approvals = { ...state.approvals };
	const invalidatedPlanIds: string[] = [];
	const invalidatedApprovalIds: string[] = [];
	const changes = [
		{ entityId: intent.id, before: intent.revision, after: updated.revision },
	];
	const boundPlanIds = new Set(
		Object.values(plans)
			.filter((plan) => plan.intentId === intent.id)
			.map((plan) => plan.id),
	);
	for (const plan of Object.values(plans)) {
		if (!boundPlanIds.has(plan.id) || plan.status === "invalid") continue;
		if (plan.revision >= Number.MAX_SAFE_INTEGER)
			return fail(
				"REVISION_CONFLICT",
				"Bound plan revision is exhausted",
				false,
			);
		plans[plan.id] = {
			...bump(plan, ctx.now),
			status: "invalid",
			invalidReason: reason,
		};
		invalidatedPlanIds.push(plan.id);
		changes.push({
			entityId: plan.id,
			before: plan.revision,
			after: plan.revision + 1,
		});
	}
	for (const approval of Object.values(approvals)) {
		if (
			(!boundPlanIds.has(approval.planId) &&
				!Object.hasOwn(
					state.changeSets[approval.changeSetId]?.targetRevisions ?? {},
					intent.id,
				)) ||
			(approval.status !== "pending" && approval.status !== "valid")
		)
			continue;
		if (approval.revision >= Number.MAX_SAFE_INTEGER)
			return fail(
				"REVISION_CONFLICT",
				"Bound approval revision is exhausted",
				false,
			);
		approvals[approval.id] = {
			...bump(approval, ctx.now),
			status: "invalid",
			invalidReason: reason,
		};
		invalidatedApprovalIds.push(approval.id);
		changes.push({
			entityId: approval.id,
			before: approval.revision,
			after: approval.revision + 1,
		});
	}
	const captureDrafts = { ...state.captureDrafts };
	if (command.type === "deleteIntent")
		for (const draft of Object.values(captureDrafts)) {
			if (draft.intentId !== intent.id) continue;
			if (draft.revision >= Number.MAX_SAFE_INTEGER)
				return fail(
					"REVISION_CONFLICT",
					"Linked capture revision is exhausted",
					false,
				);
			captureDrafts[draft.id] = {
				id: draft.id,
				revision: draft.revision + 1,
				createdAt: draft.createdAt,
				updatedAt: ctx.now,
				dataMode: draft.dataMode,
				provenance: { origin: "user" },
				channel: draft.channel,
				raw: "",
				parsedFields: emptyFields(),
				constraints: [],
				ambiguityNote: null,
				status: "savedAsIntent",
				intentId: intent.id,
			};
			changes.push({
				entityId: draft.id,
				before: draft.revision,
				after: draft.revision + 1,
			});
		}
	const next = finish(
		state,
		{
			intents: { ...state.intents, [intent.id]: updated },
			plans,
			approvals,
			captureDrafts,
		},
		changes,
		{
			eventId: ctx.uuid(),
			type: "intent." + command.type,
			commandId: command.commandId,
			actor: command.actor,
			at: ctx.now,
			summary:
				command.type +
				": current intent changed; existing responsibilities retained",
		},
	);
	return ok(next, {
		intent: updated,
		invalidatedPlanIds,
		invalidatedApprovalIds,
	});
};

export const intentHandlers: Record<IntentLifecycleCommand["type"], Handler> = {
	editIntent: handleIntent,
	pauseIntent: handleIntent,
	resumeIntent: handleIntent,
	deleteIntent: handleIntent,
};
