import type { Db } from "../db/client.js";
import type { RecurringPayment, Reminder, Transaction } from "../db/schema.js";
import { listRecentTransactions } from "./transactions.js";
import { lastReminderForHousehold } from "./reminders.js";
import { lastRecurringForHousehold } from "./recurring.js";

export type LastRecord =
  | { type: "transaction"; row: Transaction }
  | { type: "reminder"; row: Reminder }
  | { type: "recurring"; row: RecurringPayment };

/** The most recently created live record of any kind in a household. */
export async function findLastRecord(db: Db, householdId: number): Promise<LastRecord | undefined> {
  const [tx] = await listRecentTransactions(db, householdId, 1);
  const reminder = await lastReminderForHousehold(db, householdId);
  const recurring = await lastRecurringForHousehold(db, householdId);
  const candidates: LastRecord[] = [];
  if (tx) candidates.push({ type: "transaction", row: tx });
  if (reminder) candidates.push({ type: "reminder", row: reminder });
  if (recurring) candidates.push({ type: "recurring", row: recurring });
  candidates.sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime());
  return candidates[0];
}
