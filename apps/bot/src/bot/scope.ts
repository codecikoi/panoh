import type { Middleware } from "grammy";
import { ensureMember, env, getOrCreateHousehold, guessDefaults, upsertUser } from "@madat/core";
import { scopeFromHousehold, type BotContext, type Deps } from "./context.js";

/** Resolves the household (chat) and member (user) for every update and attaches them to the context. */
export function scopeMiddleware(deps: Deps): Middleware<BotContext> {
  return async (ctx, next) => {
    ctx.deps = deps;
    const chat = ctx.chat;
    const from = ctx.from;
    if (!chat || chat.type === "channel") return;
    const e = env();
    const defaults = guessDefaults(from?.language_code, {
      locale: e.DEFAULT_LOCALE,
      currency: e.DEFAULT_CURRENCY,
      timezone: e.DEFAULT_TIMEZONE,
    });
    const { household } = await getOrCreateHousehold(
      deps.db,
      { chatId: chat.id, chatType: chat.type, title: "title" in chat ? chat.title : (from?.first_name ?? null) },
      defaults,
    );
    let user;
    if (from && !from.is_bot) {
      user = await upsertUser(deps.db, { id: from.id, firstName: from.first_name, username: from.username, languageCode: from.language_code });
      await ensureMember(deps.db, household.id, user.id);
    }
    ctx.scope = scopeFromHousehold(household, user);
    await next();
  };
}
