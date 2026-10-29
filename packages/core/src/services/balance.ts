import { and, asc, desc, eq, gt, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import { alerts, balances, transactions, type Alert, type Balance, type Household, type NewBalance, type Transaction } from "../db/schema.js";
import { TOTAL_BUDGET } from "../categories.js";
import { currentMonthKey, todayISO } from "../dates.js";
import { convert, roundMoney, type RateTable } from "../money.js";
import { listTransactionsForMonth } from "./transactions.js";
import { computeOutlook, listBudgets, type BudgetStat } from "./planning.js";
import { getRates } from "./rates.js";
import { loadCategoryLookup } from "./categories.js";

// ---------- balance checkpoints ----------

export interface BalanceInfo {
  checkpoint: Balance;
  /** The checkpoint amount in the base currency; null when there is no exchange rate for it. */
  start: number | null;
  /** Income and expenses counted since the checkpoint, in the base currency. */
  income: number;
  expense: number;
  /** start + income − expense; null when the checkpoint cannot be converted. */
  current: number | null;
  currency: string;
}

export async function createBalance(db: Db, input: NewBalance): Promise<Balance> {
  const rows = await db.insert(balances).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert balance");
  return row;
}

export async function getBalance(db: Db, id: number): Promise<Balance | undefined> {
  const rows = await db.select().from(balances).where(eq(balances.id, id)).limit(1);
  return rows[0];
}

export async function updateBalance(db: Db, id: number, patch: Partial<Balance>): Promise<Balance | undefined> {
  const rows = await db
    .update(balances)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(balances.id, id))
    .returning();
  return rows[0];
}

/** Removes a checkpoint; the one before it (if any) becomes current again. */
export async function deleteBalance(db: Db, id: number): Promise<boolean> {
  const rows = await db.delete(balances).where(eq(balances.id, id)).returning({ id: balances.id });
  return rows.length > 0;
}

export async function latestBalance(db: Db, householdId: number): Promise<Balance | undefined> {
  const rows = await db
    .select()
    .from(balances)
    .where(eq(balances.householdId, householdId))
    .orderBy(desc(balances.createdAt), desc(balances.id))
    .limit(1);
  return rows[0];
}

export async function findBalanceByBotMessage(db: Db, chatId: number, botMessageId: number): Promise<Balance | undefined> {
  const rows = await db
    .select()
    .from(balances)
    .where(and(eq(balances.sourceChatId, chatId), eq(balances.botMessageId, botMessageId)))
    .limit(1);
  return rows[0];
}

/**
 * Confirmed records that move the balance after a checkpoint: recorded after it AND dated on or after its day,
 * so a backfilled "yesterday's taxi" does not count against money that was counted already.
 */
export async function listTransactionsSince(db: Db, householdId: number, checkpoint: Pick<Balance, "createdAt" | "asOf">): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.status, "confirmed"),
        gt(transactions.createdAt, checkpoint.createdAt),
        gte(transactions.occurredOn, checkpoint.asOf),
      ),
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id));
}

function inBase(tx: Transaction, currency: string, rates: RateTable): number | null {
  if (tx.amountBase !== null && tx.amountBase !== undefined && tx.baseCurrency === currency) return tx.amountBase;
  return convert(tx.amount, tx.currency, currency, rates);
}

export function computeBalance(checkpoint: Balance, since: Transaction[], currency: string, rates: RateTable): BalanceInfo {
  const start = convert(checkpoint.amount, checkpoint.currency, currency, rates);
  let income = 0;
  let expense = 0;
  for (const tx of since) {
    const amt = inBase(tx, currency, rates) ?? 0;
    if (tx.kind === "income") income += amt;
    else expense += amt;
  }
  income = roundMoney(income);
  expense = roundMoney(expense);
  return { checkpoint, start, income, expense, current: start === null ? null : roundMoney(start + income - expense), currency };
}

/** The money on hand by the records, or null when the family never told the bot how much they have. */
export async function loadBalance(db: Db, household: Household, rates?: RateTable): Promise<BalanceInfo | null> {
  const checkpoint = await latestBalance(db, household.id);
  if (!checkpoint) return null;
  const [since, table] = await Promise.all([listTransactionsSince(db, household.id, checkpoint), rates ? { rates } : getRates(db)]);
  return computeBalance(checkpoint, since, household.baseCurrency, table.rates);
}

