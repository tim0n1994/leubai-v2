/// <reference types="node" />
// Focused closeout contract: capture lifecycle (manual field-only intent,
// CaptureDraft update/constraints, atomic linked completion) plus the
// selectPlan intent envelope (real saved intent binding, intent revision in
// ChangeSet.targetRevisions, stale-intent approval blocking).
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_IDS,
  createDomainStore,
  createInitialState,
} from "./index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  DomainCommand,
  DomainState,
  FailureCode,
} from "./index.ts";

const NOW = "2026-09-12T10:00:00+08:00";
let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "closeout-uuid-" + uuidSeq;
}

function newStore(initialState?: DomainState) {
  return createDomainStore({ dataMode: "fixture", initialState, now: () => NOW, uuid: testUuid });
}

function cmd<T extends CommandType>(
  type: T,
  rest: Omit<Extract<DomainCommand, { type: T }>, "type" | "commandId" | "actor" | "issuedAt"> &
    Partial<Pick<CommandBase, "actor" | "commandId">>,
): Extract<DomainCommand, { type: T }> {
  commandSeq += 1;
  return {
    type,
    commandId: rest.commandId ?? "closeout-cmd-" + commandSeq,
    actor: "user",
    issuedAt: NOW,
    ...rest,
  } as Extract<DomainCommand, { type: T }>;
}

function asOk<T extends DomainCommand>(result: CommandResult<T>): CommandDataOf<T> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

function asFailure(result: CommandResult<DomainCommand>): {
  code: FailureCode;
  reason: string;
  details?: Record<string, unknown>;
} {
  if (result.ok) throw new Error("expected failure, got ok");
  return result;
}

function discardedIntentState(): DomainState {
  const base = createInitialState("fixture");
  const fixtureIntent = base.intents[FIXTURE_IDS.intent];
  const discarded = { ...fixtureIntent, id: "fx-intent-discarded-01", status: "discarded" as const };
  return { ...base, intents: { ...base.intents, "fx-intent-discarded-01": discarded } };
}

const QUIET_CONSTRAINT = { kind: "quiet", expression: "不被打扰", confirmed: true };
const MANUAL_FIELDS = { date: "2026-09-14", startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: "写复盘" };

test("manual field-only saveIntent creates a saved user intent with exactly empty verbatim", async () => {
  const store = newStore();
  const data = asOk(
    await store.execute(
      cmd("saveIntent", { entityId: null, expectedRevision: null, raw: "", channel: "manual", parsedFields: MANUAL_FIELDS }),
    ),
  );
  assert.equal(data.intent.status, "saved");
  assert.equal(data.intent.verbatim, "");
  assert.equal(data.intent.channel, "manual");
  assert.deepEqual(data.intent.provenance, { origin: "user", note: "manual field entry" });
  assert.equal(data.intent.ambiguityNote, null);
  for (const key of ["date", "startTime", "endTime", "timezone", "topic"]) {
    assert.equal(data.intent.fieldStatus[key], "confirmed");
  }
  const stored = store.getState().intents[data.intent.id];
  assert.ok(stored, "intent must exist in resulting state");
  assert.equal(stored.status, "saved");
});

test("manual field-only saveIntent rejects incomplete fields instead of fabricating ambiguity", async () => {
  const store = newStore();
  const missingDate = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: null,
        expectedRevision: null,
        raw: "",
        channel: "manual",
        parsedFields: { date: null, startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: null },
      }),
    ),
  );
  assert.equal(missingDate.code, "INVALID_INPUT");
  assert.match(missingDate.reason, /manual field-only/);
  const allMissing = asFailure(
    await store.execute(cmd("saveIntent", { entityId: null, expectedRevision: null, raw: "", channel: "manual" })),
  );
  assert.equal(allMissing.code, "INVALID_INPUT");
  assert.match(allMissing.reason, /manual field-only/);
  assert.equal(Object.keys(store.getState().intents).length, 1);
});

test("manual capture is user-only", async () => {
  const store = newStore();
  const byAutomation = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: null,
        expectedRevision: null,
        raw: "",
        channel: "manual",
        parsedFields: MANUAL_FIELDS,
        actor: "automation",
      }),
    ),
  );
  assert.equal(byAutomation.code, "USER_ONLY");
  assert.equal(Object.keys(store.getState().intents).length, 1);
});

