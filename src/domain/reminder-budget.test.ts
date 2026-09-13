/// <reference types="node" />
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
const RULESET = FIXTURE_IDS.ruleset;
const BUDGET = FIXTURE_IDS.attentionBudget;
let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "budget-uuid-" + uuidSeq;
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
    commandId: rest.commandId ?? "budget-cmd-" + commandSeq,
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

test("dailyReminderMax accepts the 0 and 10 bounds with atomic ruleset and budget revisions", async () => {
  for (const cap of [0, 10] as const) {
    const store = newStore();
    const before = store.getState();
    const data = asOk(
      await store.execute(
        cmd("updateRules", { entityId: RULESET, expectedRevision: 1, dailyReminderMax: cap, summary: "设置每日提醒上限 " + cap }),
      ),
    );
    assert.equal(data.ruleset.revision, 2);
    const last = data.ruleset.history[data.ruleset.history.length - 1];
    assert.equal(last.revision, 2);
    assert.equal(last.actor, "user");
    assert.deepEqual(last.changes, ["dailyReminderMax"]);
    assert.equal(last.description, "设置每日提醒上限 " + cap);
    const budget = store.getState().attention.budget;
    assert.equal(budget.dailyMax, cap);
    assert.equal(budget.revision, 2);
    assert.equal(budget.used, before.attention.budget.used);
    assert.equal(budget.budgetDay, before.attention.budget.budgetDay);
    assert.equal(budget.timezone, before.attention.budget.timezone);
    assert.deepEqual(budget.deliveredIds, before.attention.budget.deliveredIds);
    assert.deepEqual(budget.queue, before.attention.budget.queue);
    assert.equal(data.ruleset.dailyCapacityMinutes, before.ruleset.dailyCapacityMinutes);
    assert.equal(data.ruleset.timezone, before.ruleset.timezone);
    assert.deepEqual(data.ruleset.grants, before.ruleset.grants);
    const event = store.getState().events[store.getState().events.length - 1];
    assert.deepEqual(
      event.entityRevisions.find((e) => e.entityId === RULESET),
      { entityId: RULESET, before: 1, after: 2 },
    );
    assert.deepEqual(
      event.entityRevisions.find((e) => e.entityId === BUDGET),
      { entityId: BUDGET, before: 1, after: 2 },
    );
    assert.match(event.summary, new RegExp("dailyReminderMax set to " + cap));
  }
});

