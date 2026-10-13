import { GrammyError, type Api, type InlineKeyboard } from "grammy";
import { log } from "@budgie/core";
import type { BotContext } from "./context.js";

export type Reaction = Parameters<BotContext["react"]>[0];

export async function safeReact(ctx: BotContext, reaction: Reaction | []): Promise<void> {
  try {
    if (Array.isArray(reaction) && reaction.length === 0) {
      const chatId = ctx.chat?.id;
      const messageId = ctx.msg?.message_id;
      if (chatId && messageId) await ctx.api.setMessageReaction(chatId, messageId, []);
      return;
    }
    await ctx.react(reaction as Reaction);
  } catch (err) {
    log.debug("reaction failed", { err });
  }
}

/** Edits a message; returns false when Telegram refuses (too old, deleted, unchanged). */
export async function safeEdit(api: Api, chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
  try {
    await api.editMessageText(chatId, messageId, text, keyboard ? { reply_markup: keyboard } : { reply_markup: { inline_keyboard: [] } });
    return true;
  } catch (err) {
    if (err instanceof GrammyError && err.description.includes("message is not modified")) return true;
    log.debug("edit failed", { err });
    return false;
  }
}

export function isChatGone(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 403 || (err.error_code === 400 && /chat not found/i.test(err.description)));
}
