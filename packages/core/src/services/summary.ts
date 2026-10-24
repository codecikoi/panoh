import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import type { Household, Transaction } from "../db/schema.js";
import { CATEGORY_EMOJI, type Category } from "../categories.js";
import { currentMonthKey, daysInMonth, monthDateRange, nowIn, shiftMonthKey } from "../dates.js";
import { roundMoney } from "../money.js";
import { listTransactionsForMonth } from "./transactions.js";
import { countReminders, listOpenReminders } from "./reminders.js";
import { listRecurring, upcomingPayments } from "./recurring.js";
import { getRates } from "./rates.js";
import { EMPTY_OUTLOOK, computeOutlook, listActiveGoals, listBudgets, listGoalTransactions, listOpenPlans, type MonthOutlook } from "./planning.js";

export interface CategoryStat {
  category: string;
  emoji: string;
  amount: number;
  count: number;
  share: number;
  prevAmount: number;
  delta: number;
  deltaPct: number | null;
}

export interface BiggestSpend {
  note: string;
  amount: number;
  category: string;
  date: string;
}

export interface UpcomingPaymentInfo {
  name: string;
  amount: number | null;
  currency: string;
  date: string;
  daysLeft: number;
}

export interface MonthlySummary {
  month: string;
  prevMonth: string;
  currency: string;
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  income: number;
  expense: number;
  net: number;
  prevIncome: number;
  prevExpense: number;
  hasPrev: boolean;
  expenseDeltaPct: number | null;
  incomeDeltaPct: number | null;
  categories: CategoryStat[];
  incomeCategories: CategoryStat[];
  topGrowth: CategoryStat | null;
  topDrop: CategoryStat | null;
  biggest: BiggestSpend[];
  recordCount: number;
  pendingCount: number;
  unconverted: { currency: string; amount: number }[];
  avgPerDay: number;
  projected: number | null;
  upcomingPayments: UpcomingPaymentInfo[];
  openReminders: number;
  doneReminders: number;
  /** Limits, savings goals, planned expenses and the "free money" forecast (forecast only for the current month). */
  outlook: MonthOutlook;
}

export interface SummaryInput {
  month: string;
  currency: string;
  now: DateTime;
  transactions: Transaction[];
  prevTransactions: Transaction[];
  pendingCount?: number;
  upcomingPayments?: UpcomingPaymentInfo[];
  openReminders?: number;
  doneReminders?: number;
  outlook?: MonthOutlook;
}

function baseAmount(tx: Transaction, currency: string): number | null {
  if (tx.amountBase !== null && tx.amountBase !== undefined && tx.baseCurrency === currency) return tx.amountBase;
  if (tx.currency === currency) return tx.amount;
  return null;
}

