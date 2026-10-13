import { describe, expect, it } from "vitest";
import { LOCALES } from "./locales/index.js";
import { en } from "./locales/en.js";
import { SUPPORTED_LOCALES, pickLocale, t } from "./index.js";

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("i18n", () => {
  it("ships all 30 supported locales", () => {
    expect(Object.keys(LOCALES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("every locale has every English key with the same placeholders", () => {
    for (const [code, table] of Object.entries(LOCALES)) {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(table[key], `${code}:${key}`).toBeTypeOf("string");
        expect(placeholders(table[key]), `${code}:${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it("interpolates and falls back", () => {
    expect(t("ru", "settings.saved", { value: "UZS" })).toBe("✅ Сохранил: UZS");
    expect(t("xx", "settings.saved", { value: "UZS" })).toBe("✅ Saved: UZS");
  });

  it("picks locales from Telegram language codes", () => {
    expect(pickLocale("ru")).toBe("ru");
    expect(pickLocale("pt-br")).toBe("pt");
    expect(pickLocale("zh-hans")).toBe("zh");
    expect(pickLocale("xx")).toBe("en");
    expect(pickLocale("uz-UZ")).toBe("uz");
    expect(pickLocale(undefined, "ru")).toBe("ru");
  });
});
