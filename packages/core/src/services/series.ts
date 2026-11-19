import { and, desc, eq, isNotNull } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import {
  reminderSeries,
  reminders,
  type Household,
  type NewReminderSeries,
  type Reminder,
  type ReminderSeries,
} from "../db/schema.js";
import { clampDay } from "../dates.js";

export type RepeatFreq = ReminderSeries["freq"];
export const REPEAT_FREQS: readonly RepeatFreq[] = ["daily", "weekly", "monthly"];

export interface RepeatRule {
  freq: RepeatFreq;
  /** ISO weekdays (1 = Monday) for weekly, otherwise null. */
  weekdays: number[] | null;
  /** Day of month for monthly, otherwise null. */
  dayOfMonth: number | null;
}

/**
 * Cleans a rule from the model: weekly needs weekdays and monthly a day, taken from the first occurrence (`first`,
 * a local date) when the message gave none. Every weekday of the week is plain daily. Null when it cannot be completed.
 */
export function normalizeRule(
  freq: RepeatFreq,
  weekdays: number[] | null | undefined,
  dayOfMonth: number | null | undefined,
  first: DateTime | null,
): RepeatRule | null {
  if (freq === "daily") return { freq, weekdays: null, dayOfMonth: null };
  if (freq === "weekly") {
    let days = [...new Set((weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (!days.length && first) days = [first.weekday];
    if (!days.length) return null;
    if (days.length === 7) return { freq: "daily", weekdays: null, dayOfMonth: null };
    return { freq, weekdays: days, dayOfMonth: null };
  }
  const day = dayOfMonth && dayOfMonth >= 1 && dayOfMonth <= 31 ? Math.round(dayOfMonth) : (first?.day ?? null);
  return day ? { freq, weekdays: null, dayOfMonth: day } : null;
}

export function ruleOf(series: Pick<ReminderSeries, "freq" | "weekdays" | "dayOfMonth">): RepeatRule {
  return { freq: series.freq, weekdays: series.weekdays ?? null, dayOfMonth: series.dayOfMonth ?? null };
}

/** Whether the rule fires on a local calendar date. */
export function ruleMatches(rule: RepeatRule, date: DateTime): boolean {
  if (rule.freq === "daily") return true;
  if (rule.freq === "weekly") return (rule.weekdays ?? []).includes(date.weekday);
  return date.day === clampDay(date.year, date.month, rule.dayOfMonth ?? 1);
}

/** First occurrence on or after `fromDate` (local ISO date) that is later than `after`. */
export function nextOccurrence(
  rule: RepeatRule,
  time: { hour: number; minute: number },
  tz: string,
  fromDate: string,
  after: Date,
): { period: string; dueAt: Date } | null {
  let day = DateTime.fromISO(fromDate, { zone: tz }).startOf("day");
  for (let i = 0; i < 400; i++, day = day.plus({ days: 1 })) {
    if (!ruleMatches(rule, day)) continue;
    const due = day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
    if (due.toMillis() > after.getTime()) return { period: day.toISODate()!, dueAt: due.toJSDate() };
  }
  return null;
}

export async function createSeries(db: Db, input: NewReminderSeries): Promise<ReminderSeries> {
  const rows = await db.insert(reminderSeries).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert reminder series");
  return row;
}

export async function getSeries(db: Db, id: number): Promise<ReminderSeries | undefined> {
  const rows = await db.select().from(reminderSeries).where(eq(reminderSeries.id, id)).limit(1);
  return rows[0];
}

export async function updateSeries(db: Db, id: number, patch: Partial<ReminderSeries>): Promise<ReminderSeries | undefined> {
  const rows = await db
    .update(reminderSeries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(reminderSeries.id, id))
    .returning();
  return rows[0];
}

export async function listActiveSeries(db: Db, householdId: number): Promise<ReminderSeries[]> {
  return db
    .select()
    .from(reminderSeries)
    .where(and(eq(reminderSeries.householdId, householdId), eq(reminderSeries.active, true)))
    .orderBy(reminderSeries.createdAt);
}

export async function listAllActiveSeries(db: Db): Promise<ReminderSeries[]> {
  return db.select().from(reminderSeries).where(eq(reminderSeries.active, true));
}

export async function findSeriesByBotMessage(db: Db, chatId: number, botMessageId: number): Promise<ReminderSeries | undefined> {
  const rows = await db
    .select()
    .from(reminderSeries)
    .where(and(eq(reminderSeries.sourceChatId, chatId), eq(reminderSeries.botMessageId, botMessageId)))
    .limit(1);
  return rows[0];
}

export async function lastSeriesForHousehold(db: Db, householdId: number): Promise<ReminderSeries | undefined> {
  const rows = await db
    .select()
    .from(reminderSeries)
    .where(and(eq(reminderSeries.householdId, householdId), eq(reminderSeries.active, true)))
    .orderBy(desc(reminderSeries.createdAt))
    .limit(1);
  return rows[0];
}

/** The occurrence with the latest date, whatever its status. */
async function latestOccurrence(db: Db, seriesId: number): Promise<Reminder | undefined> {
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.seriesId, seriesId), isNotNull(reminders.period)))
    .orderBy(desc(reminders.period))
    .limit(1);
  return rows[0];
}

