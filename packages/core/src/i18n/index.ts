import type { LocaleStrings } from "./locales/en.js";
import { LOCALES } from "./locales/index.js";

export type LocaleKey = keyof LocaleStrings;
export type Params = Record<string, string | number>;

/** The 30 most widely used languages on Telegram; translations are generated on demand. */
export const SUPPORTED_LOCALES = [
  "en", "ru", "uz", "es", "pt", "fr", "de", "it", "tr", "ar", "fa", "hi", "id", "ms", "vi",
  "th", "ko", "ja", "zh", "uk", "pl", "kk", "az", "ky", "tg", "nl", "ro", "he", "bn", "ur",
] as const;

export function availableLocales(): string[] {
  return Object.keys(LOCALES);
}

export function hasLocale(code: string): boolean {
  return code in LOCALES;
}

/** Maps a Telegram `language_code` (e.g. "pt-br") to an available locale, falling back to English. */
export function pickLocale(code: string | undefined | null, fallback = "en"): string {
  if (!code) return hasLocale(fallback) ? fallback : "en";
  const base = code.toLowerCase().split(/[-_]/)[0] ?? "";
  if (hasLocale(base)) return base;
  return hasLocale(fallback) ? fallback : "en";
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function t(locale: string, key: LocaleKey, params?: Params): string {
  const table = LOCALES[locale] ?? LOCALES.en!;
  const template = table[key] ?? LOCALES.en![key] ?? key;
  return interpolate(template, params);
}

export function languageName(code: string, inLocale = code): string {
  try {
    const name = new Intl.DisplayNames([inLocale], { type: "language" }).of(code);
    if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    /* fall through */
  }
  return code;
}

export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
