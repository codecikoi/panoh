import type { Bot } from "grammy";
import { DateTime } from "luxon";
import {
  archiveCustomCategory,
  cancelPlan,
  cancelReminder,
  currentMonthKey,
  customCategoryId,
  deleteBalance,
  getBalance,
  loadCategoryLookup,
  removeAlert,
  getGoal,
  getPlan,
  loadMonthlySummary,
  removeBudget,
  updateGoal,
  currencyName,
  deactivateRecurring,
  escapeHtml,
  formatDateTime,
  getRates,
  getRecurring,
  getReminder,
  getTransaction,
  hasLocale,
  isValidMonthKey,
  periodFromKey,
  isValidTimezone,
  languageName,
  log,
  markReminderDone,
  rescheduleDefaultHour,
  snoozeReminder,
  softDeleteTransaction,
  t,
  toBase,
  updateHousehold,
  updateReminder,
  updateTransaction,
} from "@madat/core";
import type { BotContext } from "./context.js";
import * as R from "./render.js";
import { applyCorrection, budgetLineFor, correctionOf, loadTarget, notifyAlerts, payPlan, recordPayment } from "./actions.js";
import { sendSummary } from "./summary.js";
import { sendReport } from "../report/send.js";
import { safeEdit } from "./telegram.js";