test("saveIntent rejects impossible dates, out-of-range times, reversed intervals, and unknown zones", async () => {
  const store = newStore();
  const cases: Array<{ parsedFields: Record<string, string | null>; reason: RegExp }> = [
    { parsedFields: { ...MANUAL_FIELDS, date: "2026-02-30" }, reason: /real calendar date/ },
    { parsedFields: { ...MANUAL_FIELDS, startTime: "24:00" }, reason: /HH:MM/ },
    { parsedFields: { ...MANUAL_FIELDS, endTime: "99:99" }, reason: /HH:MM/ },
    { parsedFields: { ...MANUAL_FIELDS, startTime: "11:00", endTime: "09:00" }, reason: /later/ },
    { parsedFields: { ...MANUAL_FIELDS, timezone: "Mars/Olympus_Mons" }, reason: /IANA timezone/ },
  ];
  for (const c of cases) {
    const f = asFailure(
      await store.execute(
        cmd("saveIntent", { entityId: null, expectedRevision: null, raw: "", channel: "manual", parsedFields: c.parsedFields }),
      ),
    );
    assert.equal(f.code, "INVALID_INPUT");
    assert.match(f.reason, c.reason);
  }
  const textChannelBadDate = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: null,
        expectedRevision: null,
        raw: "下周汇报",
        channel: "text",
        parsedFields: { date: "2026-02-30", startTime: "09:00", endTime: "10:00", timezone: "Asia/Shanghai", topic: null },
      }),
    ),
  );
  assert.equal(textChannelBadDate.code, "INVALID_INPUT");
  assert.match(textChannelBadDate.reason, /real calendar date/);
  assert.equal(Object.keys(store.getState().intents).length, 1);
});

test("independent null/null saveIntent keeps verbatim whitespace exact while validating trimmed", async () => {
  const store = newStore();
  const data = asOk(
    await store.execute(
      cmd("saveIntent", {
        entityId: null,
        expectedRevision: null,
        raw: "  周四上午写评审意见  ",
        channel: "text",
        parsedFields: { date: "2026-09-17", startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: "评审意见" },
      }),
    ),
  );
  assert.equal(data.intent.status, "saved");
  assert.equal(data.intent.verbatim, "  周四上午写评审意见  ");
});

test("nonmanual channels still reject blank raw and keep existing ambiguity semantics", async () => {
  const store = newStore();
  const blank = asFailure(
    await store.execute(cmd("saveIntent", { entityId: null, expectedRevision: null, raw: "   ", channel: "voice" })),
  );
  assert.equal(blank.code, "INVALID_INPUT");
  const ambiguous = asOk(
    await store.execute(cmd("saveIntent", { entityId: null, expectedRevision: null, raw: "找时间处理合作方反馈", channel: "share" })),
  );
  assert.equal(ambiguous.intent.status, "ambiguous");
  assert.equal(Object.keys(store.getState().intents).length, 2);
});

test("saveCaptureDraft updates the exact open draft in place with revision+1", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(cmd("saveCaptureDraft", { entityId: null, expectedRevision: null, channel: "text", raw: "第一版" })),
  );
  const draftId = created.captureDraft.id;
  assert.equal(created.captureDraft.revision, 1);
  const updated = asOk(
    await store.execute(
      cmd("saveCaptureDraft", { entityId: draftId, expectedRevision: 1, channel: "voice", raw: "第二版", parsedFields: { topic: "周报" } }),
    ),
  );
  assert.equal(updated.captureDraft.id, draftId);
  assert.equal(updated.captureDraft.revision, 2);
  assert.equal(updated.captureDraft.raw, "第二版");
  assert.equal(updated.captureDraft.channel, "voice");
  assert.equal(updated.captureDraft.status, "open");
  assert.deepEqual(updated.captureDraft.parsedFields, {
    date: null,
    startTime: null,
    endTime: null,
    timezone: null,
    topic: "周报",
  });
  const drafts = store.getState().captureDrafts;
  assert.equal(Object.keys(drafts).length, 1);
  assert.equal(drafts[draftId].revision, 2);
});

