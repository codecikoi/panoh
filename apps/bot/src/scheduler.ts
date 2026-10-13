import type { Api } from "grammy";
import { DateTime } from "luxon";
import {
  cleanupProcessed,
  cleanupStalePending,
  dueReminders,
  ensureRemindersFor,
  getHouseholdById,
  getRecurring,
  listAllActiveRecurring,
  listAllHouseholds,
  listTransactionsForMonth,
  log,
  markReminderSent,
  ratesAreStale,
  refreshRates,
  shiftMonthKey,
  t,
  updateHousehold,
  updateReminder,
  type Household,
} from "@madat/core";
import { scopeFromHousehold, type Deps } from "./bot/context.js";
import { alertKeyboard, alertText } from "./bot/render.js";
import { sendSummary } from "./bot/summary.js";
import { isChatGone } from "./bot/telegram.js";

export interface Scheduler {
  tick: () => Promise<void>;
  start: (intervalMs: number) => void;
  stop: () => void;
}

export function createScheduler(api: Api, deps: Deps): Scheduler {
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  let lastHourly = 0;
  const householdCache = new Map<number, Household>();

  async function household(id: number): Promise<Household | undefined> {
    const cached = householdCache.get(id);
    if (cached) return cached;
    const row = await getHouseholdById(deps.db, id);
    if (row) householdCache.set(id, row);
    return row;
  }

  async function sendDueReminders(): Promise<void> {
    const now = new Date();
    const due = await dueReminders(deps.db, now);
    for (const reminder of due) {
      const h = await household(reminder.householdId);
      if (!h) continue;
      const scope = scopeFromHousehold(h);
      const rp = reminder.recurringPaymentId ? await getRecurring(deps.db, reminder.recurringPaymentId) : undefined;
      if (reminder.recurringPaymentId && (!rp || !rp.active || rp.lastPaidPeriod === reminder.period)) {
        await updateReminder(deps.db, reminder.id, { status: "cancelled" });
        continue;
      }
      try {
        const sent = await api.sendMessage(h.telegramChatId, alertText(scope, reminder, rp), { reply_markup: alertKeyboard(scope, reminder) });
        await markReminderSent(deps.db, reminder.id, sent.message_id);
        if (reminder.botMessageId) {
          // The confirmation's "change time" / "cancel" buttons are meaningless once the alert is out.
          await api
            .editMessageReplyMarkup(reminder.sourceChatId ?? h.telegramChatId, reminder.botMessageId, { reply_markup: { inline_keyboard: [] } })
            .catch(() => undefined);
        }
      } catch (err) {
        if (isChatGone(err)) {
          await updateReminder(deps.db, reminder.id, { status: "cancelled" });
        } else {
          log.error("reminder send failed", { err, reminderId: reminder.id });
        }
      }
    }
  }

  async function scheduleRecurring(): Promise<void> {
    const list = await listAllActiveRecurring(deps.db);
    for (const rp of list) {
      const h = await household(rp.householdId);
      if (!h) continue;
      try {
        await ensureRemindersFor(deps.db, rp, h);
      } catch (err) {
        log.error("recurring scheduling failed", { err, id: rp.id });
      }
    }
  }

  async function monthlySummaries(): Promise<void> {
    const list = await listAllHouseholds(deps.db);
    for (const h of list) {
      const now = DateTime.now().setZone(h.timezone);
      const prevMonth = shiftMonthKey(now.toFormat("yyyy-LL"), -1);
      if (now.day !== h.summaryDay || now.hour < h.summaryHour || h.lastMonthlySummary === prevMonth) continue;
      try {
        const rows = await listTransactionsForMonth(deps.db, h.id, prevMonth);
        await updateHousehold(deps.db, h.id, { lastMonthlySummary: prevMonth });
        householdCache.delete(h.id);
        if (!rows.length) continue;
        const scope = scopeFromHousehold(h);
        await sendSummary(api, deps, scope, h.telegramChatId, prevMonth, { intro: t(h.locale, "summary.monthly_auto") });
      } catch (err) {
        if (!isChatGone(err)) log.error("monthly summary failed", { err, householdId: h.id });
      }
    }
  }

  async function hourlyJobs(): Promise<void> {
    if (Date.now() - lastHourly < 3600 * 1000) return;
    lastHourly = Date.now();
    householdCache.clear();
    try {
      if (await ratesAreStale(deps.db, 24)) await refreshRates(deps.db);
    } catch (err) {
      log.warn("rates refresh failed", { err });
    }
    await cleanupStalePending(deps.db, new Date(Date.now() - 48 * 3600 * 1000));
    await cleanupProcessed(deps.db, new Date(Date.now() - 7 * 24 * 3600 * 1000));
    await scheduleRecurring();
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await hourlyJobs();
      await sendDueReminders();
      await monthlySummaries();
    } catch (err) {
      log.error("scheduler tick failed", { err });
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(intervalMs) {
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