/**
 * Makes sure the series has its next occurrence scheduled: one after the latest existing date, in the future.
 * Idempotent; a snoozed occurrence does not count as the next one. Returns the upcoming occurrence.
 */
export async function ensureNextOccurrence(
  db: Db,
  series: ReminderSeries,
  household: Household,
  now = new Date(),
  /** Local date the series starts on (a one-off reminder turned into a repeating one keeps its day). */
  notBefore?: string,
): Promise<Reminder | undefined> {
  if (!series.active) return undefined;
  const tz = household.timezone;
  const last = await latestOccurrence(db, series.id);
  if (last && last.status === "scheduled" && last.snoozeCount === 0) return last;
  let today = DateTime.fromJSDate(now).setZone(tz).toISODate()!;
  if (notBefore && notBefore > today) today = notBefore;
  const from = last?.period && last.period >= today ? DateTime.fromISO(last.period, { zone: tz }).plus({ days: 1 }).toISODate()! : today;
  const time = { hour: series.hour ?? household.reminderHour, minute: series.hour === null ? 0 : series.minute };
  const next = nextOccurrence(ruleOf(series), time, tz, from, now);
  if (!next) return undefined;
  const rows = await db
    .insert(reminders)
    .values({
      householdId: series.householdId,
      userId: series.userId,
      kind: "reminder",
      title: series.title,
      dueAt: next.dueAt,
      defaultTime: series.hour === null,
      seriesId: series.id,
      period: next.period,
      sourceChatId: series.sourceChatId,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0];
}

/** After the rule, time or title changed: the waiting occurrence is dropped and scheduled again from the new rule. */
export async function rescheduleSeries(db: Db, series: ReminderSeries, household: Household, now = new Date()): Promise<Reminder | undefined> {
  await db
    .delete(reminders)
    .where(and(eq(reminders.seriesId, series.id), eq(reminders.status, "scheduled"), eq(reminders.snoozeCount, 0)));
  return ensureNextOccurrence(db, series, household, now);
}

/** Stops a series: no more occurrences; the ones already sent stay until they are marked. */
export async function stopSeries(db: Db, id: number): Promise<ReminderSeries | undefined> {
  const row = await updateSeries(db, id, { active: false });
  await db
    .update(reminders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(reminders.seriesId, id), eq(reminders.status, "scheduled")));
  return row;
}

/** The upcoming occurrence of a series, if one is scheduled. */
export async function upcomingOccurrence(db: Db, seriesId: number): Promise<Reminder | undefined> {
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.seriesId, seriesId), eq(reminders.status, "scheduled")))
    .orderBy(reminders.dueAt)
    .limit(1);
  return rows[0];
}
