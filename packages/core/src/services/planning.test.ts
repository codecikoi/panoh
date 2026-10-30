import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { createTestDb, type DbHandle } from "../db/client.js";
import type { Budget, Goal, Plan, RecurringPayment, Transaction } from "../db/schema.js";
import { getOrCreateHousehold, updateHousehold } from "./households.js";
import { createTransaction, softDeleteTransaction } from "./transactions.js";
import { getReminder, rescheduleDefaultHour } from "./reminders.js";
import {
  cancelPlan,
  completePlan,
  computeOutlook,
  createPlan,
  getPlan,
  getPlanReminder,
  listBudgets,
  loadBudgetStat,
  plannedTotalForMonth,
  removeBudget,
  schedulePlanReminder,
  setBudget,
} from "./planning.js";
import { loadMonthlySummary } from "./summary.js";
import { describeEdits, diffFields, listEdits, logEdit } from "./edits.js";

let id = 1;
const created = new Date("2026-09-01T00:00:00Z");

function tx(partial: Partial<Transaction>): Transaction {
  return {
    id: id++, householdId: 1, userId: null, kind: "expense", amount: 0, currency: "UZS", amountBase: null, baseCurrency: "UZS",
    category: "other", note: "", items: null, occurredOn: "2026-10-05", status: "confirmed", confidence: 1, recurringPaymentId: null,
    period: null, planId: null, goalId: null, sourceChatId: null, sourceMessageId: null, botMessageId: null, createdAt: created, updatedAt: created,
    ...partial,
  };
}

function rp(partial: Partial<RecurringPayment>): RecurringPayment {
  return {
    id: id++, householdId: 1, userId: null, name: "кредит", amount: 2000000, currency: "UZS", category: "loans", dayOfMonth: 15,
    remindDaysBefore: null, active: true, lastPaidPeriod: null, sourceChatId: null, sourceMessageId: null, botMessageId: null,
    createdAt: created, updatedAt: created, ...partial,
  };
}

function plan(partial: Partial<Plan>): Plan {
  return {
    id: id++, householdId: 1, userId: null, title: "подарок", amount: 1000000, currency: "UZS", category: "gifts", plannedOn: "2026-10-20",
    dateApproximate: false, status: "planned", sourceChatId: null, sourceMessageId: null, botMessageId: null, createdAt: created, updatedAt: created,
    ...partial,
  };
}

function goal(partial: Partial<Goal>): Goal {
  return {
    id: id++, householdId: 1, userId: null, title: "отпуск", targetAmount: 10000000, currency: "UZS", deadline: null, status: "active",
    sourceChatId: null, sourceMessageId: null, botMessageId: null, createdAt: created, updatedAt: created, ...partial,
  };
}

const budget = (category: string, amount: number, currency = "UZS"): Budget => ({ householdId: 1, category, amount, currency, createdAt: created, updatedAt: created });