export function pct(current: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

export function buildCategoryStats(
  current: Transaction[],
  prev: Transaction[],
  kind: "expense" | "income",
  currency: string,
): { stats: CategoryStat[]; total: number; prevTotal: number; unconverted: Map<string, number> } {
  const sums = new Map<string, { amount: number; count: number }>();
  const prevSums = new Map<string, number>();
  const unconverted = new Map<string, number>();
  let total = 0;
  let prevTotal = 0;
  for (const tx of current) {
    if (tx.kind !== kind) continue;
    const amt = baseAmount(tx, currency);
    if (amt === null) {
      unconverted.set(tx.currency, (unconverted.get(tx.currency) ?? 0) + tx.amount);
      continue;
    }
    total += amt;
    const entry = sums.get(tx.category) ?? { amount: 0, count: 0 };
    entry.amount += amt;
    entry.count += 1;
    sums.set(tx.category, entry);
  }
  for (const tx of prev) {
    if (tx.kind !== kind) continue;
    const amt = baseAmount(tx, currency);
    if (amt === null) continue;
    prevTotal += amt;
    prevSums.set(tx.category, (prevSums.get(tx.category) ?? 0) + amt);
  }
  const categories = new Set([...sums.keys(), ...prevSums.keys()]);
  const stats: CategoryStat[] = [];
  for (const category of categories) {
    const entry = sums.get(category) ?? { amount: 0, count: 0 };
    const prevAmount = prevSums.get(category) ?? 0;
    stats.push({
      category,
      emoji: CATEGORY_EMOJI[category as Category] ?? "📦",
      amount: roundMoney(entry.amount),
      count: entry.count,
      share: total > 0 ? Math.round((entry.amount / total) * 100) : 0,
      prevAmount: roundMoney(prevAmount),
      delta: roundMoney(entry.amount - prevAmount),
      deltaPct: pct(entry.amount, prevAmount),
    });
  }
  stats.sort((a, b) => b.amount - a.amount);
  return { stats, total: roundMoney(total), prevTotal: roundMoney(prevTotal), unconverted };
}

export function computeSummary(input: SummaryInput): MonthlySummary {
  const { month, currency, now } = input;
  const prevMonth = shiftMonthKey(month, -1);
  const isCurrentMonth = month === now.toFormat("yyyy-LL");
  const dim = daysInMonth(month);
  const daysElapsed = isCurrentMonth ? Math.max(1, now.day) : dim;

  const expenses = buildCategoryStats(input.transactions, input.prevTransactions, "expense", currency);
  const incomes = buildCategoryStats(input.transactions, input.prevTransactions, "income", currency);

  const unconverted = new Map<string, number>();
  for (const [cur, amt] of [...expenses.unconverted, ...incomes.unconverted]) {
    unconverted.set(cur, (unconverted.get(cur) ?? 0) + amt);
  }

  const visibleCategories = expenses.stats.filter((s) => s.amount > 0);
  const grew = expenses.stats.filter((s) => s.prevAmount > 0 && s.delta > 0).sort((a, b) => b.delta - a.delta);
  const dropped = expenses.stats.filter((s) => s.prevAmount > 0 && s.delta < 0).sort((a, b) => a.delta - b.delta);

  const biggest = input.transactions
    .filter((tx) => tx.kind === "expense")
    .map((tx) => ({ tx, amt: baseAmount(tx, currency) }))
    .filter((x): x is { tx: Transaction; amt: number } => x.amt !== null)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 3)
    .map(({ tx, amt }) => ({ note: tx.note || tx.category, amount: amt, category: tx.category, date: tx.occurredOn }));

  const avgPerDay = roundMoney(expenses.total / daysElapsed);
  const hasPrev = input.prevTransactions.length > 0;

  return {
    month,
    prevMonth,
    currency,
    isCurrentMonth,
    daysElapsed,
    daysInMonth: dim,
    income: incomes.total,
    expense: expenses.total,
    net: roundMoney(incomes.total - expenses.total),
    prevIncome: incomes.prevTotal,
    prevExpense: expenses.prevTotal,
    hasPrev,
    expenseDeltaPct: hasPrev ? pct(expenses.total, expenses.prevTotal) : null,
    incomeDeltaPct: hasPrev ? pct(incomes.total, incomes.prevTotal) : null,
    categories: visibleCategories,
    incomeCategories: incomes.stats.filter((s) => s.amount > 0),
    topGrowth: grew[0] ?? null,
    topDrop: dropped[0] ?? null,
    biggest,
    recordCount: input.transactions.length,
    pendingCount: input.pendingCount ?? 0,
    unconverted: [...unconverted.entries()].map(([cur, amount]) => ({ currency: cur, amount: roundMoney(amount) })),
    avgPerDay,
    projected: isCurrentMonth ? roundMoney(avgPerDay * dim) : null,
    upcomingPayments: input.upcomingPayments ?? [],
    openReminders: input.openReminders ?? 0,
    doneReminders: input.doneReminders ?? 0,
    outlook: input.outlook ?? EMPTY_OUTLOOK,
  };
}

export async function loadMonthlySummary(db: Db, household: Household, month = currentMonthKey(household.timezone)): Promise<MonthlySummary> {
  const prevMonth = shiftMonthKey(month, -1);
  const [transactions, withPending, prevTransactions, recurring, open] = await Promise.all([
    listTransactionsForMonth(db, household.id, month),
    listTransactionsForMonth(db, household.id, month, { includePending: true }),
    listTransactionsForMonth(db, household.id, prevMonth),
    listRecurring(db, household.id),
    listOpenReminders(db, household.id, 100),
  ]);
  const range = monthDateRange(month);
  const from = DateTime.fromISO(range.start, { zone: household.timezone }).toJSDate();
  const to = DateTime.fromISO(range.end, { zone: household.timezone }).toJSDate();
  const doneReminders = await countReminders(db, household.id, ["done"], { from, to });
  const upcoming = upcomingPayments(recurring, household.timezone, 14).map((u) => ({
    name: u.payment.name,
    amount: u.payment.amount,
    currency: u.payment.currency,
    date: u.date,
    daysLeft: u.daysLeft,
  }));
  const now = nowIn(household.timezone);
  const summary = computeSummary({
    month,
    currency: household.baseCurrency,
    now,
    transactions,
    prevTransactions,
    pendingCount: withPending.length - transactions.length,
    upcomingPayments: upcoming,
    openReminders: open.filter((r) => r.kind === "reminder").length,
    doneReminders,
  });
  const [{ rates }, openPlans, budgetRows, goalRows, goalTransactions] = await Promise.all([
    getRates(db),
    listOpenPlans(db, household.id),
    listBudgets(db, household.id),
    listActiveGoals(db, household.id),
    listGoalTransactions(db, household.id),
  ]);
  summary.outlook = computeOutlook({
    month,
    currency: household.baseCurrency,
    now,
    income: summary.income,
    expense: summary.expense,
    transactions,
    recurring,
    openPlans,
    budgets: budgetRows,
    goals: goalRows,
    goalTransactions,
    rates,
  });
  return summary;
}
