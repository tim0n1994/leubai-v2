import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptureDraftCommand,
  buildIntentCommand,
  findMatchingIntent,
  sameDraftState,
  validateInterval,
  verifyDraftReadback,
  verifyIntentReadback,
  viewFromDraftRecord,
  viewFromIntent,
} from "./s14-capture-adapter.ts";
import type { DomainState, EntityId } from "../../domain/types.ts";

const FIELD_ONLY_FIELDS = {
  dateText: "9 月 14 日",
  start: "09:00",
  end: "10:00",
  constraint: "",
};

function draftState(overrides?: {
  verbatim?: string;
  fields?: Partial<typeof FIELD_ONLY_FIELDS>;
}) {
  return {
    verbatim: overrides?.verbatim ?? "",
    fields: { ...FIELD_ONLY_FIELDS, ...overrides?.fields },
  };
}

const OPEN_INTERVAL = { date: "2026-09-14", start: "09:00", end: "10:00" };

const MANUAL_PARSED_FIELDS = {
  date: "2026-09-14",
  startTime: "09:00",
  endTime: "10:00",
  timezone: "Asia/Shanghai",
  topic: null,
};

function entityBase(id: EntityId, revision: number) {
  return {
    id,
    revision,
    createdAt: "2026-09-12T10:00:00+08:00",
    updatedAt: "2026-09-12T10:00:00+08:00",
    dataMode: "live" as const,
    provenance: { origin: "user" as const },
  };
}

function openDraftRecord(overrides?: Record<string, unknown>) {
  return {
    ...entityBase("draft-1", 1),
    channel: "shortcut" as const,
    raw: "  明晚七点到八点留给自己  ",
    parsedFields: {
      date: "2026-09-13",
      startTime: "19:00",
      endTime: "20:00",
      timezone: "Asia/Shanghai",
      topic: null,
    },
    constraints: [{ kind: "manual", expression: "客户会议", confirmed: true }],
    ambiguityNote: null,
    status: "open" as const,
    ...overrides,
  };
}

function savedIntentRecord(overrides?: Record<string, unknown>) {
  return {
    ...entityBase("intent-1", 1),
    verbatim: "  明晚七点到八点留给自己  ",
    channel: "shortcut" as const,
    parsedFields: {
      date: "2026-09-13",
      startTime: "19:00",
      endTime: "20:00",
      timezone: "Asia/Shanghai",
      topic: null,
    },
    fieldStatus: { date: "confirmed" as const },
    constraints: [],
    status: "saved" as const,
    ambiguityNote: null,
    sourceRefs: [],
    ...overrides,
  };
}

function stateWith(records: {
  captureDrafts?: unknown[];
  intents?: unknown[];
}): DomainState {
  return {
    captureDrafts: Object.fromEntries(
      (records.captureDrafts ?? []).map((record: any) => [record.id, record]),
    ),
    intents: Object.fromEntries(
      (records.intents ?? []).map((record: any) => [record.id, record]),
    ),
  } as unknown as DomainState;
}

test("field-only empty verbatim saves as manual channel with raw exactly empty and no fabricated sentence", () => {
  const command = buildIntentCommand({
    submitted: draftState(),
    interval: OPEN_INTERVAL,
    target: null,
  });
  assert.equal(command.channel, "manual");
  assert.equal(command.raw, "");
  assert.equal(command.entityId, null);
  assert.equal(command.expectedRevision, null);
  assert.deepEqual(command.parsedFields, {
    date: "2026-09-14",
    startTime: "09:00",
    endTime: "10:00",
    timezone: "Asia/Shanghai",
    topic: null,
  });
});

test("verbatim intent preserves raw exactly including surrounding whitespace", () => {
  const submitted = draftState({
    verbatim: "  明晚七点到八点留给自己，客户会议别动。  ",
  });
  const command = buildIntentCommand({
    submitted,
    interval: { date: "2026-09-13", start: "19:00", end: "20:00" },
    target: null,
  });
  assert.equal(command.channel, "shortcut");
  assert.equal(command.raw, "  明晚七点到八点留给自己，客户会议别动。  ");
});

test("linked intent command carries the open capture target id and revision", () => {
  const command = buildIntentCommand({
    submitted: draftState(),
    interval: OPEN_INTERVAL,
    target: { id: "draft-1", revision: 3, status: "open" },
  });
  assert.equal(command.entityId, "draft-1");
  assert.equal(command.expectedRevision, 3);
});

test("completed capture target is not silently recaptured; intent goes out independent", () => {
  const command = buildIntentCommand({
    submitted: draftState(),
    interval: OPEN_INTERVAL,
    target: { id: "draft-1", revision: 4, status: "savedAsIntent" },
  });
  assert.equal(command.entityId, null);
  assert.equal(command.expectedRevision, null);
});

