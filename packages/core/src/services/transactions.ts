import { and, asc, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { plans, transactions, type NewTransaction, type Transaction } from "../db/schema.js";
import { monthDateRange } from "../dates.js";

export async function createTransaction(db: Db, input: NewTransaction): Promise<Transaction> {
  const rows = await db.insert(transactions).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert transaction");
  return row;
}

export async function updateTransaction(db: Db, id: number, patch: Partial<Transaction>): Promise<Transaction | undefined> {
  const rows = await db
    .update(transactions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  return rows[0];
}

/** Marks a transaction deleted; a planned expense it paid goes back to the plan list. */
export async function softDeleteTransaction(db: Db, id: number): Promise<Transaction | undefined> {
  const row = await updateTransaction(db, id, { status: "deleted" });
  if (row?.planId) {
    await db
      .update(plans)
      .set({ status: "planned", updatedAt: new Date() })
      .where(and(eq(plans.id, row.planId), eq(plans.status, "done")));
  }
  return row;
}

export async function getTransaction(db: Db, id: number): Promise<Transaction | undefined> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0];
}

export async function findTransactionByBotMessage(db: Db, chatId: number, botMessageId: number): Promise<Transaction | undefined> {
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.sourceChatId, chatId), eq(transactions.botMessageId, botMessageId)))
    .limit(1);
  return rows[0];
}

export async function listTransactionsForMonth(
  db: Db,
  householdId: number,
  month: string,
  options: { includePending?: boolean } = {},
): Promise<Transaction[]> {
  const { start, end } = monthDateRange(month);
  const statusFilter = options.includePending ? ne(transactions.status, "deleted") : eq(transactions.status, "confirmed");
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
        statusFilter,
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.id));
}

/** Transactions dated from `from` to `to` inclusive (ISO dates), oldest first. */
export async function listTransactionsInRange(
  db: Db,
  householdId: number,
  from: string,
  to: string,
  options: { includePending?: boolean } = {},
): Promise<Transaction[]> {
  const statusFilter = options.includePending ? ne(transactions.status, "deleted") : eq(transactions.status, "confirmed");
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
        statusFilter,
      ),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id));
}

export async function listRecentTransactions(db: Db, householdId: number, limit = 10): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), ne(transactions.status, "deleted")))
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(limit);
}

export async function cleanupStalePending(db: Db, olderThan: Date): Promise<number> {
  const rows = await db
    .update(transactions)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(transactions.status, "pending"), lt(transactions.createdAt, olderThan)))
    .returning({ id: transactions.id });
  return rows.length;
}

export async function countTransactions(db: Db, householdId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), ne(transactions.status, "deleted")));
  return rows[0]?.count ?? 0;
}
