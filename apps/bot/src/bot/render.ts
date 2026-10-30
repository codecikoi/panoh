import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import {
  BALANCE_SCOPE,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  TOTAL_BUDGET,
  activeCustomCategories,
  availableLocales,
  categoryEmoji,
  isCustomCategory,
  currentMonthKey,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatPercent,
  itemsOf,
  languageName,
  shiftMonthKey,
  monthPeriod,
  periodKey,
  t,
  endOfMonthISO,
  type AlertEvent,
  type Alert,
  type BalanceInfo,
  type BudgetStat,
  type Category,
  type CustomCategoryInfo,
  type Goal,
  type GoalStat,
  type Insights,
  type Plan,
  type MonthlySummary,
  type RecurringPayment,
  type Reminder,
  type Transaction,
} from "@madat/core";
import type { Scope } from "./context.js";

export const COMMON_CURRENCIES = ["USD", "EUR", "UZS", "RUB", "KZT", "KGS", "TJS", "UAH", "TRY", "GBP", "AED", "INR"];
export const COMMON_TIMEZONES = [
  "Asia/Tashkent", "Europe/Moscow", "Asia/Almaty", "Asia/Bishkek", "Asia/Dushanbe", "Europe/Kyiv",
  "Europe/Istanbul", "Europe/Berlin", "Europe/London", "Asia/Dubai", "America/New_York", "UTC",
];

export function money(scope: Scope, amount: number, currency = scope.currency): string {
  return formatMoney(amount, currency, scope.locale);
}

/** Translated name of a built-in category, the family's own name for a custom one, "Monthly budget" for the total. */
export function catName(scope: Scope, category: string): string {
  const own = scope.categories.get(category);
  if (own) return escapeHtml(own.name);
  if (category === TOTAL_BUDGET) return t(scope.locale, "cat.total");
  if (isCustomCategory(category)) return category;
  return t(scope.locale, `cat.${category as Category}`);
}

export function catLabel(scope: Scope, category: string): string {
  return `${categoryEmoji(category, scope.categories)} ${catName(scope, category)}`;
}

export function kindLabel(scope: Scope, kind: "expense" | "income"): string {
  return t(scope.locale, kind === "expense" ? "kind.expense" : "kind.income");
}

/** The name this family gave the assistant, or the default. */
export function assistantName(scope: Scope): string {
  return scope.household.assistantName ?? t(scope.locale, "app.name");
}

export function prefixOf(scope: Scope): string {
  return scope.household.triggers.prefix ?? "+";
}

function noteLine(note: string): string {
  return note ? `\n<i>${escapeHtml(note)}</i>` : "";
}

/** The member's first name for a record line; nothing in a private chat (one person) or when the name is not known. */
export function authorName(scope: Scope, userId: number | null | undefined): string {
  if (scope.household.chatType === "private" || userId === null || userId === undefined) return "";
  return scope.names.get(userId) ?? "";
}

/** The note and author of a plain record, or one line per position ("корзинка продукты · 313 000 UZS · Зоир"). */
function itemLines(scope: Scope, tx: Transaction): string {
  const items = itemsOf(tx);
  const line = (parts: string[]) => {
    const text = parts.filter(Boolean).join(" · ");
    return text ? `\n${text}` : "";
  };
  if (items.length === 1) {
    const who = authorName(scope, items[0]!.userId);
    return line([tx.note ? `<i>${escapeHtml(tx.note)}</i>` : "", escapeHtml(who)]);
  }
  return items.map((i) => line([i.note ? `<i>${escapeHtml(i.note)}</i>` : "", money(scope, i.amount, tx.currency), escapeHtml(authorName(scope, i.userId))])).join("");
}

export function txText(scope: Scope, tx: Transaction, options: { rateMissing?: boolean } = {}): string {
  const amount = money(scope, tx.amount, tx.currency);
  let converted = "";
  if (tx.currency !== scope.currency && tx.amountBase !== null) {
    converted = t(scope.locale, "confirm.tx_converted", { base: money(scope, tx.amountBase) });
  }
  const base = t(scope.locale, "confirm.tx", { kind: kindLabel(scope, tx.kind), amount: amount + converted, category: catLabel(scope, tx.category) });
  const missing = options.rateMissing || (tx.currency !== scope.currency && tx.amountBase === null)
    ? t(scope.locale, "confirm.tx_rate_missing", { currency: tx.currency })
    : "";
  return base + itemLines(scope, tx) + missing;
}