test("intent constraints are explicit: manual kind for edited field, empty array when cleared", () => {
  const manual = buildIntentCommand({
    submitted: draftState({ fields: { constraint: "周三复查" } }),
    interval: OPEN_INTERVAL,
    target: null,
  });
  assert.deepEqual(manual.constraints, [
    { kind: "manual", expression: "周三复查", confirmed: true },
  ]);
  const cleared = buildIntentCommand({
    submitted: draftState(),
    interval: OPEN_INTERVAL,
    target: null,
  });
  assert.deepEqual(cleared.constraints, []);
});

test("draft save command updates the same open draft id and revision instead of creating a new draft", () => {
  const submitted = draftState({
    verbatim: "  明晚七点到八点留给自己，客户会议别动。  ",
    fields: { dateText: "9 月 13 日", start: "19:00", end: "20:00", constraint: "客户会议" },
  });
  const created = buildCaptureDraftCommand({ submitted, target: null });
  assert.equal(created.entityId, null);
  assert.equal(created.expectedRevision, null);
  assert.deepEqual(created.constraints, [
    { kind: "raw", expression: "客户会议", confirmed: true },
  ]);
  const updated = buildCaptureDraftCommand({
    submitted,
    target: { id: "draft-9", revision: 2, status: "open" },
  });
  assert.equal(updated.entityId, "draft-9");
  assert.equal(updated.expectedRevision, 2);
  assert.notEqual(updated.commandId, created.commandId);
});

test("draft command hash includes target revision so a moved draft never reuses a committed payload", () => {
  const submitted = draftState();
  const atRevision2 = buildCaptureDraftCommand({
    submitted,
    target: { id: "draft-9", revision: 2, status: "open" },
  });
  const atRevision3 = buildCaptureDraftCommand({
    submitted,
    target: { id: "draft-9", revision: 3, status: "open" },
  });
  assert.notEqual(atRevision2.commandId, atRevision3.commandId);
  const rebuilt = buildCaptureDraftCommand({
    submitted,
    target: { id: "draft-9", revision: 2, status: "open" },
  });
  assert.equal(rebuilt.commandId, atRevision2.commandId);
});

test("intent command hash includes target revision for the same reason", () => {
  const submitted = draftState();
  const atRevision2 = buildIntentCommand({
    submitted,
    interval: OPEN_INTERVAL,
    target: { id: "draft-9", revision: 2, status: "open" },
  });
  const atRevision3 = buildIntentCommand({
    submitted,
    interval: OPEN_INTERVAL,
    target: { id: "draft-9", revision: 3, status: "open" },
  });
  assert.notEqual(atRevision2.commandId, atRevision3.commandId);
});

test("restored open draft returns manual constraint fields from stored constraints, not a raw re-parse", () => {
  const view = viewFromDraftRecord(openDraftRecord());
  assert.equal(view.kind, "open");
  assert(view.kind === "open");
  assert.deepEqual(view.target, { id: "draft-1", revision: 1, status: "open" });
  assert.equal(view.draft.verbatim, "  明晚七点到八点留给自己  ");
  assert.equal(view.draft.fields.constraint, "客户会议");
  assert.equal(view.draft.fields.start, "19:00");
});

test("restored savedAsIntent draft exposes the completed state and exact intent link", () => {
  const view = viewFromDraftRecord(
    openDraftRecord({ status: "savedAsIntent", revision: 2, intentId: "intent-7" }),
  );
  assert.equal(view.kind, "completed");
  assert(view.kind === "completed");
  assert.deepEqual(view.target, { id: "draft-1", revision: 2, status: "savedAsIntent" });
  assert.equal(view.intentId, "intent-7");
  const legacy = viewFromDraftRecord(
    openDraftRecord({ status: "savedAsIntent", intentId: null }),
  );
  assert(legacy.kind === "completed");
  assert.equal(legacy.intentId, null);
});

test("restored intent snapshot keeps verbatim and joined constraint expressions", () => {
  const view = viewFromIntent(
    savedIntentRecord({
      constraints: [
        { id: "c1", kind: "manual", expression: "客户会议", confirmed: true },
        { id: "c2", kind: "manual", expression: "别改", confirmed: true },
      ],
    }),
  );
  assert.equal(view.kind, "intentSnapshot");
  assert(view.kind === "intentSnapshot");
  assert.equal(view.draft.fields.constraint, "客户会议、别改");
});

