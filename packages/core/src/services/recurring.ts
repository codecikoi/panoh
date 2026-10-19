import { and, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import { recurringPayments, type Household, type NewRecurringPayment, type RecurringPayment } from "../db/schema.js";
import { atLocalTime, nextDueDate, todayISO } from "../dates.js";
import { createReminderIfMissing, cancelRemindersForPeriod } from "./reminders.js";

export async function createRecurring(db: Db, input: NewRecurringPayment): Promise<RecurringPayment> {
  const rows = await db.insert(recurringPayments).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert recurring payment");
  return row;
}

export async function getRecurring(db: Db, id: number): Promise<RecurringPayment | undefined> {
  const rows = await db.select().from(recurringPayments).where(eq(recurringPayments.id, id)).limit(1);
  return rows[0];
}

export async function updateRecurring(db: Db, id: number, patch: Partial<RecurringPayment>): Promise<RecurringPayment | undefined> {
  const rows = await db
    .update(recurringPayments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(recurringPayments.id, id))
    .returning();
  return rows[0];
}

export async function listRecurring(db: Db, householdId: number, activeOnly = true): Promise<RecurringPayment[]> {
  const where = activeOnly
    ? and(eq(recurringPayments.householdId, householdId), eq(recurringPayments.active, true))
    : eq(recurringPayments.householdId, householdId);
  return db.select().from(recurringPayments).where(where).orderBy(recurringPayments.dayOfMonth);
}

export async function listAllActiveRecurring(db: Db): Promise<RecurringPayment[]> {
  return db.select().from(recurringPayments).where(eq(recurringPayments.active, true));
}

export async function deactivateRecurring(db: Db, id: number): Promise<RecurringPayment | undefined> {
  return updateRecurring(db, id, { active: false });
}

export async function findRecurringByBotMessage(db: Db, chatId: number, botMessageId: number): Promise<RecurringPayment | undefined> {
  const rows = await db
    .select()
    .from(recurringPayments)
    .where(and(eq(recurringPayments.sourceChatId, chatId), eq(recurringPayments.botMessageId, botMessageId)))
    .limit(1);
  return rows[0];
}

export async function lastRecurringForHousehold(db: Db, householdId: number): Promise<RecurringPayment | undefined> {
  const rows = await db
    .select()
    .from(recurringPayments)
    .where(and(eq(recurringPayments.householdId, householdId), eq(recurringPayments.active, true)))
    .orderBy(desc(recurringPayments.createdAt))
    .limit(1);
  return rows[0];
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/** Finds the item whose name best matches a free-text mention. */
export function matchByName<T>(list: T[], nameOf: (item: T) => string, query: string | null | undefined): T | undefined {
  if (!query) return undefined;
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const exact = list.find((p) => nameOf(p).toLowerCase() === q);
  if (exact) return exact;
  const contains = list.find((p) => q.includes(nameOf(p).toLowerCase()) || nameOf(p).toLowerCase().includes(q));
  if (contains) return contains;
  const qTokens = new Set(tokens(q));
  let best: { item: T; score: number } | undefined;
  for (const p of list) {
    const score = tokens(nameOf(p)).filter((t) => qTokens.has(t) || [...qTokens].some((x) => x.startsWith(t) || t.startsWith(x))).length;
    if (score > 0 && (!best || score > best.score)) best = { item: p, score };
  }
  return best?.item;
}

/** Finds the recurring payment whose name best matches a free-text mention. */
export function matchRecurringByName(list: RecurringPayment[], query: string | null | undefined): RecurringPayment | undefined {
  return matchByName(list, (p) => p.name, query);
}

export interface NextDue {
  date: string;
  period: string;
  paid: boolean;
}

export function nextDue(payment: RecurringPayment, tz: string, fromDate = todayISO(tz)): NextDue {
  let date = nextDueDate(payment.dayOfMonth, fromDate);
  let period = date.slice(0, 7);
  if (payment.lastPaidPeriod === period) {
    const next = DateTime.fromISO(date, { zone: "utc" }).plus({ months: 1 });
    date = nextDueDate(payment.dayOfMonth, next.startOf("month").toISODate()!);
    period = date.slice(0, 7);
  }
  return { date, period, paid: payment.lastPaidPeriod === period };
}

/** Creates the "upcoming" and "due today" reminders for the next unpaid period. Idempotent. */
export async function ensureRemindersFor(db: Db, payment: RecurringPayment, household: Household, now = new Date()): Promise<void> {
  const tz = household.timezone;
  const due = nextDue(payment, tz);
  if (due.paid) return;
  const daysBefore = payment.remindDaysBefore ?? household.remindDaysBefore;
  const hour = household.reminderHour;
  const dueAtDay = atLocalTime(due.date, hour, tz);
  const upcomingAt = DateTime.fromJSDate(dueAtDay).minus({ days: daysBefore }).toJSDate();
  const base = {
    householdId: household.id,
    userId: payment.userId,
    title: payment.name,
    recurringPaymentId: payment.id,
    period: due.period,
    sourceChatId: household.telegramChatId,
  };
  if (daysBefore > 0 && dueAtDay.getTime() > now.getTime()) {
    await createReminderIfMissing(db, {
      ...base,
      kind: "payment_upcoming",
      dueAt: upcomingAt.getTime() > now.getTime() ? upcomingAt : now,
    });
  }
  await createReminderIfMissing(db, {
    ...base,
    kind: "payment_due",
    dueAt: dueAtDay.getTime() > now.getTime() ? dueAtDay : now,
  });
}

export async function markPaid(db: Db, payment: RecurringPayment, period: string): Promise<RecurringPayment | undefined> {
  await cancelRemindersForPeriod(db, payment.id, period);
  return updateRecurring(db, payment.id, { lastPaidPeriod: period });
}

export interface UpcomingPayment {
  payment: RecurringPayment;
  date: string;
  period: string;
  daysLeft: number;
}

export function upcomingPayments(list: RecurringPayment[], tz: string, withinDays = 14): UpcomingPayment[] {
  const today = todayISO(tz);
  const result: UpcomingPayment[] = [];
  for (const payment of list) {
    const due = nextDue(payment, tz, today);
    const daysLeft = Math.round(DateTime.fromISO(due.date).diff(DateTime.fromISO(today), "days").days);
    if (daysLeft <= withinDays) result.push({ payment, date: due.date, period: due.period, daysLeft });
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft);
}
