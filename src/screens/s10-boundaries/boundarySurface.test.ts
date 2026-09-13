import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore, type DomainStore } from "../../domain/store.ts";
import type { GrantKey, UpdateRulesCommand } from "../../domain/types.ts";
import {
  actorLabel,
  CAPABILITY_ROWS,
  formatBlockRange,
  grantStatusLabel,
  GRANT_KEYS,
  GRANT_ROWS,
  parseDailyCapacityMinutes,
  parseDailyReminderMax,
  planRulesRetry,
  describeRulesFailure,
  selectActiveProtectedBlocks,
  selectLatestConfirmation,
  selectRulesHistory,
  verifyBudgetMaxReadback,
  verifyCapacityReadback,
  verifyGrantReadback,
  verifyPauseReadback,
} from "./boundarySurface.ts";

const FIXED_NOW = "2026-09-12T01:00:00.000Z";

test("readback failure remains uncertain and requires the original command", () => {
  assert.deepEqual(describeRulesFailure({ code: "STORAGE_READBACK_UNVERIFIED" }), { persistedUnknown: true, plan: "replayExact" });
});
test("a thrown commit stage is uncertain even when the code says write failed", () => {
  assert.deepEqual(describeRulesFailure({ code: "STORAGE_WRITE_FAILED", details: { stage: "unknown" } }), { persistedUnknown: true, plan: "replayExact" });
});
test("postwrite conflict cannot be recaptured as a definitely unwritten change", () => {
  assert.deepEqual(describeRulesFailure({ code: "REVISION_CONFLICT", details: { stage: "postwrite" } }), { persistedUnknown: true, plan: "replayExact" });
});

test("definitive prewrite refusals remain distinct from unknown effects", () => {
  assert.deepEqual(describeRulesFailure({ code: "STORAGE_WRITE_FAILED" }), { persistedUnknown: false, plan: "replayExact" });
  assert.deepEqual(describeRulesFailure({ code: "REVISION_CONFLICT" }), { persistedUnknown: false, plan: "recapture" });
  assert.deepEqual(describeRulesFailure({ code: "INVALID_INPUT", details: "unknown" }), { persistedUnknown: false, plan: "replayExact" });
});
test("an unresolved attempt cannot be discarded when its retry also fails", () => {
  assert.deepEqual(describeRulesFailure({ code: "STORAGE_READ_FAILED" }, true), { persistedUnknown: true, plan: "replayExact" });
  assert.deepEqual(describeRulesFailure({ code: "REVISION_CONFLICT" }, true), { persistedUnknown: true, plan: "replayExact" });
});
let uuidSeq = 0;
let commandSeq = 0;

function makeStore(): DomainStore {
  uuidSeq = 0;
  commandSeq = 0;
  return createDomainStore({
    dataMode: "fixture",
    now: () => FIXED_NOW,
    uuid: () => {
      uuidSeq += 1;
      return "uuid-" + String(uuidSeq);
    },
  });
}

function updateRules(
  patch: Partial<Pick<UpdateRulesCommand, "grants" | "dailyCapacityMinutes" | "dailyReminderMax" | "summary">>,
  expectedRevision: number,
  entityId: string,
): UpdateRulesCommand {
  commandSeq += 1;
  return {
    type: "updateRules",
    commandId: "cmd-rules-" + String(commandSeq),
    entityId,
    expectedRevision,
    actor: "user",
    issuedAt: FIXED_NOW,
    summary: patch.summary ?? "test rule change",
    grants: patch.grants,
    dailyCapacityMinutes: patch.dailyCapacityMinutes,
    dailyReminderMax: patch.dailyReminderMax,
  };
}

test("exactly the six domain grant keys are claimable, each described once", () => {
  assert.deepEqual([...GRANT_KEYS], [
    "readMaterial",
    "createLocalDraft",
    "updateEstimate",
    "internalReschedule",
    "attentionRemind",
    "externalCalendarWrite",
  ]);
  assert.deepEqual(
    GRANT_ROWS.map((row) => row.key),
    [...GRANT_KEYS],
  );
  for (const row of GRANT_ROWS) {
    assert.ok(row.title.trim().length > 0);
    assert.ok(row.desc.trim().length > 0);
  }
});

test("actions without a grant are shown as not claimable, never as checkboxes", () => {
  assert.equal(CAPABILITY_ROWS.length, 3);
  const titles = CAPABILITY_ROWS.map((row) => row.title).join("|");
  assert.match(titles, /移动外部会议/);
  assert.match(titles, /发送消息|提交交付/);
  assert.match(titles, /付款|购买/);
  for (const row of CAPABILITY_ROWS) {
    assert.match(row.note, /没有对应权限项/);
    assert.match(row.note, /复选框/);
    assert.match(row.note, /推导/);
  }
});

