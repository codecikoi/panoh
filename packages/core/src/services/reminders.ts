import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import { reminders, type NewReminder, type Reminder } from "../db/schema.js";

export async function createReminder(db: Db, input: NewReminder): Promise<Reminder> {
  const rows = await db.insert(reminders).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert reminder");
  return row;
}

/** Inserts unless a reminder for the same recurring payment, period and kind already exists. */
export async function createReminderIfMissing(db: Db, input: NewReminder): Promise<Reminder | undefined> {
  const rows = await db.insert(reminders).values(input).onConflictDoNothing().returning();
  return rows[0];
}

export async function getReminder(db: Db, id: number): Promise<Reminder | undefined> {
  const rows = await db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
  return rows[0];
}

export async function updateReminder(db: Db, id: number, patch: Partial<Reminder>): Promise<Reminder | undefined> {
  const rows = await db
    .update(reminders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(reminders.id, id))
    .returning();
  return rows[0];
}

export async function findReminderByBotMessage(db: Db, chatId: number, messageId: number): Promise<Reminder | undefined> {
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(eq(reminders.sourceChatId, chatId), or(eq(reminders.botMessageId, messageId), eq(reminders.notifiedMessageId, messageId))),
    )
    .limit(1);
  return rows[0];
}

export interface OpenRemindersFilter {
  kind?: Reminder["kind"];
  /** Due at or after this instant. */
  from?: Date;
  /** Due before this instant. */
  to?: Date;
}

export async function listOpenReminders(db: Db, householdId: number, limit = 20, filter: OpenRemindersFilter = {}): Promise<Reminder[]> {
  const conditions: SQL[] = [eq(reminders.householdId, householdId), inArray(reminders.status, ["scheduled", "sent"])];
  if (filter.kind) conditions.push(eq(reminders.kind, filter.kind));
  if (filter.from) conditions.push(gte(reminders.dueAt, filter.from));
  if (filter.to) conditions.push(lt(reminders.dueAt, filter.to));
  return db
    .select()
    .from(reminders)
    .where(and(...conditions))
    .orderBy(asc(reminders.dueAt))
    .limit(limit);
}

export async function dueReminders(db: Db, now: Date, limit = 100): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, "scheduled"), lte(reminders.dueAt, now)))
    .orderBy(asc(reminders.dueAt))
    .limit(limit);
}

export async function markReminderSent(db: Db, id: number, notifiedMessageId: number | null): Promise<void> {
  await updateReminder(db, id, { status: "sent", notifiedMessageId });
}

export async function markReminderDone(db: Db, id: number): Promise<Reminder | undefined> {
  return updateReminder(db, id, { status: "done" });
}

export async function cancelReminder(db: Db, id: number): Promise<Reminder | undefined> {
  return updateReminder(db, id, { status: "cancelled" });
}

export async function snoozeReminder(db: Db, id: number, until: Date): Promise<Reminder | undefined> {
  const current = await getReminder(db, id);
  if (!current) return undefined;
  return updateReminder(db, id, { status: "scheduled", dueAt: until, snoozeCount: current.snoozeCount + 1 });
}

export async function cancelRemindersForPeriod(db: Db, recurringPaymentId: number, period: string): Promise<number> {
  const rows = await db
    .update(reminders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(reminders.recurringPaymentId, recurringPaymentId),
        eq(reminders.period, period),
        inArray(reminders.status, ["scheduled", "sent"]),
      ),
    )
    .returning({ id: reminders.id });
  return rows.length;
}

export async function countReminders(
  db: Db,
  householdId: number,
  status: Reminder["status"][],
  range?: { from: Date; to: Date },
): Promise<number> {
  const conditions = [eq(reminders.householdId, householdId), inArray(reminders.status, status), eq(reminders.kind, "reminder")];
  if (range) conditions.push(gte(reminders.dueAt, range.from), lt(reminders.dueAt, range.to));
  const rows = await db.select({ id: reminders.id }).from(reminders).where(and(...conditions));
  return rows.length;
}

export async function lastReminderForHousehold(db: Db, householdId: number): Promise<Reminder | undefined> {
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.householdId, householdId),
        eq(reminders.kind, "reminder"),
        // Occurrences of a repeating reminder are created by the scheduler, not by the family.
        isNull(reminders.seriesId),
        inArray(reminders.status, ["scheduled", "sent"]),
      ),
    )
    .orderBy(desc(reminders.createdAt))
    .limit(1);
  return rows[0];
}

/**
 * Moves every scheduled reminder that sits on the household default time (payment reminders and
 * one-off reminders created without an explicit time) to a new hour of the day, same local date.
 */
export async function rescheduleDefaultHour(db: Db, householdId: number, tz: string, hour: number): Promise<number> {
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.householdId, householdId),
        eq(reminders.status, "scheduled"),
        or(inArray(reminders.kind, ["payment_upcoming", "payment_due"]), eq(reminders.defaultTime, true)),
      ),
    );
  let changed = 0;
  for (const row of rows) {
    const due = DateTime.fromJSDate(row.dueAt).setZone(tz).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    if (due.getTime() === row.dueAt.getTime()) continue;
    await updateReminder(db, row.id, { dueAt: due });
    changed++;
  }
  return changed;
}

function titleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/** Levenshtein distance capped at 2 (enough to tell a one-letter typo from a different word). */
function closeWords(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]! <= 1;
}

/**
 * Two reminder titles about the same thing: more than half the words of the shorter one appear in the other,
 * allowing a typo ("митап течстар" ~ "завтра митап техстар", but not "митап течстар" ~ "митап luma").
 */
export function similarTitles(a: string, b: string): boolean {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (!x.length || !y.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const shared = short.filter((w) => long.some((v) => closeWords(w, v))).length;
  return shared / short.length > 0.5;
}

/** Open one-off reminders on the same local day with a similar title (to warn about a duplicate). */
export async function findSimilarReminders(db: Db, householdId: number, tz: string, title: string, dueAt: Date, excludeId?: number): Promise<Reminder[]> {
  const day = DateTime.fromJSDate(dueAt).setZone(tz).startOf("day");
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.householdId, householdId),
        eq(reminders.kind, "reminder"),
        isNull(reminders.seriesId),
        inArray(reminders.status, ["scheduled", "sent"]),
        gte(reminders.dueAt, day.toJSDate()),
        lt(reminders.dueAt, day.plus({ days: 1 }).toJSDate()),
      ),
    )
    .orderBy(asc(reminders.dueAt));
  return rows.filter((r) => r.id !== excludeId && similarTitles(r.title, title));
}