test("draft update preserves omitted fields/constraints, merges partial fields, and honors explicit clears", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: null,
        expectedRevision: null,
        channel: "text",
        raw: "v1",
        parsedFields: { date: "2026-02-30" },
        ambiguityNote: "note-1",
        constraints: [QUIET_CONSTRAINT],
      }),
    ),
  );
  const draftId = created.captureDraft.id;
  assert.deepEqual(created.captureDraft.constraints, [QUIET_CONSTRAINT]);
  const merged = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: draftId,
        expectedRevision: 1,
        channel: "text",
        raw: "v2",
        parsedFields: { startTime: "10:00" },
      }),
    ),
  );
  assert.equal(merged.captureDraft.revision, 2);
  assert.deepEqual(merged.captureDraft.parsedFields, {
    date: "2026-02-30",
    startTime: "10:00",
    endTime: null,
    timezone: null,
    topic: null,
  });
  assert.equal(merged.captureDraft.ambiguityNote, "note-1");
  assert.deepEqual(merged.captureDraft.constraints, [QUIET_CONSTRAINT]);
  const cleared = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: draftId,
        expectedRevision: 2,
        channel: "text",
        raw: "v3",
        parsedFields: { date: null },
        ambiguityNote: null,
        constraints: [],
      }),
    ),
  );
  assert.equal(cleared.captureDraft.revision, 3);
  assert.deepEqual(cleared.captureDraft.parsedFields, {
    date: null,
    startTime: "10:00",
    endTime: null,
    timezone: null,
    topic: null,
  });
  assert.equal(cleared.captureDraft.ambiguityNote, null);
  assert.deepEqual(cleared.captureDraft.constraints, []);
  const state = store.getState();
  assert.deepEqual(state.captureDrafts[draftId].constraints, []);
});

test("draft save preserves semantically invalid strings exactly; linked saveIntent rejects them without completing", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: null,
        expectedRevision: null,
        channel: "text",
        raw: "  原样保留  ",
        parsedFields: { date: "2026-02-30", startTime: "25:99", timezone: "Nowhere/Nowhere" },
      }),
    ),
  );
  const draftId = created.captureDraft.id;
  assert.equal(created.captureDraft.raw, "  原样保留  ");
  assert.equal(created.captureDraft.parsedFields.date, "2026-02-30");
  assert.equal(created.captureDraft.parsedFields.startTime, "25:99");
  assert.equal(created.captureDraft.parsedFields.timezone, "Nowhere/Nowhere");
  const before = store.getState();
  const rejected = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "",
        channel: "manual",
        parsedFields: { startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: null },
      }),
    ),
  );
  assert.equal(rejected.code, "INVALID_INPUT");
  assert.match(rejected.reason, /real calendar date/);
  assert.deepEqual(store.getState().captureDrafts[draftId], before.captureDrafts[draftId]);
  assert.equal(store.getState().captureDrafts[draftId].status, "open");
  assert.equal(Object.keys(store.getState().intents).length, Object.keys(before.intents).length);
});

test("draft update rejects missing, stale, and non-open targets with zero mutation", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(cmd("saveCaptureDraft", { entityId: null, expectedRevision: null, channel: "text", raw: "初稿" })),
  );
  const draftId = created.captureDraft.id;
  const snapshot = store.getState();
  const missing = asFailure(
    await store.execute(cmd("saveCaptureDraft", { entityId: "fx-draft-missing", expectedRevision: 1, channel: "text", raw: "x" })),
  );
  assert.equal(missing.code, "ENTITY_NOT_FOUND");
  const stale = asFailure(
    await store.execute(cmd("saveCaptureDraft", { entityId: draftId, expectedRevision: 99, channel: "text", raw: "x" })),
  );
  assert.equal(stale.code, "REVISION_CONFLICT");
  const nullRevision = asFailure(
    await store.execute(cmd("saveCaptureDraft", { entityId: draftId, expectedRevision: null, channel: "text", raw: "x" })),
  );
  assert.equal(nullRevision.code, "INVALID_INPUT");
  assert.equal(store.getState(), snapshot);
  const discarded = asOk(await store.execute(cmd("discardCaptureDraft", { entityId: draftId, expectedRevision: 1 })));
  assert.equal(discarded.captureDraft.status, "discarded");
  const afterDiscard = asFailure(
    await store.execute(cmd("saveCaptureDraft", { entityId: draftId, expectedRevision: 2, channel: "text", raw: "x" })),
  );
  assert.equal(afterDiscard.code, "INVALID_TRANSITION");
  assert.equal(Object.keys(store.getState().captureDrafts).length, 1);
  assert.equal(store.getState().captureDrafts[draftId].status, "discarded");
});