test("grant status labels separate granted from locked", () => {
  assert.deepEqual(grantStatusLabel(true), { label: "已授权", tone: "ok" });
  assert.deepEqual(grantStatusLabel(false), { label: "未授权", tone: "locked" });
});

test("capacity input accepts only positive whole minutes", () => {
  for (const raw of ["", "   ", "abc", "0", "-5", "2.5"]) {
    const parsed = parseDailyCapacityMinutes(raw);
    assert.equal(parsed.ok, false, raw);
  }
  assert.deepEqual(parseDailyCapacityMinutes("1e3"), { ok: true, value: 1000 });
  assert.deepEqual(parseDailyCapacityMinutes("+90"), { ok: true, value: 90 });
  const ok = parseDailyCapacityMinutes(" 90 ");
  assert.deepEqual(ok, { ok: true, value: 90 });
  assert.deepEqual(parseDailyCapacityMinutes("120"), { ok: true, value: 120 });
});

test("pause readback verifies paused field and epoch, and treats persisted-null as unknown", async () => {
  const store = makeStore();
  const before = store.getState().ruleset;
  commandSeq += 1;
  const pause = await store.execute({
    type: "pauseAutomation",
    commandId: "cmd-pause-" + String(commandSeq),
    entityId: before.id,
    expectedRevision: before.revision,
    actor: "user",
    issuedAt: FIXED_NOW,
  });
  assert.ok(pause.ok);
  const paused = store.getState().ruleset;
  assert.equal(paused.paused, true);
  assert.equal(paused.pauseEpoch, before.pauseEpoch + 1);
  assert.equal(paused.revision, before.revision);
  assert.deepEqual(verifyPauseReadback(store.getState(), store.getState(), true, paused.pauseEpoch), { ok: true });
  const unknown = verifyPauseReadback(store.getState(), null, true, paused.pauseEpoch);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.persistedUnknown, true);
  const wrongEpoch = verifyPauseReadback(store.getState(), store.getState(), true, paused.pauseEpoch + 5);
  assert.equal(wrongEpoch.ok, false);
  const wrongField = verifyPauseReadback(store.getState(), store.getState(), false, paused.pauseEpoch);
  assert.equal(wrongField.ok, false);
});

test("resume readback requires paused=false and keeps the same epoch", async () => {
  const store = makeStore();
  const before = store.getState().ruleset;
  commandSeq += 1;
  await store.execute({
    type: "pauseAutomation",
    commandId: "cmd-pause-" + String(commandSeq),
    entityId: before.id,
    expectedRevision: before.revision,
    actor: "user",
    issuedAt: FIXED_NOW,
  });
  commandSeq += 1;
  const resume = await store.execute({
    type: "resumeAutomation",
    commandId: "cmd-resume-" + String(commandSeq),
    entityId: before.id,
    expectedRevision: before.revision,
    actor: "user",
    issuedAt: FIXED_NOW,
  });
  assert.ok(resume.ok);
  const resumed = store.getState().ruleset;
  assert.equal(resumed.paused, false);
  assert.equal(resumed.pauseEpoch, before.pauseEpoch + 1);
  assert.deepEqual(verifyPauseReadback(store.getState(), store.getState(), false, resumed.pauseEpoch), { ok: true });
});

test("grant change with exact revision verifies dual readback and rejects drifted states", async () => {
  const store = makeStore();
  const before = store.getState().ruleset;
  const patch: Partial<Record<GrantKey, boolean>> = { readMaterial: false };
  const result = await store.execute(updateRules({ grants: patch }, before.revision, before.id));
  assert.ok(result.ok);
  const expectedNext = before.revision + 1;
  assert.deepEqual(verifyGrantReadback(store.getState(), store.getState(), patch, expectedNext), { ok: true });
  const unknown = verifyGrantReadback(store.getState(), null, patch, expectedNext);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.persistedUnknown, true);
  const wrongValue = verifyGrantReadback(store.getState(), store.getState(), { readMaterial: true }, expectedNext);
  assert.equal(wrongValue.ok, false);
  const staleRevision = verifyGrantReadback(store.getState(), store.getState(), patch, before.revision);
  assert.equal(staleRevision.ok, false);
});

test("an interleaved rules write makes the earlier candidate's readback fail honestly", async () => {
  const store = makeStore();
  const before = store.getState().ruleset;
  const candidate = updateRules({ grants: { createLocalDraft: false } }, before.revision, before.id);
  await store.execute(updateRules({ grants: { readMaterial: false } }, before.revision, before.id));
  const lateResult = await store.execute(candidate);
  assert.ok(lateResult.ok);
  const check = verifyGrantReadback(store.getState(), store.getState(), { createLocalDraft: false }, before.revision + 1);
  assert.equal(check.ok, false);
});