test("dailyReminderMax rejects -1, 11, fractions, NaN, and Infinity with INVALID_INPUT and zero state effect", async () => {
  for (const bad of [-1, 11, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const store = newStore();
    const before = store.getState();
    const failure = asFailure(
      await store.execute(
        cmd("updateRules", { entityId: RULESET, expectedRevision: 1, dailyReminderMax: bad, summary: "非法上限" }),
      ),
    );
    assert.equal(failure.code, "INVALID_INPUT");
    assert.equal(store.getState(), before);
    assert.equal(store.getState().attention.budget.dailyMax, 2);
    assert.equal(store.getState().attention.budget.revision, 1);
  }
});

test("dailyReminderMax requires the actual current ruleset entityId and revision envelope", async () => {
  const store = newStore();
  const before = store.getState();
  const nullEnvelope = asFailure(
    await store.execute(cmd("updateRules", { entityId: null, expectedRevision: null, dailyReminderMax: 3, summary: "空信封" })),
  );
  assert.equal(nullEnvelope.code, "INVALID_INPUT");
  const nullRevision = asFailure(
    await store.execute(cmd("updateRules", { entityId: RULESET, expectedRevision: null, dailyReminderMax: 3, summary: "空修订" })),
  );
  assert.equal(nullRevision.code, "INVALID_INPUT");
  const wrongId = asFailure(
    await store.execute(cmd("updateRules", { entityId: "fx-ruleset-other", expectedRevision: 1, dailyReminderMax: 3, summary: "错实体" })),
  );
  assert.equal(wrongId.code, "ENTITY_NOT_FOUND");
  const stale = asFailure(
    await store.execute(cmd("updateRules", { entityId: RULESET, expectedRevision: 99, dailyReminderMax: 3, summary: "过期修订" })),
  );
  assert.equal(stale.code, "REVISION_CONFLICT");
  assert.equal(store.getState(), before);
  assert.equal(store.getState().attention.budget.dailyMax, 2);
  assert.equal(store.getState().attention.budget.revision, 1);
  assert.equal(store.getState().ruleset.history.length, 1);
});

test("dailyReminderMax changes are user-only", async () => {
  for (const actor of ["automation", "model"] as const) {
    const store = newStore();
    const before = store.getState();
    const failure = asFailure(
      await store.execute(
        cmd("updateRules", { entityId: RULESET, expectedRevision: 1, dailyReminderMax: 4, summary: "非用户改上限", actor }),
      ),
    );
    assert.equal(failure.code, "USER_ONLY");
    assert.equal(store.getState(), before);
  }
});

test("lowering dailyReminderMax below used keeps delivered history, queue, items, and remaining clamps to zero", async () => {
  const base = createInitialState("fixture");
  const queuedEntry = {
    id: "fx-q-1",
    deliveryId: "d-q-1",
    mergeKey: "mk-1",
    title: "排队项",
    reason: "daily attention budget exhausted",
    queuedAt: NOW,
    dueAt: null,
  };
  const seeded: DomainState = {
    ...base,
    attention: {
      budget: {
        ...base.attention.budget,
        used: 3,
        dailyMax: 2,
        deliveredIds: ["d-1", "d-2", "d-3"],
        queue: [queuedEntry],
      },
      items: {
        "fx-attn-d1": {
          id: "fx-attn-d1",
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
          dataMode: "fixture",
          provenance: { origin: "system" },
          deliveryId: "d-1",
          mergeKey: "",
          title: "已送达",
          body: "",
          source: "internal",
          urgency: "normal",
          riskBasis: null,
          status: "delivered",
          deliveredAt: NOW,
          budgetCharged: true,
        },
      },
    },
  };
  const store = newStore(seeded);
  const before = store.getState();
  const data = asOk(
    await store.execute(
      cmd("updateRules", { entityId: RULESET, expectedRevision: 1, dailyReminderMax: 0, summary: "降到已用之下" }),
    ),
  );
  assert.equal(data.ruleset.revision, 2);
  const budget = store.getState().attention.budget;
  assert.equal(budget.dailyMax, 0);
  assert.equal(budget.revision, 2);
  assert.equal(budget.used, 3, "used is never erased by a lower cap");
  assert.deepEqual(budget.deliveredIds, ["d-1", "d-2", "d-3"]);
  assert.deepEqual(budget.queue, [queuedEntry]);
  assert.equal(budget.budgetDay, before.attention.budget.budgetDay);
  assert.equal(budget.timezone, before.attention.budget.timezone);
  assert.equal(store.getState().attention.items["fx-attn-d1"].budgetCharged, true);
  assert.equal(store.getState().attention.items["fx-attn-d1"].deliveredAt, NOW);
  assert.equal(store.getState().attention.items["fx-attn-d1"].status, "delivered");
  assert.equal(Math.max(0, budget.dailyMax - budget.used), 0, "remaining = max(0, dailyMax - used)");
  const blocked = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-new-1", title: "新的提醒", source: "internal", urgency: "normal" }),
    ),
  );
  assert.equal(blocked.outcome.delivered, false);
  assert.equal(blocked.outcome.queued, true);
  assert.equal(blocked.outcome.budgetCharged, false);
  assert.equal(store.getState().attention.budget.used, 3);
});

test("failed commit leaves both budget and ruleset history unchanged; retry publishes atomically", async () => {
  let allowCommit = false;
  const store = createDomainStore({
    dataMode: "fixture",
    now: () => NOW,
    uuid: testUuid,
    commit: async () => (allowCommit ? { ok: true } : { ok: false, code: "STORAGE_WRITE_FAILED" as const, reason: "disk full", retryable: true }),
  });
  const before = store.getState();
  const command = cmd("updateRules", {
    entityId: RULESET,
    expectedRevision: 1,
    dailyReminderMax: 3,
    commandId: "budget-cmd-commit",
    summary: "提交失败也不生效",
  });
  const failed = asFailure(await store.execute(command));
  assert.equal(failed.code, "STORAGE_WRITE_FAILED");
  assert.equal(failed.reason, "disk full");
  assert.equal(store.getState(), before);
  assert.equal(store.getState().attention.budget.dailyMax, 2);
  assert.equal(store.getState().attention.budget.revision, 1);
  assert.equal(store.getState().ruleset.history.length, 1);
  allowCommit = true;
  const retried = asOk(await store.execute(command));
  assert.equal(retried.ruleset.revision, 2);
  assert.equal(store.getState().attention.budget.dailyMax, 3);
  assert.equal(store.getState().attention.budget.revision, 2);
  assert.equal(store.getState().ruleset.history.length, 2);
});

