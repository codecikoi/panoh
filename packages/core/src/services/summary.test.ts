import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { computeSummary } from "./summary.js";
import type { Transaction } from "../db/schema.js";

let id = 1;
function tx(partial: Partial<Transaction>): Transaction {
  return {
    id: id++,
    householdId: 1,
    userId: null,
    kind: "expense",
    amount: 0,
    currency: "UZS",
    amountBase: null,
    baseCurrency: "UZS",
    category: "other",
    note: "",
    items: null,
    occurredOn: "2026-10-05",
    status: "confirmed",
    confidence: 1,
    recurringPaymentId: null,
    period: null,
    planId: null,
    goalId: null,
    sourceChatId: null,
    sourceMessageId: null,
    botMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe("computeSummary", () => {
  const now = DateTime.fromISO("2026-10-13T12:00:00", { zone: "Asia/Tashkent" });

  it("aggregates categories, deltas and projections", () => {
    const summary = computeSummary({
      month: "2026-10",
      currency: "UZS",
      now,
      transactions: [
        tx({ amount: 1200000, category: "groceries", note: "продукты" }),
        tx({ amount: 300000, category: "groceries" }),
        tx({ amount: 500000, category: "dining", note: "ресторан" }),
        tx({ amount: 100, currency: "USD", amountBase: 1280000, category: "loans", note: "кредит" }),
        tx({ amount: 50, currency: "EUR", category: "travel" }),
        tx({ kind: "income", amount: 9000000, category: "salary" }),
      ],
      prevTransactions: [
        tx({ amount: 1000000, category: "groceries", occurredOn: "2026-09-10" }),
        tx({ amount: 800000, category: "dining", occurredOn: "2026-09-11" }),
        tx({ kind: "income", amount: 9000000, category: "salary", occurredOn: "2026-09-01" }),
      ],
      openReminders: 2,
    });
    expect(summary.expense).toBe(3280000);
    expect(summary.income).toBe(9000000);
    expect(summary.net).toBe(5720000);
    expect(summary.categories[0]).toMatchObject({ category: "groceries", amount: 1500000, prevAmount: 1000000, deltaPct: 50 });
    expect(summary.categories.find((c) => c.category === "loans")?.amount).toBe(1280000);
    expect(summary.unconverted).toEqual([{ currency: "EUR", amount: 50 }]);
    expect(summary.topGrowth?.category).toBe("groceries");
    expect(summary.topDrop?.category).toBe("dining");
    expect(summary.expenseDeltaPct).toBe(82);
    expect(summary.isCurrentMonth).toBe(true);
    expect(summary.daysElapsed).toBe(13);
    expect(summary.projected).toBeGreaterThan(summary.expense);
    expect(summary.biggest[0]?.note).toBe("кредит");
    expect(summary.openReminders).toBe(2);
    expect(summary.newCategories.map((c) => c.category)).toEqual(["loans"]);
    expect(summary.droppedCategories).toEqual([]);
  });

  it("attributes spending to the members who recorded it, position by position", () => {
    const summary = computeSummary({
      month: "2026-10",
      currency: "UZS",
      now,
      members: new Map([
        [1, "Zoir"],
        [2, "Malika"],
      ]),
      transactions: [
        tx({ amount: 333000, category: "groceries", note: "корзинка + виноград", userId: 1, items: [{ amount: 313000, note: "корзинка", userId: 1 }, { amount: 20000, note: "виноград", userId: 2 }] }),
        tx({ amount: 80000, category: "dining", userId: 2 }),
        tx({ amount: 10, currency: "USD", amountBase: 128000, category: "transport", userId: 2 }),
        tx({ amount: 50000, category: "transport", userId: 3 }), // name unknown: not attributed
        tx({ amount: 5000, category: "other", userId: null }),
        tx({ kind: "income", amount: 9000000, category: "salary", userId: 1 }),
      ],
      prevTransactions: [],
    });
    expect(summary.byPerson).toEqual([
      { userId: 1, name: "Zoir", expense: 313000, income: 9000000, share: 58, count: 2 },
      { userId: 2, name: "Malika", expense: 228000, income: 0, share: 42, count: 3 },
    ]);
  });

  it("handles empty months", () => {
    const summary = computeSummary({ month: "2026-08", currency: "USD", now, transactions: [], prevTransactions: [] });
    expect(summary.recordCount).toBe(0);
    expect(summary.projected).toBeNull();
    expect(summary.hasPrev).toBe(false);
  });
});
