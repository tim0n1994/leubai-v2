import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_DAY,
  FIXTURE_IDS,
  createDomainStore,
  createInitialState,
} from "../../domain/index.ts";
import type {
  CommandBase,
  CommandDataOf,
  CommandResult,
  CommandType,
  Commitment,
  DomainCommand,
  DomainState,
} from "../../domain/index.ts";
import {
  DAY_TRACK_GEOMETRY,
  formatCapacityWarning,
  formatCoverageText,
  formatIsoDateCn,
  formatMinuteOfDay,
  formatModificationHint,
  formatSourceSyncText,
  minuteToTrackPx,
  selectCapacityView,
  selectCommitmentsOnDate,
  selectDutyCards,
  selectHeroView,
  selectMonthSurface,
  selectModificationView,
  selectProtectedOverlaps,
  selectSourceRows,
  selectSurfaceDate,
  selectTimelineSurface,
  selectWeekSurface,
  totalOverlapMinutes,
  trackHourLabels,
  weekDatesContaining,
  monthGridDates,
} from "./timeSurfaces.ts";

const NOW = "2026-09-12T10:00:00+08:00";
const SURFACE_DATE = "2026-09-12";

let commandSeq = 0;
let uuidSeq = 0;

function testUuid(): string {
  uuidSeq += 1;
  return "uuid-" + uuidSeq;
}

function newStore() {
  return createDomainStore({ dataMode: "fixture", now: () => NOW, uuid: testUuid });
}

function cmd<T extends CommandType>(
  type: T,
  rest: Omit<Extract<DomainCommand, { type: T }>, "type" | "commandId" | "actor" | "issuedAt"> &
    Partial<Pick<CommandBase, "actor" | "commandId">>,
): Extract<DomainCommand, { type: T }> {
  commandSeq += 1;
  return {
    type,
    commandId: "cmd-" + commandSeq,
    actor: "user",
    issuedAt: NOW,
    ...rest,
  } as Extract<DomainCommand, { type: T }>;
}

function asOk<T extends DomainCommand>(result: CommandResult<T>): CommandDataOf<T> {
  if (!result.ok) throw new Error("expected ok, got " + result.code + ": " + result.reason);
  return result.data;
}

async function runApprovedPlanA(store: ReturnType<typeof newStore>) {
  const intent = store.getState().intents[FIXTURE_IDS.intent];
  const selected = asOk(
    await store.execute(
      cmd("selectPlan", { entityId: intent.id, expectedRevision: intent.revision, kind: "A" }),
    ),
  );
  const grant = asOk(
    await store.execute(
      cmd("grantApproval", {
        entityId: null,
        expectedRevision: null,
        changeSetId: selected.changeSet.id,
        grants: ["readMaterial", "createLocalDraft", "updateEstimate"],
      }),
    ),
  );
  const run = asOk(
    await store.execute(
      cmd("startOperation", {
        entityId: null,
        expectedRevision: null,
        approvalId: grant.approval.id,
      }),
    ),
  );
  void run;
}

function extraCommitment(
  id: string,
  date: string,
  startMinute: number,
  endMinute: number,
  minutes: number,
  mobility: Commitment["mobility"],
): Commitment {
  return {
    id,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    dataMode: "fixture",
    provenance: { origin: "user" },
    requestId: null,
    acceptedBy: "user",
    scope: "测试责任 " + id,
    scopeStatus: "clarified",
    deadline: null,
    effortEstimateMinutes: minutes,
    mobility,
    schedule: { date, startMinute, endMinute, timezone: "Asia/Shanghai" },
    status: "active",
    pendingDetails: [],
  };
}

test("surface date comes from the stored protected block, not a hardcoded page constant", () => {
  const state = createInitialState("fixture");
  assert.equal(selectSurfaceDate(state), SURFACE_DATE);
  assert.equal(FIXTURE_DAY, SURFACE_DATE);
  const withoutProtected = structuredClone(state);
  withoutProtected.protectedBlocks = {};
  assert.equal(selectSurfaceDate(withoutProtected), SURFACE_DATE);
  const withoutAnything = structuredClone(withoutProtected);
  withoutAnything.commitments = {};
  assert.equal(selectSurfaceDate(withoutAnything), FIXTURE_DAY);
});

