import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "../../domain/store.ts";
import { restoreLatestCapture } from "./capture-restore.ts";
import { buildCaptureDraftCommand, buildIntentCommand, findMatchingIntent, parseSentence, validateInterval } from "./s14-capture-adapter.ts";

const submitted = { verbatim: "  明晚七点到八点留给自己，分享恢复验收。  ", fields: parseSentence("明晚七点到八点留给自己，分享恢复验收。") };

test("empty capture history does not manufacture a restored capture", () => {
  const state = createDomainStore({ dataMode: "fixture" }).getState();
  assert.deepEqual(restoreLatestCapture({ ...state, intents: {}, captureDrafts: {} }), { kind: "none" });
});

test("initial or explicit reopen restores saved share intent with the same duplicate-capture lock", async () => {
  const store = createDomainStore({ dataMode: "fixture" });
  const verdict = validateInterval(submitted.fields);
  assert.ok(verdict.ok);
  const result = await store.execute(buildIntentCommand({ submitted, interval: verdict.interval, target: null, channel: "share" }));
  assert.ok(result.ok);
  for (let opening = 0; opening < 2; opening++) {
    const restored = restoreLatestCapture(store.getState());
    assert.equal(restored.kind, "restored");
    assert.equal(restored.channel, "share");
    assert.equal(restored.draft.verbatim, submitted.verbatim);
    assert.equal(findMatchingIntent(store.getState(), restored.draft, restored.channel)?.id, result.data.intent.id);
    assert.equal(restored.target, null);
  }
});

test("reopening reads latest state and restores a newer open voice draft with its exact revision", async () => {
  const store = createDomainStore({ dataMode: "fixture", now: () => "2030-09-13T00:00:00Z" });
  const first = restoreLatestCapture(store.getState());
  const saved = await store.execute(buildCaptureDraftCommand({ submitted, target: null, channel: "voice" }));
  assert.ok(saved.ok);
  const reopened = restoreLatestCapture(store.getState());
  assert.notDeepEqual(reopened, first);
  assert.equal(reopened.kind, "restored");
  assert.equal(reopened.channel, "voice");
  assert.equal(reopened.draft.verbatim, submitted.verbatim);
  assert.deepEqual(reopened.target, { id: saved.data.captureDraft.id, revision: saved.data.captureDraft.revision, status: "open" });
  assert.equal(reopened.saved, null);
});

test("completed capture without historic intent link keeps its completed lock and does not revive discarded data", async () => {
  const store = createDomainStore({ dataMode: "fixture", now: () => "2030-09-13T00:00:00Z" });
  const saved = await store.execute(buildCaptureDraftCommand({ submitted, target: null, channel: "share" }));
  assert.ok(saved.ok);
  const state = store.getState();
  const record = { ...saved.data.captureDraft, status: "savedAsIntent" as const, intentId: undefined };
  const restored = restoreLatestCapture({ ...state, intents: {}, captureDrafts: { [record.id]: record } });
  if (restored.kind !== "restored") throw new Error(restored.kind);
  assert.deepEqual(restored.saved, { intentId: null, draftId: record.id, baseline: restored.draft });
  assert.equal(restored.target?.status, "savedAsIntent");
  assert.deepEqual(restoreLatestCapture({ ...state, intents: {}, captureDrafts: { [record.id]: { ...record, status: "discarded" } } }), { kind: "none" });
});
