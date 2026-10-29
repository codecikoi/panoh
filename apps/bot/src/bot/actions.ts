import { DateTime } from "luxon";
import {
  BALANCE_SCOPE,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  TOTAL_BUDGET,
  archiveCustomCategory,
  cancelPlan,
  categoryKind,
  createCustomCategory,
  customCategoryId,
  evaluateAlerts,
  findCustomCategory,
  loadBalance,
  loadCategoryLookup,
  normalizeCategoryName,
  normalizeEmoji,
  setAlert,
  setBalance,
  toCategoryInfo,
  updateBalance,
  cancelReminder,
  completePlan,
  createGoal,
  createPlan,
  currentMonthKey,
  findGoalByBotMessage,
  findPlanByBotMessage,
  formatMonthInline,
  getGoal,
  getPlan,
  getPlanReminder,
  getRecurring,
  getTransaction,
  listActiveGoals,
  listOpenPlans,
  loadBudgetStat,
  loadMonthlySummary,
  makePeriod,
  matchByName,
  normalizeAssistantName,
  updateHousehold,
  plannedTotalForMonth,
  removeBudget,
  schedulePlanReminder,
  setBudget,
  updateGoal,
  updatePlan,
  createRecurring,
  createReminder,
  createTransaction,
  deactivateRecurring,
  describeEdits,
  diffFields,
  listEdits,
  logEdit,
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
  type Goal,
  type Period,
  type Plan,
  type RateTable,
  type RecurringPayment,
  type Reminder,
  type Transaction,
} from "@madat/core";
import { InlineKeyboard, type Api } from "grammy";
import type { BotContext, Deps, Scope } from "./context.js";
import * as R from "./render.js";
import { safeEdit } from "./telegram.js";

export type ReplyTarget =
  | { type: "transaction"; row: Transaction }
  | { type: "reminder"; row: Reminder }
  | { type: "recurring"; row: RecurringPayment }
  | { type: "plan"; row: Plan }
  | { type: "goal"; row: Goal };

export async function resolveReplyTarget(db: Db, chatId: number, messageId: number): Promise<ReplyTarget | undefined> {
  const tx = await findTransactionByBotMessage(db, chatId, messageId);
  if (tx && tx.status !== "deleted") return { type: "transaction", row: tx };
  const reminder = await findReminderByBotMessage(db, chatId, messageId);
  if (reminder?.planId) {
    // A reply to a "planned for today" alert is about the plan itself.
    const plan = await getPlan(db, reminder.planId);
    if (plan && plan.status === "planned") return { type: "plan", row: plan };
  } else if (reminder && reminder.status !== "cancelled") {
    return { type: "reminder", row: reminder };
  }
  const recurring = await findRecurringByBotMessage(db, chatId, messageId);
  if (recurring && recurring.active) return { type: "recurring", row: recurring };
  const plan = await findPlanByBotMessage(db, chatId, messageId);
  if (plan && plan.status === "planned") return { type: "plan", row: plan };
  const goal = await findGoalByBotMessage(db, chatId, messageId);
  if (goal && goal.status === "active") return { type: "goal", row: goal };
  return undefined;
}

export function describeTarget(target: ReplyTarget, tz = "UTC"): string {
  switch (target.type) {
    case "transaction": {
      const r = target.row;
      const asked = r.kind === "expense" && r.category === "other" && !r.note ? " (the bot asked what it was spent on; category not stated yet)" : "";
      return `${r.kind} record: amount ${r.amount} ${r.currency}, category ${r.category}, note "${r.note}", date ${r.occurredOn}${asked}`;
    }
    case "reminder":
      return `reminder: "${target.row.title}" due ${DateTime.fromJSDate(target.row.dueAt).setZone(tz).toFormat("yyyy-LL-dd HH:mm")} (local time)`;
    case "recurring":
      return `recurring payment: "${target.row.name}" ${target.row.amount ?? "?"} ${target.row.currency} on day ${target.row.dayOfMonth}`;
    case "plan": {
      const r = target.row;
      return `planned expense: "${r.title}" ${r.amount} ${r.currency}, category ${r.category}, date ${r.plannedOn}${r.dateApproximate ? " (month only)" : ""}`;
    }
    case "goal": {
      const r = target.row;
      return `savings goal: "${r.title}" ${r.targetAmount === null ? "no target (open-ended stash)" : `target ${r.targetAmount} ${r.currency}`}, deadline ${r.deadline ?? "none"}`;
    }
  }
}

