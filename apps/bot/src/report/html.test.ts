import { describe, expect, it } from "vitest";
import type { ReportData, Transaction } from "@madat/core";
import { monthPeriod, previousPeriod, weekPeriod } from "@madat/core";
import { renderReportHtml } from "./html.js";

function tx(partial: Partial<Transaction>): Transaction {
  return {
    id: 1, householdId: 1, userId: null, kind: "expense", amount: 1000, currency: "UZS", amountBase: 1000, baseCurrency: "UZS", category: "groceries",
    note: "", items: null, occurredOn: "2026-10-05", status: "confirmed", confidence: 1, recurringPaymentId: null, period: null, planId: null, goalId: null,
    sourceChatId: null, sourceMessageId: null, botMessageId: null, createdAt: new Date(), updatedAt: new Date(), ...partial,
  };
}

const cat = (category: string, amount: number, share: number) => ({ category, emoji: "", amount, count: 1, share, prevAmount: 0, delta: amount, deltaPct: null });

function data(partial: Partial<ReportData> = {}): ReportData {
  const period = monthPeriod("2026-10");
  return {
    period, prevPeriod: previousPeriod(period), currency: "UZS", income: 0, expense: 700, net: -700, prevIncome: 0, prevExpense: 0, hasPrev: false,
    expenseDeltaPct: null, incomeDeltaPct: null, avgPerDay: 22, biggest: [], unconverted: [], incomeCategories: [], month: null, byPerson: [], names: {},
    categories: ["groceries", "dining", "transport", "health", "kids", "pets", "gifts"].map((c, i) => cat(c, 100, i === 0 ? 16 : 14)),
    transactions: [tx({ note: '<script>alert("x")</script>' }), tx({ id: 2, kind: "income", category: "salary", occurredOn: "2026-10-06" })],
    ...partial,
  };
}

describe("renderReportHtml", () => {
  it("escapes user text, folds small categories into a hatched Other and blocks the network", () => {
    const html = renderReportHtml({ locale: "ru", tz: "Asia/Tashkent", assistantName: "Кекс<ик>", title: "Семья & друзья", data: data() });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Кекс&lt;ик&gt;");
    expect(html).toContain("Семья &amp; друзья");
    expect(html).toContain("Прочее");
    expect(html).toContain('class="hatch"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Все операции (2)");
    expect(html).not.toContain("Лимиты");
  });

  it("draws the mark and Lucide category icons instead of emoji, in the brand colours", () => {
    const html = renderReportHtml({ locale: "en", tz: "UTC", assistantName: "Madat", title: null, data: data() });
    expect(html).toContain('viewBox="0 0 64 64"'); // the mark in the header
    expect(html).toContain('<span class="cat"><svg'); // category labels carry an icon
    expect(html).toContain("--accent:#E40163");
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("names who recorded what in a group, lists positions, and keeps a private report nameless", () => {
    const group = data({
      names: { 1: "Zoir", 2: "Malika" },
      byPerson: [
        { userId: 1, name: "Zoir", expense: 500, income: 0, share: 71, count: 1 },
        { userId: 2, name: "Malika", expense: 200, income: 0, share: 29, count: 1 },
      ],
      transactions: [
        tx({ userId: 1, amount: 333, note: "корзинка + виноград", items: [{ amount: 313, note: "корзинка", userId: 1 }, { amount: 20, note: "виноград", userId: 2 }] }),
        tx({ id: 2, userId: 2, amount: 200, note: "кафе", category: "dining" }),
      ],
    });
    const html = renderReportHtml({ locale: "ru", tz: "UTC", assistantName: "Madat", title: "Семья", data: group });
    expect(html).toContain("Кто сколько потратил");
    expect(html).toContain("<th>Кто</th>");
    expect(html).toContain("виноград");
    expect(html).toContain("Malika");
    // The same data from a private chat: one person, so no author column and no split.
    const alone = renderReportHtml({ locale: "ru", tz: "UTC", assistantName: "Madat", title: null, data: group });
    expect(alone).not.toContain("Кто сколько потратил");
    expect(alone).not.toContain("<th>Кто</th>");
  });

  it("goes right-to-left for Arabic and skips month-only blocks for a week", () => {
    const week = weekPeriod("2026-10-20");
    const html = renderReportHtml({ locale: "ar", tz: "UTC", assistantName: "Madat", title: null, data: data({ period: week, prevPeriod: previousPeriod(week) }) });
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('class="forecast"');
  });
});
