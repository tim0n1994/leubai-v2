import { fail, ok } from "../store.ts";
import type { Handler } from "../store.ts";
import { isCheckpointNote } from "../checkpointNoteModel.ts";
import { bump, finish, lookupEntity, requireRevision, requireUser } from "./shared.ts";

const appendCheckpointNote: Handler = (state, command, ctx) => {
  if (command.type !== "appendCheckpointNote") return fail("INVALID_INPUT", "Expected checkpoint note command", false);
  const userFailure = requireUser(command.actor, command.type);
  if (userFailure) return userFailure;
  const found = lookupEntity(state.checkpoints, command.entityId, "checkpoint");
  if (found.failure) return found.failure;
  if (command.expectedRevision === null) return fail("INVALID_INPUT", "Checkpoint note requires exact revision", false);
  const conflict = requireRevision(found.entity.revision, command.expectedRevision);
  if (conflict) return conflict;
  const note = { id: ctx.uuid(), verbatim: command.verbatim, channel: command.channel, createdAt: ctx.now };
  if (!isCheckpointNote(note)) return fail("INVALID_INPUT", "Note requires 1–20000 characters and text or voice provenance", false);
  const checkpoint = { ...bump(found.entity, ctx.now), notes: [...(found.entity.notes ?? []), note] };
  const nextState = finish(state, { checkpoints: { ...state.checkpoints, [checkpoint.id]: checkpoint } },
    [{ entityId: checkpoint.id, before: found.entity.revision, after: checkpoint.revision }],
    { eventId: ctx.uuid(), type: "checkpoint.note.appended", commandId: command.commandId, actor: command.actor, at: ctx.now, summary: "User appended a checkpoint note; saved snapshot unchanged" });
  return ok(nextState, { checkpoint });
};
export const checkpointNoteHandlers = { appendCheckpointNote };
