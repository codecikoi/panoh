import { DateTime } from "luxon";
import { formatMonth } from "./dates.js";

/** A report period: inclusive ISO dates in the household's calendar. */
export interface Period {
  from: string;
  to: string;
  kind: "month" | "week" | "range";
}

const MAX_DAYS = 366;

function iso(dt: DateTime): string {
  return dt.toISODate()!;
}

function day(value: string): DateTime {
  return DateTime.fromISO(value, { zone: "utc" });
}

export function monthPeriod(month: string): Period {
  const start = DateTime.fromFormat(month, "yyyy-LL", { zone: "utc" });
  return { from: iso(start), to: iso(start.endOf("month")), kind: "month" };
}

/** Monday–Sunday week containing the given date. */
export function weekPeriod(date: string): Period {
  const start = day(date).startOf("week");
  return { from: iso(start), to: iso(start.plus({ days: 6 })), kind: "week" };
}

export function periodDays(p: Period): number {
  return Math.round(day(p.to).diff(day(p.from), "days").days) + 1;
}

/** The period right before: previous month, previous week, or the same number of days before a range. */
export function previousPeriod(p: Period): Period {
  if (p.kind === "month") return monthPeriod(day(p.from).minus({ months: 1 }).toFormat("yyyy-LL"));
  if (p.kind === "week") return weekPeriod(iso(day(p.from).minus({ days: 7 })));
  const len = periodDays(p);
  return { from: iso(day(p.from).minus({ days: len })), to: iso(day(p.from).minus({ days: 1 })), kind: "range" };
}

/** "This month" and the other presets offered as buttons. */
export function presetPeriods(today: string): { thisWeek: Period; lastWeek: Period; thisMonth: Period; lastMonth: Period } {
  const thisWeek = weekPeriod(today);
  const thisMonth = monthPeriod(today.slice(0, 7));
  return { thisWeek, lastWeek: previousPeriod(thisWeek), thisMonth, lastMonth: previousPeriod(thisMonth) };
}

/** Compact form for callback data: "20261001-20261031". */
export function periodKey(p: Period): string {
  return `${p.from.replaceAll("-", "")}-${p.to.replaceAll("-", "")}`;
}

function classify(from: string, to: string): Period {
  const month = monthPeriod(from.slice(0, 7));
  if (month.from === from && month.to === to) return month;
  const week = weekPeriod(from);
  if (week.from === from && week.to === to) return week;
  return { from, to, kind: "range" };
}

/** A from–to pair checked for order, validity and length; month and week spans are recognised as such. */
export function makePeriod(from: string, to: string): Period | null {
  const a = day(from);
  const b = day(to);
  if (!a.isValid || !b.isValid || b < a) return null;
  const p = classify(iso(a), iso(b));
  return periodDays(p) > MAX_DAYS ? null : p;
}

export function periodFromKey(key: string): Period | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  return makePeriod(`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}-${m[5]}-${m[6]}`);
}

const PRESET_WORDS: Record<string, (presets: ReturnType<typeof presetPeriods>) => Period> = {};
for (const w of ["week", "thisweek", "неделя", "эта неделя", "текущая неделя", "hafta", "shu hafta", "bu hafta"]) PRESET_WORDS[w] = (p) => p.thisWeek;
for (const w of ["lastweek", "last week", "прошлая неделя", "o'tgan hafta", "otgan hafta"]) PRESET_WORDS[w] = (p) => p.lastWeek;
for (const w of ["month", "thismonth", "месяц", "этот месяц", "текущий месяц", "oy", "shu oy", "bu oy"]) PRESET_WORDS[w] = (p) => p.thisMonth;
for (const w of ["last", "lastmonth", "last month", "прошлый месяц", "o'tgan oy", "otgan oy"]) PRESET_WORDS[w] = (p) => p.lastMonth;

/**
 * Parses a /report argument: a preset word ("week", "прошлый месяц"), a month ("2026-09"),
 * or a range ("01.10–15.10", "1.10.2026-15.10.2026", "2026-10-01..2026-10-15"). Null when not understood.
 */
export function parsePeriod(arg: string, today: string): Period | null {
  const text = arg.trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ");
  if (!text) return null;
  const preset = PRESET_WORDS[text];
  if (preset) return preset(presetPeriods(today));
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return monthPeriod(text);

  const isoRange = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|[-–—]|to|по)\s*(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (isoRange) return makePeriod(isoRange[1]!, isoRange[2]!);

  const dotted = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s*(?:[-–—]|\.\.|по|to)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(text);
  if (dotted) {
    const year = (value: string | undefined, fallback: number) =>
      value === undefined ? fallback : value.length === 2 ? 2000 + Number(value) : Number(value);
    const currentYear = Number(today.slice(0, 4));
    const toYear = year(dotted[6], currentYear);
    let fromYear = year(dotted[3], toYear);
    const pad = (n: string) => n.padStart(2, "0");
    let from = `${fromYear}-${pad(dotted[2]!)}-${pad(dotted[1]!)}`;
    const to = `${toYear}-${pad(dotted[5]!)}-${pad(dotted[4]!)}`;
    // "20.12–05.01" without years spans New Year.
    if (dotted[3] === undefined && dotted[6] === undefined && from > to) {
      fromYear -= 1;
      from = `${fromYear}-${pad(dotted[2]!)}-${pad(dotted[1]!)}`;
    }
    return makePeriod(from, to);
  }
  return null;
}

/** "October 2026" for a month, otherwise a locale-aware date range ("19–25 окт. 2026 г.", "Oct 19 – 25, 2026"). */
export function formatPeriod(p: Period, locale: string): string {
  if (p.kind === "month") return formatMonth(p.from.slice(0, 7), locale);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return fmt.formatRange(new Date(`${p.from}T00:00:00Z`), new Date(`${p.to}T00:00:00Z`));
}