export function registerCallbacks(bot: Bot<BotContext>): void {
  bot.on("callback_query:data", async (ctx) => {
    const [ns = "", action = "", ...rest] = ctx.callbackQuery.data.split(":");
    const scope = ctx.scope;
    const db = ctx.deps.db;
    const message = ctx.callbackQuery.message;
    const chatId = message?.chat.id ?? scope.household.telegramChatId;
    const messageId = message?.message_id;
    const currentText = message && "text" in message ? (message.text ?? "") : "";
    const edit = async (text: string, keyboard?: ReturnType<typeof R.txKeyboard>) => {
      if (messageId) await safeEdit(ctx.api, chatId, messageId, text, keyboard);
    };
    const answer = (text?: string, alert = false) => ctx.answerCallbackQuery(text ? { text, show_alert: alert } : undefined).catch(() => undefined);

    try {
      if (ns === "tx") {
        const id = Number(rest[0]);
        const tx = await getTransaction(db, id);
        if (!tx || tx.householdId !== scope.household.id || tx.status === "deleted") return answer(t(scope.locale, "hint.not_found"));
        if (action === "del" || action === "no") {
          await softDeleteTransaction(db, id);
          await edit(action === "no" ? t(scope.locale, "confirm.not_recorded") : R.deletedText(scope, currentText));
          if (tx.status === "confirmed") await notifyAlerts(ctx.api, ctx.deps, scope, chatId);
          return answer();
        }
        if (action === "yes") {
          const { rates } = await getRates(db);
          const updated = await updateTransaction(db, id, {
            status: "confirmed",
            amountBase: toBase(tx.amount, tx.currency, scope.currency, rates),
            baseCurrency: scope.currency,
          });
          if (updated) await edit(R.txText(scope, updated) + (await budgetLineFor(db, scope, updated)), R.txKeyboard(scope, updated));
          await notifyAlerts(ctx.api, ctx.deps, scope, chatId);
          return answer();
        }
        if (action === "edit") return answer(t(scope.locale, "hint.edit"), true);
        return answer();
      }

      if (ns === "rem") {
        const id = Number(rest[0]);
        const reminder = await getReminder(db, id);
        if (!reminder || reminder.householdId !== scope.household.id) return answer(t(scope.locale, "hint.not_found"));
        if (action === "done") {
          await markReminderDone(db, id);
          await edit(t(scope.locale, "alert.done", { title: escapeHtml(reminder.title) }));
          return answer();
        }
        if (action === "del") {
          await cancelReminder(db, id);
          await edit(R.deletedText(scope, currentText));
          return answer();
        }
        if (action === "time") {
          if (reminder.status === "done" || reminder.status === "cancelled") return answer(t(scope.locale, "hint.not_found"));
          if (rest[1] === undefined) {
            await edit(t(scope.locale, "hint.pick_time", { title: escapeHtml(reminder.title) }), R.hourPickerKeyboard(`rem:time:${id}`));
            return answer();
          }
          if (!/^\d{1,2}$/.test(rest[1]) || Number(rest[1]) > 23) return answer();
          const hour = Number(rest[1]);
          const now = DateTime.now().setZone(scope.tz);
          let due = DateTime.fromJSDate(reminder.dueAt).setZone(scope.tz).set({ hour, minute: 0, second: 0, millisecond: 0 });
          // A stale date (already fired) moves to the next occurrence of that hour instead of the past.
          if (due <= now) due = now.set({ hour, minute: 0, second: 0, millisecond: 0 });
          if (due <= now) due = due.plus({ days: 1 });
          const updated = await updateReminder(db, id, { dueAt: due.toJSDate(), defaultTime: false, status: "scheduled" });
          if (updated) await edit(R.reminderText(scope, updated), R.reminderKeyboard(scope, updated));
          return answer(t(scope.locale, "confirm.done"));
        }
        if (action === "snz") {
          const minutes = Number(rest[1]) || 60;
          const until = minutes >= 1440
            ? DateTime.now().setZone(scope.tz).plus({ days: 1 }).set({ hour: scope.household.reminderHour, minute: 0, second: 0, millisecond: 0 }).toJSDate()
            : new Date(Date.now() + minutes * 60_000);
          await snoozeReminder(db, id, until);
          await edit(`${escapeHtml(currentText)}\n${t(scope.locale, "alert.snoozed", { when: formatDateTime(until, scope.tz, scope.locale) })}`);
          return answer();
        }
        return answer();
      }

      if (ns === "rp") {
        const id = Number(rest[0]);
        const rp = await getRecurring(db, id);
        if (!rp || rp.householdId !== scope.household.id) return answer(t(scope.locale, "hint.not_found"));
        if (action === "del") {
          await deactivateRecurring(db, id);
          await edit(R.deletedText(scope, currentText));
          return answer();
        }
        if (action === "paid") {
          const period = rest[1] && /^\d{4}-\d{2}$/.test(rest[1]) ? rest[1] : DateTime.now().setZone(scope.tz).toFormat("yyyy-LL");
          const { rates } = await getRates(db);
          const tx = await recordPayment(db, scope, rp, period, { chatId, rates });
          const text = R.paidText(scope, rp.name, tx?.amount ?? null, tx?.currency ?? rp.currency);
          await edit(text, tx ? R.txKeyboard(scope, tx) : undefined);
          if (tx && messageId) await updateTransaction(db, tx.id, { botMessageId: messageId });
          if (tx) await notifyAlerts(ctx.api, ctx.deps, scope, chatId);
          return answer(t(scope.locale, "confirm.done"));
        }
        return answer();
      }

      if (ns === "plan") {
        const plan = await getPlan(db, Number(rest[0]));
        if (!plan || plan.householdId !== scope.household.id || plan.status !== "planned") return answer(t(scope.locale, "hint.not_found"));
        if (action === "del") {
          await cancelPlan(db, plan.id);
          await edit(R.deletedText(scope, currentText));
          return answer();
        }
        if (action === "paid") {
          const { rates } = await getRates(db);
          const tx = await payPlan(db, scope, plan, { chatId, rates });
          await edit(R.planPaidText(scope, plan, tx) + (await budgetLineFor(db, scope, tx)), R.txKeyboard(scope, tx));
          if (messageId) await updateTransaction(db, tx.id, { botMessageId: messageId });
          await notifyAlerts(ctx.api, ctx.deps, scope, chatId);
          return answer(t(scope.locale, "confirm.done"));
        }
        return answer();
      }

      if (ns === "fix") {
        // Yes/No on a suspicious amount correction: fix:amt:<type>:<id>:<amount> or fix:keep:<type>:<id>
        const target = await loadTarget(db, rest[0] ?? "", Number(rest[1]));
        if (!target || target.row.householdId !== scope.household.id) return answer(t(scope.locale, "hint.not_found"));
        if (action === "amt") {
          const amount = Number(rest[2]);
          if (!Number.isFinite(amount) || amount <= 0) return answer();
          const { rates } = await getRates(db);
          const place = { chatId, isPrivate: message?.chat.type === "private" };
          await applyCorrection(ctx, target, correctionOf({ amount }), place, rates, { trustAmount: true });
          await edit(t(scope.locale, "confirm.updated"));
          return answer(t(scope.locale, "confirm.done"));
        }
        if (action === "keep") {
          const row = target.row as { amount?: number | null; targetAmount?: number | null; currency: string };
          const amount = row.amount ?? row.targetAmount;
          await edit(t(scope.locale, "correction.amount_kept", { amount: amount != null ? R.money(scope, amount, row.currency) : "—" }));
        }
        return answer();
      }

      if (ns === "goal") {
        const goal = await getGoal(db, Number(rest[0]));
        if (!goal || goal.householdId !== scope.household.id || goal.status !== "active") return answer(t(scope.locale, "hint.not_found"));
        if (action === "del") {
          await updateGoal(db, goal.id, { status: "cancelled" });
          await edit(R.deletedText(scope, currentText));
        }
        return answer();
      }

      if (ns === "bud") {
        const category = rest[0] ?? "";
        await removeBudget(db, scope.household.id, category);
        if (action === "rm") {
          // Pressed in the /budgets list: show what is left.
          const stats = (await loadMonthlySummary(db, scope.household, currentMonthKey(scope.tz))).outlook.budgets;
          await edit(R.budgetsListText(scope, stats), stats.length ? R.budgetsKeyboard(scope, stats) : undefined);
        } else {
          await edit(R.deletedText(scope, currentText));
        }
        return answer(t(scope.locale, "confirm.budget_removed", { category: R.catLabel(scope, category) }));
      }

      if (ns === "bal") {
        // 🗑 on a balance checkpoint: the previous one (if any) is current again.
        const balance = await getBalance(db, Number(rest[0]));
        if (!balance || balance.householdId !== scope.household.id) return answer(t(scope.locale, "hint.not_found"));
        if (action === "del") {
          await deleteBalance(db, balance.id);
          await edit(R.deletedText(scope, currentText));
        }
        return answer();
      }

      if (ns === "alr") {
        if (action === "del") {
          const alertScope = rest.join(":");
          await removeAlert(db, scope.household.id, alertScope);
          await edit(R.deletedText(scope, currentText));
          return answer(t(scope.locale, "alert.removed"));
        }
        return answer();
      }

      if (ns === "cat") {
        const id = customCategoryId(rest[0] ?? "");
        if (id === null) return answer();
        const row = await archiveCustomCategory(db, id);
        if (!row || row.householdId !== scope.household.id) return answer(t(scope.locale, "hint.not_found"));
        scope.categories = await loadCategoryLookup(db, scope.household.id);
        if (action === "rm") {
          // Pressed in the /categories list: show what is left.
          await edit(R.categoriesListText(scope), R.categoriesKeyboard(scope));
        } else {
          await edit(R.deletedText(scope, currentText));
        }
        return answer(t(scope.locale, "confirm.category_removed", { name: row.name }).replace(/<[^>]+>/g, ""));
      }

      if (ns === "set") {
        const value = rest.join(":");
        if (action === "cur" && !value) {
          await edit(t(scope.locale, "settings.choose_currency"), R.currencyKeyboard());
          return answer();
        }
        if (action === "tz" && !value) {
          await edit(t(scope.locale, "settings.choose_timezone"), R.timezoneKeyboard());
          return answer();
        }
        if (action === "lang" && !value) {
          await edit(t(scope.locale, "settings.choose_language"), R.languageKeyboard());
          return answer();
        }
        if (action === "name") {
          await edit(t(scope.locale, "rename.current", { name: escapeHtml(R.assistantName(scope)) }), R.settingsKeyboard(scope));
          return answer();
        }
        if (action === "hour" && !value) {
          await edit(t(scope.locale, "settings.choose_reminder_time"), R.hourPickerKeyboard("set:hour"));
          return answer();
        }
        let saved = "";
        if (action === "cur" && /^[A-Z]{3}$/.test(value)) {
          scope.household = await updateHousehold(db, scope.household.id, { baseCurrency: value });
          scope.currency = value;
          saved = `${value} · ${currencyName(value, scope.locale)}`;
        } else if (action === "tz" && isValidTimezone(value)) {
          scope.household = await updateHousehold(db, scope.household.id, { timezone: value });
          scope.tz = value;
          await rescheduleDefaultHour(db, scope.household.id, value, scope.household.reminderHour);
          saved = value;
        } else if (action === "hour" && /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= 23) {
          scope.household = await updateHousehold(db, scope.household.id, { reminderHour: Number(value) });
          await rescheduleDefaultHour(db, scope.household.id, scope.tz, Number(value));
          saved = R.formatHour(Number(value));
        } else if (action === "lang" && hasLocale(value)) {
          scope.household = await updateHousehold(db, scope.household.id, { locale: value });
          scope.locale = value;
          saved = languageName(value, value);
        }
        await edit(R.settingsText(scope), R.settingsKeyboard(scope));
        return answer(saved ? t(scope.locale, "settings.saved", { value: saved }) : undefined);
      }

      if (ns === "rep") {
        const period = periodFromKey(action);
        if (!period) return answer();
        await answer(t(scope.locale, "report.started"));
        void sendReport(ctx.api, ctx.deps, scope, chatId, period);
        return;
      }

      if (ns === "sum") {
        const month = action;
        if (!isValidMonthKey(month) || !messageId) return answer();
        await answer();
        await sendSummary(ctx.api, ctx.deps, scope, chatId, month, { editMessageId: messageId });
        return;
      }
      return answer();
    } catch (err) {
      log.error("callback failed", { err, data: ctx.callbackQuery.data });
      await answer(t(scope.locale, "error.generic"));
    }
  });
}
