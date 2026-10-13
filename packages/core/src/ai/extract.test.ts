import { describe, expect, it } from "vitest";
import { buildExtractionUserMessage, normalizeItems, type ExtractionContext } from "./extract.js";

const ctx: ExtractionContext = {
  text: "продукты 150к и такси 20к",
  authorName: "Zoir",
  locale: "ru",
  timezone: "Asia/Tashkent",
  baseCurrency: "UZS",
  recurringPayments: [{ name: "кредит", amount: 2000000, currency: "UZS", dayOfMonth: 15 }],
};

describe("normalizeItems", () => {
  it("applies defaults and validates categories", () => {
    const items = normalizeItems(
      [
        { kind: "expense", amount: 150000, currency: null, category: "groceries", note: "продукты", date: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, confidence: 0.95 },
        { kind: "expense", amount: -20000, currency: "сум", category: "spaceships", note: "такси", date: "2026-10-12", due_at: null, day_of_month: null, remind_days_before: null, target: null, confidence: 7 },
        { kind: "none", amount: null, currency: null, category: null, note: "", date: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, confidence: 1 },
      ],
      ctx,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "expense", amount: 150000, currency: "UZS", category: "groceries" });
    expect(items[1]).toMatchObject({ amount: 20000, currency: "UZS", category: "other", date: "2026-10-12", confidence: 1 });
  });

  it("keeps only changed fields for corrections", () => {
    const [item] = normalizeItems(
      [{ kind: "correction", amount: 115000, currency: null, category: null, note: "", date: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, confidence: 0.9 }],
      ctx,
    );
    expect(item?.changed).toEqual({ amount: 115000 });
  });

  it("converts reminder times from household timezone", () => {
    const [item] = normalizeItems(
      [{ kind: "reminder", amount: null, currency: null, category: null, note: "позвонить маме", date: null, due_at: "2026-10-15T10:00", day_of_month: null, remind_days_before: null, target: null, confidence: 0.9 }],
      ctx,
    );
    expect(item?.dueAt?.toISOString()).toBe("2026-10-15T05:00:00.000Z");
  });

  it("builds a prompt with household context", () => {
    const msg = buildExtractionUserMessage({ ...ctx, replyTo: "expense record: 150000 UZS" });
    expect(msg).toContain("Asia/Tashkent");
    expect(msg).toContain('"кредит"');
    expect(msg).toContain("REPLY");
    expect(msg).toContain(ctx.text);
  });
});
