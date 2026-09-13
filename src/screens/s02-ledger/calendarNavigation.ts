import { shiftCalendarDate } from "../../domain/calendarTime.ts";

export function navigateCalendarPeriod(date: string, view: "today" | "week" | "month", direction: -1 | 1): string {
  if (view !== "month") return shiftCalendarDate(date, direction * (view === "week" ? 7 : 1));
  const instant = new Date(date + "T00:00:00Z");
  const day = instant.getUTCDate();
  instant.setUTCDate(1);
  instant.setUTCMonth(instant.getUTCMonth() + direction);
  const last = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 0)).getUTCDate();
  instant.setUTCDate(Math.min(day, last));
  return instant.toISOString().slice(0, 10);
}