test("exact command replay of a dailyReminderMax change publishes no extra history or budget revision", async () => {
  const store = newStore();
  const command = cmd("updateRules", {
    entityId: RULESET,
    expectedRevision: 1,
    dailyReminderMax: 4,
    commandId: "budget-cmd-replay",
    summary: "幂等重放",
  });
  const first = asOk(await store.execute(command));
  const replay = asOk(await store.execute(command));
  assert.deepEqual(replay, first);
  assert.equal(store.getState().ruleset.revision, 2);
  assert.equal(store.getState().ruleset.history.length, 2);
  assert.equal(store.getState().attention.budget.revision, 2);
  assert.equal(store.getState().attention.budget.dailyMax, 4);
});

test("attention delivery respects the lowered max and raising it never sends automatically", async () => {
  const store = newStore();
  const first = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-a", title: "第一条", source: "internal", urgency: "normal" }),
    ),
  );
  assert.equal(first.outcome.delivered, true);
  assert.equal(first.outcome.budgetUsed, 2);
  const lowered = asOk(
    await store.execute(
      cmd("updateRules", { entityId: RULESET, expectedRevision: 1, dailyReminderMax: 1, summary: "降到 1" }),
    ),
  );
  assert.equal(lowered.ruleset.revision, 2);
  const second = asOk(
    await store.execute(
      cmd("deliverAttention", { entityId: null, expectedRevision: null, deliveryId: "d-b", title: "第二条", source: "internal", urgency: "normal" }),
    ),
  );
  assert.equal(second.outcome.delivered, false);
  assert.equal(second.outcome.queued, true);
  assert.equal(second.outcome.budgetCharged, false);
  assert.equal(second.outcome.budgetMax, 1);
  assert.equal(store.getState().attention.budget.used, 2);
  const beforeRaise = store.getState();
  const raised = asOk(
    await store.execute(
      cmd("updateRules", { entityId: RULESET, expectedRevision: 2, dailyReminderMax: 5, summary: "升到 5，不补发" }),
    ),
  );
  assert.equal(raised.ruleset.revision, 3);
  const after = store.getState();
  assert.equal(after.attention.budget.dailyMax, 5);
  assert.equal(after.attention.budget.used, 2, "raising the cap never sends or charges anything automatically");
  assert.deepEqual(after.attention.budget.queue, beforeRaise.attention.budget.queue);
  assert.deepEqual(after.attention.budget.deliveredIds, beforeRaise.attention.budget.deliveredIds);
  assert.deepEqual(after.attention.budget.used, beforeRaise.attention.budget.used);
  assert.deepEqual(Object.keys(after.attention.items), Object.keys(beforeRaise.attention.items));
});

test("updateRules that omits dailyReminderMax keeps legacy null-envelope compatibility and leaves the budget untouched", async () => {
  const store = newStore();
  const before = store.getState();
  const data = asOk(
    await store.execute(
      cmd("updateRules", { entityId: null, expectedRevision: null, dailyCapacityMinutes: 150, summary: "只改容量" }),
    ),
  );
  assert.equal(data.ruleset.revision, 2);
  assert.equal(data.ruleset.dailyCapacityMinutes, 150);
  const budget = store.getState().attention.budget;
  assert.equal(budget.revision, 1);
  assert.equal(budget.dailyMax, 2);
  assert.equal(budget.updatedAt, before.attention.budget.updatedAt);
  const event = store.getState().events[store.getState().events.length - 1];
  assert.equal(event.entityRevisions.find((e) => e.entityId === BUDGET), undefined);
});
