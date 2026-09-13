import assert from "node:assert/strict";
import test from "node:test";
import { createDomainStore } from "./store.ts";
import type { SaveLocalCommitmentCommand } from "./types.ts";
import { scheduleSlice, scheduledEffortOnDate, scheduleValidationError } from "./calendarTime.ts";
import { selectCapacitySummary } from "./selectors.ts";
import { selectCommitmentsOnDate, selectMonthSurface, selectTimelineSurface, selectWeekSurface, weekDatesContaining } from "../screens/s01-now/timeSurfaces.ts";
import { navigateCalendarPeriod } from "../screens/s02-ledger/calendarNavigation.ts";
import { createPersistedDomainStore } from "../data/persistedStore.ts";
import { InMemoryStorage } from "../data/storage.ts";

function command(patch: Partial<SaveLocalCommitmentCommand> = {}): SaveLocalCommitmentCommand {
  return { type: "saveLocalCommitment", commandId: "create-local", entityId: null, expectedRevision: null, actor: "user", issuedAt: "2026-09-13T10:00:00Z", scope: "写作", effortEstimateMinutes: 120, mobility: "flexible", status: "active", schedule: { date: "2026-12-31", endDate: "2027-01-01", startMinute: 1380, endMinute: 60, timezone: "Asia/Shanghai" }, ...patch };
}

test("local responsibility create, move, unschedule, complete, cancel and reopen retain one identity and audit", async () => {
  const store = createDomainStore({ dataMode: "live" });
  const originalCount = Object.keys(store.getState().commitments).length;
  const created = await store.execute(command());
  assert.ok(created.ok);
  let item = created.data.commitment;
  for (const [index, patch] of [{ schedule: null }, { status: "done" as const }, { status: "cancelled" as const }, { status: "active" as const, schedule: { date: "2027-01-02", startMinute: 540, endMinute: 600, timezone: "Asia/Shanghai" } }].entries()) {
    const result = await store.execute(command({ entityId: item.id, expectedRevision: item.revision, commandId: "edit-" + index, ...patch }));
    assert.ok(result.ok);
    assert.equal(result.data.commitment.id, item.id);
    item = result.data.commitment;
  }
  assert.equal(Object.keys(store.getState().commitments).length, originalCount + 1);
  assert.equal(store.getState().events.length, 5);
  assert.equal(selectCommitmentsOnDate(store.getState(), "2027-01-02").length, 1);
});

test("cross-year day, week, month and capacity share slices and conserve effort", async () => {
  const store = createDomainStore({ dataMode: "live" });
  assert.ok((await store.execute(command())).ok);
  const state = store.getState();
  assert.equal(selectCommitmentsOnDate(state, "2026-12-31")[0].schedule?.endMinute, 1440);
  assert.equal(selectCommitmentsOnDate(state, "2027-01-01")[0].schedule?.startMinute, 0);
  assert.equal(selectCapacitySummary(state, "2026-12-31").committedKnownMinutes, 60);
  assert.equal(selectCapacitySummary(state, "2027-01-01").committedKnownMinutes, 60);
  assert.equal(selectWeekSurface(state, weekDatesContaining("2027-01-01")).days.reduce((sum, day) => sum + day.knownEffortMinutes, 0), 120);
  assert.equal(selectMonthSurface(state, "2027-01-01").weeks.flat().find(day => day.date === "2027-01-01")?.commitmentCount, 1);
  assert.equal(selectTimelineSurface(state, "2027-01-01", { axisStartMinute: 0, axisEndMinute: 1440, trackHeightPx: 1440 }).blocks[0].heightPx, 60);
});

test("DST gaps and repeated wall times, reversed intervals, invalid dates, actors and stale edits fail without mutation", async () => {
  const schedule = command().schedule!;
  for (const invalid of [{ ...schedule, date: "2026-02-30" }, { ...schedule, timezone: "Invalid/Zone" }, { ...schedule, date: "2026-03-08", endDate: "2026-03-08", startMinute: 135, endMinute: 195, timezone: "America/New_York" }, { ...schedule, date: "2026-11-01", endDate: "2026-11-01", startMinute: 75, endMinute: 135, timezone: "America/New_York" }]) assert.ok(scheduleValidationError(invalid));
  const store = createDomainStore({ dataMode: "live" });
  const before = store.getState();
  assert.equal((await store.execute(command({ actor: "model" }))).ok, false);
  assert.deepEqual(store.getState(), before);
  const result = await store.execute(command());
  assert.ok(result.ok);
  assert.equal((await store.execute(command({ entityId: result.data.commitment.id, expectedRevision: 0, commandId: "stale" }))).ok, false);
});

test("display timezone changes slices without moving absolute time and midnight end is exclusive", () => {
  const schedule = { date: "2026-09-13", startMinute: 30, endMinute: 90, timezone: "Asia/Shanghai" };
  assert.deepEqual(scheduleSlice(schedule, "2026-09-12", "UTC"), { startMinute: 990, endMinute: 1050 });
  const midnight = { ...schedule, endDate: "2026-09-14", startMinute: 1380, endMinute: 0 };
  assert.equal(scheduleSlice(midnight, "2026-09-14", "Asia/Shanghai"), null);
  const dst = { date: "2026-03-07", endDate: "2026-03-08", startMinute: 1380, endMinute: 180, timezone: "America/New_York" };
  assert.equal(scheduledEffortOnDate(dst, 180, "2026-03-07", dst.timezone), 60);
  assert.equal(scheduledEffortOnDate(dst, 180, "2026-03-08", dst.timezone), 120);
});

test("all-day spans stay local dates and leap/month navigation clamps without skipping months", () => {
  const allDay = { date: "2028-02-28", endDate: "2028-03-01", startMinute: null, endMinute: null, timezone: "Asia/Shanghai", allDay: true };
  assert.deepEqual(scheduleSlice(allDay, "2028-02-29", "America/New_York"), { startMinute: 0, endMinute: 1440 });
  assert.equal(scheduledEffortOnDate(allDay, 180, "2028-02-29", "UTC"), 60);
  assert.equal(navigateCalendarPeriod("2028-01-31", "month", 1), "2028-02-29");
  assert.equal(navigateCalendarPeriod("2026-12-31", "today", 1), "2027-01-01");
  assert.equal(navigateCalendarPeriod("2026-12-31", "week", 1), "2027-01-07");
});

test("persisted creation replays once after reopen", async () => {
  const storage = new InMemoryStorage();
  const first = await createPersistedDomainStore({ dataMode: "live", storage });
  assert.equal(first.status, "ready");
  if (first.status !== "ready") return;
  const originalCount = Object.keys(first.store.getState().commitments).length;
  assert.ok((await first.store.execute(command())).ok);
  const reopened = await createPersistedDomainStore({ dataMode: "live", storage });
  if (reopened.status !== "ready") throw new Error(reopened.status);
  assert.ok((await reopened.store.execute(command())).ok);
  assert.equal(Object.keys(reopened.store.getState().commitments).length, originalCount + 1);
});