test("draft readback verifies existence, raw, parsed fields, and open status", () => {
  const submitted = draftState({
    verbatim: "  明晚七点到八点留给自己  ",
    fields: { dateText: "9 月 13 日", start: "19:00", end: "20:00", constraint: "" },
  });
  const command = buildCaptureDraftCommand({ submitted, target: null });
  const good = verifyDraftReadback(
    stateWith({ captureDrafts: [openDraftRecord({ constraints: [] })] }),
    command,
    { captureDraft: openDraftRecord({ constraints: [] }) as any },
  );
  assert.equal(good.ok, true);
  const rawMismatch = verifyDraftReadback(
    stateWith({ captureDrafts: [openDraftRecord({ raw: "other" })] }),
    command,
    { captureDraft: openDraftRecord({ raw: "other" }) as any },
  );
  assert.equal(rawMismatch.ok, false);
  const closedDraft = verifyDraftReadback(
    stateWith({
      captureDrafts: [openDraftRecord({ status: "savedAsIntent" })],
    }),
    command,
    { captureDraft: openDraftRecord({ status: "savedAsIntent" }) as any },
  );
  assert.equal(closedDraft.ok, false);
});

test("linked intent readback requires the exact capture draft completed with the exact intent id", () => {
  const submitted = draftState();
  const command = buildIntentCommand({
    submitted,
    interval: OPEN_INTERVAL,
    target: { id: "draft-1", revision: 1, status: "open" },
  });
  const intent = savedIntentRecord({
    verbatim: "",
    channel: "manual",
    parsedFields: MANUAL_PARSED_FIELDS,
  });
  const completedDraft = openDraftRecord({
    status: "savedAsIntent",
    channel: "manual",
    raw: "",
    parsedFields: MANUAL_PARSED_FIELDS,
    constraints: [],
    intentId: "intent-1",
  });
  const good = verifyIntentReadback(
    stateWith({ captureDrafts: [completedDraft], intents: [intent] }),
    command,
    { intent: intent as any, captureDraft: completedDraft as any },
  );
  assert.equal(good.ok, true);
  const missingDraft = verifyIntentReadback(
    stateWith({ intents: [intent] }),
    command,
    { intent: intent as any },
  );
  assert.equal(missingDraft.ok, false);
  const wrongLink = verifyIntentReadback(
    stateWith({
      captureDrafts: [openDraftRecord({ status: "savedAsIntent", intentId: "intent-OTHER" })],
      intents: [intent],
    }),
    command,
    {
      intent: intent as any,
      captureDraft: openDraftRecord({
        status: "savedAsIntent",
        intentId: "intent-OTHER",
      }) as any,
    },
  );
  assert.equal(wrongLink.ok, false);
});

test("independent intent readback verifies channel, verbatim, and parsed fields", () => {
  const submitted = draftState();
  const command = buildIntentCommand({
    submitted,
    interval: OPEN_INTERVAL,
    target: null,
  });
  const good = verifyIntentReadback(
    stateWith({
      intents: [
        savedIntentRecord({
          verbatim: "",
          channel: "manual",
          parsedFields: MANUAL_PARSED_FIELDS,
          constraints: [],
        }),
      ],
    }),
    command,
    {
      intent: savedIntentRecord({
        verbatim: "",
        channel: "manual",
        parsedFields: MANUAL_PARSED_FIELDS,
        constraints: [],
      }) as any,
    },
  );
  assert.equal(good.ok, true);
  const wrongVerbatim = verifyIntentReadback(
    stateWith({ intents: [savedIntentRecord({ verbatim: "different" })] }),
    buildIntentCommand({
      submitted: draftState({ verbatim: "different" }),
      interval: OPEN_INTERVAL,
      target: null,
    }),
    { intent: savedIntentRecord({ verbatim: "" }) as any },
  );
  assert.equal(wrongVerbatim.ok, false);
});

test("heuristic matching still links legacy whitespace-preserved verbatim intents", () => {
  const state = stateWith({
    intents: [savedIntentRecord()],
  });
  const match = findMatchingIntent(state, {
    verbatim: "明晚七点到八点留给自己",
    fields: { dateText: "9 月 13 日", start: "19:00", end: "20:00", constraint: "" },
  });
  assert.equal(match?.id, "intent-1");
});

test("validateInterval keeps malformed input rejected while complete fields pass", () => {
  const bad = validateInterval({
    dateText: "13 日",
    start: "25:00",
    end: "26:00",
    constraint: "",
  });
  assert.equal(bad.ok, false);
  const good = validateInterval({
    dateText: "9 月 14 日",
    start: "09:00",
    end: "10:00",
    constraint: "",
  });
  assert.deepEqual(good, { ok: true, interval: OPEN_INTERVAL });
});

test("sameDraftState compares verbatim and every editable field", () => {
  assert.ok(sameDraftState(draftState(), draftState()));
  assert.ok(!sameDraftState(draftState(), draftState({ fields: { start: "09:30" } })));
});
