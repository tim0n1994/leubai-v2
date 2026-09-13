import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import type { CommandType } from "../types.ts";
import type {
  AssignToProtectedBlockCommand,
  DecideQuietCommand,
  OpenQuietSessionCommand,
  ProtectedBlock,
  QuietSession,
} from "../types.ts";
import { bump, finish, requireRevision, requireUser } from "./shared.ts";

export const quietHandlers: Partial<Record<CommandType, Handler>> = {
  openQuietSession: (state, command, ctx) => {
    const c = command as OpenQuietSessionCommand;
    const block = Object.values(state.protectedBlocks).find((b) => b.blockId === c.blockId);
    if (!block) return fail("ENTITY_NOT_FOUND", "protected block not found: " + c.blockId, false);
    const existing = Object.values(state.quietSessions).find((s) => s.blockId === c.blockId && s.decision === "unchosen");
    if (existing) return ok(null, { session: existing });
    const knownIntervals = Object.values(state.sources)
      .filter((source) => source.coverage.known)
      .flatMap((source) => source.coverage.intervals);
    const session: QuietSession = {
      id: ctx.uuid(),
      revision: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      dataMode: state.dataMode,
      provenance: { origin: "user" },
      blockId: c.blockId,
      originRoute: c.originRoute,
      decision: "unchosen",
      dismissedAt: null,
      suppressPrompts: false,
      coverageSnapshot: { known: knownIntervals.length > 0, intervals: knownIntervals },
    };
    const nextState = finish(
      state,
      { quietSessions: { ...state.quietSessions, [session.id]: session } },
      [{ entityId: session.id, before: 0, after: 1 }],
      { eventId: ctx.uuid(), type: "quiet.opened", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "quiet session opened" },
    );
    return ok(nextState, { session });
  },

  decideQuiet: (state, command, ctx) => {
    const c = command as DecideQuietCommand;
    let session = c.entityId ? state.quietSessions[c.entityId] : undefined;
    if (!session) {
      const candidates = Object.values(state.quietSessions)
        .filter((s) => s.blockId === c.blockId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      session = candidates[0];
    }
    if (!session) return fail("ENTITY_NOT_FOUND", "quiet session not found for block " + c.blockId, false);
    const revisionFail = requireRevision(session.revision, c.expectedRevision);
    if (revisionFail) return revisionFail;
    const updated: QuietSession = {
      ...bump(session, ctx.now),
      decision: c.decision,
      suppressPrompts: true,
      dismissedAt: c.decision === "exit" ? ctx.now : session.dismissedAt,
    };
    const nextState = finish(
      state,
      { quietSessions: { ...state.quietSessions, [updated.id]: updated } },
      [{ entityId: updated.id, before: session.revision, after: updated.revision }],
      { eventId: ctx.uuid(), type: "quiet.decided", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "quiet decision " + c.decision },
    );
    return ok(nextState, { session: updated });
  },

  assignToProtectedBlock: (state, command, ctx) => {
    const c = command as AssignToProtectedBlockCommand;
    const userFail = requireUser(c.actor, "assignToProtectedBlock");
    if (userFail) return userFail;
    const block = Object.values(state.protectedBlocks).find((b) => b.blockId === c.blockId);
    if (!block) return fail("ENTITY_NOT_FOUND", "protected block not found: " + c.blockId, false);
    const assignment = c.assignment.trim();
    if (!assignment) return fail("INVALID_INPUT", "assignment must not be empty", false);
    const updated: ProtectedBlock = { ...bump(block, ctx.now), purpose: assignment };
    const nextState = finish(
      state,
      { protectedBlocks: { ...state.protectedBlocks, [updated.id]: updated } },
      [{ entityId: updated.id, before: block.revision, after: updated.revision }],
      { eventId: ctx.uuid(), type: "protectedBlock.assigned", commandId: c.commandId, actor: c.actor, at: ctx.now, summary: "protected block explicitly assigned by user" },
    );
    return ok(nextState, { block: updated });
  },
};
