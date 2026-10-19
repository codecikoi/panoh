import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import {
  budgets,
  goals,
  plans,
  reminders,
  transactions,
  type Budget,
  type Goal,
  type Household,
  type NewGoal,
  type NewPlan,
  type Plan,
  type RecurringPayment,
  type Reminder,
  type Transaction,
} from "../db/schema.js";
import { CATEGORY_EMOJI, type Category } from "../categories.js";
import { clampDay, daysInMonth, monthDateRange } from "../dates.js";
import { convert, roundMoney, type RateTable } from "../money.js";
import { createReminder, updateReminder } from "./reminders.js";
import { listTransactionsForMonth } from "./transactions.js";
import { getRates } from "./rates.js";

// ---------- plans ----------

export async function createPlan(db: Db, input: NewPlan): Promise<Plan> {
  const rows = await db.insert(plans).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert plan");
  return row;
}

export async function getPlan(db: Db, id: number): Promise<Plan | undefined> {
  const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0];
}

export async function updatePlan(db: Db, id: number, patch: Partial<Plan>): Promise<Plan | undefined> {
  const rows = await db
    .update(plans)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(plans.id, id))
    .returning();
  return rows[0];
}

export async function listOpenPlans(db: Db, householdId: number): Promise<Plan[]> {
  return db
    .select()
    .from(plans)
    .where(and(eq(plans.householdId, householdId), eq(plans.status, "planned")))
    .orderBy(asc(plans.plannedOn), asc(plans.id));
}

export async function findPlanByBotMessage(db: Db, chatId: number, botMessageId: number): Promise<Plan | undefined> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.sourceChatId, chatId), eq(plans.botMessageId, botMessageId)))
    .limit(1);
  return rows[0];
}

export async function lastPlanForHousehold(db: Db, householdId: number): Promise<Plan | undefined> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.householdId, householdId), eq(plans.status, "planned")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return rows[0];
}

export async function getPlanReminder(db: Db, planId: number): Promise<Reminder | undefined> {
  const rows = await db.select().from(reminders).where(eq(reminders.planId, planId)).limit(1);
  return rows[0];
}

async function closePlanReminder(db: Db, planId: number): Promise<void> {
  await db
    .update(reminders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(reminders.planId, planId), inArray(reminders.status, ["scheduled", "sent"])));
}

/**
 * Creates or moves the "planned expense is due" reminder: on the planned date at the given local time,
 * or at the household default hour. Nothing is scheduled when that moment has already passed.
 */
export async function schedulePlanReminder(
  db: Db,
  plan: Plan,
  household: Household,
  time: { hour: number; minute: number } | null = null,
  now = new Date(),
): Promise<Reminder | undefined> {
  const dueAt = DateTime.fromISO(plan.plannedOn, { zone: household.timezone })
    .set({ hour: time?.hour ?? household.reminderHour, minute: time?.minute ?? 0, second: 0, millisecond: 0 })
    .toJSDate();
  const existing = await getPlanReminder(db, plan.id);
  if (dueAt.getTime() <= now.getTime() + 60_000) {
    if (existing && existing.status === "scheduled") await updateReminder(db, existing.id, { status: "cancelled" });
    return undefined;
  }
  const values = { title: plan.title, dueAt, defaultTime: time === null, status: "scheduled" as const };
  if (existing) return updateReminder(db, existing.id, values);
  return createReminder(db, {
    householdId: plan.householdId,
    userId: plan.userId,
    kind: "plan_due",
    planId: plan.id,
    sourceChatId: plan.sourceChatId ?? household.telegramChatId,
    ...values,
  });
}

export async function completePlan(db: Db, planId: number): Promise<Plan | undefined> {
  await closePlanReminder(db, planId);
  return updatePlan(db, planId, { status: "done" });
}

export async function cancelPlan(db: Db, planId: number): Promise<Plan | undefined> {
  await closePlanReminder(db, planId);
  return updatePlan(db, planId, { status: "cancelled" });
}

// ---------- budgets ----------

export async function setBudget(db: Db, householdId: number, category: string, amount: number, currency: string): Promise<Budget> {
  const rows = await db
    .insert(budgets)
    .values({ householdId, category, amount, currency })
    .onConflictDoUpdate({ target: [budgets.householdId, budgets.category], set: { amount, currency, updatedAt: new Date() } })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to save budget");
  return row;
}

export async function removeBudget(db: Db, householdId: number, category: string): Promise<boolean> {
  const rows = await db
    .delete(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.category, category)))
    .returning({ category: budgets.category });
  return rows.length > 0;
}

export async function listBudgets(db: Db, householdId: number): Promise<Budget[]> {
  return db.select().from(budgets).where(eq(budgets.householdId, householdId)).orderBy(asc(budgets.category));
}

// ---------- goals ----------

export async function createGoal(db: Db, input: NewGoal): Promise<Goal> {
  const rows = await db.insert(goals).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert goal");
  return row;
}

