import type { CommitmentSchedule } from "./types.ts";
import { tzOffsetMinutes } from "./handlers/shared.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();
const wallTimes = new Map<string, number | null>();

export function validCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return false;
  const instant = new Date(date + "T00:00:00Z");
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}

export function shiftCalendarDate(date: string, days: number): string {
  const instant = new Date(date + "T00:00:00Z");
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function zonedParts(instant: string | number, timezone: string): { date: string; minute: number } {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function uniqueZonedMinute(date: string, minute: number, timezone: string): number | null {
  const key = `${date}/${minute}/${timezone}`;
  if (wallTimes.has(key)) return wallTimes.get(key)!;
  const naive = Date.parse(date + "T00:00:00Z") + minute * 60000;
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(tzOffsetMinutes(timezone, new Date(naive + hours * 3600000)));
  const matches = [...offsets].map(offset => naive - offset * 60000).filter(instant => {
    const parts = zonedParts(instant, timezone);
    return parts.date === date && parts.minute === minute;
  });
  const result = matches.length === 1 ? matches[0] : null;
  if (wallTimes.size > 10000) wallTimes.clear();
  wallTimes.set(key, result);
  return result;
}

export function scheduleValidationError(schedule: CommitmentSchedule | null): string | null {
  if (schedule === null) return null;
  if (!schedule || typeof schedule !== "object" || typeof schedule.timezone !== "string" || !validCalendarDate(schedule.date) || !validCalendarDate(schedule.endDate ?? schedule.date)) return "请选择有效日期与时区。";
  try { new Intl.DateTimeFormat("en", { timeZone: schedule.timezone }).format(); } catch { return "时区无效。"; }
  if (schedule.allDay) return (schedule.endDate ?? schedule.date) < schedule.date ? "结束日期不能早于开始日期。" : null;
  const { startMinute, endMinute } = schedule;
  if (startMinute === null && endMinute === null && !schedule.endDate) return null;
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute === null || endMinute === null || startMinute < 0 || startMinute >= 1440 || endMinute < 0 || endMinute >= 1440) return "请填写完整的开始与结束时间。";
  const start = uniqueZonedMinute(schedule.date, startMinute, schedule.timezone);
  const end = uniqueZonedMinute(schedule.endDate ?? schedule.date, endMinute, schedule.timezone);
  if (start === null || end === null) return "所选当地时间因夏令时不存在或重复，请选择明确时段。";
  return end <= start ? "结束时间必须晚于开始时间。" : null;
}

export function scheduleSlice(schedule: CommitmentSchedule, date: string, displayTimezone: string): { startMinute: number; endMinute: number } | null {
  if (schedule.allDay) return date >= schedule.date && date <= (schedule.endDate ?? schedule.date) ? { startMinute: 0, endMinute: 1440 } : null;
  if (schedule.startMinute === null || schedule.endMinute === null) return null;
  const startInstant = uniqueZonedMinute(schedule.date, schedule.startMinute, schedule.timezone);
  const endInstant = uniqueZonedMinute(schedule.endDate ?? schedule.date, schedule.endMinute, schedule.timezone);
  if (startInstant === null || endInstant === null || endInstant <= startInstant) return null;
  const start = zonedParts(startInstant, displayTimezone), end = zonedParts(endInstant, displayTimezone);
  if (date < start.date || date > end.date) return null;
  const startMinute = date === start.date ? start.minute : 0;
  const endMinute = date === end.date ? end.minute : 1440;
  return endMinute > startMinute ? { startMinute, endMinute } : null;
}

export function scheduledEffortOnDate(schedule: CommitmentSchedule, effort: number, date: string, timezone: string): number {
  if (schedule.allDay) {
    const days = (Date.parse((schedule.endDate ?? schedule.date) + "T00:00:00Z") - Date.parse(schedule.date + "T00:00:00Z")) / 86400000 + 1;
    return scheduleSlice(schedule, date, timezone) ? effort / days : 0;
  }
  if (schedule.startMinute === null || schedule.endMinute === null) return schedule.date === date ? effort : 0;
  const start = uniqueZonedMinute(schedule.date, schedule.startMinute, schedule.timezone);
  const end = uniqueZonedMinute(schedule.endDate ?? schedule.date, schedule.endMinute, schedule.timezone);
  const dayStart = uniqueZonedMinute(date, 0, timezone), dayEnd = uniqueZonedMinute(shiftCalendarDate(date, 1), 0, timezone);
  if (start === null || end === null || dayStart === null || dayEnd === null || end <= start) return 0;
  return effort * Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart)) / (end - start);
}
