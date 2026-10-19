import { and, asc, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
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

export async function listOpenReminders(db: Db, householdId: number, limit = 20): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.householdId, householdId), inArray(reminders.status, ["scheduled", "sent"])))
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
    .where(and(eq(reminders.householdId, householdId), eq(reminders.kind, "reminder"), inArray(reminders.status, ["scheduled", "sent"])))
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