export async function getGoal(db: Db, id: number): Promise<Goal | undefined> {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return rows[0];
}

export async function updateGoal(db: Db, id: number, patch: Partial<Goal>): Promise<Goal | undefined> {
  const rows = await db
    .update(goals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(goals.id, id))
    .returning();
  return rows[0];
}

export async function listActiveGoals(db: Db, householdId: number): Promise<Goal[]> {
  return db
    .select()
    .from(goals)
    .where(and(eq(goals.householdId, householdId), eq(goals.status, "active")))
    .orderBy(asc(goals.createdAt));
}

export async function findGoalByBotMessage(db: Db, chatId: number, botMessageId: number): Promise<Goal | undefined> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.sourceChatId, chatId), eq(goals.botMessageId, botMessageId)))
    .limit(1);
  return rows[0];
}

export async function lastGoalForHousehold(db: Db, householdId: number): Promise<Goal | undefined> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.householdId, householdId), eq(goals.status, "active")))
    .orderBy(desc(goals.createdAt))
    .limit(1);
  return rows[0];
}

/** Confirmed contributions (savings expenses) to the given goals, any month. */
export async function listGoalTransactions(db: Db, householdId: number): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.goalId), eq(transactions.status, "confirmed")));
}

// ---------- month outlook ----------

export interface BudgetStat {
  category: string;
  emoji: string;
  limit: number;
  spent: number;
  pct: number;
  remaining: number;
}

export interface GoalStat {
  id: number;
  title: string;
  currency: string;
  target: number;
  saved: number;
  pct: number;
  deadline: string | null;
  monthsLeft: number | null;
  /** Even monthly contribution needed to reach the target by the deadline (null without a deadline). */
  monthlyNeed: number | null;
  contributedThisMonth: number;
  /** Part of monthlyNeed not yet put aside this month. */
  remainingThisMonth: number;
}

export interface PlannedItem {
  id: number;
  title: string;
  /** In the household base currency; null when there is no exchange rate. */
  amount: number | null;
  originalAmount: number;
  currency: string;
  category: string;
  date: string;
  approximate: boolean;
  overdue: boolean;
}

export interface PaymentDue {
  id: number;
  name: string;
  amount: number | null;
  date: string;
  overdue: boolean;
}

export interface Forecast {
  payments: number;
  plans: number;
  goals: number;
  /** Everything still to be paid or put aside this month. */
  ahead: number;
  /** Income received − spent − ahead. Negative means a shortfall. Future income is not counted. */
  free: number;
  daysLeft: number;
  /** How much can be spent per day for the rest of the month (null when nothing is free). */
  perDay: number | null;
}

export interface MonthOutlook {
  budgets: BudgetStat[];
  goals: GoalStat[];
  plans: PlannedItem[];
  payments: PaymentDue[];
  forecast: Forecast | null;
}

export const EMPTY_OUTLOOK: MonthOutlook = { budgets: [], goals: [], plans: [], payments: [], forecast: null };

export interface OutlookInput {
  month: string;
  currency: string;
  /** Current moment in the household timezone. */
  now: DateTime;
  income: number;
  expense: number;
  /** Confirmed transactions of the month. */
  transactions: Transaction[];
  recurring: RecurringPayment[];
  openPlans: Plan[];
  budgets: Budget[];
  goals: Goal[];
  goalTransactions: Transaction[];
  rates: RateTable;
}

function inBase(tx: Transaction, currency: string, rates: RateTable): number | null {
  if (tx.amountBase !== null && tx.amountBase !== undefined && tx.baseCurrency === currency) return tx.amountBase;
  return convert(tx.amount, tx.currency, currency, rates);
}

function monthIndex(isoDate: string): number {
  const dt = DateTime.fromISO(isoDate, { zone: "utc" });
  return dt.year * 12 + dt.month;
}

