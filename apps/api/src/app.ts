import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  currentMonthKey,
  getHouseholdById,
  getInsights,
  isMember,
  isValidMonthKey,
  listHouseholdsForTelegramUser,
  listOpenPlans,
  listOpenReminders,
  listRecurring,
  listTransactionsForMonth,
  loadMonthlySummary,
  nextDue,
  type Db,
  type Household,
} from "@madat/core";
import { initDataAuth, type AuthVariables } from "./auth.js";

export interface ApiOptions {
  db: Db;
  botToken: string;
  corsOrigin?: string;
}

export function createApp(options: ApiOptions): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db } = options;

  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/api/*", cors({ origin: options.corsOrigin ?? "*" }));
  app.use("/api/*", initDataAuth(options.botToken));

  app.get("/api/me", async (c) => {
    const user = c.get("tgUser");
    const households = await listHouseholdsForTelegramUser(db, user.id);
    return c.json({
      user: { id: user.id, firstName: user.first_name, username: user.username ?? null, languageCode: user.language_code ?? null },
      households: households.map(publicHousehold),
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

  async function authorizedHousehold(telegramUserId: number, id: number): Promise<Household | undefined> {
    if (!Number.isInteger(id)) return undefined;
    if (!(await isMember(db, id, telegramUserId))) return undefined;
    return getHouseholdById(db, id);
  }

  return app;
}

function publicHousehold(h: Household) {
  return {
    id: h.id,
    title: h.title,
    chatType: h.chatType,
    baseCurrency: h.baseCurrency,
    timezone: h.timezone,
    locale: h.locale,
  };
}
