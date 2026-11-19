import type { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import {
  clampDay,
  currentMonthKey,
  getRates,
  listOpenPlans,
  listOpenReminders,
  listRecentTransactions,
  listRecurring,
  loadMonthlySummary,
  monthPeriod,
  nextDue,
  plannedTotalForMonth,
  todayISO,
  type Db,
  type ListTarget,
  type Period,
  type Plan,
} from "@madat/core";
import type { Scope } from "./context.js";
import * as R from "./render.js";

/** A list the bot sends: from a command (/reminders …) or when asked in words ("какие напоминания есть?"). */
export interface ListMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

/** Instants bounding a period of local days: from its first midnight to the midnight after its last day. */
function bounds(period: Period, tz: string): { from: Date; to: Date } {
  return {
    from: DateTime.fromISO(period.from, { zone: tz }).startOf("day").toJSDate(),
    to: DateTime.fromISO(period.to, { zone: tz }).plus({ days: 1 }).startOf("day").toJSDate(),
  };
}

/** Plans of a period; overdue ones count while the period reaches today (they are still to be paid). */
function plansIn(rows: Plan[], period: Period, today: string): Plan[] {
  return rows.filter((p) => (p.plannedOn >= period.from && p.plannedOn <= period.to) || (p.plannedOn < period.from && p.plannedOn < today && period.to >= today));
}

export async function remindersMessage(db: Db, scope: Scope, period?: Period | null): Promise<ListMessage> {
  const rows = await listOpenReminders(db, scope.household.id, 30, { kind: "reminder", ...(period ? bounds(period, scope.tz) : {}) });
  return { text: R.remindersListText(scope, rows, period), keyboard: R.remindersKeyboard(scope, rows) };
}

export async function paymentsMessage(db: Db, scope: Scope): Promise<ListMessage> {
  const list = await listRecurring(db, scope.household.id);
  const rows = list.map((payment) => ({ payment, ...nextDue(payment, scope.tz) }));
  return { text: R.paymentsListText(scope, rows) };
}

export async function plansMessage(db: Db, scope: Scope, period?: Period | null): Promise<ListMessage> {
  const all = await listOpenPlans(db, scope.household.id);
  const rows = period ? plansIn(all, period, todayISO(scope.tz)) : all;
  const { rates } = await getRates(db);
  const months = new Set(rows.map((p) => p.plannedOn.slice(0, 7)));
  const total = [...months].reduce((sum, m) => sum + plannedTotalForMonth(rows, m, scope.currency, rates), 0);
  return { text: R.plansListText(scope, rows, rows.length > 1 ? total : null, period) };
}

export async function budgetsMessage(db: Db, scope: Scope): Promise<ListMessage> {
  const stats = (await loadMonthlySummary(db, scope.household, currentMonthKey(scope.tz))).outlook.budgets;
  return { text: R.budgetsListText(scope, stats), keyboard: stats.length ? R.budgetsKeyboard(scope, stats) : undefined };
}

export async function goalsMessage(db: Db, scope: Scope): Promise<ListMessage> {
  const stats = (await loadMonthlySummary(db, scope.household, currentMonthKey(scope.tz))).outlook.goals;
  return { text: R.goalsListText(scope, stats) };
}

export async function recordsMessage(db: Db, scope: Scope): Promise<ListMessage> {
  return { text: R.lastRecordsText(scope, await listRecentTransactions(db, scope.household.id, 10)) };
}

/** Reminders, bills and planned expenses of a period (this month by default) in one message. */
export async function overviewMessage(db: Db, scope: Scope, period: Period = monthPeriod(currentMonthKey(scope.tz))): Promise<ListMessage> {
  const today = todayISO(scope.tz);
  const [reminders, recurring, plans] = await Promise.all([
    listOpenReminders(db, scope.household.id, 30, { kind: "reminder", ...bounds(period, scope.tz) }),
    listRecurring(db, scope.household.id),
    listOpenPlans(db, scope.household.id),
  ]);
  const payments: R.OverviewData["payments"] = [];
  let month = DateTime.fromISO(period.from, { zone: "utc" }).startOf("month");
  while (month.toISODate()! <= period.to) {
    for (const payment of recurring) {
      const date = month.set({ day: clampDay(month.year, month.month, payment.dayOfMonth) }).toISODate()!;
      if (date < period.from || date > period.to) continue;
      const key = date.slice(0, 7);
      payments.push({ payment, date, paid: payment.lastPaidPeriod !== null && payment.lastPaidPeriod >= key });
    }
    month = month.plus({ months: 1 });
  }
  payments.sort((a, b) => a.date.localeCompare(b.date));
  return { text: R.overviewText(scope, period, { reminders, payments, plans: plansIn(plans, period, today) }) };
}

export async function listMessage(db: Db, scope: Scope, target: ListTarget, period: Period | null): Promise<ListMessage> {
  switch (target) {
    case "reminders":
      return remindersMessage(db, scope, period);
    case "payments":
      return paymentsMessage(db, scope);
    case "plans":
      return plansMessage(db, scope, period);
    case "budgets":
      return budgetsMessage(db, scope);
    case "goals":
      return goalsMessage(db, scope);
    case "records":
      return recordsMessage(db, scope);
    case "overview":
      return overviewMessage(db, scope, period ?? undefined);
  }
}
