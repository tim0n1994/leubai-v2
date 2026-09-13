import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "./store.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { InMemoryStorage } from "../data/storage.ts";
import { isCheckpointNote } from "./checkpointNoteModel.ts";

test("checkpoint note preserves original voice transcript without changing snapshot", async () => {
  let sequence = 0;
  const store = createDomainStore({ dataMode: "fixture", now: () => "2026-09-13T10:00:00Z", uuid: () => "note-" + ++sequence });
  const base = () => ({ commandId: "command-" + ++sequence, actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" });
  const saved = await store.execute({ ...base(), type: "saveCheckpoint", entityId: null, expectedRevision: null });
  assert.ok(saved.ok);
  const checkpoint = saved.data.checkpoint;
  const result = await store.execute({ ...base(), type: "appendCheckpointNote", entityId: checkpoint.id, expectedRevision: checkpoint.revision, verbatim: "  待核实客户时间。\n", channel: "voice" });
  assert.ok(result.ok);
  assert.equal(result.data.checkpoint.notes?.[0]?.verbatim, "  待核实客户时间。\n");
  assert.equal(result.data.checkpoint.notes?.[0]?.channel, "voice");
  assert.deepEqual(result.data.checkpoint.sourceVersionSet, checkpoint.sourceVersionSet);
  assert.equal(result.data.checkpoint.savedAt, checkpoint.savedAt);
  const stale = await store.execute({ ...base(), type: "appendCheckpointNote", entityId: checkpoint.id, expectedRevision: checkpoint.revision, verbatim: "stale", channel: "text" });
  assert.equal(stale.ok, false);
});

test("notes survive persistent store reopen and identical command retries append only once", async () => {
  const storage = new InMemoryStorage();
  const opened = await createPersistedDomainStore({ dataMode: "fixture", storage });
  assert.equal(opened.status, "ready");
  if (opened.status !== "ready") return;
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" };
  const created = await opened.store.execute({ ...base, commandId: "create-notes-checkpoint", type: "saveCheckpoint", entityId: null, expectedRevision: null });
  assert.ok(created.ok);
  const command = { ...base, commandId: "append-notes-idempotent", type: "appendCheckpointNote" as const, entityId: created.data.checkpoint.id, expectedRevision: 1, verbatim: "  继续核对\n原始记录。", channel: "text" as const };
  assert.ok((await opened.store.execute(command)).ok);
  assert.ok((await opened.store.execute(command)).ok);
  const reopened = await createPersistedDomainStore({ dataMode: "fixture", storage });
  assert.equal(reopened.status, "ready");
  if (reopened.status !== "ready") return;
  const notes = reopened.store.getState().checkpoints[command.entityId]?.notes;
  assert.equal(notes?.length, 1);
  assert.equal(notes?.[0]?.verbatim, command.verbatim);
});

test("checkpoint note parser rejects empty, overlong, invalid-channel and invalid-time payloads", () => {
  const note = { id: "note", verbatim: "ok", channel: "text", createdAt: "2026-09-13T10:00:00Z" };
  assert.ok(isCheckpointNote(note));
  for (const invalid of [{ ...note, verbatim: "  " }, { ...note, verbatim: "a".repeat(20001) }, { ...note, channel: "model" }, { ...note, createdAt: "bad" }]) assert.equal(isCheckpointNote(invalid), false);
});

test("automation and blank note commands cannot append notes", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const base = { actor: "user" as const, issuedAt: "2026-09-13T10:00:00Z" };
  const created = await store.execute({ ...base, commandId: "note-create", type: "saveCheckpoint", entityId: null, expectedRevision: null });
  assert.ok(created.ok);
  const command = { ...base, type: "appendCheckpointNote" as const, entityId: created.data.checkpoint.id, expectedRevision: 1, verbatim: "valid", channel: "text" as const };
  assert.equal((await store.execute({ ...command, commandId: "note-automation", actor: "automation" })).ok, false);
  assert.equal((await store.execute({ ...command, commandId: "note-empty", verbatim: " " })).ok, false);
  assert.equal(store.getState().checkpoints[command.entityId]?.notes, undefined);
});
