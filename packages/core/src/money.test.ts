import { describe, expect, it } from "vitest";
import { convert, formatMoney, normalizeCurrency } from "./money.js";

describe("money", () => {
  it("normalizes currency aliases", () => {
    expect(normalizeCurrency("сум", "USD")).toBe("UZS");
    expect(normalizeCurrency("$", "UZS")).toBe("USD");
    expect(normalizeCurrency("руб.", "USD")).toBe("RUB");
    expect(normalizeCurrency("eur", "USD")).toBe("EUR");
    expect(normalizeCurrency(null, "UZS")).toBe("UZS");
    expect(normalizeCurrency("banana", "UZS")).toBe("UZS");
  });

  it("converts through USD rates", () => {
    const rates = { UZS: 12800, EUR: 0.9 };
    expect(convert(128000, "UZS", "USD", rates)).toBe(10);
    expect(convert(10, "USD", "UZS", rates)).toBe(128000);
    expect(convert(9, "EUR", "USD", rates)).toBe(10);
    expect(convert(100, "UZS", "UZS", rates)).toBe(100);
    expect(convert(100, "KZT", "UZS", rates)).toBeNull();
  });

  it("formats money without crashing on unknown codes", () => {
    expect(formatMoney(150000, "UZS", "ru")).toContain("150");
    expect(formatMoney(12.5, "USD", "en")).toBe("$12.50");
    expect(formatMoney(1500, "AB", "en")).toContain("AB");
  });
});
