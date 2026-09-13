import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechInput, speechErrorMessage, speechControlDisabled } from "./speech-input.ts";

test("unsupported speech host has no microphone action", () => {
  assert.equal(createSpeechInput({}), null);
});
test("parent submission cannot disable stop while microphone is listening", () => {
  assert.equal(speechControlDisabled(true, true), false);
  assert.equal(speechControlDisabled(true, false), true);
  assert.equal(speechControlDisabled(false, true), false);
});
test("speech failures provide distinct actionable states", () => {
  const errors = ["not-allowed", "no-speech", "audio-capture", "network", "aborted", "unexpected"];
  assert.equal(new Set(errors.map(speechErrorMessage)).size, errors.length);
});