export function computeOutlook(input: OutlookInput): MonthOutlook {
  const { month, currency, now, rates } = input;
  const isCurrentMonth = month === now.toFormat("yyyy-LL");
  const today = now.toISODate()!;
  const monthEnd = monthDateRange(month).end;

  const budgetStats: BudgetStat[] = [];
  for (const b of input.budgets) {
    const limit = convert(b.amount, b.currency, currency, rates);
    if (limit === null || limit <= 0) continue;
    let spent = 0;
    for (const tx of input.transactions) {
      if (tx.kind !== "expense" || tx.category !== b.category) continue;
      spent += inBase(tx, currency, rates) ?? 0;
    }
    budgetStats.push({
      category: b.category,
      emoji: CATEGORY_EMOJI[b.category as Category] ?? "📦",
      limit: roundMoney(limit),
      spent: roundMoney(spent),
      pct: Math.round((spent / limit) * 100),
      remaining: roundMoney(limit - spent),
    });
  }
  budgetStats.sort((a, b) => b.pct - a.pct);

  if (!isCurrentMonth) return { ...EMPTY_OUTLOOK, budgets: budgetStats };

  const goalStats: GoalStat[] = input.goals.map((g) => {
    let saved = 0;
    let thisMonth = 0;
    for (const tx of input.goalTransactions) {
      if (tx.goalId !== g.id) continue;
      const amt = tx.currency === g.currency ? tx.amount : (convert(tx.amount, tx.currency, g.currency, rates) ?? 0);
      saved += amt;
      if (tx.occurredOn.startsWith(month)) thisMonth += amt;
    }
    let monthsLeft: number | null = null;
    let monthlyNeed: number | null = null;
    if (g.deadline) {
      monthsLeft = Math.max(1, monthIndex(g.deadline) - monthIndex(today) + 1);
      monthlyNeed = Math.ceil(Math.max(0, g.targetAmount - (saved - thisMonth)) / monthsLeft);
    }
    return {
      id: g.id,
      title: g.title,
      currency: g.currency,
      target: g.targetAmount,
      saved: roundMoney(saved),
      pct: g.targetAmount > 0 ? Math.min(100, Math.round((saved / g.targetAmount) * 100)) : 0,
      deadline: g.deadline,
      monthsLeft,
      monthlyNeed,
      contributedThisMonth: roundMoney(thisMonth),
      remainingThisMonth: monthlyNeed === null ? 0 : roundMoney(Math.max(0, monthlyNeed - thisMonth)),
    };
  });

  const payments: PaymentDue[] = [];
  for (const rp of input.recurring) {
    if (!rp.active || rp.amount === null || rp.lastPaidPeriod === month) continue;
    const [y, m] = month.split("-").map(Number) as [number, number];
    const date = `${month}-${String(clampDay(y, m, rp.dayOfMonth)).padStart(2, "0")}`;
    const createdOn = DateTime.fromJSDate(rp.createdAt).setZone(now.zone).toISODate()!;
    // A bill whose day had already passed when it was added was most likely paid before Madat knew about it.
    if (date < today && createdOn > date) continue;
    payments.push({ id: rp.id, name: rp.name, amount: convert(rp.amount, rp.currency, currency, rates), date, overdue: date < today });
  }
  payments.sort((a, b) => a.date.localeCompare(b.date));

  const planned: PlannedItem[] = input.openPlans
    .filter((p) => p.status === "planned" && p.plannedOn < monthEnd)
    .map((p) => ({
      id: p.id,
      title: p.title,
      amount: convert(p.amount, p.currency, currency, rates),
      originalAmount: p.amount,
      currency: p.currency,
      category: p.category,
      date: p.plannedOn,
      approximate: p.dateApproximate,
      overdue: p.plannedOn < today,
    }));

  const sum = (values: (number | null)[]) => roundMoney(values.reduce<number>((acc, v) => acc + (v ?? 0), 0));
  const paymentsTotal = sum(payments.map((p) => p.amount));
  const plansTotal = sum(planned.map((p) => p.amount));
  const goalsTotal = sum(goalStats.map((g) => (g.currency === currency ? g.remainingThisMonth : convert(g.remainingThisMonth, g.currency, currency, rates))));
  const ahead = roundMoney(paymentsTotal + plansTotal + goalsTotal);
  const free = roundMoney(input.income - input.expense - ahead);
  const daysLeft = Math.max(1, daysInMonth(month) - now.day + 1);

  return {
    budgets: budgetStats,
    goals: goalStats,
    plans: planned,
    payments,
    forecast: {
      payments: paymentsTotal,
      plans: plansTotal,
      goals: goalsTotal,
      ahead,
      free,
      daysLeft,
      perDay: free > 0 ? Math.floor(free / daysLeft) : null,
    },
  };
}

/** Sum of open plans dated within a month, in the base currency. */
export function plannedTotalForMonth(openPlans: Plan[], month: string, currency: string, rates: RateTable): number {
  let total = 0;
  for (const p of openPlans) {
    if (p.status !== "planned" || !p.plannedOn.startsWith(month)) continue;
    total += convert(p.amount, p.currency, currency, rates) ?? 0;
  }
  return roundMoney(total);
}

/** Limit usage of one category in a month, or undefined when the category has no limit. */
export async function loadBudgetStat(db: Db, household: Household, category: string, month: string): Promise<BudgetStat | undefined> {
  const rows = await listBudgets(db, household.id);
  const budget = rows.find((b) => b.category === category);
  if (!budget) return undefined;
  const [monthTransactions, { rates }] = await Promise.all([listTransactionsForMonth(db, household.id, month), getRates(db)]);
  const outlook = computeOutlook({
    month,
    currency: household.baseCurrency,
    // Any moment outside the month: only the budget part is needed.
    now: DateTime.fromISO("1970-01-01", { zone: household.timezone }),
    income: 0,
    expense: 0,
    transactions: monthTransactions,
    recurring: [],
    openPlans: [],
    budgets: [budget],
    goals: [],
    goalTransactions: [],
    rates,
  });
  return outlook.budgets[0];
}