test("linked saveIntent atomically completes the exact draft with preserved user edits and exact links", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: null,
        expectedRevision: null,
        channel: "text",
        raw: "周四上午腾两小时写复盘",
        parsedFields: { date: "2026-09-17" },
        ambiguityNote: "待确认时间段",
        constraints: [QUIET_CONSTRAINT],
      }),
    ),
  );
  const draftId = created.captureDraft.id;
  const completed = asOk(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "",
        channel: "manual",
        parsedFields: { startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: "写复盘" },
      }),
    ),
  );
  const intent = completed.intent;
  assert.equal(intent.status, "saved");
  assert.equal(intent.verbatim, "");
  assert.equal(intent.channel, "manual");
  assert.deepEqual(intent.provenance, { origin: "user", note: "manual field entry" });
  assert.deepEqual(intent.parsedFields, {
    date: "2026-09-17",
    startTime: "09:00",
    endTime: "11:00",
    timezone: "Asia/Shanghai",
    topic: "写复盘",
  });
  assert.equal(intent.ambiguityNote, "待确认时间段");
  assert.equal(intent.constraints.length, 1);
  assert.equal(typeof intent.constraints[0].id, "string");
  assert.ok(intent.constraints[0].id.length > 0);
  assert.equal(intent.constraints[0].kind, "quiet");
  assert.equal(intent.constraints[0].expression, "不被打扰");
  assert.equal(intent.constraints[0].confirmed, true);
  const draft = completed.captureDraft;
  assert.ok(draft, "linked path must return the completed capture draft");
  assert.equal(draft.id, draftId);
  assert.equal(draft.revision, 2);
  assert.equal(draft.status, "savedAsIntent");
  assert.equal(draft.intentId, intent.id);
  assert.equal(draft.raw, "");
  assert.deepEqual(draft.parsedFields, intent.parsedFields);
  assert.deepEqual(draft.constraints, [QUIET_CONSTRAINT]);
  const state = store.getState();
  assert.equal(state.intents[intent.id].status, "saved");
  assert.equal(state.captureDrafts[draftId].status, "savedAsIntent");
  assert.equal(state.captureDrafts[draftId].intentId, intent.id);
  const event = state.events[state.events.length - 1];
  const intentChange = event.entityRevisions.find((e) => e.entityId === intent.id);
  assert.deepEqual(intentChange, { entityId: intent.id, before: 0, after: 1 });
  const draftChange = event.entityRevisions.find((e) => e.entityId === draftId);
  assert.deepEqual(draftChange, { entityId: draftId, before: 1, after: 2 });
});

test("rejected linked saveIntent preserves the source draft exactly and creates no intent", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: null,
        expectedRevision: null,
        channel: "text",
        raw: "周五晚上打球",
        constraints: [QUIET_CONSTRAINT],
      }),
    ),
  );
  const draftId = created.captureDraft.id;
  const before = store.getState();
  const rejected = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "",
        channel: "manual",
        parsedFields: { date: "2026-09-18", startTime: "19:00", endTime: null, timezone: null, topic: null },
      }),
    ),
  );
  assert.equal(rejected.code, "INVALID_INPUT");
  assert.equal(store.getState(), before);
  assert.deepEqual(store.getState().captureDrafts[draftId], before.captureDrafts[draftId]);
});

test("linked persistence failure is atomic; retry publishes intent and draft completion together", async () => {
  let commitCalls = 0;
  const store = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    commit: async () => {
      commitCalls += 1;
      if (commitCalls === 2) {
        return { ok: false, code: "STORAGE_WRITE_FAILED", reason: "quota exceeded", retryable: true };
      }
      return { ok: true };
    },
  });
  const created = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: null,
        expectedRevision: null,
        channel: "text",
        raw: "合同评审",
        parsedFields: { date: "2026-09-15" },
        ambiguityNote: "nb",
      }),
    ),
  );
  const draftId = created.captureDraft.id;
  const before = store.getState();
  const failed = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "",
        channel: "manual",
        parsedFields: { startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: "评审" },
      }),
    ),
  );
  assert.equal(failed.code, "STORAGE_WRITE_FAILED");
  assert.equal(failed.reason, "quota exceeded");
  assert.equal(store.getState(), before);
  assert.equal(Object.keys(store.getState().intents).length, 1);
  assert.equal(store.getState().captureDrafts[draftId].status, "open");
  assert.equal(store.getState().captureDrafts[draftId].revision, 1);
  const retried = asOk(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "",
        channel: "manual",
        parsedFields: { startTime: "09:00", endTime: "11:00", timezone: "Asia/Shanghai", topic: "评审" },
        commandId: "closeout-cmd-retry-linked",
      }),
    ),
  );
  assert.equal(retried.intent.status, "saved");
  assert.ok(retried.captureDraft, "retry must return the completed capture draft");
  assert.equal(retried.captureDraft.status, "savedAsIntent");
  assert.equal(retried.captureDraft.intentId, retried.intent.id);
  const state = store.getState();
  assert.equal(Object.keys(state.intents).length, 2);
  assert.equal(state.captureDrafts[draftId].status, "savedAsIntent");
  assert.equal(state.captureDrafts[draftId].revision, 2);
  assert.equal(state.globalRevision, before.globalRevision + 1);
});

