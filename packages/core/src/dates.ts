import { DateTime } from "luxon";

export function nowIn(tz: string): DateTime {
  return DateTime.now().setZone(tz);
}

export function todayISO(tz: string): string {
  return nowIn(tz).toISODate() ?? new Date().toISOString().slice(0, 10);
}

export function monthKey(dt: DateTime): string {
  return dt.toFormat("yyyy-LL");
}

export function currentMonthKey(tz: string): string {
  return monthKey(nowIn(tz));
}

export function shiftMonthKey(key: string, delta: number): string {
  const dt = DateTime.fromFormat(key, "yyyy-LL", { zone: "utc" });
  return monthKey(dt.plus({ months: delta }));
}

export function isValidMonthKey(key: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) && DateTime.fromFormat(key, "yyyy-LL").isValid;
}

/** Inclusive start date and exclusive end date (ISO yyyy-mm-dd) for a month key. */
export function monthDateRange(key: string): { start: string; end: string } {
  const dt = DateTime.fromFormat(key, "yyyy-LL", { zone: "utc" });
  return { start: dt.toISODate()!, end: dt.plus({ months: 1 }).toISODate()! };
}

/** Last day (ISO date) of the month that contains an ISO date. */
export function endOfMonthISO(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: "utc" }).endOf("month").toISODate()!;
}

export function daysInMonth(key: string): number {
  return DateTime.fromFormat(key, "yyyy-LL", { zone: "utc" }).daysInMonth ?? 30;
}

export function isValidISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid;
}

/** Parses a local date-time (no offset) in the given zone and returns a JS Date (UTC instant). */
export function localToInstant(value: string, tz: string): Date | null {
  const dt = DateTime.fromISO(value, { zone: tz });
  if (!dt.isValid) return null;
  return dt.toJSDate();
}

export function formatMonth(key: string, locale: string): string {
  const dt = DateTime.fromFormat(key, "yyyy-LL", { zone: "utc" }).setLocale(locale);
  const text = dt.toFormat("LLLL yyyy");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Month name for the middle of a sentence: «на ноябрь 2026», "for November 2026". */
export function formatMonthInline(key: string, locale: string): string {
  return DateTime.fromFormat(key, "yyyy-LL", { zone: "utc" }).setLocale(locale).toFormat("LLLL yyyy");
}

export function formatDate(iso: string, locale: string, tz = "utc"): string {
  const dt = DateTime.fromISO(iso, { zone: tz }).setLocale(locale);
  return dt.toLocaleString({ day: "numeric", month: "short" });
}

export function formatDateTime(date: Date, tz: string, locale: string): string {
  const dt = DateTime.fromJSDate(date).setZone(tz).setLocale(locale);
  const sameYear = dt.year === nowIn(tz).year;
  return dt.toLocaleString({
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function describeNow(tz: string, locale: string): string {
  const dt = nowIn(tz).setLocale("en");
  return `${dt.toFormat("yyyy-LL-dd HH:mm")} (${dt.toFormat("cccc")}, ${tz}, locale ${locale})`;
}

export function clampDay(year: number, month: number, day: number): number {
  const dim = DateTime.fromObject({ year, month }, { zone: "utc" }).daysInMonth ?? 28;
  return Math.min(Math.max(day, 1), dim);
}

/** Next due date (ISO date) for a day-of-month schedule, on or after `fromDate` (ISO date). */
export function nextDueDate(dayOfMonth: number, fromDate: string): string {
  const from = DateTime.fromISO(fromDate, { zone: "utc" });
  const thisMonth = from.set({ day: clampDay(from.year, from.month, dayOfMonth) });
  if (thisMonth >= from) return thisMonth.toISODate()!;
  const next = from.plus({ months: 1 });
  return next.set({ day: clampDay(next.year, next.month, dayOfMonth) }).toISODate()!;
}

export function atLocalTime(isoDate: string, hour: number, tz: string): Date {
  return DateTime.fromISO(isoDate, { zone: tz }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}
