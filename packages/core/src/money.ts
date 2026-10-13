const CURRENCY_ALIASES: Record<string, string> = {
  SUM: "UZS",
  SOUM: "UZS",
  "SO'M": "UZS",
  SOM: "UZS",
  СУМ: "UZS",
  СЎМ: "UZS",
  RUR: "RUB",
  РУБ: "RUB",
  "Р": "RUB",
  "₽": "RUB",
  "$": "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "₸": "KZT",
  ТГ: "KZT",
  ТЕНГЕ: "KZT",
  "₴": "UAH",
  ГРН: "UAH",
  "₺": "TRY",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  СОМОНИ: "TJS",
  "₫": "VND",
  "฿": "THB",
};

export function normalizeCurrency(input: string | null | undefined, fallback: string): string {
  if (!input) return fallback;
  const raw = input.trim().toUpperCase().replace(/\.$/, "");
  if (!raw) return fallback;
  const alias = CURRENCY_ALIASES[raw];
  if (alias) return alias;
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  return fallback;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatMoney(amount: number, currency: string, locale = "en"): string {
  const abs = Math.abs(amount);
  const fractionDigits = Number.isInteger(abs) || abs >= 1000 ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    const number = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
    return `${number} ${currency}`;
  }
}

export function formatCompact(amount: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

export function formatPercent(value: number, locale = "en"): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)}%`;
}

/** Rates are quoted per 1 USD (how many units of `currency` one dollar buys). */
export type RateTable = Record<string, number>;

export function convert(amount: number, from: string, to: string, rates: RateTable): number | null {
  if (from === to) return amount;
  const fromRate = from === "USD" ? 1 : rates[from];
  const toRate = to === "USD" ? 1 : rates[to];
  if (!fromRate || !toRate) return null;
  return roundMoney((amount / fromRate) * toRate);
}