export interface ApplyMeta {
  chatId: number;
  sourceMessageId: number;
  isPrivate: boolean;
  replyTarget?: ReplyTarget;
}

export interface ApplyOutcome {
  handled: number;
  corrected: number;
  /** Replies where the bot asked, explained or answered a question instead of recording. */
  clarified: number;
  summaryRequested: boolean;
  /** A PDF report was asked for: the period, or "ask" when none was named. */
  report?: Period | "ask";
}

function replyOpts(meta: ApplyMeta, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return meta.isPrivate ? extra : { reply_parameters: { message_id: meta.sourceMessageId }, ...extra };
}

export async function applyItems(ctx: BotContext, items: ExtractedItem[], meta: ApplyMeta): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { handled: 0, corrected: 0, clarified: 0, summaryRequested: false };
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
        case "planned_expense":
          if (await handlePlan(ctx, item, meta)) outcome.handled++;
          break;
        case "budget_limit":
        case "budget_remove":
          if (await handleBudget(ctx, item, meta)) outcome.handled++;
          break;
        case "goal":
          if (await handleGoal(ctx, item, meta)) outcome.handled++;
          break;
        case "goal_contribution":
          if (await handleContribution(ctx, item, meta, rates)) outcome.handled++;
          break;
        case "balance_set":
          if (await handleBalanceSet(ctx, item, meta)) outcome.handled++;
          break;
        case "balance_request":
          if (await handleBalanceRequest(ctx, item, meta)) {
            outcome.handled++;
            outcome.clarified++;
          }
          break;
        case "balance_alert":
          if (await handleBalanceAlert(ctx, item, meta)) outcome.handled++;
          break;
        case "category_create":
        case "category_remove":
          if (await handleCategory(ctx, item, meta)) outcome.handled++;
          break;
        case "correction": {
          const result = await handleCorrection(ctx, item, meta, rates);
          if (result !== "missing") outcome.handled++;
          if (result === "changed") outcome.corrected++;
          if (result === "nothing" || result === "asked") outcome.clarified++;
          break;
        }
        case "rename":
          if (item.note) {
            await ctx.reply(await renameAssistant(ctx, item.note), replyOpts(meta));
            outcome.handled++;
          }
          break;
        case "clarify":
          if (item.note) {
            await ctx.reply(escapeHtml(item.note), replyOpts(meta));
            outcome.handled++;
            outcome.clarified++;
          }
          break;
        case "cancel_last":
          if (await undoLast(ctx, meta)) outcome.handled++;
          break;
        case "summary_request":
          outcome.summaryRequested = true;
          break;
        case "report_request":
          outcome.report = (item.hasDate && item.dateTo ? makePeriod(item.date, item.dateTo) : null) ?? "ask";
          outcome.handled++;
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
  // An expense with no stated purpose is kept (as "other") rather than guessed; the bot asks and a reply fixes the category.
  const askCategory = kind === "expense" && (item.category === null || (item.category === "other" && !item.note));
  const status = item.confidence >= 0.6 || askCategory ? "confirmed" : "pending";
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
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const text = status === "pending" ? R.txPendingText(scope, tx) : R.txText(scope, tx) + (await budgetLineFor(ctx.deps.db, scope, tx));
  const question = askCategory ? "\n" + t(scope.locale, "ask.category") : "";
  const sent = await ctx.reply(text + question, replyOpts(meta, { reply_markup: R.txKeyboard(scope, tx) }));
  await updateTransaction(ctx.deps.db, tx.id, { botMessageId: sent.message_id });
  if (status === "confirmed") await notifyAlerts(ctx.api, ctx.deps, scope, meta.chatId);
  return true;
}

/** "🎯 Groceries: 2.6M of 3M (87%)" for a confirmed expense in a category with a monthly limit, plus the month total if set. */
export async function budgetLineFor(db: Db, scope: Scope, tx: Transaction): Promise<string> {
  if (tx.kind !== "expense" || tx.status !== "confirmed") return "";
  const month = tx.occurredOn.slice(0, 7);
  const own = await loadBudgetStat(db, scope.household, tx.category, month, scope.categories);
  const total = await loadBudgetStat(db, scope.household, TOTAL_BUDGET, month, scope.categories);
  return R.budgetLine(scope, own) + R.budgetLine(scope, total);
}

