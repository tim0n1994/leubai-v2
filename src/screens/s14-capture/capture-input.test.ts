import assert from "node:assert/strict";
import test from "node:test";
import * as adapter from "./s14-capture-adapter.ts";
import { createDomainStore } from "../../domain/store.ts";

test("voice and share commands retain source channel and exact raw input", () => {
  // Given a transcript with meaningful original whitespace.
  const submitted = { verbatim: "  明晚七点到八点留给自己。  ", fields: adapter.parseSentence("明晚七点到八点留给自己。") };
  // When submitted through each capture source.
  for (const channel of ["voice", "share"] as const) {
    const command = adapter.buildCaptureDraftCommand({ submitted, target: null, channel });
    // Then provenance and original input survive without normalization.
    assert.equal(command.channel, channel);
    assert.equal(command.raw, submitted.verbatim);
  }
});

test("restored share and voice intents remain linked to saved record instead of enabling duplicate capture", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const submitted = { verbatim: "明晚七点到八点留给自己，验收分享原文。", fields: adapter.parseSentence("明晚七点到八点留给自己，验收分享原文。") };
  const verdict = adapter.validateInterval(submitted.fields);
  assert.ok(verdict.ok);
  for (const channel of ["voice", "share"] as const) {
    const command = adapter.buildIntentCommand({ submitted, interval: verdict.interval, target: null, channel });
    const saved = await store.execute(command);
    assert.ok(saved.ok);
    const restored = adapter.viewFromIntent(saved.data.intent);
    assert.equal(adapter.findMatchingIntent(store.getState(), restored.draft, channel)?.id, saved.data.intent.id);
    assert.equal(saved.data.intent.channel, channel);
    assert.equal(saved.data.intent.verbatim, submitted.verbatim);
  }
});
