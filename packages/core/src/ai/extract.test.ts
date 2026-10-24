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
        { kind: "expense", amount: 150000, currency: null, category: "groceries", note: "продукты", date: null, date_approximate: false, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 0.95 },
        { kind: "expense", amount: -20000, currency: "сум", category: "spaceships", note: "такси", date: "2026-10-12", date_approximate: false, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 7 },
        { kind: "none", amount: null, currency: null, category: null, note: "", date: null, date_approximate: false, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 1 },
      ],
      ctx,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "expense", amount: 150000, currency: "UZS", category: "groceries" });
    expect(items[1]).toMatchObject({ amount: 20000, currency: "UZS", category: "other", date: "2026-10-12", confidence: 1 });
  });

  it("keeps only changed fields for corrections", () => {
    const [item] = normalizeItems(
      [{ kind: "correction", amount: 115000, currency: null, category: null, note: "", date: null, date_approximate: false, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 0.9 }],
      ctx,
    );
    expect(item?.changed).toEqual({ amount: 115000 });
    expect(item?.timeSpecified).toBe(false);
  });

  it("converts reminder times from household timezone and keeps the time_specified flag", () => {
    const [item] = normalizeItems(
      [{ kind: "reminder", amount: null, currency: null, category: null, note: "позвонить маме", date: null, date_approximate: false, date_to: null, due_at: "2026-10-15T10:00", day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 0.9 }],
      ctx,
    );
    expect(item?.dueAt?.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(item?.timeSpecified).toBe(false);
    const [explicit] = normalizeItems(
      [{ kind: "reminder", amount: null, currency: null, category: null, note: "врач", date: null, date_approximate: false, date_to: null, due_at: "2026-10-15T15:30", day_of_month: null, remind_days_before: null, target: null, time_specified: true, confidence: 0.9 }],
      ctx,
    );
    expect(explicit?.timeSpecified).toBe(true);
  });

  it("puts month-only plans on the last day of the month", () => {
    const [plan, exact] = normalizeItems(
      [
        { kind: "planned_expense", amount: 3000000, currency: null, category: "gifts", note: "подарок на свадьбу", date: "2026-12-01", date_approximate: true, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 0.9 },
        { kind: "planned_expense", amount: 2000000, currency: null, category: null, note: "коляска", date: "2026-10-17", date_approximate: false, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 0.9 },
      ],
      ctx,
    );
    expect(plan).toMatchObject({ date: "2026-12-31", hasDate: true, dateApproximate: true, category: "gifts", timeSpecified: false });
    expect(exact).toMatchObject({ date: "2026-10-17", dateApproximate: false, category: "other" });
    const [fix] = normalizeItems(
      [{ kind: "correction", amount: null, currency: null, category: null, note: "", date: "2026-12-15", date_approximate: false, date_to: null, due_at: null, day_of_month: null, remind_days_before: null, target: null, time_specified: false, confidence: 0.9 }],
      ctx,
    );
    expect(fix?.changed).toEqual({ date: "2026-12-15", dateApproximate: false });
  });

  it("builds a prompt with household context", () => {
    const msg = buildExtractionUserMessage({
      ...ctx,
      replyTo: "expense record: 150000 UZS",
      plans: [{ name: "подарок", amount: 3000000, currency: "UZS", date: "2026-12-31" }],
      goals: [{ name: "отпуск", target: 10000000, currency: "UZS" }],
    });
    expect(msg).toContain('Known planned expenses: "подарок"');
    expect(msg).toContain('Known savings goals: "отпуск"');
    expect(msg).toContain("Asia/Tashkent");
    expect(msg).toContain("Default reminder time when none is given: 09:00");
    expect(msg).toContain('"кредит"');
    expect(msg).toContain("REPLY");
    expect(msg).not.toContain("Most recent record");
    expect(buildExtractionUserMessage({ ...ctx, lastRecord: "planned expense: \"x\"" })).toContain('Most recent record in this chat (the message is not a reply): planned expense: "x"');
    expect(msg).toContain(ctx.text);
  });
});