/** Records a new checkpoint, remembering what the records expected at that moment. */
export async function setBalance(
  db: Db,
  household: Household,
  input: { amount: number; currency: string; userId?: number | null; sourceChatId?: number | null; sourceMessageId?: number | null },
): Promise<{ balance: Balance; previous: BalanceInfo | null }> {
  const previous = await loadBalance(db, household);
  const balance = await createBalance(db, {
    householdId: household.id,
    userId: input.userId ?? null,
    amount: input.amount,
    currency: input.currency,
    asOf: todayISO(household.timezone),
    expected: previous?.current ?? null,
    sourceChatId: input.sourceChatId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
  });
  return { balance, previous };
}

// ---------- threshold alerts ----------

export const BALANCE_SCOPE = "balance";

export async function setAlert(db: Db, householdId: number, scope: string, amount: number, currency: string, userId: number | null = null): Promise<Alert> {
  const rows = await db
    .insert(alerts)
    .values({ householdId, userId, scope, amount, currency, armed: true })
    .onConflictDoUpdate({ target: [alerts.householdId, alerts.scope], set: { amount, currency, armed: true, userId, updatedAt: new Date() } })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to save alert");
  return row;
}

export async function removeAlert(db: Db, householdId: number, scope: string): Promise<boolean> {
  const rows = await db.delete(alerts).where(and(eq(alerts.householdId, householdId), eq(alerts.scope, scope))).returning({ scope: alerts.scope });
  return rows.length > 0;
}

export async function listAlerts(db: Db, householdId: number): Promise<Alert[]> {
  return db.select().from(alerts).where(eq(alerts.householdId, householdId)).orderBy(asc(alerts.scope));
}

/** Households that have at least one alert, for the scheduler. */
export async function listHouseholdsWithAlerts(db: Db): Promise<number[]> {
  const rows = await db.selectDistinct({ householdId: alerts.householdId }).from(alerts);
  return rows.map((r) => r.householdId);
}

export interface AlertEvent {
  alert: Alert;
  /** Threshold in the base currency. */
  threshold: number;
  /** The watched value right now (balance, or what is left of the limit), base currency. */
  value: number;
  /** The monthly limit, for category alerts. */
  limit?: number;
}

/**
 * Checks every alert of a household: an armed alert whose value fell below the threshold fires (and disarms);
 * a disarmed one re-arms silently once the value is back above. Returns the alerts that fired.
 */
export async function evaluateAlerts(db: Db, household: Household): Promise<AlertEvent[]> {
  const list = await listAlerts(db, household.id);
  if (!list.length) return [];
  const currency = household.baseCurrency;
  const { rates } = await getRates(db);
  const needBalance = list.some((a) => a.scope === BALANCE_SCOPE);
  const needBudgets = list.some((a) => a.scope !== BALANCE_SCOPE);
  const balance = needBalance ? await loadBalance(db, household, rates) : null;
  let budgets: BudgetStat[] = [];
  if (needBudgets) {
    const month = currentMonthKey(household.timezone);
    const [rows, monthTransactions, categories] = await Promise.all([listBudgets(db, household.id), listTransactionsForMonth(db, household.id, month), loadCategoryLookup(db, household.id)]);
    budgets = computeOutlook({
      month,
      currency,
      now: DateTime.fromISO("1970-01-01", { zone: household.timezone }),
      income: 0,
      expense: 0,
      transactions: monthTransactions,
      recurring: [],
      openPlans: [],
      budgets: rows,
      goals: [],
      goalTransactions: [],
      rates,
      categories,
    }).budgets;
  }
  const fired: AlertEvent[] = [];
  for (const alert of list) {
    const threshold = convert(alert.amount, alert.currency, currency, rates);
    if (threshold === null) continue;
    let value: number | null = null;
    let limit: number | undefined;
    if (alert.scope === BALANCE_SCOPE) {
      value = balance?.current ?? null;
    } else {
      const stat = budgets.find((b) => b.category === alert.scope || (alert.scope === TOTAL_BUDGET && b.category === TOTAL_BUDGET));
      if (stat) {
        value = stat.remaining;
        limit = stat.limit;
      }
    }
    if (value === null) continue;
    if (alert.armed && value < threshold) {
      await db.update(alerts).set({ armed: false, updatedAt: new Date() }).where(and(eq(alerts.householdId, household.id), eq(alerts.scope, alert.scope)));
      fired.push({ alert, threshold, value, ...(limit !== undefined ? { limit } : {}) });
    } else if (!alert.armed && value >= threshold) {
      await db.update(alerts).set({ armed: true, updatedAt: new Date() }).where(and(eq(alerts.householdId, household.id), eq(alerts.scope, alert.scope)));
    }
  }
  return fired;
}
