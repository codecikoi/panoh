import type { Bot } from "grammy";
import { currentMonthKey, evaluateTrigger, extractItems, listRecurring, log, markProcessed, t, type ExtractionResult } from "@madat/core";
import type { BotContext } from "./context.js";
import { applyItems, describeTarget, resolveReplyTarget } from "./actions.js";
import { sendSummary } from "./summary.js";
import { safeReact } from "./telegram.js";
import { ensureWelcome } from "./commands.js";
import { prefixOf } from "./render.js";

const recentByChat = new Map<number, string[]>();

function remember(chatId: number, line: string): void {
  const list = recentByChat.get(chatId) ?? [];
  list.push(line.slice(0, 200));
  while (list.length > 4) list.shift();
  recentByChat.set(chatId, list);
}

export function registerMessages(bot: Bot<BotContext>): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    const chat = ctx.chat;
    const isPrivate = chat.type === "private";
    const scope = ctx.scope;
    const replyTo = ctx.message.reply_to_message;
    const isReplyToBot = replyTo?.from?.id === ctx.me.id;

    const trigger = evaluateTrigger({
      text,
      locale: scope.locale,
      botUsername: ctx.me.username,
      isReplyToBot,
      isPrivateChat: isPrivate,
      config: scope.household.triggers,
    });
    if (!trigger.process) return;
    if (!(await markProcessed(ctx.deps.db, chat.id, ctx.message.message_id))) return;
    if (!scope.household.setupDone) await ensureWelcome(ctx);

    const replyTarget = isReplyToBot && replyTo ? await resolveReplyTarget(ctx.deps.db, chat.id, replyTo.message_id) : undefined;
    void safeReact(ctx, "👀");

    const recurring = await listRecurring(ctx.deps.db, scope.household.id);
    const authorName = ctx.from.first_name || ctx.from.username || "member";
    let result: ExtractionResult;
    try {
      result = await extractItems({
        text: trigger.cleaned,
        authorName,
        locale: scope.locale,
        timezone: scope.tz,
        baseCurrency: scope.currency,
        defaultReminderHour: scope.household.reminderHour,
        recurringPayments: recurring.map((p) => ({ name: p.name, amount: p.amount, currency: p.currency, dayOfMonth: p.dayOfMonth })),
        replyTo: replyTarget ? describeTarget(replyTarget, scope.tz) : undefined,
        recent: recentByChat.get(chat.id),
      });
    } catch (err) {
      log.error("extraction failed", { err, chatId: chat.id });
      await safeReact(ctx, "😢");
      await ctx.reply(t(scope.locale, "error.ai"));
      return;
    }
    log.info("message processed", {
      chatId: chat.id,
      reason: trigger.reason,
      items: result.items.map((i) => i.kind),
      usage: result.usage,
    });
    remember(chat.id, `${authorName}: ${trigger.cleaned}`);

    const outcome = await applyItems(ctx, result.items, {
      chatId: chat.id,
      sourceMessageId: ctx.message.message_id,
      rawText: trigger.cleaned,
      isPrivate,
      replyTarget,
    });
    for (const item of result.items) {
      if (item.kind !== "none") remember(chat.id, `bot recorded ${item.kind}: ${item.amount ?? ""} ${item.currency} ${item.category ?? ""} ${item.note}`.trim());
    }

    if (outcome.summaryRequested) {
      await sendSummary(ctx.api, ctx.deps, scope, chat.id, currentMonthKey(scope.tz));
    }
    if (outcome.handled === 0 && !outcome.summaryRequested) {
      if (trigger.explicit) {
        await safeReact(ctx, "🤷");
        await ctx.reply(t(scope.locale, "nothing.explicit", { prefix: prefixOf(scope) }));
      } else {
        await safeReact(ctx, []);
      }
      return;
    }
    await safeReact(ctx, outcome.corrected > 0 && outcome.corrected === outcome.handled ? "👌" : "✍");
  });
}