/** Sends the alerts that just fired (balance or limit below a threshold); the scheduler catches anything missed here. */
export async function notifyAlerts(api: Api, deps: Deps, scope: Scope, chatId: number): Promise<void> {
  try {
    for (const event of await evaluateAlerts(deps.db, scope.household)) {
      await api.sendMessage(chatId, R.alertFiredText(scope, event));
    }
  } catch (err) {
    log.error("alerts check failed", { err, householdId: scope.household.id });
  }
}

// ---------- balance, alerts, categories ----------

/** The built-in category whose key or translated name matches, if any. */
function builtinCategoryByName(scope: Scope, name: string): string | undefined {
  const needle = name.trim().toLowerCase();
  return [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].find((k) => k === needle || R.catName(scope, k).toLowerCase() === needle);
}

async function handleBalanceSet(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  if (item.amount === null) {
    await ctx.reply(t(scope.locale, "ask.balance_amount"), replyOpts(meta));
    return true;
  }
  const { balance, previous } = await setBalance(ctx.deps.db, scope.household, {
    amount: item.amount,
    currency: item.currency,
    userId: scope.user?.id ?? null,
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const sent = await ctx.reply(R.balanceSetText(scope, item.amount, item.currency, previous), replyOpts(meta, { reply_markup: R.balanceKeyboard(scope, balance.id) }));
  await updateBalance(ctx.deps.db, balance.id, { botMessageId: sent.message_id });
  await notifyAlerts(ctx.api, ctx.deps, scope, meta.chatId);
  return true;
}

async function handleBalanceRequest(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const summary = await loadMonthlySummary(db, scope.household, currentMonthKey(scope.tz));
  // "How much is left of the month budget" without one set reads as the general question.
  const category = item.category === TOTAL_BUDGET && !summary.outlook.budgets.some((b) => b.category === TOTAL_BUDGET) ? null : item.category;
  const balance = category === null ? await loadBalance(db, scope.household) : null;
  const spent = category === null ? null : (summary.categories.find((c) => c.category === category)?.amount ?? 0);
  await ctx.reply(
    R.balanceAnswerText(scope, { balance, budgets: summary.outlook.budgets, category, spentInCategory: spent, forecast: summary.outlook.forecast }),
    replyOpts(meta),
  );
  return true;
}

async function handleBalanceAlert(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  if (item.amount === null) {
    await ctx.reply(t(scope.locale, "ask.alert_amount"), replyOpts(meta));
    return true;
  }
  // A threshold on "the month budget" when none is set means the money on hand.
  let alertScope = item.category ?? BALANCE_SCOPE;
  if (alertScope === TOTAL_BUDGET && !(await loadBudgetStat(db, scope.household, TOTAL_BUDGET, currentMonthKey(scope.tz)))) alertScope = BALANCE_SCOPE;
  const alert = await setAlert(db, scope.household.id, alertScope, item.amount, item.currency, scope.user?.id ?? null);
  let now: { value: number | null; limit?: number } | null = null;
  if (alertScope === BALANCE_SCOPE) {
    now = { value: (await loadBalance(db, scope.household))?.current ?? null };
  } else {
    const stat = await loadBudgetStat(db, scope.household, alertScope, currentMonthKey(scope.tz), scope.categories);
    now = stat ? { value: stat.remaining, limit: stat.limit } : null;
  }
  await ctx.reply(R.alertSetText(scope, alert, now), replyOpts(meta, { reply_markup: R.alertKeyboardFor(scope, alert) }));
  await notifyAlerts(ctx.api, ctx.deps, scope, meta.chatId);
  return true;
}

async function handleCategory(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const name = normalizeCategoryName(item.note);
  if (!name) {
    await ctx.reply(t(scope.locale, "category.invalid"), replyOpts(meta));
    return true;
  }
  if (item.kind === "category_remove") {
    const own = findCustomCategory(scope.categories, null, name);
    if (!own) {
      // A built-in name: say so instead of pretending it was removed.
      const builtin = builtinCategoryByName(scope, name);
      await ctx.reply(t(scope.locale, builtin ? "category.builtin" : "category.not_found", { name: escapeHtml(name) }), replyOpts(meta));
      return true;
    }
    await archiveCustomCategory(db, customCategoryId(own.key)!);
    scope.categories = await loadCategoryLookup(db, scope.household.id);
    await ctx.reply(t(scope.locale, "confirm.category_removed", { name: escapeHtml(own.name) }), replyOpts(meta));
    return true;
  }
  const kind = item.target === "income" ? "income" : "expense";
  const existing = findCustomCategory(scope.categories, kind, name);
  const builtin = builtinCategoryByName(scope, name);
  if (existing || builtin) {
    const emoji = existing?.emoji ?? R.catLabel(scope, builtin!).split(" ")[0]!;
    const label = existing ? escapeHtml(existing.name) : R.catName(scope, builtin!);
    await ctx.reply(t(scope.locale, "confirm.category_exists", { emoji, name: label }), replyOpts(meta));
    return true;
  }
  const row = await createCustomCategory(db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    kind,
    name,
    emoji: normalizeEmoji(item.emoji) ?? (kind === "income" ? "💵" : "📦"),
  });
  scope.categories = await loadCategoryLookup(db, scope.household.id);
  const info = toCategoryInfo(row);
  await ctx.reply(R.categoryCreatedText(scope, info), replyOpts(meta, { reply_markup: R.categoryKeyboard(scope, info) }));
  return true;
}

/** How a plan changes the month: free money / shortfall for this month, the planned total for a later month. */
async function planImpact(db: Db, scope: Scope, plan: Plan): Promise<string> {
  const month = plan.plannedOn.slice(0, 7);
  const current = currentMonthKey(scope.tz);
  if (month <= current) {
    const forecast = (await loadMonthlySummary(db, scope.household, current)).outlook.forecast;
    if (!forecast) return "";
    return forecast.free >= 0
      ? t(scope.locale, "confirm.plan_free", { amount: R.money(scope, forecast.free) })
      : t(scope.locale, "confirm.plan_short", { amount: R.money(scope, -forecast.free) });
  }
  const { rates } = await getRates(db);
  const total = plannedTotalForMonth(await listOpenPlans(db, scope.household.id), month, scope.currency, rates);
  return t(scope.locale, "confirm.plan_month_total", { month: formatMonthInline(month, scope.locale), amount: R.money(scope, total) });
}

function localTime(date: Date, tz: string): { hour: number; minute: number } {
  const dt = DateTime.fromJSDate(date).setZone(tz);
  return { hour: dt.hour, minute: dt.minute };
}

async function handlePlan(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const title = item.note || item.target || "…";
  if (item.amount === null) {
    await ctx.reply(t(scope.locale, "ask.amount", { note: escapeHtml(title) }), replyOpts(meta));
    return true;
  }
  if (!item.hasDate) {
    await ctx.reply(t(scope.locale, "ask.plan_when", { title: escapeHtml(title) }), replyOpts(meta));
    return true;
  }
  const plan = await createPlan(db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    title,
    amount: item.amount,
    currency: item.currency,
    category: item.category ?? "other",
    plannedOn: item.date,
    dateApproximate: item.dateApproximate,
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const time = item.timeSpecified && item.dueAt && !item.dateApproximate ? localTime(item.dueAt, scope.tz) : null;
  await schedulePlanReminder(db, plan, scope.household, time);
  const text = R.planText(scope, plan) + (await planImpact(db, scope, plan));
  const sent = await ctx.reply(text, replyOpts(meta, { reply_markup: R.planKeyboard(scope, plan) }));
  await updatePlan(db, plan.id, { botMessageId: sent.message_id });
  return true;
}

async function handleBudget(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const category = item.category;
  if (!category) {
    await ctx.reply(t(scope.locale, "ask.budget_category"), replyOpts(meta));
    return true;
  }
  if (item.kind === "budget_remove") {
    await removeBudget(db, scope.household.id, category);
    await ctx.reply(t(scope.locale, "confirm.budget_removed", { category: R.catLabel(scope, category) }), replyOpts(meta));
    return true;
  }
  if (item.amount === null) {
    await ctx.reply(t(scope.locale, "ask.amount", { note: R.catLabel(scope, category) }), replyOpts(meta));
    return true;
  }
  await setBudget(db, scope.household.id, category, item.amount, item.currency);
  const stat = await loadBudgetStat(db, scope.household, category, currentMonthKey(scope.tz));
  await ctx.reply(
    R.budgetConfirmText(scope, category, item.amount, item.currency, stat),
    replyOpts(meta, { reply_markup: new InlineKeyboard().text(t(scope.locale, "btn.delete"), `bud:del:${category}`) }),
  );
  return true;
}

async function goalStat(db: Db, scope: Scope, goalId: number) {
  return (await loadMonthlySummary(db, scope.household, currentMonthKey(scope.tz))).outlook.goals.find((g) => g.id === goalId);
}

async function handleGoal(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const title = item.note || item.target || "…";
  // No amount means an open-ended stash: contributions are counted, nothing to reach.
  const goal = await createGoal(db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    title,
    targetAmount: item.amount,
    currency: item.currency,
    deadline: item.hasDate ? item.date : null,
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const sent = await ctx.reply(
    R.goalText(scope, goal, await goalStat(db, scope, goal.id)),
    replyOpts(meta, { reply_markup: R.goalKeyboard(scope, goal) }),
  );
  await updateGoal(db, goal.id, { botMessageId: sent.message_id });
  return true;
}

async function handleContribution(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta, rates: RateTable): Promise<boolean> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const goals = await listActiveGoals(db, scope.household.id);
  const goal =
    matchByName(goals, (g) => g.title, item.target) ??
    matchByName(goals, (g) => g.title, item.note) ??
    (goals.length === 1 ? goals[0] : undefined);
  if (!goal || item.amount === null) {
    return handleTransaction(ctx, { ...item, kind: "expense", category: "savings" }, meta, rates);
  }
  const tx = await createTransaction(db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    kind: "expense",
    amount: item.amount,
    currency: item.currency,
    amountBase: toBase(item.amount, item.currency, scope.currency, rates),
    baseCurrency: scope.currency,
    category: "savings",
    note: goal.title,
    occurredOn: item.date,
    status: "confirmed",
    confidence: item.confidence,
    goalId: goal.id,
    sourceChatId: meta.chatId,
    sourceMessageId: meta.sourceMessageId,
  });
  const stat = await goalStat(db, scope, goal.id);
  const text = stat ? R.contributionText(scope, tx, stat) : R.txText(scope, tx);
  const sent = await ctx.reply(text, replyOpts(meta, { reply_markup: R.txKeyboard(scope, tx) }));
  await updateTransaction(db, tx.id, { botMessageId: sent.message_id });
  await notifyAlerts(ctx.api, ctx.deps, scope, meta.chatId);
  return true;
}

/** Records the expense for a planned item and closes the plan. */
export async function payPlan(
  db: Db,
  scope: Scope,
  plan: Plan,
  override: { amount?: number | null; currency?: string; sourceMessageId?: number; chatId: number; rates: RateTable },
): Promise<Transaction> {
  const custom = override.amount !== undefined && override.amount !== null;
  const amount = custom ? override.amount! : plan.amount;
  const currency = custom && override.currency ? override.currency : plan.currency;
  const tx = await createTransaction(db, {
    householdId: scope.household.id,
    userId: scope.user?.id ?? null,
    kind: "expense",
    amount,
    currency,
    amountBase: toBase(amount, currency, scope.currency, override.rates),
    baseCurrency: scope.currency,
    category: plan.category,
    note: plan.title,
    occurredOn: DateTime.now().setZone(scope.tz).toISODate()!,
    status: "confirmed",
    confidence: 1,
    planId: plan.id,
    sourceChatId: override.chatId,
    sourceMessageId: override.sourceMessageId ?? null,
  });
  await completePlan(db, plan.id);
  return tx;
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
    const plans = await listOpenPlans(ctx.deps.db, scope.household.id);
    const plan = matchByName(plans, (p) => p.title, item.target) ?? matchByName(plans, (p) => p.title, item.note);
    if (plan) {
      const tx = await payPlan(ctx.deps.db, scope, plan, {
        amount: item.amount,
        currency: item.currency,
        sourceMessageId: meta.sourceMessageId,
        chatId: meta.chatId,
        rates,
      });
      const text = R.planPaidText(scope, plan, tx) + (await budgetLineFor(ctx.deps.db, scope, tx));
      const sent = await ctx.reply(text, replyOpts(meta, { reply_markup: R.txKeyboard(scope, tx) }));
      await updateTransaction(ctx.deps.db, tx.id, { botMessageId: sent.message_id });
      await notifyAlerts(ctx.api, ctx.deps, scope, meta.chatId);
      return true;
    }
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
  if (tx) {
    await updateTransaction(ctx.deps.db, tx.id, { botMessageId: sent.message_id });
    await notifyAlerts(ctx.api, ctx.deps, scope, meta.chatId);
  }
  return true;
}

/** Where a correction came from: the chat and, in groups, the user message to answer. */
export interface ReplyPlace {
  chatId: number;
  isPrivate: boolean;
  replyTo?: number;
}

/** changed: applied · nothing: nothing to change (the user was asked) · asked: an amount waits for a yes/no · missing: no live record. */
export type CorrectionResult = "changed" | "nothing" | "asked" | "missing";

const RECENT_RECORD_MS = 30 * 60 * 1000;

/** The newest record of the household if it was created recently enough to be what a message refers to. */
export async function recentRecord(db: Db, householdId: number): Promise<ReplyTarget | undefined> {
  const last = await findLastRecord(db, householdId);
  return last && Date.now() - last.row.createdAt.getTime() < RECENT_RECORD_MS ? last : undefined;
}

/** Gives the assistant a new name in this chat (or back to the default) and returns the reply text. */
export async function renameAssistant(ctx: BotContext, raw: string): Promise<string> {
  const scope = ctx.scope;
  const name = normalizeAssistantName(raw);
  if (name === "invalid") return t(scope.locale, "rename.invalid");
  scope.household = await updateHousehold(ctx.deps.db, scope.household.id, { assistantName: name });
  if (name === null) return t(scope.locale, "rename.reset");
  return t(scope.locale, "rename.done", { name: escapeHtml(name) });
}

/** Loads a live record by the type/id pair used in callback data. */
export async function loadTarget(db: Db, type: string, id: number): Promise<ReplyTarget | undefined> {
  if (!Number.isInteger(id)) return undefined;
  switch (type) {
    case "transaction": {
      const row = await getTransaction(db, id);
      return row && row.status !== "deleted" ? { type, row } : undefined;
    }
    case "plan": {
      const row = await getPlan(db, id);
      return row && row.status === "planned" ? { type, row } : undefined;
    }
    case "goal": {
      const row = await getGoal(db, id);
      return row && row.status === "active" ? { type, row } : undefined;
    }
    case "recurring": {
      const row = await getRecurring(db, id);
      return row && row.active ? { type, row } : undefined;
    }
    default:
      return undefined;
  }
}

/** A correction item that changes only the given fields. */
export function correctionOf(changed: ExtractedItem["changed"]): ExtractedItem {
  return {
    kind: "correction",
    amount: changed.amount ?? null,
    currency: changed.currency ?? "",
    category: null,
    note: "",
    date: "",
    hasDate: false,
    dateTo: null,
    dateApproximate: false,
    dueAt: null,
    dayOfMonth: null,
    remindDaysBefore: null,
    target: null,
    emoji: null,
    timeSpecified: false,
    confidence: 1,
    changed,
  };
}

/** Target description plus its correction history, for the model. */
export async function describeWithHistory(db: Db, target: ReplyTarget, tz: string): Promise<string> {
  const edits = await listEdits(db, target.type, target.row.id);
  const base = describeTarget(target, tz);
  return edits.length ? `${base}\nEdit history (oldest first):\n${describeEdits(edits)}` : base;
}

function amountOf(target: ReplyTarget): { amount: number; currency: string } | null {
  switch (target.type) {
    case "transaction":
    case "plan":
      return { amount: target.row.amount, currency: target.row.currency };
    case "goal":
      return target.row.targetAmount === null ? null : { amount: target.row.targetAmount, currency: target.row.currency };
    case "recurring":
      return target.row.amount === null ? null : { amount: target.row.amount, currency: target.row.currency };
    case "reminder":
      return null;
  }
}

/** A new amount a thousand times off the current one is far more likely a misread (a day, a typo) than a fix. */
function implausibleAmount(current: number | undefined, next: number | undefined, currencyGiven: boolean): boolean {
  if (!current || !next || currencyGiven) return false;
  const ratio = next / current;
  return ratio >= 1000 || ratio <= 0.001;
}

function placeOpts(place: ReplyPlace, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return place.isPrivate || !place.replyTo ? extra : { reply_parameters: { message_id: place.replyTo }, ...extra };
}

async function handleCorrection(ctx: BotContext, item: ExtractedItem, meta: ApplyMeta, rates: RateTable): Promise<CorrectionResult> {
  const scope = ctx.scope;
  const target = meta.replyTarget ?? (await recentRecord(ctx.deps.db, scope.household.id));
  if (!target) {
    await ctx.reply(t(scope.locale, "hint.not_found"), replyOpts(meta));
    return "missing";
  }
  return applyCorrection(ctx, target, item, { chatId: meta.chatId, isPrivate: meta.isPrivate, replyTo: meta.sourceMessageId }, rates);
}

/**
 * Applies a correction to a record, logs what changed and refreshes its confirmation.
 * A suspicious amount is held back and confirmed with Yes/No buttons; a correction that changes nothing is said so.
 */
export async function applyCorrection(
  ctx: BotContext,
  target: ReplyTarget,
  item: ExtractedItem,
  place: ReplyPlace,
  rates: RateTable,
  options: { trustAmount?: boolean } = {},
): Promise<CorrectionResult> {
  const scope = ctx.scope;
  const changes = { ...item.changed };
  const current = amountOf(target);
  let held: number | undefined;
  if (!options.trustAmount && implausibleAmount(current?.amount, changes.amount, changes.currency !== undefined)) {
    held = changes.amount;
    delete changes.amount;
  }
  const applied = await applyChanges(ctx, target, { ...item, changed: changes }, place, rates);
  if (applied === null) return "missing";
  if (held !== undefined && current) {
    const keyboard = new InlineKeyboard()
      .text(t(scope.locale, "btn.yes"), `fix:amt:${target.type}:${target.row.id}:${held}`)
      .text(t(scope.locale, "btn.no"), `fix:keep:${target.type}:${target.row.id}`);
    await ctx.api.sendMessage(
      place.chatId,
      t(scope.locale, "correction.confirm_amount", {
        old: R.money(scope, current.amount, current.currency),
        new: R.money(scope, held, current.currency),
      }),
      placeOpts(place, { reply_markup: keyboard }),
    );
    return "asked";
  }
  if (!applied) {
    await ctx.api.sendMessage(place.chatId, t(scope.locale, "correction.nothing"), placeOpts(place));
    return "nothing";
  }
  return "changed";
}

/** true: changed and logged · false: nothing would change · null: the record is finished or gone. */
async function applyChanges(ctx: BotContext, target: ReplyTarget, item: ExtractedItem, place: ReplyPlace, rates: RateTable): Promise<boolean | null> {
  const scope = ctx.scope;
  const db = ctx.deps.db;
  const hid = scope.household.id;
  const c = item.changed;
  if (target.type === "transaction") {
    const row = target.row;
    // A category of the other side (an income category on an expense) is not applied.
    const category = c.category !== undefined && categoryKind(c.category, scope.categories) === row.kind ? c.category : row.category;
    const next = {
      amount: c.amount ?? row.amount,
      currency: c.currency ?? row.currency,
      category,
      note: c.note ?? row.note,
      occurredOn: c.date ?? row.occurredOn,
    };
    const diff = diffFields(row, next);
    if (!diff) return false;
    const updated = await updateTransaction(db, row.id, {
      ...next,
      amountBase: toBase(next.amount, next.currency, scope.currency, rates),
      status: row.status === "pending" ? "confirmed" : row.status,
    });
    if (!updated) return null;
    await logEdit(db, hid, "transaction", row.id, diff);
    const text = R.txText(scope, updated) + (await budgetLineFor(db, scope, updated));
    await refreshConfirmation(ctx.api, scope, row.botMessageId, text, R.txKeyboard(scope, updated), place);
    await notifyAlerts(ctx.api, ctx.deps, scope, place.chatId);
    return true;
  }
  if (target.type === "plan") {
    const row = target.row;
    const reminder = await getPlanReminder(db, row.id);
    let plannedOn = c.date ?? row.plannedOn;
    let dateApproximate = c.date ? c.dateApproximate === true : row.dateApproximate;
    // Keep an explicit time of day the plan reminder already had; take a new one when the reply names it.
    const before = reminder && !reminder.defaultTime ? localTime(reminder.dueAt, scope.tz) : null;
    let time = before;
    if (item.dueAt && item.timeSpecified) {
      time = localTime(item.dueAt, scope.tz);
      if (!c.date) {
        plannedOn = DateTime.fromJSDate(item.dueAt).setZone(scope.tz).toISODate()!;
        dateApproximate = false;
      }
    }
    if (dateApproximate) time = null;
    const hhmm = (v: { hour: number; minute: number } | null) => (v ? `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}` : null);
    const next = {
      amount: c.amount ?? row.amount,
      currency: c.currency ?? row.currency,
      category: c.category ?? row.category,
      title: c.note ?? row.title,
      plannedOn,
      dateApproximate,
      time: hhmm(time),
    };
    const diff = diffFields({ ...row, time: hhmm(before) }, next);
    if (!diff) return false;
    const { time: _time, ...fields } = next;
    const updated = await updatePlan(db, row.id, fields);
    if (!updated) return null;
    await logEdit(db, hid, "plan", row.id, diff);
    await schedulePlanReminder(db, updated, scope.household, time);
    const text = R.planText(scope, updated) + (await planImpact(db, scope, updated));
    await refreshConfirmation(ctx.api, scope, row.botMessageId, text, R.planKeyboard(scope, updated), place);
    return true;
  }
  if (target.type === "goal") {
    const row = target.row;
    const next = {
      targetAmount: c.amount ?? row.targetAmount,
      currency: c.currency ?? row.currency,
      title: c.note ?? row.title,
      deadline: c.date ?? row.deadline,
    };
    const diff = diffFields(row, next);
    if (!diff) return false;
    const updated = await updateGoal(db, row.id, next);
    if (!updated) return null;
    await logEdit(db, hid, "goal", row.id, diff);
    const text = R.goalText(scope, updated, await goalStat(db, scope, updated.id));
    await refreshConfirmation(ctx.api, scope, row.botMessageId, text, R.goalKeyboard(scope, updated), place);
    return true;
  }
  if (target.type === "reminder") {
    const row = target.row;
    if (row.status === "done" || row.status === "cancelled") {
      await ctx.api.sendMessage(place.chatId, t(scope.locale, "hint.not_found"), placeOpts(place));
      return null;
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
    const next = { title: c.note ?? row.title, dueAt, defaultTime };
    const diff = diffFields(row, next);
    if (!diff) return false;
    const updated = await updateReminder(db, row.id, { ...next, status: "scheduled" });
    if (!updated) return null;
    await logEdit(db, hid, "reminder", row.id, diff);
    await refreshConfirmation(
      ctx.api,
      scope,
      row.botMessageId,
      R.reminderText(scope, updated, { defaultTime }),
      R.reminderKeyboard(scope, updated, { offerTime: defaultTime }),
      place,
    );
    return true;
  }
  const row = target.row;
  const next = {
    amount: c.amount ?? row.amount,
    currency: c.currency ?? row.currency,
    name: c.note ?? row.name,
    dayOfMonth: item.dayOfMonth ?? row.dayOfMonth,
    category: c.category ?? row.category,
  };
  const diff = diffFields(row, next);
  if (!diff) return false;
  const updated = await updateRecurring(db, row.id, next);
  if (!updated) return null;
  await logEdit(db, hid, "recurring", row.id, diff);
  await ensureRemindersFor(db, updated, scope.household);
  await refreshConfirmation(ctx.api, scope, row.botMessageId, R.recurringText(scope, updated), R.recurringKeyboard(scope, updated), place);
  return true;
}

async function refreshConfirmation(
  api: Api,
  scope: Scope,
  botMessageId: number | null,
  text: string,
  keyboard: ReturnType<typeof R.txKeyboard>,
  place: ReplyPlace,
): Promise<void> {
  const edited = botMessageId ? await safeEdit(api, place.chatId, botMessageId, text, keyboard) : false;
  if (!edited) {
    await api.sendMessage(place.chatId, `${t(scope.locale, "confirm.updated")}\n${text}`, placeOpts(place, { reply_markup: keyboard }));
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
  } else if (last.type === "recurring") {
    await deactivateRecurring(db, last.row.id);
    what = R.recurringText(scope, last.row);
  } else if (last.type === "plan") {
    await cancelPlan(db, last.row.id);
    what = R.planText(scope, last.row);
  } else {
    await updateGoal(db, last.row.id, { status: "cancelled" });
    what = R.goalText(scope, last.row);
  }
  const chatId = last.row.sourceChatId ?? scope.household.telegramChatId;
  if (last.row.botMessageId) await safeEdit(ctx.api, chatId, last.row.botMessageId, R.deletedText(scope, what));
  await ctx.reply(t(scope.locale, "undo.done", { what }), opts);
  if (last.type === "transaction") await notifyAlerts(ctx.api, ctx.deps, scope, chatId);
  return true;
}
