import type { Db } from "../db/client.js";
import type { Household, Transaction } from "../db/schema.js";
import type { Insights } from "../ai/insights.js";
import { periodDays, previousPeriod, type Period } from "../period.js";
import { roundMoney } from "../money.js";
import { buildCategoryStats, loadMonthlySummary, pct, type BiggestSpend, type CategoryStat } from "./summary.js";
import { listTransactionsInRange } from "./transactions.js";
import { getInsights } from "./insights.js";
import type { MonthOutlook } from "./planning.js";
import type { BalanceSummary } from "./summary.js";

export interface ReportData {
  period: Period;
  prevPeriod: Period;
  currency: string;
  income: number;
  expense: number;
  net: number;
  prevIncome: number;
  prevExpense: number;
  hasPrev: boolean;
  expenseDeltaPct: number | null;
  incomeDeltaPct: number | null;
  avgPerDay: number;
  categories: CategoryStat[];
  incomeCategories: CategoryStat[];
  biggest: BiggestSpend[];
  unconverted: { currency: string; amount: number }[];
  /** Every confirmed record of the period, oldest first. */
  transactions: Transaction[];
  /** Limits, goals, plans, the money on hand and insights: only for a calendar-month report. */
  month: { outlook: MonthOutlook; insights: Insights | null; balance: BalanceSummary | null } | null;
}

/** Changes whenever a record of the period is added, edited or deleted, so a cached PDF can be reused until then. */
export function reportFingerprint(rows: Transaction[]): string {
  const latest = rows.reduce((max, tx) => Math.max(max, tx.updatedAt.getTime()), 0);
  return `${rows.length}:${latest}`;
}

export async function loadReport(db: Db, household: Household, period: Period, options: { insights?: boolean } = {}): Promise<ReportData> {
  const currency = household.baseCurrency;
  const prevPeriod = previousPeriod(period);
  const [rows, prevRows] = await Promise.all([
    listTransactionsInRange(db, household.id, period.from, period.to),
    listTransactionsInRange(db, household.id, prevPeriod.from, prevPeriod.to),
  ]);
  const expenses = buildCategoryStats(rows, prevRows, "expense", currency);
  const incomes = buildCategoryStats(rows, prevRows, "income", currency);
  const unconverted = new Map<string, number>();
  for (const [cur, amt] of [...expenses.unconverted, ...incomes.unconverted]) unconverted.set(cur, (unconverted.get(cur) ?? 0) + amt);

  const biggest = rows
    .filter((tx) => tx.kind === "expense")
    .map((tx) => ({ tx, amt: tx.baseCurrency === currency && tx.amountBase !== null ? tx.amountBase : tx.currency === currency ? tx.amount : null }))
    .filter((x): x is { tx: Transaction; amt: number } => x.amt !== null)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 3)
    .map(({ tx, amt }) => ({ note: tx.note || tx.category, amount: amt, category: tx.category, date: tx.occurredOn }));

  let month: ReportData["month"] = null;
  if (period.kind === "month") {
    const summary = await loadMonthlySummary(db, household, period.from.slice(0, 7));
    const insights = options.insights === false || summary.recordCount === 0 ? null : await getInsights(db, household, summary);
    month = { outlook: summary.outlook, insights, balance: summary.balance };
  }

  const hasPrev = prevRows.length > 0;
  return {
    period,
    prevPeriod,
    currency,
    income: incomes.total,
    expense: expenses.total,
    net: roundMoney(incomes.total - expenses.total),
    prevIncome: incomes.prevTotal,
    prevExpense: expenses.prevTotal,
    hasPrev,
    expenseDeltaPct: hasPrev ? pct(expenses.total, expenses.prevTotal) : null,
    incomeDeltaPct: hasPrev ? pct(incomes.total, incomes.prevTotal) : null,
    avgPerDay: roundMoney(expenses.total / periodDays(period)),
    categories: expenses.stats.filter((s) => s.amount > 0),
    incomeCategories: incomes.stats.filter((s) => s.amount > 0),
    biggest,
    unconverted: [...unconverted.entries()].map(([cur, amount]) => ({ currency: cur, amount: roundMoney(amount) })),
    transactions: rows,
    month,
  };
}
