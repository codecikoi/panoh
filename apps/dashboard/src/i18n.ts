import { createContext, useContext } from "react";
import { apiGet } from "./api";

export type Strings = Record<string, string>;

export async function loadStrings(locale: string): Promise<{ locale: string; strings: Strings }> {
  return apiGet(`/i18n/${encodeURIComponent(locale)}`);
}

export interface I18n {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function makeI18n(locale: string, strings: Strings): I18n {
  return {
    locale,
    t: (key, params) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (params?.[k] === undefined ? m : String(params[k]))),
  };
}

export const I18nContext = createContext<I18n>(makeI18n("en", {}));
export const useI18n = (): I18n => useContext(I18nContext);
