import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { exchangeRates } from "../db/schema.js";
import { env } from "../config.js";
import { log } from "../logger.js";
import { convert, type RateTable } from "../money.js";

export async function getRates(db: Db): Promise<{ rates: RateTable; fetchedAt: Date | null }> {
  const rows = await db.select().from(exchangeRates);
  const rates: RateTable = { USD: 1 };
  let fetchedAt: Date | null = null;
  for (const row of rows) {
    rates[row.currency] = row.rate;
    if (!fetchedAt || row.fetchedAt > fetchedAt) fetchedAt = row.fetchedAt;
  }
  return { rates, fetchedAt };
}

export async function refreshRates(db: Db, url = env().RATES_URL): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`rates: HTTP ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, number>; result?: string };
  const rates = data.rates;
  if (!rates || typeof rates !== "object") throw new Error("rates: unexpected payload");
  const now = new Date();
  const rows = Object.entries(rates)
    .filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && typeof rate === "number" && rate > 0)
    .map(([currency, rate]) => ({ currency, rate, fetchedAt: now }));
  if (!rows.length) return 0;
  await db
    .insert(exchangeRates)
    .values(rows)
    .onConflictDoUpdate({
      target: exchangeRates.currency,
      set: { rate: sql`excluded.rate`, fetchedAt: sql`excluded.fetched_at` },
    });
  log.info("rates: refreshed", { count: rows.length });
  return rows.length;
}

export async function ratesAreStale(db: Db, maxAgeHours = 24): Promise<boolean> {
  const { fetchedAt } = await getRates(db);
  if (!fetchedAt) return true;
  return Date.now() - fetchedAt.getTime() > maxAgeHours * 3600 * 1000;
}

export function toBase(amount: number, currency: string, base: string, rates: RateTable): number | null {
  return convert(amount, currency, base, rates);
}
