import { createDb, env, log, requireEnv } from "@madat/core";
import { createBot } from "./bot/bot.js";
import { setCommands, setProfile } from "./bot/commands.js";
import { createScheduler } from "./scheduler.js";
import { createServer } from "./server.js";
import { createTelegramAgent } from "./network.js";

const e = env();
const token = requireEnv("BOT_TOKEN");

const handle = await createDb();
await handle.migrate();

const deps = { db: handle.db, dashboardUrl: e.DASHBOARD_URL, dashboardLink: e.DASHBOARD_TME_LINK };
const bot = createBot(token, deps, {
  client: {
    timeoutSeconds: 30,
    // grammY on Node uses node-fetch, which takes a classic https.Agent.
    baseFetchConfig: { agent: createTelegramAgent(e.TELEGRAM_PROXY) } as unknown as RequestInit,
  },
});
try {
  await bot.init();
} catch (err) {
  log.error("bot: cannot reach the Telegram API. Check DNS, or set TELEGRAM_PROXY=http://host:port", { err });
  process.exit(1);
}
log.info("bot: initialised", {
  username: bot.botInfo.username,
  canReadAllGroupMessages: bot.botInfo.can_read_all_group_messages,
  mode: e.BOT_MODE,
});
if (!bot.botInfo.can_read_all_group_messages) {
  log.warn("bot: privacy mode is ON — keyword and prefix triggers will not work in groups. Disable it in @BotFather (/setprivacy).");
}
// 30 localized command lists and profiles take a while to register; do it in the background so polling starts right away.
void setCommands(bot)
  .catch((err) => log.warn("setMyCommands failed", { err }))
  .then(() => setProfile(bot))
  .catch((err) => log.warn("bot profile update incomplete", { err }));

const scheduler = createScheduler(bot.api, deps);
const { server } = createServer(bot, scheduler);
scheduler.start(30_000);

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
