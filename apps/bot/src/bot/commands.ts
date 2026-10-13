import type { Bot } from "grammy";
import type { LanguageCode } from "grammy/types";
import {
  availableLocales,
  currentMonthKey,
  effectiveKeywords,
  escapeHtml,
  hasLocale,
  isValidMonthKey,
  isValidTimezone,
  languageName,
  listOpenReminders,
  listRecentTransactions,
  listRecurring,
  nextDue,
  rescheduleDefaultHour,
  shiftMonthKey,
  t,
  updateHousehold,
  type LocaleKey,
} from "@budgie/core";
import type { BotContext } from "./context.js";
import * as R from "./render.js";
import { undoLast } from "./actions.js";
import { sendSummary } from "./summary.js";

export async function ensureWelcome(ctx: BotContext, force = false): Promise<void> {
  const scope = ctx.scope;
  if (scope.household.setupDone && !force) return;
  const isPrivate = ctx.chat?.type === "private";
  const prefix = R.prefixOf(scope);
  if (isPrivate) {
    await ctx.reply(t(scope.locale, "welcome.private", { app: t(scope.locale, "app.name") }));
  } else {
    await ctx.reply(
      t(scope.locale, "welcome.group", {
        app: t(scope.locale, "app.name"),
        prefix: escapeHtml(prefix),
        bot: ctx.me.username,
        currency: scope.currency,
        timezone: scope.tz,
        language: languageName(scope.locale, scope.locale),
      }),
    );
    if (!ctx.me.can_read_all_group_messages) {
      await ctx.reply(t(scope.locale, "welcome.privacy_warning", { prefix: escapeHtml(prefix) }));
    }
  }
  if (!scope.household.setupDone) {
    scope.household = await updateHousehold(ctx.deps.db, scope.household.id, { setupDone: true });
  }
}

function argOf(ctx: BotContext): string {
  return (ctx.match ?? "").toString().trim();
}