test("duplicate linked completion is rejected with the known intentId and never reopens or duplicates", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(cmd("saveCaptureDraft", { entityId: null, expectedRevision: null, channel: "text", raw: "only once" })),
  );
  const draftId = created.captureDraft.id;
  const first = asOk(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "",
        channel: "manual",
        parsedFields: MANUAL_FIELDS,
      }),
    ),
  );
  const intentsAfterFirst = Object.keys(store.getState().intents).length;
  const duplicate = asFailure(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 2,
        raw: "",
        channel: "manual",
        parsedFields: MANUAL_FIELDS,
      }),
    ),
  );
  assert.equal(duplicate.code, "INVALID_TRANSITION");
  assert.equal(duplicate.details?.intentId, first.intent.id);
  assert.equal(Object.keys(store.getState().intents).length, intentsAfterFirst);
  assert.equal(store.getState().captureDrafts[draftId].status, "savedAsIntent");
  assert.equal(store.getState().captureDrafts[draftId].intentId, first.intent.id);
  const discardCompleted = asFailure(
    await store.execute(cmd("discardCaptureDraft", { entityId: draftId, expectedRevision: 2 })),
  );
  assert.equal(discardCompleted.code, "INVALID_TRANSITION");
  assert.equal(store.getState().captureDrafts[draftId].status, "savedAsIntent");
});

test("custom newly saved intent binds plan A and B to that exact intent with both target revisions", async () => {
  const store = newStore();
  const saved = asOk(
    await store.execute(
      cmd("saveIntent", {
        entityId: null,
        expectedRevision: null,
        raw: "周六晚上七点到八点专心写周报",
        channel: "text",
        parsedFields: { date: "2026-09-12", startTime: "19:00", endTime: "20:00", timezone: "Asia/Shanghai", topic: "周报" },
      }),
    ),
  );
  assert.equal(saved.intent.status, "saved");
  const planA = asOk(await store.execute(cmd("selectPlan", { entityId: saved.intent.id, expectedRevision: 1, kind: "A" })));
  assert.equal(planA.plan.intentId, saved.intent.id);
  assert.deepEqual(planA.changeSet.targetRevisions, { [saved.intent.id]: 1, [FIXTURE_IDS.commitmentReport]: 1 });
  const planB = asOk(await store.execute(cmd("selectPlan", { entityId: saved.intent.id, expectedRevision: 1, kind: "B" })));
  assert.equal(planB.plan.intentId, saved.intent.id);
  assert.deepEqual(planB.changeSet.targetRevisions, { [saved.intent.id]: 1, [FIXTURE_IDS.commitmentAdmin]: 1 });
  const state = store.getState();
  assert.equal(state.plans[planA.plan.id].intentId, saved.intent.id);
  assert.equal(state.plans[planB.plan.id].intentId, saved.intent.id);
});

