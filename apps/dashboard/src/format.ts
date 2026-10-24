import { formatMoney } from "@madat/core/money";
export { formatMoney, formatPercent } from "@madat/core/money";

/** Short form for narrow tiles: "10,2 млн UZS" from a million up, the full amount below. */
export function formatMoneyCompact(amount: number, currency: string, locale: string): string {
  if (Math.abs(amount) < 1_000_000) return formatMoney(amount, currency, locale);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 1 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(amount)} ${currency}`;
  }
}

/** "Октябрь 2026" — month and year, capitalised, in the family's language. */
export function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  // Standalone month name plus the year ("Октябрь 2026", not "октября 2026 г.").
  const name = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function currentMonth(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

/** "пт, 24 октября" for a day header; "24 окт." when short. */
export function dayLabel(iso: string, locale: string, short = false): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const options: Intl.DateTimeFormatOptions = short ? { day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, options).format(Date.UTC(y, m - 1, d));
}

export function dateTimeLabel(isoInstant: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(isoInstant));
}