export function registerCommands(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    await ensureWelcome(ctx, true);
  });

  bot.command("help", async (ctx) => {
    const scope = ctx.scope;
    await ctx.reply(t(scope.locale, "help", { prefix: escapeHtml(R.prefixOf(scope)), days: scope.household.remindDaysBefore }));
  });

  bot.command("summary", async (ctx) => {
    const scope = ctx.scope;
    const arg = argOf(ctx).toLowerCase();
    let month = currentMonthKey(scope.tz);
    if (["last", "prev", "previous"].includes(arg)) month = shiftMonthKey(month, -1);
    else if (isValidMonthKey(arg)) month = arg;
    await sendSummary(ctx.api, ctx.deps, scope, ctx.chat.id, month);
  });

  bot.command("last", async (ctx) => {
    const rows = await listRecentTransactions(ctx.deps.db, ctx.scope.household.id, 10);
    await ctx.reply(R.lastRecordsText(ctx.scope, rows));
  });

  bot.command("undo", async (ctx) => {
    await undoLast(ctx);
  });

  bot.command("reminders", async (ctx) => {
    const rows = await listOpenReminders(ctx.deps.db, ctx.scope.household.id);
    await ctx.reply(R.remindersListText(ctx.scope, rows));
  });

  bot.command("payments", async (ctx) => {
    const list = await listRecurring(ctx.deps.db, ctx.scope.household.id);
    const rows = list.map((payment) => ({ payment, ...nextDue(payment, ctx.scope.tz) }));
    await ctx.reply(R.paymentsListText(ctx.scope, rows));
  });

  bot.command("settings", async (ctx) => {
    await ctx.reply(R.settingsText(ctx.scope), { reply_markup: R.settingsKeyboard(ctx.scope) });
  });

  bot.command("currency", async (ctx) => {
    const scope = ctx.scope;
    const code = argOf(ctx).toUpperCase();
    if (!code) return ctx.reply(t(scope.locale, "settings.choose_currency"), { reply_markup: R.currencyKeyboard() });
    if (!/^[A-Z]{3}$/.test(code)) return ctx.reply(t(scope.locale, "settings.currency_invalid"));
    scope.household = await updateHousehold(ctx.deps.db, scope.household.id, { baseCurrency: code });
    scope.currency = code;
    await ctx.reply(t(scope.locale, "settings.saved", { value: code }));
  });

  bot.command("timezone", async (ctx) => {
    const scope = ctx.scope;
    const tz = argOf(ctx);
    if (!tz) return ctx.reply(t(scope.locale, "settings.choose_timezone"), { reply_markup: R.timezoneKeyboard() });
    if (!isValidTimezone(tz)) return ctx.reply(t(scope.locale, "settings.timezone_invalid"));
    scope.household = await updateHousehold(ctx.deps.db, scope.household.id, { timezone: tz });
    scope.tz = tz;
    await rescheduleDefaultHour(ctx.deps.db, scope.household.id, tz, scope.household.reminderHour);
    await ctx.reply(t(scope.locale, "settings.saved", { value: tz }));
  });

  bot.command("language", async (ctx) => {
    const scope = ctx.scope;
    const code = argOf(ctx).toLowerCase();
    if (!code) return ctx.reply(t(scope.locale, "settings.choose_language"), { reply_markup: R.languageKeyboard() });
    if (!hasLocale(code)) return ctx.reply(t(scope.locale, "settings.language_invalid", { list: availableLocales().join(", ") }));
    scope.household = await updateHousehold(ctx.deps.db, scope.household.id, { locale: code });
    scope.locale = code;
    await ctx.reply(t(code, "settings.saved", { value: languageName(code, code) }));
  });

  bot.command("keywords", async (ctx) => {
    const scope = ctx.scope;
    const arg = argOf(ctx);
    const triggers = { ...scope.household.triggers };
    const custom = new Set((triggers.keywords ?? []).map((k) => k.toLowerCase()));
    const match = /^(add|remove)\s+(.+)$/i.exec(arg);
    if (match) {
      const words = match[2]!.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
      for (const w of words) match[1]!.toLowerCase() === "add" ? custom.add(w) : custom.delete(w);
      triggers.keywords = [...custom];
      scope.household = await updateHousehold(ctx.deps.db, scope.household.id, { triggers });
      return ctx.reply(t(scope.locale, "keywords.updated", { custom: custom.size ? escapeHtml([...custom].join(", ")) : t(scope.locale, "keywords.none") }));
    }
    const builtin = effectiveKeywords(scope.locale, null).slice(0, 25).join(", ");
    await ctx.reply(
      t(scope.locale, "keywords.current", {
        locale: scope.locale,
        builtin: escapeHtml(builtin) + "…",
        custom: custom.size ? escapeHtml([...custom].join(", ")) : t(scope.locale, "keywords.none"),
      }),
    );
  });

  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    const old = ctx.myChatMember.old_chat_member.status;
    const joined = (status === "member" || status === "administrator") && (old === "left" || old === "kicked");
    if (joined && ctx.chat.type !== "private") await ensureWelcome(ctx, true);
  });
}

const COMMAND_KEYS: { command: string; key: LocaleKey }[] = [
  { command: "summary", key: "cmd.summary" },
  { command: "last", key: "cmd.last" },
  { command: "undo", key: "cmd.undo" },
  { command: "reminders", key: "cmd.reminders" },
  { command: "payments", key: "cmd.payments" },
  { command: "settings", key: "cmd.settings" },
  { command: "keywords", key: "cmd.keywords" },
  { command: "help", key: "cmd.help" },
  { command: "start", key: "cmd.start" },
];

export async function setCommands(bot: Bot<BotContext>): Promise<void> {
  const build = (locale: string) => COMMAND_KEYS.map((c) => ({ command: c.command, description: t(locale, c.key).slice(0, 256) }));
  await bot.api.setMyCommands(build("en"));
  for (const locale of availableLocales()) {
    if (locale === "en" || locale.length !== 2) continue;
    try {
      await bot.api.setMyCommands(build(locale), { language_code: locale as LanguageCode });
    } catch {
      /* unsupported language codes are ignored */
    }
  }
}
