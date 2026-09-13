import {
	applyContextReviewAction,
	createEmptyContextReviewState,
} from "../contextReviewModel.ts";
import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import { finish } from "./shared.ts";

export const contextReviewHandlers: Record<"contextReviewAction", Handler> = {
	contextReviewAction(state, command, ctx) {
		if (command.type !== "contextReviewAction")
			return fail("INVALID_INPUT", "Wrong command", false);
		if (command.action.actor !== command.actor)
			return fail(
				"USER_ONLY",
				"Action actor must match the command actor",
				false,
			);
		if (command.expectedRevision !== state.globalRevision)
			return fail(
				"REVISION_CONFLICT",
				"Context changed; review the latest state before applying",
				true,
			);
		const sources = Object.values(state.sources);
		const currentSourceVersions = Object.fromEntries(
			sources.map((source) => [source.id, source.sourceVersion]),
		);
		const allChecked =
			sources.length > 0 &&
			sources.every(
				(source) =>
					source.status === "connected" &&
					source.coverage.known &&
					source.lastSuccessAt &&
					!source.lastUsableSnapshot?.stale &&
					!source.accessRevokedAt,
			);
		const checkedAt = allChecked
			? sources.map((source) => source.lastSuccessAt ?? "").sort()[0]
			: null;
		const result = applyContextReviewAction(
			state.contextReview ?? createEmptyContextReviewState(),
			command.action,
			{
				actor: command.actor,
				now: ctx.now,
				uuid: ctx.uuid,
				dataMode: state.dataMode,
				protectedBlocks: state.protectedBlocks,
				ledger: state.ledger,
				currentSourceVersions,
				sourceRecheck: checkedAt
					? {
							outcome: "success",
							checkedAt,
							sourceVersions: currentSourceVersions,
						}
					: null,
			},
		);
		if (!result.ok) {
			const code =
				result.code === "NOT_FOUND"
					? "ENTITY_NOT_FOUND"
					: result.code === "INVALID_STATE"
						? "STORAGE_CORRUPT"
						: result.code === "PERIOD_CONFLICT"
							? "CONFLICT"
							: result.code === "STALE_RECEIPT"
								? "INVALID_TRANSITION"
								: result.code;
			return fail(code, result.reason, result.code === "REVISION_CONFLICT");
		}
		return ok(
			finish(state, { contextReview: result.state }, [], {
				eventId: ctx.uuid(),
				type: "context." + command.action.type,
				commandId: command.commandId,
				actor: command.actor,
				at: ctx.now,
				summary: command.action.type,
			}),
			{ contextReview: result.state },
		);
	},
};
