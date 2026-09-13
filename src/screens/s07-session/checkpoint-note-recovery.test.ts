import assert from "node:assert/strict";
import test from "node:test";
import { checkpointNoteRecovery } from "./checkpoint-note-recovery.ts";

test("definitive revision conflict requests explicit rebase even when transport marks it retryable", () => {
  assert.equal(checkpointNoteRecovery({ code: "REVISION_CONFLICT", retryable: true }), "rebase");
});
test("unconfirmed persistence errors retain exact retry while definitive rejection allows editing", () => {
  assert.equal(checkpointNoteRecovery({ code: "STORAGE_READBACK_UNVERIFIED", retryable: true }), "retry");
  assert.equal(checkpointNoteRecovery({ code: "INVALID_INPUT", retryable: false }), "edit");
});
