import {
  FIXTURE_DAY,
  selectCapacitySummary,
} from "../../domain/index.ts";
import type {
  Commitment,
  DomainState,
  EntityId,
  Source,
  TimeRange,
} from "../../domain/index.ts";

export const SURFACE_AXIS_START_MINUTE = 1020;
export const SURFACE_AXIS_END_MINUTE = 1230;
export const SURFACE_TRACK_HEIGHT_PX = 430;

export interface TrackGeometry {
  axisStartMinute: number;
  axisEndMinute: number;
  trackHeightPx: number;
}

export const DAY_TRACK_GEOMETRY: TrackGeometry = {
  axisStartMinute: SURFACE_AXIS_START_MINUTE,
  axisEndMinute: SURFACE_AXIS_END_MINUTE,
  trackHeightPx: SURFACE_TRACK_HEIGHT_PX,
};

export type CapacityKind = "unknown" | "deficit" | "surplus" | "balanced";

export interface CapacityView {
  date: string;
  capacityMinutes: number;
  committedKnownMinutes: number;
  unknownEffortCount: number;
  gapMinutes: number | null;
  kind: CapacityKind;
}

export function selectCapacityView(state: DomainState, date: string): CapacityView {
  const summary = selectCapacitySummary(state, date);
  let kind: CapacityKind = "unknown";
  if (!summary.incomplete && summary.gapMinutes !== null) {
    kind =
      summary.gapMinutes > 0
        ? "deficit"
        : summary.gapMinutes < 0
          ? "surplus"
          : "balanced";
  }
  return { ...summary, kind };
}

export function formatCapacityWarning(capacity: CapacityView): string {
  switch (capacity.kind) {
    case "deficit":
      return "当前计划超出容量 " + capacity.gapMinutes + " 分钟";
    case "surplus":
      return (
        "预计投入在容量内，估计余量 " + (-(capacity.gapMinutes ?? 0)) + " 分钟"
      );
    case "balanced":
      return "当前预计投入与容量持平";
    case "unknown":
      return (
        "有 " +
        capacity.unknownEffortCount +
        " 项预计投入未知，容量结果尚不确定"
      );
  }
}

export function isoDateOf(iso: string): string {
  return iso.slice(0, 10);
}

