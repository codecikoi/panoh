import { DateTime } from "luxon";
import {
  cancelReminder,
  createRecurring,
  createReminder,
  createTransaction,
  deactivateRecurring,
  ensureRemindersFor,
  escapeHtml,
  findLastRecord,
  findRecurringByBotMessage,
  findReminderByBotMessage,
  findTransactionByBotMessage,
  getRates,
  listRecurring,
  log,
  markPaid,
  matchRecurringByName,
  nextDue,
  normalizeCategory,
  softDeleteTransaction,
  t,
  toBase,
  updateRecurring,
  updateReminder,
  updateTransaction,
  type Db,
  type ExtractedItem,
  type RateTable,
  type RecurringPayment,
  type Reminder,
  type Transaction,
} from "@budgie/core";
import type { Api } from "grammy";
import type { BotContext, Scope } from "./context.js";
import * as R from "./render.js";
import { safeEdit } from "./telegram.js";

export type ReplyTarget =
  | { type: "transaction"; row: Transaction }
  | { type: "reminder"; row: Reminder }
  | { type: "recurring"; row: RecurringPayment };

export async function resolveReplyTarget(db: Db, chatId: number, messageId: number): Promise<ReplyTarget | undefined> {
  const tx = await findTransactionByBotMessage(db, chatId, messageId);
  if (tx && tx.status !== "deleted") return { type: "transaction", row: tx };
  const reminder = await findReminderByBotMessage(db, chatId, messageId);
  if (reminder && reminder.status !== "cancelled") return { type: "reminder", row: reminder };
  const recurring = await findRecurringByBotMessage(db, chatId, messageId);
  if (recurring && recurring.active) return { type: "recurring", row: recurring };
  return undefined;
}

export function describeTarget(target: ReplyTarget, tz = "UTC"): string {
  switch (target.type) {
    case "transaction": {
      const r = target.row;
      return `${r.kind} record: amount ${r.amount} ${r.currency}, category ${r.category}, note "${r.note}", date ${r.occurredOn}`;
    }
    case "reminder":
      return `reminder: "${target.row.title}" due ${DateTime.fromJSDate(target.row.dueAt).setZone(tz).toFormat("yyyy-LL-dd HH:mm")} (local time)`;
    case "recurring":
      return `recurring payment: "${target.row.name}" ${target.row.amount ?? "?"} ${target.row.currency} on day ${target.row.dayOfMonth}`;
  }
}

export interface ApplyMeta {
  chatId: number;
  sourceMessageId: number;
  rawText: string;
  isPrivate: boolean;
  replyTarget?: ReplyTarget;
}

export interface ApplyOutcome {
  handled: number;
  corrected: number;
  summaryRequested: boolean;
}

function replyOpts(meta: ApplyMeta, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return meta.isPrivate ? extra : { reply_parameters: { message_id: meta.sourceMessageId }, ...extra };
}

export async function applyItems(ctx: BotContext, items: ExtractedItem[], meta: ApplyMeta): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { handled: 0, corrected: 0, summaryRequested: false };
  if (!items.length) return outcome;
  const { rates } = await getRates(ctx.deps.db);
  for (const item of items.slice(0, 6)) {
    try {
      switch (item.kind) {
        case "expense":
        case "income":
          if (await handleTransaction(ctx, item, meta, rates)) outcome.handled++;
          break;
        case "reminder":
          if (await handleReminder(ctx, item, meta)) outcome.handled++;
          break;
        case "recurring_payment":
          if (await handleRecurring(ctx, item, meta)) outcome.handled++;
          break;
        case "payment_done":
          if (await handlePaymentDone(ctx, item, meta, rates)) outcome.handled++;
          break;
        case "correction":
          if (await handleCorrection(ctx, item, meta, rates)) {
            outcome.handled++;
            outcome.corrected++;
          }
          break;
        case "cancel_last":
          if (await undoLast(ctx, meta)) outcome.handled++;
          break;
        case "summary_request":
          outcome.summaryRequested = true;
          break;
        case "none":
          break;
      }
    } catch (err) {
      log.error("apply item failed", { err, kind: item.kind });
    }
  }
  return outcome;
}

