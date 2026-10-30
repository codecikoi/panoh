import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  currentMonthKey,
  getHouseholdById,
  getInsights,
  isMember,
  isValidMonthKey,
  listCustomCategories,
  listHouseholdsForTelegramUser,
  listOpenPlans,
  toCategoryInfo,
  listOpenReminders,
  listRecurring,
  listTransactionsForMonth,
  hasLocale,
  localeKeys,
  loadMemberNames,
  loadMonthlySummary,
  makePeriod,
  nextDue,
  t,
  type CustomCategoryInfo,
  type Db,
  type Household,
} from "@madat/core";
import { initDataAuth, type AuthVariables } from "./auth.js";

export interface ApiOptions {
  db: Db;
  botToken: string;
  corsOrigin?: string;
  /** Bot's internal HTTP address and shared token, for the dashboard's PDF button. */
  botUrl?: string;
  internalToken?: string;
}

/** Locale keys the dashboard needs. */
const DASHBOARD_PREFIXES = ["dash.", "cat.", "report.", "plans.overdue", "app.name"];

export function createApp(options: ApiOptions): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db } = options;

  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/api/*", cors({ origin: options.corsOrigin ?? "*" }));

  // Interface strings for the dashboard in the family's language (public: nothing private in them).
  app.get("/api/i18n/:locale", (c) => {
    const locale = hasLocale(c.req.param("locale")) ? c.req.param("locale") : "en";
    const strings: Record<string, string> = {};
    for (const key of localeKeys()) {
      if (DASHBOARD_PREFIXES.some((p) => key.startsWith(p))) strings[key] = t(locale, key);
    }
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({ locale, strings });
  });

  app.use("/api/*", initDataAuth(options.botToken));

  app.get("/api/me", async (c) => {
    const user = c.get("tgUser");
    const households = await listHouseholdsForTelegramUser(db, user.id);
    // The family's own categories and the members' names ride along so the dashboard can name them wherever a key or user id appears.
    const withCategories = await Promise.all(
      households.map(async (h) => {
        const [categories, names] = await Promise.all([listCustomCategories(db, h.id), loadMemberNames(db, h.id)]);
        return publicHousehold(h, categories.map(toCategoryInfo), [...names].map(([id, name]) => ({ id, name })));
      }),
    );
    return c.json({
      user: { id: user.id, firstName: user.first_name, username: user.username ?? null, languageCode: user.language_code ?? null },
      households: withCategories,
    });
  });

  app.get("/api/households/:id/summary", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    const month = c.req.query("month") ?? currentMonthKey(household.timezone);
    if (!isValidMonthKey(month)) return c.json({ error: "bad month" }, 400);
    const summary = await loadMonthlySummary(db, household, month);
    const wantInsights = c.req.query("insights") !== "0";
    const insights = wantInsights ? await getInsights(db, household, summary) : null;
    return c.json({ household: publicHousehold(household), summary, insights });
  });

  app.get("/api/households/:id/transactions", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    const month = c.req.query("month") ?? currentMonthKey(household.timezone);
    if (!isValidMonthKey(month)) return c.json({ error: "bad month" }, 400);
    const rows = await listTransactionsForMonth(db, household.id, month, { includePending: true });
    return c.json({ month, transactions: rows });
  });

  app.get("/api/households/:id/reminders", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    return c.json({ reminders: await listOpenReminders(db, household.id, 50) });
  });

  app.get("/api/households/:id/recurring", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    const list = await listRecurring(db, household.id);
    return c.json({ recurring: list.map((p) => ({ ...p, next: nextDue(p, household.timezone) })) });
  });

  app.get("/api/households/:id/plans", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    return c.json({ plans: await listOpenPlans(db, household.id) });
  });

  // Limits and savings goals with this month's usage and progress.
  app.get("/api/households/:id/planning", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    const summary = await loadMonthlySummary(db, household, currentMonthKey(household.timezone));
    return c.json({ month: summary.month, ...summary.outlook });
  });

  // Asks the bot to send the PDF report for a period into the family chat.
  app.post("/api/households/:id/report", async (c) => {
    const household = await authorizedHousehold(c.get("tgUser").id, Number(c.req.param("id")));
    if (!household) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { from?: string; to?: string };
    const period = body.from && body.to ? makePeriod(body.from, body.to) : null;
    if (!period) return c.json({ error: "bad period" }, 400);
    if (!options.botUrl || !options.internalToken) return c.json({ error: "reports unavailable" }, 503);
    const res = await fetch(`${options.botUrl}/internal/report`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.internalToken}` },
      body: JSON.stringify({ householdId: household.id, from: period.from, to: period.to }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) return c.json({ error: "bot unavailable" }, 502);
    return c.json({ ok: true, chatType: household.chatType });
  });

  async function authorizedHousehold(telegramUserId: number, id: number): Promise<Household | undefined> {
    if (!Number.isInteger(id)) return undefined;
    if (!(await isMember(db, id, telegramUserId))) return undefined;
    return getHouseholdById(db, id);
  }

  return app;
}

function publicHousehold(h: Household, categories: CustomCategoryInfo[] = [], members: { id: number; name: string }[] = []) {
  return {
    id: h.id,
    title: h.title,
    chatType: h.chatType,
    baseCurrency: h.baseCurrency,
    timezone: h.timezone,
    locale: h.locale,
    categories,
    members,
  };
}
