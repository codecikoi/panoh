import { Bot, type BotConfig } from "grammy";
import { log } from "@madat/core";
import type { BotContext, Deps } from "./context.js";
import { scopeMiddleware } from "./scope.js";
import { registerCommands } from "./commands.js";
import { registerCallbacks } from "./callbacks.js";
import { registerMessages } from "./messages.js";

export function createBot(token: string, deps: Deps, config?: BotConfig<BotContext>): Bot<BotContext> {
  const bot = new Bot<BotContext>(token, config);

  // Every outgoing text uses HTML formatting unless a call sets parse_mode explicitly.
  bot.api.config.use((prev, method, payload, signal) => {
    if ((method === "sendMessage" || method === "editMessageText") && !("parse_mode" in payload)) {
      return prev(method, { ...(payload as object), parse_mode: "HTML" } as typeof payload, signal);
    }
    return prev(method, payload, signal);
  });

  bot.use(scopeMiddleware(deps));
  registerCommands(bot);
  registerCallbacks(bot);
  registerMessages(bot);

  bot.catch((err) => {
    log.error("bot error", { err: err.error, update: err.ctx.update.update_id });
  });
  return bot;
}