test("seed capacity view is 130 planned vs 120 capacity with a 10 minute deficit", () => {
  const state = createInitialState("fixture");
  const view = selectCapacityView(state, SURFACE_DATE);
  assert.equal(view.capacityMinutes, 120);
  assert.equal(view.committedKnownMinutes, 130);
  assert.equal(view.gapMinutes, 10);
  assert.equal(view.kind, "deficit");
  assert.equal(formatCapacityWarning(view), "当前计划超出容量 10 分钟");
});

test("a real approved plan A yields estimate 110, surplus 10, unchanged schedule, and a remaining protected overlap", async () => {
  const store = newStore();
  await runApprovedPlanA(store);
  const state = store.getState();
  const view = selectCapacityView(state, SURFACE_DATE);
  assert.equal(view.capacityMinutes, 120);
  assert.equal(view.committedKnownMinutes, 110);
  assert.equal(view.gapMinutes, -10);
  assert.equal(view.kind, "surplus");
  assert.equal(formatCapacityWarning(view), "预计投入在容量内，估计余量 10 分钟");
  const commitments = selectCommitmentsOnDate(state, SURFACE_DATE);
  const byId = new Map(commitments.map((c) => [c.id, c]));
  assert.deepEqual(
    [byId.get(FIXTURE_IDS.commitmentReport)?.effortEstimateMinutes, byId.get(FIXTURE_IDS.commitmentReport)?.schedule?.startMinute, byId.get(FIXTURE_IDS.commitmentReport)?.schedule?.endMinute],
    [40, 1050, 1110],
  );
  assert.deepEqual(
    [byId.get(FIXTURE_IDS.commitmentMeeting)?.effortEstimateMinutes, byId.get(FIXTURE_IDS.commitmentMeeting)?.schedule?.startMinute, byId.get(FIXTURE_IDS.commitmentMeeting)?.schedule?.endMinute],
    [30, 1020, 1050],
  );
  assert.deepEqual(
    [byId.get(FIXTURE_IDS.commitmentAdmin)?.effortEstimateMinutes, byId.get(FIXTURE_IDS.commitmentAdmin)?.schedule?.startMinute, byId.get(FIXTURE_IDS.commitmentAdmin)?.schedule?.endMinute],
    [40, 1110, 1150],
  );
  assert.equal(totalOverlapMinutes(selectProtectedOverlaps(state, SURFACE_DATE)), 10);
  assert.equal(selectModificationView(state).kind, "verified");
  assert.equal(
    formatModificationHint("verified"),
    "已有一次已批准的修改 · 只改变预计投入，实际节省尚未测量",
  );
});

test("unknown effort keeps the capacity result unknown instead of assuming zero", () => {
  const state = structuredClone(createInitialState("fixture"));
  state.commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes = null;
  const view = selectCapacityView(state, SURFACE_DATE);
  assert.equal(view.committedKnownMinutes, 70);
  assert.equal(view.unknownEffortCount, 1);
  assert.equal(view.gapMinutes, null);
  assert.equal(view.kind, "unknown");
  assert.equal(formatCapacityWarning(view), "有 1 项预计投入未知，容量结果尚不确定");
});

test("zero commitments show the full capacity as surplus, never as unknown or a deficit", () => {
  const state = structuredClone(createInitialState("fixture"));
  state.commitments = {};
  const view = selectCapacityView(state, SURFACE_DATE);
  assert.equal(view.committedKnownMinutes, 0);
  assert.equal(view.gapMinutes, -120);
  assert.equal(view.kind, "surplus");
  assert.equal(formatCapacityWarning(view), "预计投入在容量内，估计余量 120 分钟");
});