test("capacity save updates rules, never touches protected blocks", async () => {
  const store = makeStore();
  const before = store.getState();
  const result = await store.execute(
    updateRules({ dailyCapacityMinutes: 90 }, before.ruleset.revision, before.ruleset.id),
  );
  assert.ok(result.ok);
  const after = store.getState();
  assert.equal(after.ruleset.dailyCapacityMinutes, 90);
  const expectedNext = before.ruleset.revision + 1;
  assert.deepEqual(verifyCapacityReadback(after, after, 90, expectedNext), { ok: true });
  const unknown = verifyCapacityReadback(after, null, 90, expectedNext);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.persistedUnknown, true);
  const wrong = verifyCapacityReadback(after, after, 120, expectedNext);
  assert.equal(wrong.ok, false);
  assert.deepEqual(
    Object.values(after.protectedBlocks).map((b) => [b.id, b.status, b.range]),
    Object.values(before.protectedBlocks).map((b) => [b.id, b.status, b.range]),
  );
});

test("history reads newest first without mutating the shared array, and picks the latest user confirmation", async () => {
  const store = makeStore();
  const seed = store.getState().ruleset;
  assert.equal(seed.history.length, 1);
  await store.execute(updateRules({ grants: { readMaterial: false } }, seed.revision, seed.id));
  await store.execute(updateRules({ dailyCapacityMinutes: 60 }, seed.revision + 1, seed.id));
  const ruleset = store.getState().ruleset;
  assert.deepEqual(
    selectRulesHistory(ruleset).map((row) => row.revision),
    [3, 2, 1],
  );
  assert.deepEqual(
    ruleset.history.map((row) => row.revision),
    [1, 2, 3],
  );
  const latest = selectLatestConfirmation(ruleset);
  assert.ok(latest);
  if (latest) assert.equal(latest.revision, 3);
  assert.equal(actorLabel("user"), "由你确认");
  assert.equal(actorLabel("automation"), "自动化记录");
  assert.equal(actorLabel("model"), "AI 建议记录");
});

test("active protected blocks come from shared state and skip released ones", () => {
  const store = makeStore();
  const state = store.getState();
  const active = selectActiveProtectedBlocks(state);
  assert.equal(active.length, 1);
  assert.equal(active[0].status, "active");
  const rangeText = formatBlockRange(active[0], state.ruleset.timezone);
  assert.match(rangeText, /19:00/);
  assert.match(rangeText, /20:00/);
  const released = structuredClone(state);
  for (const block of Object.values(released.protectedBlocks)) {
    block.status = "released";
  }
  assert.equal(selectActiveProtectedBlocks(released).length, 0);
});

test("retry planning distinguishes revision conflicts from replayable failures", () => {
  assert.equal(planRulesRetry("REVISION_CONFLICT"), "recapture");
  assert.equal(planRulesRetry("STORAGE_WRITE_FAILED"), "replayExact");
  assert.equal(planRulesRetry("INVALID_INPUT"), "replayExact");
});

test("dailyReminderMax input validation accepts whole 0..10 and rejects everything else", () => {
  assert.deepEqual(parseDailyReminderMax("0"), { ok: true, value: 0 });
  assert.deepEqual(parseDailyReminderMax(" 7 "), { ok: true, value: 7 });
  assert.deepEqual(parseDailyReminderMax("10"), { ok: true, value: 10 });
  for (const bad of ["", "   ", "-1", "11", "1.5", "NaN", "Infinity", "abc"]) {
    const parsed = parseDailyReminderMax(bad);
    assert.equal(parsed.ok, false, "expected rejection for " + JSON.stringify(bad));
    if (!parsed.ok) assert.ok(parsed.reason.trim().length > 0);
  }
});

test("budget max save verifies ruleset and budget revisions together and never trusts a missing persisted layer", async () => {
  const store = makeStore();
  const before = store.getState();
  const usedBefore = before.attention.budget.used;
  const result = await store.execute(
    updateRules({ dailyReminderMax: 5 }, before.ruleset.revision, before.ruleset.id),
  );
  assert.ok(result.ok);
  const after = store.getState();
  assert.equal(after.attention.budget.dailyMax, 5);
  assert.equal(after.attention.budget.used, usedBefore);
  const expectedRuleset = before.ruleset.revision + 1;
  const expectedBudget = before.attention.budget.revision + 1;
  assert.deepEqual(
    verifyBudgetMaxReadback(after, after, 5, expectedRuleset, expectedBudget),
    { ok: true },
  );
  const unknown = verifyBudgetMaxReadback(after, null, 5, expectedRuleset, expectedBudget);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.persistedUnknown, true);
  assert.equal(verifyBudgetMaxReadback(after, after, 6, expectedRuleset, expectedBudget).ok, false);
  assert.equal(verifyBudgetMaxReadback(after, after, 5, expectedRuleset, expectedBudget + 5).ok, false);
  assert.equal(verifyBudgetMaxReadback(after, after, 5, expectedRuleset + 3, expectedBudget).ok, false);
});