export function minuteOfDay(iso: string): number {
  const time = iso.slice(11, 16);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function formatMinuteOfDay(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

export function formatIsoTime(iso: string): string {
  return iso.slice(11, 16);
}

export function formatIsoDateCn(date: string): string {
  const parts = date.split("-");
  return String(Number(parts[1])) + "月" + String(Number(parts[2])) + "日";
}

export function selectSurfaceDate(
  state: DomainState,
  fallbackDate: string = FIXTURE_DAY,
): string {
  const protectedDates = Object.values(state.protectedBlocks)
    .filter((block) => block.status === "active")
    .map((block) => isoDateOf(block.range.start))
    .sort();
  if (protectedDates.length > 0) return protectedDates[0];
  const scheduledDates = Object.values(state.commitments)
    .filter((commitment) => commitment.status === "active")
    .flatMap((commitment) => (commitment.schedule ? [commitment.schedule.date] : []))
    .sort();
  if (scheduledDates.length > 0) return scheduledDates[0];
  return fallbackDate;
}

export interface ProtectedIntervalView {
  id: EntityId;
  blockId: string;
  purpose: string | null;
  startMinute: number;
  endMinute: number;
  startIso: string;
  endIso: string;
  timezone: string;
}

export function selectProtectedIntervals(
  state: DomainState,
  date: string,
): ProtectedIntervalView[] {
  const rows: ProtectedIntervalView[] = [];
  for (const block of Object.values(state.protectedBlocks)) {
    if (block.status !== "active") continue;
    const startDate = isoDateOf(block.range.start);
    const endDate = isoDateOf(block.range.end);
    if (endDate < date || startDate > date) continue;
    rows.push({
      id: block.id,
      blockId: block.blockId,
      purpose: block.purpose,
      startMinute: startDate === date ? minuteOfDay(block.range.start) : 0,
      endMinute: endDate === date ? minuteOfDay(block.range.end) : 1440,
      startIso: block.range.start,
      endIso: block.range.end,
      timezone: block.range.timezone,
    });
  }
  return rows.sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
}

export interface CommitmentView {
  id: EntityId;
  scope: string | null;
  status: Commitment["status"];
  mobility: Commitment["mobility"];
  effortEstimateMinutes: number | null;
  deadline: string | null;
  schedule: {
    date: string;
    startMinute: number | null;
    endMinute: number | null;
    timezone: string;
  } | null;
  provenanceOrigin: string;
  provenanceNote: string | null;
  requestSourceRef: string | null;
  acceptedBy: string | null;
  pendingDetails: string[];
}

export function toCommitmentView(
  state: DomainState,
  commitment: Commitment,
): CommitmentView {
  const request = commitment.requestId
    ? state.requests[commitment.requestId]
    : undefined;
  return {
    id: commitment.id,
    scope: commitment.scope,
    status: commitment.status,
    mobility: commitment.mobility,
    effortEstimateMinutes: commitment.effortEstimateMinutes,
    deadline: commitment.deadline,
    schedule: commitment.schedule
      ? {
          date: commitment.schedule.date,
          startMinute: commitment.schedule.startMinute,
          endMinute: commitment.schedule.endMinute,
          timezone: commitment.schedule.timezone,
        }
      : null,
    provenanceOrigin: commitment.provenance.origin,
    provenanceNote: commitment.provenance.note ?? null,
    requestSourceRef: request?.sourceRef ?? null,
    acceptedBy: commitment.acceptedBy,
    pendingDetails: [...commitment.pendingDetails],
  };
}

export function selectCommitmentsOnDate(
  state: DomainState,
  date: string,
): CommitmentView[] {
  return Object.values(state.commitments)
    .filter(
      (commitment) =>
        commitment.status === "active" &&
        commitment.schedule &&
        commitment.schedule.date === date,
    )
    .map((commitment) => toCommitmentView(state, commitment))
    .sort(
      (a, b) =>
        (a.schedule?.startMinute ?? 1441) - (b.schedule?.startMinute ?? 1441) ||
        a.id.localeCompare(b.id),
    );
}

export function selectUnscheduledCommitments(
  state: DomainState,
): CommitmentView[] {
  return Object.values(state.commitments)
    .filter(
      (commitment) =>
        commitment.status === "active" &&
        (!commitment.schedule || commitment.schedule.startMinute === null),
    )
    .map((commitment) => toCommitmentView(state, commitment))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface ProtectedOverlapView {
  commitmentId: EntityId;
  blockId: string;
  startMinute: number;
  endMinute: number;
  minutes: number;
}

export function selectProtectedOverlaps(
  state: DomainState,
  date: string,
  protectedIntervals: ProtectedIntervalView[] = selectProtectedIntervals(
    state,
    date,
  ),
): ProtectedOverlapView[] {
  const rows: ProtectedOverlapView[] = [];
  for (const commitment of Object.values(state.commitments)) {
    if (
      commitment.status !== "active" ||
      !commitment.schedule ||
      commitment.schedule.date !== date
    ) {
      continue;
    }
    const start = commitment.schedule.startMinute;
    const end = commitment.schedule.endMinute;
    if (start === null || end === null) continue;
    for (const interval of protectedIntervals) {
      const overlapStart = Math.max(start, interval.startMinute);
      const overlapEnd = Math.min(end, interval.endMinute);
      if (overlapEnd > overlapStart) {
        rows.push({
          commitmentId: commitment.id,
          blockId: interval.blockId,
          startMinute: overlapStart,
          endMinute: overlapEnd,
          minutes: overlapEnd - overlapStart,
        });
      }
    }
  }
  return rows.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

export function totalOverlapMinutes(overlaps: ProtectedOverlapView[]): number {
  if (overlaps.length === 0) return 0;
  const sorted = [...overlaps].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
  let total = 0;
  let currentStart = sorted[0].startMinute;
  let currentEnd = sorted[0].endMinute;
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.startMinute > currentEnd) {
      total += currentEnd - currentStart;
      currentStart = next.startMinute;
      currentEnd = next.endMinute;
    } else {
      currentEnd = Math.max(currentEnd, next.endMinute);
    }
  }
  return total + (currentEnd - currentStart);
}

export function minuteToTrackPx(geometry: TrackGeometry, minute: number): number {
  const span = geometry.axisEndMinute - geometry.axisStartMinute;
  return ((minute - geometry.axisStartMinute) / span) * geometry.trackHeightPx;
}

export function trackHourLabels(
  geometry: TrackGeometry = DAY_TRACK_GEOMETRY,
  stepMinutes = 30,
): string[] {
  const labels: string[] = [];
  for (let m = geometry.axisStartMinute; m <= geometry.axisEndMinute; m += stepMinutes) {
    labels.push(formatMinuteOfDay(m));
  }
  return labels;
}

interface ClampedRange {
  startMinute: number;
  endMinute: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  visible: boolean;
}

function clampToAxis(
  startMinute: number,
  endMinute: number,
  geometry: TrackGeometry,
): ClampedRange {
  const start = Math.max(startMinute, geometry.axisStartMinute);
  const end = Math.min(endMinute, geometry.axisEndMinute);
  return {
    startMinute: start,
    endMinute: end,
    clippedStart: startMinute < geometry.axisStartMinute,
    clippedEnd: endMinute > geometry.axisEndMinute,
    visible: end > start,
  };
}

function pxSpan(
  startMinute: number,
  endMinute: number,
  geometry: TrackGeometry,
): number {
  const span = geometry.axisEndMinute - geometry.axisStartMinute;
  return ((endMinute - startMinute) / span) * geometry.trackHeightPx;
}

export interface TimelineBlockView extends CommitmentView {
  topPx: number;
  heightPx: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  overlaps: ProtectedOverlapView[];
}

export interface ProtectedLaneView extends ProtectedIntervalView {
  topPx: number;
  heightPx: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  visible: boolean;
}

export interface OverlapSegmentView extends ProtectedOverlapView {
  topPx: number;
  heightPx: number;
}

export interface TimelineSurface {
  geometry: TrackGeometry;
  hourLabels: string[];
  blocks: TimelineBlockView[];
  excludedBlockCount: number;
  unscheduled: CommitmentView[];
  protectedLanes: ProtectedLaneView[];
  overlaps: ProtectedOverlapView[];
  overlapSegments: OverlapSegmentView[];
  totalOverlapMinutes: number;
}

export function selectTimelineSurface(
  state: DomainState,
  date: string,
  geometry: TrackGeometry = DAY_TRACK_GEOMETRY,
): TimelineSurface {
  const protectedIntervals = selectProtectedIntervals(state, date);
  const overlaps = selectProtectedOverlaps(state, date, protectedIntervals);
  const blocks: TimelineBlockView[] = [];
  let excludedBlockCount = 0;
  const unscheduled = selectUnscheduledCommitments(state);
  for (const commitment of Object.values(state.commitments)) {
    if (commitment.status !== "active") continue;
    if (
      !commitment.schedule ||
      commitment.schedule.startMinute === null ||
      commitment.schedule.endMinute === null
    ) {
      continue;
    }
    if (commitment.schedule.date !== date) continue;
    const clamped = clampToAxis(
      commitment.schedule.startMinute,
      commitment.schedule.endMinute,
      geometry,
    );
    if (!clamped.visible) {
      excludedBlockCount += 1;
      continue;
    }
    blocks.push({
      ...toCommitmentView(state, commitment),
      topPx: minuteToTrackPx(geometry, clamped.startMinute),
      heightPx: pxSpan(clamped.startMinute, clamped.endMinute, geometry),
      clippedStart: clamped.clippedStart,
      clippedEnd: clamped.clippedEnd,
      overlaps: overlaps.filter((o) => o.commitmentId === commitment.id),
    });
  }
  blocks.sort((a, b) => a.topPx - b.topPx || a.id.localeCompare(b.id));
  const protectedLanes: ProtectedLaneView[] = protectedIntervals.map((interval) => {
    const clamped = clampToAxis(interval.startMinute, interval.endMinute, geometry);
    return {
      ...interval,
      topPx: minuteToTrackPx(geometry, clamped.startMinute),
      heightPx: pxSpan(clamped.startMinute, clamped.endMinute, geometry),
      clippedStart: clamped.clippedStart,
      clippedEnd: clamped.clippedEnd,
      visible: clamped.visible,
    };
  });
  const overlapSegments: OverlapSegmentView[] = overlaps.map((overlap) => {
    const clamped = clampToAxis(overlap.startMinute, overlap.endMinute, geometry);
    return {
      ...overlap,
      topPx: minuteToTrackPx(geometry, clamped.startMinute),
      heightPx: pxSpan(clamped.startMinute, clamped.endMinute, geometry),
    };
  });
  return {
    geometry,
    hourLabels: trackHourLabels(geometry),
    blocks,
    excludedBlockCount,
    unscheduled,
    protectedLanes,
    overlaps,
    overlapSegments,
    totalOverlapMinutes: totalOverlapMinutes(overlaps),
  };
}

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function weekdayIndexOf(date: string): number {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
}

export function weekDatesContaining(date: string): string[] {
  const base = new Date(date + "T00:00:00Z");
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - weekdayIndexOf(date));
  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + i);
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

export interface WeekDayView {
  date: string;
  weekdayLabel: string;
  commitmentCount: number;
  knownEffortMinutes: number;
  unknownEffortCount: number;
  protectedCount: number;
  overlapMinutes: number;
  hasStoredRecords: boolean;
}

export interface WeekSurfaceView {
  weekStartDate: string;
  weekEndDate: string;
  days: WeekDayView[];
  daysWithoutRecords: number;
}

export function selectWeekSurface(
  state: DomainState,
  dates: string[],
): WeekSurfaceView {
  const days: WeekDayView[] = dates.map((date) => {
    const commitments = selectCommitmentsOnDate(state, date);
    const protectedCount = selectProtectedIntervals(state, date).length;
    const unknownEffortCount = commitments.filter(
      (c) => c.effortEstimateMinutes === null,
    ).length;
    const knownEffortMinutes = commitments.reduce(
      (sum, c) => sum + (c.effortEstimateMinutes ?? 0),
      0,
    );
    return {
      date,
      weekdayLabel: WEEKDAY_LABELS[weekdayIndexOf(date)],
      commitmentCount: commitments.length,
      knownEffortMinutes,
      unknownEffortCount,
      protectedCount,
      overlapMinutes: totalOverlapMinutes(selectProtectedOverlaps(state, date)),
      hasStoredRecords: commitments.length > 0 || protectedCount > 0,
    };
  });
  return {
    weekStartDate: dates[0],
    weekEndDate: dates[dates.length - 1],
    days,
    daysWithoutRecords: days.filter((day) => !day.hasStoredRecords).length,
  };
}

const SOURCE_STATUS_LABELS: Record<Source["status"], string> = {
  connected: "已连接",
  stale: "数据已过期",
  error: "同步失败",
  revoked: "授权已撤销",
  unconnected: "未连接",
};

export interface SourceRowView {
  id: EntityId;
  connectorId: string;
  status: Source["status"];
  statusLabel: string;
  lastSuccessAt: string | null;
  coverageKnown: boolean;
  coverageIntervals: TimeRange[];
}

export function selectSourceRows(state: DomainState): SourceRowView[] {
  return Object.values(state.sources)
    .map((source) => ({
      id: source.id,
      connectorId: source.connectorId,
      status: source.status,
      statusLabel: SOURCE_STATUS_LABELS[source.status],
      lastSuccessAt: source.lastSuccessAt,
      coverageKnown: source.coverage.known,
      coverageIntervals: source.coverage.intervals,
    }))
    .sort((a, b) => a.connectorId.localeCompare(b.connectorId));
}

export function formatSourceSyncText(row: SourceRowView): string {
  if (row.status === "connected" && row.lastSuccessAt) {
    return formatIsoTime(row.lastSuccessAt) + " 成功同步";
  }
  if (row.lastSuccessAt) {
    return (
      "上次成功 " + formatIsoTime(row.lastSuccessAt) + " · " + row.statusLabel
    );
  }
  return row.statusLabel + " · 未见成功同步";
}

export function formatCoverageText(row: SourceRowView): string {
  if (!row.coverageKnown) return "覆盖未知";
  if (row.coverageIntervals.length === 0) return "未见已声明覆盖区间";
  return row.coverageIntervals
    .map(
      (interval) =>
        formatIsoDateCn(isoDateOf(interval.start)) +
        " " +
        formatIsoTime(interval.start) +
        "–" +
        formatIsoTime(interval.end),
    )
    .join("；");
}

export interface HeroView {
  date: string;
  protectedInterval: ProtectedIntervalView | null;
}

export function selectHeroView(state: DomainState, date: string): HeroView {
  const intervals = selectProtectedIntervals(state, date);
  return { date, protectedInterval: intervals[0] ?? null };
}

export interface DutyCardView {
  commitment: CommitmentView;
  icon: "calendar" | "file" | "inbox";
  note: string;
  minutesLabel: string;
}

export function selectDutyCards(state: DomainState, date: string): DutyCardView[] {
  return selectCommitmentsOnDate(state, date).map((commitment) => {
    const notes: string[] = [];
    if (commitment.deadline) notes.push(formatIsoTime(commitment.deadline) + " 截止");
    notes.push(
      commitment.mobility === "fixed" ? "固定约定 · 不自动移动" : "可重新决定",
    );
    return {
      commitment,
      icon:
        commitment.mobility === "fixed"
          ? "calendar"
          : commitment.deadline
            ? "file"
            : "inbox",
      note: notes.join(" · "),
      minutesLabel:
        commitment.effortEstimateMinutes === null
          ? "未知"
          : String(commitment.effortEstimateMinutes),
    };
  });
}

export type ModificationKind = "none" | "inFlight" | "unknown" | "verified" | "failed";

export interface ModificationView {
  kind: ModificationKind;
}

export function selectModificationView(state: DomainState): ModificationView {
  const statuses = Object.values(state.operations).map((operation) => operation.status);
  if (statuses.some((s) => s === "executing" || s === "verifying")) {
    return { kind: "inFlight" };
  }
  if (statuses.some((s) => s === "unknown")) return { kind: "unknown" };
  if (statuses.some((s) => s === "verified")) return { kind: "verified" };
  if (statuses.some((s) => s === "failed")) return { kind: "failed" };
  return { kind: "none" };
}

export function formatModificationHint(kind: ModificationKind): string {
  switch (kind) {
    case "none":
      return "还没有修改任何安排";
    case "inFlight":
      return "有一次修改正在执行，结果尚未确认";
    case "unknown":
      return "上次修改结果未知，需要回读确认";
    case "verified":
      return "已有一次已批准的修改 · 只改变预计投入，实际节省尚未测量";
    case "failed":
      return "上次修改未完成，原安排未变";
  }
}