test("week groups actual stored dates inside the week and leaves other days explicitly unknown", () => {
  const state = structuredClone(createInitialState("fixture"));
  const admin = state.commitments[FIXTURE_IDS.commitmentAdmin];
  assert.ok(admin.schedule);
  admin.schedule.date = "2026-09-10";
  state.commitments["fx-commitment-extra"] = extraCommitment(
    "fx-commitment-extra",
    "2026-09-14",
    600,
    660,
    60,
    "flexible",
  );
  const week = weekDatesContaining(SURFACE_DATE);
  assert.deepEqual(week, [
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
  ]);
  const surface = selectWeekSurface(state, week);
  assert.equal(surface.weekStartDate, "2026-09-07");
  assert.equal(surface.weekEndDate, "2026-09-13");
  const byDate = new Map(surface.days.map((day) => [day.date, day]));
  assert.equal(byDate.get("2026-09-10")?.commitmentCount, 1);
  assert.equal(byDate.get("2026-09-10")?.knownEffortMinutes, 40);
  assert.equal(byDate.get("2026-09-12")?.commitmentCount, 2);
  assert.equal(byDate.get("2026-09-12")?.knownEffortMinutes, 90);
  assert.equal(byDate.get("2026-09-12")?.protectedCount, 1);
  assert.equal(byDate.get("2026-09-13")?.hasStoredRecords, false);
  assert.equal(surface.daysWithoutRecords, 5);
  assert.ok(!week.includes("2026-09-14"));
});

test("protected overlap is derived from schedule times separately from the estimate gap", () => {
  const state = createInitialState("fixture");
  const hero = selectHeroView(state, SURFACE_DATE);
  assert.deepEqual(
    [hero.protectedInterval?.startMinute, hero.protectedInterval?.endMinute, hero.protectedInterval?.purpose],
    [1140, 1200, null],
  );
  const overlaps = selectProtectedOverlaps(state, SURFACE_DATE);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].commitmentId, FIXTURE_IDS.commitmentAdmin);
  assert.deepEqual([overlaps[0].startMinute, overlaps[0].endMinute, overlaps[0].minutes], [1140, 1150, 10]);
  assert.equal(totalOverlapMinutes(overlaps), 10);
});

test("month grid covers the full calendar month aligned to Monday weeks", () => {
  const grid = monthGridDates("2026-09-12");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0], "2026-08-31");
  assert.ok(grid.includes("2026-09-01"));
  assert.ok(grid.includes("2026-09-30"));
  assert.ok(!grid.includes("2026-10-11"));
  const firstWeek = grid.slice(0, 7);
  assert.equal(firstWeek[6], "2026-09-06");
});

test("month surface aggregates per-day records and marks empty days unknown", () => {
  const state = createInitialState("fixture");
  const month = selectMonthSurface(state, "2026-09-12");
  assert.equal(month.year, 2026);
  assert.equal(month.month, 9);
  assert.equal(month.label, "2026 年 9 月");
  const byDate = new Map(month.weeks.flat().map((day) => [day.date, day]));
  assert.equal(byDate.get("2026-09-12")?.commitmentCount, 3);
  assert.equal(byDate.get("2026-09-12")?.knownEffortMinutes, 130);
  assert.equal(byDate.get("2026-09-12")?.protectedCount, 1);
  assert.equal(byDate.get("2026-09-13")?.hasStoredRecords, false);
  const outside = byDate.get("2026-08-31");
  assert.ok(outside);
  assert.equal(outside.hasStoredRecords, false);
});

test("timeline geometry maps stored minutes onto the existing 430px track", () => {
  const geometry = DAY_TRACK_GEOMETRY;
  assert.equal(minuteToTrackPx(geometry, 1020), 0);
  assert.equal(minuteToTrackPx(geometry, 1230), 430);
  assert.ok(Math.abs(minuteToTrackPx(geometry, 1140) - 245.71428571428572) < 1e-9);
  const state = createInitialState("fixture");
  const surface = selectTimelineSurface(state, SURFACE_DATE);
  assert.equal(surface.geometry.trackHeightPx, 430);
  assert.deepEqual(surface.hourLabels, [
    "17:00",
    "17:30",
    "18:00",
    "18:30",
    "19:00",
    "19:30",
    "20:00",
    "20:30",
  ]);
  assert.equal(trackHourLabels(geometry).length, 8);
  const adminBlock = surface.blocks.find((b) => b.id === FIXTURE_IDS.commitmentAdmin);
  assert.ok(adminBlock);
  assert.equal(adminBlock.overlaps.length, 1);
  assert.ok(Math.abs(adminBlock.topPx - 184.28571428571428) < 1e-9);
  assert.equal(surface.overlapSegments.length, 1);
  assert.ok(Math.abs(surface.overlapSegments[0].topPx - 245.71428571428572) < 1e-9);
  const protectedLane = surface.protectedLanes[0];
  assert.equal(protectedLane.visible, true);
  assert.ok(Math.abs(protectedLane.heightPx - 122.85714285714286) < 1e-9);
  assert.equal(formatMinuteOfDay(1140), "19:00");
  assert.equal(formatIsoDateCn(SURFACE_DATE), "9月12日");
});

