import { createDb, env, log, ratesAreStale, refreshRates, requireEnv } from "@budgie/core";
import { createBot } from "./bot/bot.js";
import { setCommands } from "./bot/commands.js";
import { createScheduler } from "./scheduler.js";
import { createServer } from "./server.js";

const e = env();
const token = requireEnv("BOT_TOKEN");

const handle = await createDb();
await handle.migrate();

const deps = { db: handle.db, dashboardUrl: e.DASHBOARD_URL, dashboardLink: e.DASHBOARD_TME_LINK };
const bot = createBot(token, deps);
await bot.init();
log.info("bot: initialised", {
  username: bot.botInfo.username,
  canReadAllGroupMessages: bot.botInfo.can_read_all_group_messages,
  mode: e.BOT_MODE,
});
if (!bot.botInfo.can_read_all_group_messages) {
  log.warn("bot: privacy mode is ON — keyword and prefix triggers will not work in groups. Disable it in @BotFather (/setprivacy).");
}
await setCommands(bot).catch((err) => log.warn("setMyCommands failed", { err }));

const scheduler = createScheduler(bot.api, deps);
const { server } = createServer(bot, scheduler);
scheduler.start(30_000);

void (async () => {
  try {
    if (await ratesAreStale(handle.db, 24)) await refreshRates(handle.db);
  } catch (err) {
    log.warn("initial rates refresh failed", { err });
  }
})();

const allowedUpdates = ["message", "callback_query", "my_chat_member"] as const;
if (e.BOT_MODE === "webhook") {
  const url = requireEnv("WEBHOOK_URL");
  await bot.api.setWebhook(url, { secret_token: e.WEBHOOK_SECRET, allowed_updates: [...allowedUpdates], drop_pending_updates: false });
  log.info("bot: webhook set", { url });
} else {
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  bot
    .start({
      allowed_updates: [...allowedUpdates],
      onStart: () => log.info("bot: polling started"),
    })
    .catch((err) => {
      log.error("bot: polling stopped", { err });
      process.exit(1);
    });
}

async function shutdown(signal: string): Promise<void> {
  log.info("shutting down", { signal });
  scheduler.stop();
  try {
    if (e.BOT_MODE === "polling") await bot.stop();
  } catch {
    /* ignore */
  }
  server.close();
  await handle.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
