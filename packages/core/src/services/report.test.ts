import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { createTestDb, type DbHandle } from "../db/client.js";
import { getOrCreateHousehold } from "./households.js";
import { createTransaction, updateTransaction } from "./transactions.js";
import { setBudget } from "./planning.js";
import { loadReport, reportFingerprint } from "./report.js";
import { monthPeriod, weekPeriod } from "../period.js";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => {
  await handle.close();
});

describe("loadReport", () => {
  it("collects totals, comparison and every record of the period", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -4001, chatType: "group" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const add = (kind: "expense" | "income", amount: number, category: string, occurredOn: string) =>
      createTransaction(handle.db, { householdId: household.id, kind, amount, currency: "UZS", amountBase: amount, baseCurrency: "UZS", category, occurredOn });
    await add("income", 9000000, "salary", "2026-09-05");
    await add("expense", 1000000, "groceries", "2026-09-10");
    await add("income", 9000000, "salary", "2026-10-05");
    const g = await add("expense", 1500000, "groceries", "2026-10-06");
    await add("expense", 300000, "transport", "2026-10-20");
    await add("expense", 100000, "dining", "2026-11-01");
    await setBudget(handle.db, household.id, "groceries", 2000000, "UZS");

    const october = await loadReport(handle.db, household, monthPeriod("2026-10"), { insights: false });
    expect(october).toMatchObject({ income: 9000000, expense: 1800000, net: 7200000, prevExpense: 1000000, expenseDeltaPct: 80, hasPrev: true });
    expect(october.transactions.map((t) => t.occurredOn)).toEqual(["2026-10-05", "2026-10-06", "2026-10-20"]);
    expect(october.categories.map((c) => [c.category, c.deltaPct])).toEqual([["groceries", 50], ["transport", null]]);
    expect(october.month?.outlook.budgets[0]).toMatchObject({ category: "groceries", spent: 1500000 });
    expect(october.avgPerDay).toBe(Math.round((1800000 / 31) * 100) / 100);

    const week = await loadReport(handle.db, household, weekPeriod("2026-10-20"), { insights: false });
    expect(week.month).toBeNull();
    expect(week.transactions).toHaveLength(1);
    expect(week.prevPeriod).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });

    const before = reportFingerprint(october.transactions);
    await updateTransaction(handle.db, g.id, { amount: 1600000 });
    const after = await loadReport(handle.db, household, monthPeriod("2026-10"), { insights: false });
    expect(reportFingerprint(after.transactions)).not.toBe(before);
  });
});