export function txPendingText(scope: Scope, tx: Transaction): string {
  return (
    t(scope.locale, "confirm.tx_pending", {
      kind: kindLabel(scope, tx.kind).toLowerCase(),
      amount: money(scope, tx.amount, tx.currency),
      category: catLabel(scope, tx.category),
    }) + noteLine(tx.note)
  );
}

export function txKeyboard(scope: Scope, tx: Transaction): InlineKeyboard {
  if (tx.status === "pending") {
    return new InlineKeyboard().text(t(scope.locale, "btn.yes"), `tx:yes:${tx.id}`).text(t(scope.locale, "btn.no"), `tx:no:${tx.id}`);
  }
  return new InlineKeyboard().text(t(scope.locale, "btn.edit"), `tx:edit:${tx.id}`).text(t(scope.locale, "btn.delete"), `tx:del:${tx.id}`);
}

export function deletedText(scope: Scope, original: string): string {
  const plain = original.replace(/<[^>]+>/g, "");
  return t(scope.locale, "confirm.deleted", { text: escapeHtml(plain) });
}

export function reminderText(scope: Scope, reminder: Reminder, options: { defaultTime?: boolean } = {}): string {
  return t(scope.locale, options.defaultTime ? "confirm.reminder_default_time" : "confirm.reminder", {
    when: formatDateTime(reminder.dueAt, scope.tz, scope.locale),
    title: escapeHtml(reminder.title),
  });
}

export function reminderKeyboard(scope: Scope, reminder: Reminder, options: { offerTime?: boolean } = {}): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (options.offerTime) kb.text(t(scope.locale, "btn.change_time"), `rem:time:${reminder.id}`);
  return kb.text(t(scope.locale, "btn.cancel"), `rem:del:${reminder.id}`);
}

export const PICKER_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Keyboard of whole hours; each button sends `${callbackPrefix}:${hour}`. */
export function hourPickerKeyboard(callbackPrefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  PICKER_HOURS.forEach((hour, i) => {
    kb.text(formatHour(hour), `${callbackPrefix}:${hour}`);
    if (i % 4 === 3) kb.row();
  });
  return kb;
}

export function recurringText(scope: Scope, rp: RecurringPayment): string {
  const days = rp.remindDaysBefore ?? scope.household.remindDaysBefore;
  if (rp.amount !== null) {
    return t(scope.locale, "confirm.recurring", {
      name: escapeHtml(rp.name),
      amount: money(scope, rp.amount, rp.currency),
      day: rp.dayOfMonth,
      days,
    });
  }
  return t(scope.locale, "confirm.recurring_no_amount", { name: escapeHtml(rp.name), day: rp.dayOfMonth, days });
}

export function recurringKeyboard(scope: Scope, rp: RecurringPayment): InlineKeyboard {
  return new InlineKeyboard().text(t(scope.locale, "btn.delete"), `rp:del:${rp.id}`);
}

export function paidText(scope: Scope, name: string, amount: number | null, currency: string): string {
  return t(scope.locale, "confirm.paid", { name: escapeHtml(name), amount: amount !== null ? money(scope, amount, currency) : "—" });
}

/** "20 Dec" for an exact date, "December 2026, no exact date" for a month-only plan. */
export function planWhen(scope: Scope, plan: Pick<Plan, "plannedOn" | "dateApproximate">): string {
  if (plan.dateApproximate) return t(scope.locale, "plan.whole_month", { month: formatMonth(plan.plannedOn.slice(0, 7), scope.locale) });
  return longDate(scope, plan.plannedOn);
}