test("selectPlan requires a real saved intent and exact revision; rejects null, missing, stale, ambiguous, discarded with zero mutation", async () => {
  const store = newStore();
  const nullTarget = asFailure(await store.execute(cmd("selectPlan", { entityId: null, expectedRevision: null, kind: "A" })));
  assert.equal(nullTarget.code, "INVALID_INPUT");
  const missingTarget = asFailure(
    await store.execute(cmd("selectPlan", { entityId: "fx-intent-missing", expectedRevision: 1, kind: "A" })),
  );
  assert.equal(missingTarget.code, "ENTITY_NOT_FOUND");
  const staleTarget = asFailure(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 2, kind: "A" })),
  );
  assert.equal(staleTarget.code, "REVISION_CONFLICT");
  const nullRevision = asFailure(
    await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: null, kind: "A" })),
  );
  assert.equal(nullRevision.code, "INVALID_INPUT");
  const ambiguous = asOk(
    await store.execute(cmd("saveIntent", { entityId: null, expectedRevision: null, raw: "找时间处理合作方反馈", channel: "share" })),
  );
  assert.equal(ambiguous.intent.status, "ambiguous");
  const ambiguousTarget = asFailure(
    await store.execute(cmd("selectPlan", { entityId: ambiguous.intent.id, expectedRevision: 1, kind: "A" })),
  );
  assert.equal(ambiguousTarget.code, "INVALID_TRANSITION");
  const revisionAfterAmbiguous = store.getState().globalRevision;
  const discardedStore = newStore(discardedIntentState());
  const discardedTarget = asFailure(
    await discardedStore.execute(cmd("selectPlan", { entityId: "fx-intent-discarded-01", expectedRevision: 1, kind: "A" })),
  );
  assert.equal(discardedTarget.code, "INVALID_TRANSITION");
  const state = store.getState();
  assert.equal(state.globalRevision, revisionAfterAmbiguous);
  assert.equal(Object.keys(state.plans).length, 0);
  assert.equal(Object.keys(state.changeSets).length, 0);
  assert.equal(Object.keys(discardedStore.getState().plans).length, 0);
});

test("stale captured intent revision blocks approval via the change set stale check", async () => {
  const base = createInitialState("fixture");
  const initial: DomainState = {
    ...base,
    intents: {
      ...base.intents,
      [FIXTURE_IDS.intent]: { ...base.intents[FIXTURE_IDS.intent], revision: 2 },
    },
  };
  const store = newStore(initial);
  const selected = asOk(await store.execute(cmd("selectPlan", { entityId: FIXTURE_IDS.intent, expectedRevision: 2, kind: "A" })));
  assert.equal(selected.plan.intentId, FIXTURE_IDS.intent);
  assert.equal(selected.changeSet.targetRevisions[FIXTURE_IDS.intent], 2);
  const beforeAdoption = store.getState();
  const moved: DomainState = {
    ...beforeAdoption,
    globalRevision: beforeAdoption.globalRevision + 1,
    intents: {
      ...beforeAdoption.intents,
      [FIXTURE_IDS.intent]: { ...beforeAdoption.intents[FIXTURE_IDS.intent], revision: 3 },
    },
  };
  store.adoptExternalState(moved);
  const blocked = asFailure(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: selected.changeSet.id,
        grants: ["readMaterial", "createLocalDraft", "updateEstimate"],
      }),
    ),
  );
  assert.equal(blocked.code, "CHANGE_SET_STALE");
  assert.match(blocked.reason, new RegExp(FIXTURE_IDS.intent));
  assert.equal(Object.keys(store.getState().approvals).length, 0);
});

test("linked saveIntent with omitted note preserves stored null ambiguityNote instead of auto-noting", async () => {
  const store = newStore();
  const created = asOk(
    await store.execute(
      cmd("saveCaptureDraft", {
        entityId: null,
        expectedRevision: null,
        channel: "text",
        raw: "下周找个时间聊合作续约",
        parsedFields: { date: "2026-09-16" },
        ambiguityNote: null,
      }),
    ),
  );
  const draftId = created.captureDraft.id;
  assert.equal(created.captureDraft.ambiguityNote, null);
  const completed = asOk(
    await store.execute(
      cmd("saveIntent", {
        entityId: draftId,
        expectedRevision: 1,
        raw: "下周找个时间聊合作续约",
        channel: "text",
        parsedFields: { startTime: "14:00", endTime: "15:00" },
      }),
    ),
  );
  assert.equal(completed.intent.status, "ambiguous");
  assert.equal(completed.intent.ambiguityNote, null);
  assert.equal(completed.intent.verbatim, "下周找个时间聊合作续约");
  assert.deepEqual(completed.intent.parsedFields, {
    date: "2026-09-16",
    startTime: "14:00",
    endTime: "15:00",
    timezone: null,
    topic: null,
  });
  assert.ok(completed.captureDraft, "linked path must return the completed capture draft");
  assert.equal(completed.captureDraft.status, "savedAsIntent");
  assert.equal(completed.captureDraft.intentId, completed.intent.id);
  assert.equal(completed.captureDraft.ambiguityNote, null);
});