test("expanded ledger track keeps every time and overlap on the same scale", () => {
  const state = createInitialState("fixture");
  const geometry = { ...DAY_TRACK_GEOMETRY, trackHeightPx: 630 };
  const surface = selectTimelineSurface(state, SURFACE_DATE, geometry);
  assert.equal(minuteToTrackPx(geometry, 1230), 630);
  assert.equal(minuteToTrackPx(geometry, 1140), 360);
  assert.equal(surface.overlapSegments[0].topPx, 360);
  assert.equal(surface.overlapSegments[0].heightPx, 30);
  assert.equal(surface.protectedLanes[0].heightPx, 180);
  assert.equal(surface.blocks.find((block) => block.id === FIXTURE_IDS.commitmentAdmin)?.topPx, 270);
});

test("stale and unconnected sources are never described as synced", () => {
  const state = createInitialState("fixture");
  const [connected] = selectSourceRows(state);
  assert.equal(connected.status, "connected");
  assert.equal(formatSourceSyncText(connected), "08:30 成功同步");
  assert.equal(formatCoverageText(connected), "9月12日 17:00–19:00");
  const staleState = structuredClone(state);
  staleState.sources[FIXTURE_IDS.sourceCalendar].status = "stale";
  const [stale] = selectSourceRows(staleState);
  assert.equal(formatSourceSyncText(stale), "上次成功 08:30 · 数据已过期");
  const staleUnknown = structuredClone(staleState);
  staleUnknown.sources[FIXTURE_IDS.sourceCalendar].coverage = { known: false, intervals: [] };
  assert.equal(formatCoverageText(selectSourceRows(staleUnknown)[0]), "覆盖未知");
  const unconnectedState: DomainState = structuredClone(state);
  unconnectedState.sources["fx-source-other"] = {
    ...unconnectedState.sources[FIXTURE_IDS.sourceCalendar],
    id: "fx-source-other",
    connectorId: "fixture-tasks",
    status: "unconnected",
    lastSuccessAt: null,
    coverage: { known: false, intervals: [] },
  };
  const rows = selectSourceRows(unconnectedState);
  const unconnected = rows.find((row) => row.id === "fx-source-other");
  assert.ok(unconnected);
  assert.equal(formatSourceSyncText(unconnected), "未连接 · 未见成功同步");
  assert.equal(formatCoverageText(unconnected), "覆盖未知");
});

test("duty cards bind stored scope, effort, mobility, and deadline", () => {
  const state = createInitialState("fixture");
  const cards = selectDutyCards(state, SURFACE_DATE);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((card) => card.commitment.schedule?.startMinute),
    [1020, 1050, 1110],
  );
  assert.deepEqual(cards.map((card) => card.minutesLabel), ["30", "60", "40"]);
  assert.deepEqual(cards.map((card) => card.icon), ["calendar", "file", "inbox"]);
  assert.deepEqual(cards.map((card) => card.note), [
    "固定约定 · 不自动移动",
    "19:00 截止 · 可重新决定",
    "可重新决定",
  ]);
  const unknownState = structuredClone(state);
  unknownState.commitments[FIXTURE_IDS.commitmentReport].effortEstimateMinutes = null;
  const unknownCards = selectDutyCards(unknownState, SURFACE_DATE);
  assert.equal(unknownCards[1].minutesLabel, "未知");
});