/** Day and month spelled out, with the year only when it is not the current one. */
export function longDate(scope: Scope, iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setLocale(scope.locale);
  const sameYear = dt.year === DateTime.now().setZone(scope.tz).year;
  return dt.toLocaleString({ day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Goal deadline: the month name when the deadline is a month end, the full date otherwise. */
export function deadlineText(scope: Scope, iso: string): string {
  if (endOfMonthISO(iso) === iso) {
    const dt = DateTime.fromISO(iso, { zone: "utc" }).setLocale(scope.locale);
    return dt.toLocaleString({ month: "long", year: "numeric" });
  }
  return longDate(scope, iso);
}

export function planText(scope: Scope, plan: Plan): string {
  return (
    t(scope.locale, "confirm.plan", {
      amount: money(scope, plan.amount, plan.currency),
      category: catLabel(scope, plan.category),
      title: escapeHtml(plan.title),
      when: planWhen(scope, plan),
    }) + (plan.dateApproximate ? t(scope.locale, "confirm.plan_no_date") : "")
  );
}

export function planKeyboard(scope: Scope, plan: Plan): InlineKeyboard {
  return new InlineKeyboard().text(t(scope.locale, "btn.cancel_plan"), `plan:del:${plan.id}`);
}

export function planPaidText(scope: Scope, plan: Plan, tx: Transaction): string {
  const differs = tx.amount !== plan.amount || tx.currency !== plan.currency;
  return (
    t(scope.locale, "confirm.plan_paid", { title: escapeHtml(plan.title), amount: money(scope, tx.amount, tx.currency) }) +
    (differs ? t(scope.locale, "confirm.plan_paid_diff", { planned: money(scope, plan.amount, plan.currency) }) : "")
  );
}

/** Line appended to an expense confirmation when its category has a monthly limit. */
export function budgetLine(scope: Scope, stat: BudgetStat | undefined): string {
  if (!stat) return "";
  const params = { category: catLabel(scope, stat.category), spent: money(scope, stat.spent), limit: money(scope, stat.limit), pct: stat.pct };
  if (stat.spent > stat.limit) return t(scope.locale, "budget.over", { ...params, amount: money(scope, stat.spent - stat.limit) });
  return t(scope.locale, "budget.line", params) + (stat.pct >= 80 ? " ⚠️" : "");
}

function budgetMark(pct: number): string {
  return pct > 100 ? " 🚨" : pct >= 80 ? " ⚠️" : "";
}

export function budgetsLines(scope: Scope, stats: BudgetStat[]): string[] {
  return stats.map(
    (b) =>
      t(scope.locale, "budgets.line", {
        emoji: b.emoji,
        category: catName(scope, b.category),
        spent: money(scope, b.spent),
        limit: money(scope, b.limit),
        pct: b.pct,
      }) + budgetMark(b.pct),
  );
}

export function budgetConfirmText(scope: Scope, category: string, amount: number, currency: string, stat: BudgetStat | undefined): string {
  return t(scope.locale, "confirm.budget", {
    category: catLabel(scope, category),
    amount: money(scope, amount, currency),
    spent: money(scope, stat?.spent ?? 0),
    pct: stat?.pct ?? 0,
  });
}

export function budgetsListText(scope: Scope, stats: BudgetStat[]): string {
  if (!stats.length) return t(scope.locale, "budgets.empty");
  return `${t(scope.locale, "budgets.title")}\n\n${budgetsLines(scope, stats).join("\n")}`;
}

/** One delete button per limit; `bud:rm` refreshes the list after removing. */
export function budgetsKeyboard(scope: Scope, stats: BudgetStat[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  stats.forEach((b, i) => {
    kb.text(`🗑 ${b.emoji} ${catName(scope, b.category).replace(/&amp;/g, "&")}`, `bud:rm:${b.category}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export function goalText(scope: Scope, goal: Goal, stat?: GoalStat): string {
  if (goal.targetAmount === null) {
    const saved = stat ? t(scope.locale, "confirm.goal_open_saved", { saved: money(scope, stat.saved, goal.currency) }) : "";
    return t(scope.locale, "confirm.goal_open", { title: escapeHtml(goal.title), saved });
  }
  const deadline = goal.deadline ? t(scope.locale, "confirm.goal_deadline", { date: deadlineText(scope, goal.deadline) }) : "";
  let text = t(scope.locale, "confirm.goal", { title: escapeHtml(goal.title), amount: money(scope, goal.targetAmount, goal.currency), deadline });
  if (stat?.monthlyNeed) text += t(scope.locale, "confirm.goal_pace", { amount: money(scope, stat.monthlyNeed, goal.currency) });
  return text;
}

export function goalKeyboard(scope: Scope, goal: Goal): InlineKeyboard {
  return new InlineKeyboard().text(t(scope.locale, "btn.delete"), `goal:del:${goal.id}`);
}

export function contributionText(scope: Scope, tx: Transaction, stat: GoalStat): string {
  if (stat.target === null) {
    return t(scope.locale, "confirm.goal_contribution_open", { title: escapeHtml(stat.title), amount: money(scope, tx.amount, tx.currency), saved: money(scope, stat.saved, stat.currency) });
  }
  return (
    t(scope.locale, "confirm.goal_contribution", {
      title: escapeHtml(stat.title),
      amount: money(scope, tx.amount, tx.currency),
      saved: money(scope, stat.saved, stat.currency),
      target: money(scope, stat.target, stat.currency),
      pct: stat.pct ?? 0,
    }) + (stat.saved >= stat.target ? t(scope.locale, "confirm.goal_reached") : "")
  );
}

export function goalsLines(scope: Scope, stats: GoalStat[]): string[] {
  return stats.map((g) => {
    if (g.target === null) return t(scope.locale, "goals.line_open", { title: escapeHtml(g.title), saved: money(scope, g.saved, g.currency) });
    let line = t(scope.locale, "goals.line", {
      title: escapeHtml(g.title),
      saved: money(scope, g.saved, g.currency),
      target: money(scope, g.target, g.currency),
      pct: g.pct ?? 0,
    });
    if (g.deadline) line += t(scope.locale, "goals.line_deadline", { date: deadlineText(scope, g.deadline) });
    if (g.monthlyNeed && g.saved < g.target) {
      line += t(scope.locale, "goals.line_pace", {
        amount: money(scope, g.monthlyNeed, g.currency),
        left: money(scope, g.remainingThisMonth, g.currency),
      });
    }
    return line;
  });
}

export function goalsListText(scope: Scope, stats: GoalStat[]): string {
  if (!stats.length) return t(scope.locale, "goals.empty");
  return `${t(scope.locale, "goals.title")}\n\n${goalsLines(scope, stats).join("\n")}`;
}

export function plansListText(scope: Scope, rows: Plan[], total: number | null): string {
  if (!rows.length) return t(scope.locale, "plans.empty");
  const today = DateTime.now().setZone(scope.tz).toISODate()!;
  const lines = rows.map((p) => {
    const overdue = p.plannedOn < today ? ` · ⏳ ${t(scope.locale, "plans.overdue")}` : "";
    return `${planWhen(scope, p)} · ${escapeHtml(p.title)} · ${money(scope, p.amount, p.currency)}${overdue}`;
  });
  const footer = total !== null ? `\n\n${t(scope.locale, "plans.total", { amount: money(scope, total) })}` : "";
  return `${t(scope.locale, "plans.title")}\n\n${lines.join("\n")}${footer}`;
}

export function alertText(scope: Scope, reminder: Reminder, rp?: RecurringPayment, plan?: Plan): string {
  if (reminder.kind === "plan_due" && plan) {
    return t(scope.locale, plan.dateApproximate ? "alert.plan_month_end" : "alert.plan_due", {
      title: escapeHtml(plan.title),
      amount: money(scope, plan.amount, plan.currency),
    });
  }
  const amount = rp?.amount !== null && rp?.amount !== undefined ? money(scope, rp.amount, rp.currency) : "";
  if (reminder.kind === "payment_due") {
    return t(scope.locale, "alert.payment_due", { name: escapeHtml(reminder.title), amount });
  }
  if (reminder.kind === "payment_upcoming") {
    const days = rp?.remindDaysBefore ?? scope.household.remindDaysBefore;
    const date = reminder.period && rp ? formatDate(`${reminder.period}-${String(rp.dayOfMonth).padStart(2, "0")}`, scope.locale) : "";
    return t(scope.locale, "alert.payment_upcoming", { days, date, name: escapeHtml(reminder.title), amount });
  }
  return t(scope.locale, "alert.reminder", { title: escapeHtml(reminder.title) });
}

export function alertKeyboard(scope: Scope, reminder: Reminder): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (reminder.recurringPaymentId && reminder.period) {
    kb.text(t(scope.locale, "btn.paid"), `rp:paid:${reminder.recurringPaymentId}:${reminder.period}`);
    kb.text(t(scope.locale, "btn.snooze_1d"), `rem:snz:${reminder.id}:1440`);
  } else if (reminder.planId) {
    kb.text(t(scope.locale, "btn.paid"), `plan:paid:${reminder.planId}`);
    kb.text(t(scope.locale, "btn.snooze_1d"), `rem:snz:${reminder.id}:1440`);
    kb.row().text(t(scope.locale, "btn.cancel_plan"), `plan:del:${reminder.planId}`);
  } else {
    kb.text(t(scope.locale, "btn.done"), `rem:done:${reminder.id}`);
    kb.text(t(scope.locale, "btn.snooze_1h"), `rem:snz:${reminder.id}:60`);
    kb.text(t(scope.locale, "btn.snooze_1d"), `rem:snz:${reminder.id}:1440`);
  }
  return kb;
}

export function lastRecordsText(scope: Scope, rows: Transaction[]): string {
  if (!rows.length) return t(scope.locale, "last.empty", { prefix: prefixOf(scope) });
  const lines = rows.map((tx) => {
    const sign = tx.kind === "income" ? "+" : "−";
    const pending = tx.status === "pending" ? " 🤔" : "";
    return `${formatDate(tx.occurredOn, scope.locale)} · ${sign}${money(scope, tx.amount, tx.currency)} · ${catLabel(scope, tx.category)}${tx.note ? ` · <i>${escapeHtml(tx.note)}</i>` : ""}${pending}`;
  });
  return `${t(scope.locale, "last.title")}\n\n${lines.join("\n")}`;
}

export function remindersListText(scope: Scope, rows: Reminder[]): string {
  const own = rows.filter((r) => r.kind === "reminder");
  if (!own.length) return t(scope.locale, "reminders.empty");
  const lines = own.map((r) => `${formatDateTime(r.dueAt, scope.tz, scope.locale)} · ${escapeHtml(r.title)}`);
  return `${t(scope.locale, "reminders.title")}\n\n${lines.join("\n")}`;
}

export function paymentsListText(scope: Scope, rows: { payment: RecurringPayment; date: string; period: string }[]): string {
  if (!rows.length) return t(scope.locale, "payments.empty");
  const lines = rows.map(({ payment, date }) =>
    t(scope.locale, "payments.line", {
      name: escapeHtml(payment.name),
      amount: payment.amount !== null ? money(scope, payment.amount, payment.currency) : "—",
      day: payment.dayOfMonth,
      next: formatDate(date, scope.locale),
    }),
  );
  return `${t(scope.locale, "payments.title")}\n\n${lines.join("\n")}`;
}

function deltaSuffix(scope: Scope, pct: number | null, month: string): string {
  if (pct === null) return "";
  return t(scope.locale, "summary.delta_vs", { pct: formatPercent(pct, scope.locale), month: formatMonth(month, scope.locale) });
}

export function summaryText(scope: Scope, s: MonthlySummary, insights?: Insights | null): string {
  const L = scope.locale;
  const monthName = formatMonth(s.month, L);
  if (s.recordCount === 0) return t(L, "summary.empty", { month: monthName, prefix: prefixOf(scope) });
  const lines: string[] = [];
  lines.push(t(L, "summary.title", { month: monthName }));
  lines.push(t(L, "summary.expenses", { amount: money(scope, s.expense), delta: deltaSuffix(scope, s.expenseDeltaPct, s.prevMonth) }));
  if (s.income > 0 || s.prevIncome > 0) {
    lines.push(t(L, "summary.income", { amount: money(scope, s.income), delta: deltaSuffix(scope, s.incomeDeltaPct, s.prevMonth) }));
    lines.push(t(L, "summary.net", { amount: (s.net >= 0 ? "+" : "") + money(scope, s.net) }));
  }
  if (s.isCurrentMonth && s.daysElapsed >= 3 && s.projected !== null) {
    lines.push(t(L, "summary.avg_day", { avg: money(scope, s.avgPerDay), projected: money(scope, s.projected) }));
  }
  if (s.balance && s.balance.current !== null) {
    lines.push(t(L, "summary.balance", { amount: money(scope, s.balance.current), date: formatDate(s.balance.asOf, L) }));
  }
  const f = s.outlook.forecast;
  if (s.isCurrentMonth && f && f.ahead > 0) {
    const parts: string[] = [];
    if (f.payments > 0) parts.push(t(L, "summary.part_payments", { amount: money(scope, f.payments) }));
    if (f.plans > 0) parts.push(t(L, "summary.part_plans", { amount: money(scope, f.plans) }));
    if (f.goals > 0) parts.push(t(L, "summary.part_goals", { amount: money(scope, f.goals) }));
    lines.push("");
    lines.push(t(L, "summary.forecast_ahead", { amount: money(scope, f.ahead), parts: parts.join(", ") }));
    if (f.free >= 0) {
      lines.push(
        t(L, "summary.forecast_free", { amount: money(scope, f.free) }) +
          (f.perDay ? t(L, "summary.forecast_per_day", { amount: money(scope, f.perDay) }) : ""),
      );
    } else {
      lines.push(t(L, "summary.forecast_short", { amount: money(scope, -f.free) }));
      lines.push(t(L, "summary.forecast_note"));
    }
  }
  if (s.categories.length) {
    lines.push("");
    lines.push(t(L, "summary.by_category"));
    for (const c of s.categories.slice(0, 10)) {
      const delta = c.deltaPct !== null ? ` (${formatPercent(c.deltaPct, L)})` : "";
      lines.push(
        t(L, "summary.category_line", {
          emoji: c.emoji,
          category: catName(scope, c.category),
          amount: money(scope, c.amount),
          share: c.share,
          delta,
        }),
      );
    }
  }
  const spenders = s.byPerson.filter((p) => p.expense > 0);
  if (spenders.length >= 2) {
    lines.push("");
    lines.push(t(L, "summary.spent_by", { list: spenders.map((p) => `${escapeHtml(p.name)} ${money(scope, p.expense)} (${p.share}%)`).join(" · ") }));
  }
  if (s.outlook.budgets.length) {
    lines.push("");
    lines.push(t(L, "summary.budgets"));
    lines.push(...budgetsLines(scope, s.outlook.budgets));
  }
  if (s.outlook.goals.length) {
    lines.push("");
    lines.push(t(L, "summary.goals"));
    lines.push(...goalsLines(scope, s.outlook.goals));
  }
  if (s.outlook.plans.length) {
    lines.push("");
    lines.push(t(L, "summary.plans"));
    for (const p of s.outlook.plans.slice(0, 8)) {
      const when = p.approximate ? "" : ` · ${formatDate(p.date, L)}`;
      lines.push(`🗓 ${escapeHtml(p.title)} · ${money(scope, p.originalAmount, p.currency)}${when}${p.overdue ? " ⏳" : ""}`);
    }
  }
  const extras: string[] = [];
  if (s.topGrowth && s.topGrowth.deltaPct !== null) {
    extras.push(
      t(L, "summary.top_growth", {
        category: catName(scope, s.topGrowth.category),
        pct: formatPercent(s.topGrowth.deltaPct, L),
        month: formatMonth(s.prevMonth, L),
      }),
    );
  }
  if (s.topDrop && s.topDrop.deltaPct !== null) {
    extras.push(
      t(L, "summary.top_drop", {
        category: catName(scope, s.topDrop.category),
        pct: formatPercent(s.topDrop.deltaPct, L),
        month: formatMonth(s.prevMonth, L),
      }),
    );
  }
  if (s.biggest.length) {
    extras.push(t(L, "summary.biggest", { list: s.biggest.map((b) => `${escapeHtml(b.note)} ${money(scope, b.amount)}`).join(", ") }));
  }
  if (extras.length) {
    lines.push("");
    lines.push(...extras);
  }
  if (s.upcomingPayments.length) {
    lines.push("");
    lines.push(t(L, "summary.upcoming"));
    for (const p of s.upcomingPayments.slice(0, 5)) {
      const amount = p.amount !== null ? ` · ${money(scope, p.amount, p.currency)}` : "";
      lines.push(`💳 ${escapeHtml(p.name)}${amount} · ${formatDate(p.date, L)}`);
    }
  }
  const footer: string[] = [];
  if (s.openReminders > 0) footer.push(t(L, "summary.open_reminders", { count: s.openReminders }));
  if (s.pendingCount > 0) footer.push(t(L, "summary.pending", { count: s.pendingCount }));
  if (s.unconverted.length) {
    footer.push(t(L, "summary.unconverted", { list: s.unconverted.map((u) => money(scope, u.amount, u.currency)).join(", ") }));
  }
  if (footer.length) {
    lines.push("");
    lines.push(...footer);
  }
  if (insights && (insights.highlights.length || insights.tips.length)) {
    if (insights.highlights.length) {
      lines.push("");
      lines.push(t(L, "summary.insights"));
      for (const h of insights.highlights) lines.push(`• ${escapeHtml(h)}`);
    }
    if (insights.tips.length) {
      lines.push("");
      lines.push(t(L, "summary.tips"));
      for (const tip of insights.tips) lines.push(`• ${escapeHtml(tip)}`);
    }
  }
  return lines.join("\n");
}

export function summaryKeyboard(scope: Scope, month: string, options: { dashboardUrl?: string; dashboardLink?: string; isPrivate: boolean }): InlineKeyboard {
  const kb = new InlineKeyboard();
  const prev = shiftMonthKey(month, -1);
  kb.text(t(scope.locale, "btn.prev_month", { month: formatMonth(prev, scope.locale) }), `sum:${prev}`);
  const next = shiftMonthKey(month, 1);
  if (month < currentMonthKey(scope.tz)) {
    kb.text(t(scope.locale, "btn.next_month", { month: formatMonth(next, scope.locale) }), `sum:${next}`);
  }
  kb.row();
  kb.text(t(scope.locale, "btn.pdf"), `rep:${periodKey(monthPeriod(month))}`);
  if (options.isPrivate && options.dashboardUrl) {
    kb.webApp(t(scope.locale, "btn.open_dashboard"), `${options.dashboardUrl}?month=${month}`);
  } else if (options.dashboardLink) {
    kb.url(t(scope.locale, "btn.open_dashboard"), `${options.dashboardLink}?startapp=${scope.household.id}_${month}`);
  }
  return kb;
}

export function settingsText(scope: Scope): string {
  const h = scope.household;
  const title = t(scope.locale, "settings.title", {
    currency: h.baseCurrency,
    timezone: h.timezone,
    language: languageName(h.locale, h.locale),
    days: h.remindDaysBefore,
    prefix: escapeHtml(prefixOf(scope)),
  });
  return [
    title,
    t(scope.locale, "settings.reminder_time_line", { time: formatHour(h.reminderHour) }),
    t(scope.locale, "settings.name_line", { name: escapeHtml(assistantName(scope)) }),
  ].join("\n");
}

export function settingsKeyboard(scope: Scope): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(scope.locale, "settings.btn_currency"), "set:cur")
    .text(t(scope.locale, "settings.btn_timezone"), "set:tz")
    .row()
    .text(t(scope.locale, "settings.btn_language"), "set:lang")
    .text(t(scope.locale, "settings.btn_reminder_time"), "set:hour")
    .row()
    .text(t(scope.locale, "settings.btn_name"), "set:name");
}

export function currencyKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  COMMON_CURRENCIES.forEach((code, i) => {
    kb.text(code, `set:cur:${code}`);
    if (i % 4 === 3) kb.row();
  });
  return kb;
}

export function timezoneKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  COMMON_TIMEZONES.forEach((tz, i) => {
    kb.text(tz, `set:tz:${tz}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export function languageKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  availableLocales().forEach((code, i) => {
    kb.text(languageName(code, code), `set:lang:${code}`);
    if (i % 3 === 2) kb.row();
  });
  return kb;
}

// ---------- balance, alerts, categories ----------

/** Confirmation of "we have 800k left": the first time an explanation, later the gap against the records. */
/** What the records said just before a checkpoint: the checkpoint before it and what came in and went out between the two. */
export interface BalanceBefore {
  start: number | null;
  asOf: string;
  income: number;
  expense: number;
  expected: number | null;
}

export function balanceBefore(info: BalanceInfo): BalanceBefore {
  return { start: info.start, asOf: info.checkpoint.asOf, income: info.income, expense: info.expense, expected: info.current };
}

/** "That is 800 000 (checkpoint 29 Oct) + income 0 − expenses 431 000": how the bot arrived at the figure by the records. */
function balanceTrailLine(scope: Scope, before: BalanceBefore): string {
  if (before.start === null || (before.income === 0 && before.expense === 0)) return "";
  return (
    "\n" +
    t(scope.locale, "balance.trail", {
      start: money(scope, before.start),
      date: formatDate(before.asOf, scope.locale),
      income: money(scope, before.income),
      expense: money(scope, before.expense),
    })
  );
}

export function balanceSetText(scope: Scope, amount: number, currency: string, previous: BalanceBefore | null): string {
  const stated = money(scope, amount, currency);
  if (!previous || previous.expected === null) return t(scope.locale, "confirm.balance", { amount: stated });
  const base = currency === scope.currency ? amount : null;
  const diff = base === null ? null : base - previous.expected;
  if (diff === null || Math.abs(diff) < 1) return t(scope.locale, "confirm.balance_matches", { amount: stated });
  return (
    t(scope.locale, "confirm.balance_diff", {
      amount: stated,
      expected: money(scope, previous.expected),
      diff: (diff > 0 ? "+" : "−") + money(scope, Math.abs(diff)),
    }) + balanceTrailLine(scope, previous)
  );
}

/** "Groceries: 100 000 left of the 678 000 limit": a stated remainder for one category, turned into its monthly limit. */
export function balanceCategoryText(scope: Scope, stat: BudgetStat): string {
  return t(scope.locale, "confirm.balance_category", {
    category: catLabel(scope, stat.category),
    left: money(scope, Math.max(0, stat.remaining)),
    limit: money(scope, stat.limit),
    spent: money(scope, stat.spent),
  });
}

export function balanceKeyboard(scope: Scope, id: number): InlineKeyboard {
  return new InlineKeyboard().text(t(scope.locale, "btn.delete"), `bal:del:${id}`);
}

/** "How much is left?": the balance, then the limits asked about (or all of them), then the month forecast. */
export function balanceAnswerText(
  scope: Scope,
  input: { balance: BalanceInfo | null; budgets: BudgetStat[]; category: string | null; spentInCategory: number | null; forecast: MonthlySummary["outlook"]["forecast"] },
): string {
  const L = scope.locale;
  const lines: string[] = [];
  const onlyCategory = input.category !== null;
  if (!onlyCategory) {
    if (input.balance && input.balance.current !== null) {
      lines.push(
        t(L, "balance.answer", { amount: money(scope, input.balance.current), date: formatDate(input.balance.checkpoint.asOf, L) }) +
          balanceTrailLine(scope, balanceBefore(input.balance)),
      );
    } else {
      lines.push(t(L, "balance.unknown"));
    }
  }
  const shown = onlyCategory ? input.budgets.filter((b) => b.category === input.category) : input.budgets;
  for (const b of shown) {
    lines.push(
      b.remaining >= 0
        ? t(L, "balance.limit_line", { category: catLabel(scope, b.category), left: money(scope, b.remaining), limit: money(scope, b.limit) })
        : t(L, "balance.limit_over", { category: catLabel(scope, b.category), amount: money(scope, -b.remaining), limit: money(scope, b.limit) }),
    );
  }
  if (onlyCategory && !shown.length) {
    lines.push(t(L, "balance.no_limit", { category: catLabel(scope, input.category!), spent: money(scope, input.spentInCategory ?? 0) }));
  }
  const f = input.forecast;
  if (!onlyCategory && f && f.ahead > 0) {
    lines.push(f.free >= 0 ? t(L, "summary.forecast_free", { amount: money(scope, f.free) }) : t(L, "summary.forecast_short", { amount: money(scope, -f.free) }));
  }
  return lines.join("\n");
}

/** Confirmation of a threshold alert, with where the watched value stands now. */
export function alertSetText(scope: Scope, alert: Alert, now: { value: number | null; limit?: number } | null): string {
  const L = scope.locale;
  const threshold = money(scope, alert.amount, alert.currency);
  let text: string;
  if (alert.scope === BALANCE_SCOPE) {
    text = t(L, "confirm.alert_balance", { amount: threshold });
    if (now && now.value !== null) text += t(L, "confirm.alert_now", { amount: money(scope, now.value) });
    else text += "\n" + t(L, "balance.unknown");
  } else {
    text = t(L, "confirm.alert_category", { category: catLabel(scope, alert.scope), amount: threshold });
    if (now && now.value !== null) text += t(L, "confirm.alert_now", { amount: money(scope, now.value) });
    else text += "\n" + t(L, "confirm.alert_no_limit", { category: catLabel(scope, alert.scope) });
  }
  return text;
}

export function alertKeyboardFor(scope: Scope, alert: Alert): InlineKeyboard {
  return new InlineKeyboard().text(t(scope.locale, "btn.delete"), `alr:del:${alert.scope}`);
}

/** The notice sent when an alert fires. */
export function alertFiredText(scope: Scope, event: AlertEvent): string {
  const L = scope.locale;
  if (event.alert.scope === BALANCE_SCOPE) {
    return t(L, "alert.balance_low", { threshold: money(scope, event.threshold), amount: money(scope, event.value) });
  }
  return t(L, "alert.category_low", {
    category: catLabel(scope, event.alert.scope),
    threshold: money(scope, event.threshold),
    left: money(scope, Math.max(0, event.value)),
    limit: money(scope, event.limit ?? 0),
  });
}

export function categoryCreatedText(scope: Scope, c: CustomCategoryInfo): string {
  return t(scope.locale, "confirm.category_created", {
    kind: kindLabel(scope, c.kind).toLowerCase(),
    emoji: c.emoji,
    name: escapeHtml(c.name),
  });
}

export function categoryKeyboard(scope: Scope, c: CustomCategoryInfo): InlineKeyboard {
  return new InlineKeyboard().text(t(scope.locale, "btn.delete"), `cat:del:${c.key}`);
}

/** Built-in and own categories for /categories; own ones get a delete button each. */
export function categoriesListText(scope: Scope): string {
  const L = scope.locale;
  const list = (builtin: readonly string[], kind: "expense" | "income") => {
    const own = activeCustomCategories(scope.categories, kind).map((c) => `${c.emoji} <b>${escapeHtml(c.name)}</b>`);
    return [...own, ...builtin.map((c) => catLabel(scope, c))].join(" · ");
  };
  return [
    t(L, "categories.title"),
    "",
    t(L, "categories.expense"),
    list(EXPENSE_CATEGORIES, "expense"),
    "",
    t(L, "categories.income"),
    list(INCOME_CATEGORIES, "income"),
    "",
    t(L, "categories.hint"),
  ].join("\n");
}

export function categoriesKeyboard(scope: Scope): InlineKeyboard | undefined {
  const own = [...activeCustomCategories(scope.categories, "expense"), ...activeCustomCategories(scope.categories, "income")];
  if (!own.length) return undefined;
  const kb = new InlineKeyboard();
  own.forEach((c, i) => {
    kb.text(`🗑 ${c.emoji} ${c.name}`, `cat:rm:${c.key}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}