describe("computeOutlook", () => {
  const now = DateTime.fromISO("2026-10-13T12:00:00", { zone: "Asia/Tashkent" });
  const base = {
    month: "2026-10",
    currency: "UZS",
    now,
    recurring: [] as RecurringPayment[],
    openPlans: [] as Plan[],
    budgets: [] as Budget[],
    goals: [] as Goal[],
    goalTransactions: [] as Transaction[],
    rates: { USD: 1, UZS: 12800 },
  };

  it("counts bills, plans and goal pace still ahead and what is left free", () => {
    const vacation = goal({ deadline: "2027-01-31" });
    const contribution = tx({ amount: 1000000, category: "savings", goalId: vacation.id, occurredOn: "2026-10-02" });
    const older = tx({ amount: 2000000, category: "savings", goalId: vacation.id, occurredOn: "2026-09-02" });
    const outlook = computeOutlook({
      ...base,
      income: 9000000,
      expense: 4000000,
      transactions: [tx({ amount: 2600000, category: "groceries" }), tx({ amount: 400000, category: "dining" }), contribution],
      recurring: [
        rp({ dayOfMonth: 15 }),
        rp({ name: "интернет", amount: 200000, dayOfMonth: 5 }),
        rp({ name: "садик", amount: 500000, dayOfMonth: 1, lastPaidPeriod: "2026-10" }),
        rp({ name: "новый", amount: 300000, dayOfMonth: 3, createdAt: new Date("2026-10-10T00:00:00Z") }),
      ],
      openPlans: [
        plan({ amount: 1000000, plannedOn: "2026-10-20" }),
        plan({ title: "шины", amount: 100, currency: "USD", plannedOn: "2026-10-31", dateApproximate: true }),
        plan({ title: "декабрь", amount: 5000000, plannedOn: "2026-12-31" }),
        plan({ title: "старый", amount: 300000, plannedOn: "2026-09-25" }),
      ],
      budgets: [budget("groceries", 3000000), budget("dining", 50, "USD"), budget("kids", 1000000)],
      goals: [vacation],
      goalTransactions: [contribution, older],
    });

    // Bills: loan (15th, ahead) + internet (5th, unpaid → overdue). Paid and "added after its day" ones are skipped.
    expect(outlook.payments.map((p) => [p.name, p.overdue])).toEqual([["интернет", true], ["кредит", false]]);
    expect(outlook.forecast?.payments).toBe(2200000);
    // Plans: this month + overdue from September; December stays out.
    expect(outlook.plans.map((p) => p.title)).toEqual(["подарок", "шины", "старый"]);
    expect(outlook.plans.find((p) => p.title === "шины")?.amount).toBe(1280000);
    expect(outlook.plans.find((p) => p.title === "старый")?.overdue).toBe(true);
    expect(outlook.forecast?.plans).toBe(2580000);
    // Goal: 10M by January, 2M saved before October → 8M over 4 months = 2M/month; 1M already put aside.
    expect(outlook.goals[0]).toMatchObject({ saved: 3000000, pct: 30, monthsLeft: 4, monthlyNeed: 2000000, contributedThisMonth: 1000000, remainingThisMonth: 1000000 });
    expect(outlook.forecast?.goals).toBe(1000000);
    expect(outlook.forecast?.ahead).toBe(5780000);
    expect(outlook.forecast?.free).toBe(9000000 - 4000000 - 5780000);
    expect(outlook.forecast?.perDay).toBeNull();
    expect(outlook.forecast?.daysLeft).toBe(19);
    // Budgets sorted by usage; USD limit converted.
    expect(outlook.budgets.map((b) => [b.category, b.pct])).toEqual([["groceries", 87], ["dining", 63], ["kids", 0]]);
  });

  it("reports free money per day and leaves past months without a forecast", () => {
    const current = computeOutlook({ ...base, income: 9000000, expense: 1000000, transactions: [] });
    expect(current.forecast).toMatchObject({ ahead: 0, free: 8000000, perDay: Math.floor(8000000 / 19) });
    const past = computeOutlook({ ...base, month: "2026-09", income: 0, expense: 0, transactions: [], budgets: [budget("groceries", 100)], openPlans: [plan({ plannedOn: "2026-09-10" })] });
    expect(past.forecast).toBeNull();
    expect(past.plans).toEqual([]);
    expect(past.budgets).toHaveLength(1);
  });

  it("counts every expense against the month total, keeps it first and leaves open stashes without a pace", () => {
    const stash = goal({ title: "заначка", targetAmount: null, deadline: "2027-01-31" });
    const put = tx({ amount: 500000, category: "savings", goalId: stash.id, occurredOn: "2026-10-02" });
    const custom = new Map([["custom_3", { key: "custom_3", kind: "expense" as const, name: "Машина", emoji: "🚗", archived: false }]]);
    const outlook = computeOutlook({
      ...base,
      income: 0,
      expense: 0,
      transactions: [tx({ amount: 2600000, category: "groceries" }), tx({ amount: 400000, category: "custom_3" }), put],
      budgets: [budget("groceries", 3000000), budget("total", 4000000), budget("custom_3", 1000000)],
      goals: [stash],
      goalTransactions: [put],
      categories: custom,
    });
    expect(outlook.budgets.map((b) => [b.category, b.spent, b.pct, b.emoji])).toEqual([
      ["total", 3500000, 88, "🧮"],
      ["groceries", 2600000, 87, "🛒"],
      ["custom_3", 400000, 40, "🚗"],
    ]);
    expect(outlook.goals[0]).toMatchObject({ target: null, pct: null, saved: 500000, monthlyNeed: null, remainingThisMonth: 0 });
    expect(outlook.forecast?.goals).toBe(0);
  });

  it("sums plans per month", () => {
    const list = [plan({ amount: 100, currency: "USD", plannedOn: "2026-12-31" }), plan({ amount: 1000000, plannedOn: "2026-12-05" }), plan({ plannedOn: "2026-11-05" })];
    expect(plannedTotalForMonth(list, "2026-12", "UZS", base.rates)).toBe(2280000);
  });
});

