import type { Db } from "../db/client.js";
import type { Balance, Goal, Plan, RecurringPayment, Reminder, Transaction } from "../db/schema.js";
import { listRecentTransactions } from "./transactions.js";
import { lastReminderForHousehold } from "./reminders.js";
import { lastRecurringForHousehold } from "./recurring.js";
import { lastGoalForHousehold, lastPlanForHousehold } from "./planning.js";
import { latestBalance } from "./balance.js";

export type LastRecord =
  | { type: "transaction"; row: Transaction }
  | { type: "reminder"; row: Reminder }
  | { type: "recurring"; row: RecurringPayment }
  | { type: "plan"; row: Plan }
  | { type: "goal"; row: Goal }
  | { type: "balance"; row: Balance };

/** The most recently created live record of any kind in a household (a balance checkpoint counts as one). */
export async function findLastRecord(db: Db, householdId: number): Promise<LastRecord | undefined> {
  const [[tx], reminder, recurring, plan, goal, balance] = await Promise.all([
    listRecentTransactions(db, householdId, 1),
    lastReminderForHousehold(db, householdId),
    lastRecurringForHousehold(db, householdId),
    lastPlanForHousehold(db, householdId),
    lastGoalForHousehold(db, householdId),
    latestBalance(db, householdId),
  ]);
  const candidates: LastRecord[] = [];
  if (tx) candidates.push({ type: "transaction", row: tx });
  if (reminder) candidates.push({ type: "reminder", row: reminder });
  if (recurring) candidates.push({ type: "recurring", row: recurring });
  if (plan) candidates.push({ type: "plan", row: plan });
  if (goal) candidates.push({ type: "goal", row: goal });
  if (balance) candidates.push({ type: "balance", row: balance });
  candidates.sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime());
  return candidates[0];
}
