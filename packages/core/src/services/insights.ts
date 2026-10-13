import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { insightsCache, type Household } from "../db/schema.js";
import { generateInsights, type Insights } from "../ai/insights.js";
import type { MonthlySummary } from "./summary.js";

const CURRENT_MONTH_TTL_MS = 6 * 3600 * 1000;
const PAST_MONTH_TTL_MS = 30 * 24 * 3600 * 1000;

export async function getInsights(db: Db, household: Household, summary: MonthlySummary, options: { force?: boolean } = {}): Promise<Insights | null> {
  if (summary.recordCount === 0) return null;
  const locale = household.locale;
  const ttl = summary.isCurrentMonth ? CURRENT_MONTH_TTL_MS : PAST_MONTH_TTL_MS;
  if (!options.force) {
    const cached = await db
      .select()
      .from(insightsCache)
      .where(and(eq(insightsCache.householdId, household.id), eq(insightsCache.month, summary.month), eq(insightsCache.locale, locale)))
      .limit(1);
    const row = cached[0];
    if (row && Date.now() - row.generatedAt.getTime() < ttl) {
      const payload = row.payload as Insights & { recordCount?: number };
      if (payload.recordCount === summary.recordCount || !summary.isCurrentMonth) return payload;
    }
  }
  const insights = await generateInsights(summary, locale);
  if (!insights) return null;
  await db
    .insert(insightsCache)
    .values({ householdId: household.id, month: summary.month, locale, payload: { ...insights, recordCount: summary.recordCount }, generatedAt: new Date() })
    .onConflictDoUpdate({
      target: [insightsCache.householdId, insightsCache.month, insightsCache.locale],
      set: { payload: { ...insights, recordCount: summary.recordCount }, generatedAt: new Date() },
    });
  return insights;
}
