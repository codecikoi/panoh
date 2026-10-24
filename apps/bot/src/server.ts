import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { webhookCallback, type Bot } from "grammy";
import { env, getHouseholdById, log, makePeriod } from "@madat/core";
import { scopeFromHousehold, type BotContext, type Deps } from "./bot/context.js";
import { sendReport } from "./report/send.js";
import type { Scheduler } from "./scheduler.js";

export function createServer(bot: Bot<BotContext>, scheduler: Scheduler, deps: Deps) {
  const app = new Hono();
  const e = env();

  app.get("/health", (c) => c.json({ ok: true, mode: e.BOT_MODE }));

  if (e.BOT_MODE === "webhook") {
    const handler = webhookCallback(bot, "hono", {
      secretToken: e.WEBHOOK_SECRET,
      timeoutMilliseconds: 55_000,
      onTimeout: "return",
    });
    app.post("/telegram/webhook", (c) => handler(c));
  }

  app.post("/internal/tick", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    if (!e.INTERNAL_TOKEN || auth !== `Bearer ${e.INTERNAL_TOKEN}`) return c.json({ error: "unauthorized" }, 401);
    await scheduler.tick();
    return c.json({ ok: true });
  });

  // The dashboard's "PDF" button: the API asks the bot to send the report into the family chat.
  app.post("/internal/report", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    if (!e.INTERNAL_TOKEN || auth !== `Bearer ${e.INTERNAL_TOKEN}`) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { householdId?: number; from?: string; to?: string };
    const household = Number.isInteger(body.householdId) ? await getHouseholdById(deps.db, body.householdId!) : undefined;
    const period = body.from && body.to ? makePeriod(body.from, body.to) : null;
    if (!household || !period) return c.json({ error: "bad request" }, 400);
    void sendReport(bot.api, deps, scopeFromHousehold(household), household.telegramChatId, period).catch((err) =>
      log.error("internal report failed", { err, householdId: household.id }),
    );
    return c.json({ ok: true }, 202);
  });

  const server = serve({ fetch: app.fetch, port: e.PORT, hostname: "0.0.0.0" }, (info) => {
    log.info("http: listening", { port: info.port });
  });
  return { app, server };
}