async function handleTransaction(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta, rates: RateTable): Promise<boolean> {
  const scope = ctx.scope;
  const kind = item.kind === "income" ? "income" : "expense";
  if (item.amount === null) {
    await ctx.reply(t(scope.locale, "ask.amount", { note: escapeHtml(item.note || "…") }), replyOpts(meta));
    return true;
  }
  const amountBase = toBase(item.amount, item.currency, scope.currency, rates);
  const status = item.confidence >= 0.6 ? "confirmed" : "pending";
  const tx = await createTransaction(ctx.deps.db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    kind,
    amount: item.amount,
    currency: item.currency,
    amountBase,
    baseCurrency: scope.currency,
    category: item.category ?? normalizeCategory(kind, null),
    note: item.note,
    occurredOn: item.date,
    status,
    confidence: item.confidence,
    rawText: meta.rawText.slice(0, 500),
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const text = status === "pending" ? R.txPendingText(scope, tx) : R.txText(scope, tx);
  const sent = await ctx.reply(text, replyOpts(meta, { reply_markup: R.txKeyboard(scope, tx) }));
  await updateTransaction(ctx.deps.db, tx.id, { botMessageId: sent.message_id });
  return true;
}

async function handleReminder(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const title = item.note || item.target || "…";
  if (!item.dueAt) {
    await ctx.reply(t(scope.locale, "ask.when", { title: escapeHtml(title) }), replyOpts(meta));
    return true;
  }
  const defaultTime = !item.timeSpecified;
  const reminder = await createReminder(ctx.deps.db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    kind: "reminder",
    title,
    dueAt: item.dueAt,
    defaultTime,
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const sent = await ctx.reply(
    R.reminderText(scope, reminder, { defaultTime }),
    replyOpts(meta, { reply_markup: R.reminderKeyboard(scope, reminder, { offerTime: defaultTime }) }),
  );
  await updateReminder(ctx.deps.db, reminder.id, { botMessageId: sent.message_id });
  return true;
}

async function handleRecurring(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const name = item.note || item.target || "payment";
  if (!item.dayOfMonth) {
    await ctx.reply(t(scope.locale, "ask.day", { name: escapeHtml(name) }), replyOpts(meta));
    return true;
  }
  const rp = await createRecurring(ctx.deps.db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    name,
    amount: item.amount,
    currency: item.currency,
    category: item.category ?? "loans",
    dayOfMonth: item.dayOfMonth,
    remindDaysBefore: item.remindDaysBefore,
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  await ensureRemindersFor(ctx.deps.db, rp, scope.household);
  const sent = await ctx.reply(R.recurringText(scope, rp), replyOpts(meta, { reply_markup: R.recurringKeyboard(scope, rp) }));
  await updateRecurring(ctx.deps.db, rp.id, { botMessageId: sent.message_id });
  return true;
}

export async function recordPayment(
  db: Db,
  scope: Scope,
  rp: RecurringPayment,
  period: string,
  override: { amount?: number | null; currency?: string; sourceMessageId?: number; chatId: number; rates: RateTable },
): Promise<Transaction | null> {
  await markPaid(db, rp, period);
  const amount = override.amount ?? rp.amount;
  if (amount === null || amount === undefined) return null;
  const currency = override.amount !== undefined && override.amount !== null && override.currency ? override.currency : rp.currency;
  return createTransaction(db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    kind: "expense",
    amount,
    currency,
    amountBase: toBase(amount, currency, scope.currency, override.rates),
    baseCurrency: scope.currency,
    category: rp.category,
    note: rp.name,
    occurredOn: DateTime.now().setZone(scope.tz).toISODate()!,
    status: "confirmed",
    confidence: 1,
    recurringPaymentId: rp.id,
    period,
    sourceChatId: override.chatId,
    sourceMessageId: override.sourceMessageId ?? null,
  });
}

async function handlePaymentDone(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta, rates: RateTable): Promise<boolean> {
  const scope = ctx.scope;
  const list = await listRecurring(ctx.deps.db, scope.household.id);
  const match = matchRecurringByName(list, item.target) ?? matchRecurringByName(list, item.note);
  if (!match) {
    return handleTransaction(ctx, { ...item, kind: "expense", category: item.category ?? "loans" }, meta, rates);
  }
  const due = nextDue(match, scope.tz);
  const tx = await recordPayment(ctx.deps.db, scope, match, due.period, {
    amount: item.amount,
    currency: item.currency,
    sourceMessageId: meta.sourceMessageId,
    chatId: meta.chatId,
    rates,
  });
  const text = R.paidText(scope, match.name, tx?.amount ?? null, tx?.currency ?? match.currency);
  const sent = await ctx.reply(text, replyOpts(meta, tx ? { reply_markup: R.txKeyboard(scope, tx) } : {}));
  if (tx) await updateTransaction(ctx.deps.db, tx.id, { botMessageId: sent.message_id });
  return true;
}

async function handleCorrection(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta, rates: RateTable): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  let target = meta.replyTarget;
  if (!target) {
    const last = await findLastRecord(db, scope.household.id);
    if (last && Date.now() - last.row.createdAt.getTime() < 15 * 60 * 1000) target = last;
  }
  if (!target) {
    await ctx.reply(t(scope.locale, "hint.not_found"), replyOpts(meta));
    return false;
  }
  const c = item.changed;
  if (target.type === "transaction") {
    const row = target.row;
    const amount = c.amount ?? row.amount;
    const currency = c.currency ?? row.currency;
    const updated = await updateTransaction(db, row.id, {
      amount,
      currency,
      amountBase: toBase(amount, currency, scope.currency, rates),
      category: c.category ?? row.category,
      note: c.note ?? row.note,
      occurredOn: c.date ?? row.occurredOn,
      status: row.status === "pending" ? "confirmed" : row.status,
    });
    if (!updated) return false;
    await refreshConfirmation(ctx.api, scope, meta.chatId, row.botMessageId, R.txText(scope, updated), R.txKeyboard(scope, updated), meta);
    return true;
  }
  if (target.type === "reminder") {
    const row = target.row;
    if (row.status === "done" || row.status === "cancelled") {
      await ctx.reply(t(scope.locale, "hint.not_found"), replyOpts(meta));
      return false;
    }
    const orig = DateTime.fromJSDate(row.dueAt).setZone(scope.tz);
    let dueAt = row.dueAt;
    let defaultTime = row.defaultTime;
    if (item.dueAt && item.timeSpecified) {
      // Explicit time (possibly with a new date): take it as is.
      dueAt = item.dueAt;
      defaultTime = false;
    } else if (item.dueAt || c.date) {
      // Only the date moved: keep the time of day the reminder already had (default or explicit).
      const newDate = item.dueAt ? DateTime.fromJSDate(item.dueAt).setZone(scope.tz) : DateTime.fromISO(c.date!, { zone: scope.tz });
      const hour = row.defaultTime ? scope.household.reminderHour : orig.hour;
      const minute = row.defaultTime ? 0 : orig.minute;
      dueAt = newDate.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
    }
    const updated = await updateReminder(db, row.id, { title: c.note ?? row.title, dueAt, defaultTime, status: "scheduled" });
    if (!updated) return false;
    await refreshConfirmation(
      ctx.api,
      scope,
      meta.chatId,
      row.botMessageId,
      R.reminderText(scope, updated, { defaultTime }),
      R.reminderKeyboard(scope, updated, { offerTime: defaultTime }),
      meta,
    );
    return true;
  }
  const row = target.row;
  const updated = await updateRecurring(db, row.id, {
    amount: c.amount ?? row.amount,
    currency: c.currency ?? row.currency,
    name: c.note ?? row.name,
    dayOfMonth: item.dayOfMonth ?? row.dayOfMonth,
    category: c.category ?? row.category,
  });
  if (!updated) return false;
  await ensureRemindersFor(db, updated, scope.household);
  await refreshConfirmation(ctx.api, scope, meta.chatId, row.botMessageId, R.recurringText(scope, updated), R.recurringKeyboard(scope, updated), meta);
  return true;
}

async function refreshConfirmation(
  api: Api,
  scope: Scope,
  chatId: number,
  botMessageId: number | null,
  text: string,
  keyboard: ReturnType<typeof R.txKeyboard>,
  meta: ApplyMeta,
): Promise<void> {
  const edited = botMessageId ? await safeEdit(api, chatId, botMessageId, text, keyboard) : false;
  if (!edited) {
    await api.sendMessage(chatId, `${t(scope.locale, "confirm.updated")}\n${text}`, {
      reply_markup: keyboard,
      ...(meta.isPrivate ? {} : { reply_parameters: { message_id: meta.sourceMessageId } }),
    });
  }
}

/** Deletes the most recent record and strikes through its confirmation. Used by "undo" and /undo. */
export async function undoLast(ctx: BotContext, meta?: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const last = await findLastRecord(db, scope.household.id);
  const opts = meta ? replyOpts(meta) : {};
  if (!last) {
    await ctx.reply(t(scope.locale, "undo.nothing"), opts);
    return false;
  }
  let what = "";
  if (last.type === "transaction") {
    await softDeleteTransaction(db, last.row.id);
    what = R.txText(scope, last.row);
  } else if (last.type === "reminder") {
    await cancelReminder(db, last.row.id);
    what = R.reminderText(scope, last.row);
  } else {
    await deactivateRecurring(db, last.row.id);
    what = R.recurringText(scope, last.row);
  }
  const chatId = last.row.sourceChatId ?? scope.household.telegramChatId;
  if (last.row.botMessageId) await safeEdit(ctx.api, chatId, last.row.botMessageId, R.deletedText(scope, what));
  await ctx.reply(t(scope.locale, "undo.done", { what }), opts);
  return true;
}
