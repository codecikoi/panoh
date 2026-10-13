import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { webhookCallback, type Bot } from "grammy";
import { env, log } from "@madat/core";
import type { BotContext } from "./bot/context.js";
import type { Scheduler } from "./scheduler.js";

export function createServer(bot: Bot<BotContext>, scheduler: Scheduler) {
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

  const server = serve({ fetch: app.fetch, port: e.PORT, hostname: "0.0.0.0" }, (info) => {
    log.info("http: listening", { port: info.port });
  });
  return { app, server };
}