describe("planning services (pglite)", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("schedules, moves and closes the plan reminder", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -2001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const tz = household.timezone;
    const day = DateTime.now().setZone(tz).plus({ days: 3 }).toISODate()!;
    const p = await createPlan(handle.db, { householdId: household.id, title: "коляска", amount: 2000000, currency: "UZS", category: "kids", plannedOn: day });
    const r1 = await schedulePlanReminder(handle.db, p, household);
    expect(r1).toMatchObject({ kind: "plan_due", planId: p.id, defaultTime: true, status: "scheduled" });
    expect(DateTime.fromJSDate(r1!.dueAt).setZone(tz).toFormat("yyyy-LL-dd HH:mm")).toBe(`${day} 09:00`);

    const r2 = await schedulePlanReminder(handle.db, p, household, { hour: 18, minute: 30 });
    expect(r2?.id).toBe(r1!.id);
    expect(r2?.defaultTime).toBe(false);
    // Explicit time survives a change of the household default hour.
    await updateHousehold(handle.db, household.id, { reminderHour: 11 });
    await rescheduleDefaultHour(handle.db, household.id, tz, 11);
    expect(DateTime.fromJSDate((await getReminder(handle.db, r1!.id))!.dueAt).setZone(tz).toFormat("HH:mm")).toBe("18:30");

    // Planned for a moment that has passed: no reminder.
    const today = await createPlan(handle.db, { householdId: household.id, title: "сегодня", amount: 1, currency: "UZS", plannedOn: DateTime.now().setZone(tz).minus({ days: 1 }).toISODate()! });
    expect(await schedulePlanReminder(handle.db, today, household)).toBeUndefined();

    await completePlan(handle.db, p.id);
    expect((await getPlanReminder(handle.db, p.id))?.status).toBe("cancelled");
    await cancelPlan(handle.db, today.id);
    expect((await getPlan(handle.db, today.id))?.status).toBe("cancelled");
  });

  it("returns a paid plan to the list when its expense is deleted", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -2001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const p = await createPlan(handle.db, { householdId: household.id, title: "шины", amount: 1000000, currency: "UZS", plannedOn: "2030-01-01" });
    const paid = await createTransaction(handle.db, { householdId: household.id, kind: "expense", amount: 900000, currency: "UZS", baseCurrency: "UZS", category: "transport", occurredOn: "2030-01-01", planId: p.id });
    await completePlan(handle.db, p.id);
    await softDeleteTransaction(handle.db, paid.id);
    expect((await getPlan(handle.db, p.id))?.status).toBe("planned");
  });

  it("stores limits and reports their usage in the monthly summary", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -2002, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const month = DateTime.now().setZone(household.timezone).toFormat("yyyy-LL");
    const today = DateTime.now().setZone(household.timezone).toISODate()!;
    await setBudget(handle.db, household.id, "groceries", 1000000, "UZS");
    await setBudget(handle.db, household.id, "groceries", 2000000, "UZS");
    await setBudget(handle.db, household.id, "dining", 500000, "UZS");
    expect((await listBudgets(handle.db, household.id)).map((b) => [b.category, b.amount])).toEqual([["dining", 500000], ["groceries", 2000000]]);
    await createTransaction(handle.db, { householdId: household.id, kind: "expense", amount: 1700000, currency: "UZS", baseCurrency: "UZS", amountBase: 1700000, category: "groceries", occurredOn: today });
    expect(await loadBudgetStat(handle.db, household, "groceries", month)).toMatchObject({ spent: 1700000, limit: 2000000, pct: 85 });
    expect(await loadBudgetStat(handle.db, household, "transport", month)).toBeUndefined();
    const summary = await loadMonthlySummary(handle.db, household, month);
    expect(summary.outlook.budgets.map((b) => b.category)).toEqual(["groceries", "dining"]);
    expect(summary.outlook.forecast).toMatchObject({ free: -1700000 });
    expect(await removeBudget(handle.db, household.id, "dining")).toBe(true);
    expect(await removeBudget(handle.db, household.id, "dining")).toBe(false);
  });
});

describe("record edits", () => {
  it("diffs only changed fields and describes the history", async () => {
    expect(diffFields({ amount: 3000000, title: "x", at: new Date("2026-10-01T00:00:00Z") }, { amount: 3000000, title: "x", at: new Date("2026-10-01T00:00:00Z") })).toBeNull();
    const diff = diffFields({ amount: 3000000, plannedOn: "2026-10-31", extra: 1 }, { amount: 11, plannedOn: "2026-10-31" })!;
    expect(diff).toEqual({ before: { amount: 3000000 }, after: { amount: 11 } });

    const handle = await createTestDb();
    try {
      const { household } = await getOrCreateHousehold(handle.db, { chatId: -3001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
      await logEdit(handle.db, household.id, "plan", 7, diff);
      await logEdit(handle.db, household.id, "plan", 7, { before: { plannedOn: "2026-10-31" }, after: { plannedOn: "2026-11-11" } });
      await logEdit(handle.db, household.id, "goal", 7, { before: { title: "a" }, after: { title: "b" } });
      const edits = await listEdits(handle.db, "plan", 7);
      expect(describeEdits(edits)).toBe('edit 1: amount 3000000 → 11\nedit 2: plannedOn "2026-10-31" → "2026-11-11"');
    } finally {
      await handle.close();
    }
  });
});
