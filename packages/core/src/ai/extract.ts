import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client.js";
import { env } from "../config.js";
import { log } from "../logger.js";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  NO_CUSTOM_CATEGORIES,
  TOTAL_BUDGET,
  normalizeCategory,
  type CategoryLookup,
  type CustomCategoryInfo,
} from "../categories.js";
import { normalizeCurrency } from "../money.js";
import { describeNow, endOfMonthISO, isValidISODate, localToInstant, todayISO } from "../dates.js";

export const ITEM_KINDS = [
  "expense",
  "income",
  "reminder",
  "recurring_payment",
  "payment_done",
  "planned_expense",
  "budget_limit",
  "budget_remove",
  "goal",
  "goal_contribution",
  "balance_set",
  "balance_request",
  "balance_alert",
  "category_create",
  "category_remove",
  "correction",
  "cancel_last",
  "summary_request",
  "report_request",
  "rename",
  "clarify",
  "none",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

const RawItem = z.object({
  kind: z.enum(ITEM_KINDS),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  category: z.string().nullable(),
  note: z.string(),
  date: z.string().nullable(),
  date_approximate: z.boolean(),
  date_to: z.string().nullable(),
  due_at: z.string().nullable(),
  day_of_month: z.number().int().nullable(),
  remind_days_before: z.number().int().nullable(),
  target: z.string().nullable(),
  emoji: z.string().nullable(),
  time_specified: z.boolean(),
  confidence: z.number(),
});

const RawExtraction = z.object({
  language: z.string(),
  items: z.array(RawItem),
});

export type RawExtractedItem = z.infer<typeof RawItem>;

/** Kinds whose `category` may be the month total ("total") rather than a real category. */
const TOTAL_ALLOWED: ReadonlySet<ItemKind> = new Set(["budget_limit", "budget_remove", "balance_request", "balance_alert"]);

export interface ExtractedItem {
  kind: ItemKind;
  amount: number | null;
  currency: string;
  /** Built-in category key, a custom category key ("custom_12") or "total" for the month limit. */
  category: string | null;
  note: string;
  /** ISO date: when an expense / income happened, or the planned date / goal deadline. Defaults to today. */
  date: string;
  /** Whether the model returned a date at all (`date` falls back to today otherwise). */
  hasDate: boolean;
  /** Only a month was given for a plan or goal; `date` is then the last day of that month. */
  dateApproximate: boolean;
  /** report_request: last day of the period (ISO, inclusive); null when no period was named. */
  dateTo: string | null;
  /** Instant for reminders (already converted from household local time). */
  dueAt: Date | null;
  dayOfMonth: number | null;
  remindDaysBefore: number | null;
  target: string | null;
  /** category_create: the emoji the user gave or the model picked. */
  emoji: string | null;
  /** For reminders: whether the user stated a time of day (false = household default time was applied). */
  timeSpecified: boolean;
  confidence: number;
  /** Fields explicitly set by a correction. */
  changed: Partial<{ amount: number; currency: string; category: string; note: string; date: string; dateApproximate: boolean }>;
}

export interface ExtractionContext {
  text: string;
  authorName: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  /** Hour (0-23, household local time) used for reminders that come without a time of day. */
  defaultReminderHour?: number;
  recurringPayments: { name: string; amount: number | null; currency: string; dayOfMonth: number }[];
  plans?: { name: string; amount: number; currency: string; date: string }[];
  goals?: { name: string; target: number | null; currency: string }[];
  /** The household's own categories (active ones): the model may file records under their keys. */
  customCategories?: Pick<CustomCategoryInfo, "key" | "kind" | "name">[];
  /** Short description of the bot message the user replied to (with its edit history), if any. */
  replyTo?: string;
  /** The most recent record in the chat (with its edit history) when the message is not a reply. */
  lastRecord?: string;
  /** The message addresses the bot directly (reply, mention, name, prefix or private chat). */
  addressed?: boolean;
  /** Name the family gave the assistant, if not the default. */
  assistantName?: string | null;
  /** Recent processed messages, oldest first. */
  recent?: string[];
}

export interface ExtractionResult {
  language: string;
  items: ExtractedItem[];
  refused: boolean;
  usage?: { input: number; output: number; cacheRead: number };
}

export const EXTRACT_SYSTEM_PROMPT = `You are the parsing engine of a family finance assistant that lives in a Telegram chat.
A household member sent a message (any language). Extract every actionable item from it as structured data.
Return nothing but the structured output.

## Item kinds
- expense: money spent. Needs amount (number) and category from the expense list. If the message does not say what the money went to ("расход 94к", "потратил 50к", "spent 100$"), category = "other" and note = "": never guess a category or invent a note, the bot asks the user. A missing category alone does not lower confidence.
- income: money received. Needs amount and category from the income list.
- reminder: a one-off thing to do at a date/time. Needs due_at (local date-time, "YYYY-MM-DDTHH:mm"), note (what to do) and time_specified.
- recurring_payment: a bill that repeats every month on a fixed day (loan, rent, kindergarten, internet...). Needs day_of_month, note (short name), optional amount, optional remind_days_before.
- payment_done: the user says a KNOWN recurring payment or a KNOWN planned expense (see the lists in the user message) was paid or bought. Set target to that item's name exactly. Optional amount if stated (the actual amount may differ from the planned one).
- planned_expense: money the family intends to spend in the future ("в декабре подарок на свадьбу 3 млн", "plan 200$ for new tires next month", "в субботу купить коляску 2 млн"). Needs amount, category, note and date (the planned day). If only a month or a vague period is given, date = the last day of that month/period and date_approximate=true. If a time of day is stated, also set due_at and time_specified=true. Asking to be reminded to pay a specific amount on a date is a planned_expense too (the bot reminds on that day). Past or present tense ("bought", "paid", "spent") is an expense, not a plan.
- budget_limit: a monthly spending limit for one expense category ("лимит на продукты 3 млн", "бюджет на кафе 1 млн", "no more than 1m a month on cafes") or for the whole month ("бюджет на месяц 5 млн", "общий лимит 5 млн", "budget 2000$ a month"): then category = "total". "Budget" and "limit" mean the same here. Needs category and amount.
- budget_remove: remove the monthly limit of a category ("убери лимит на кафе") or of the month ("убери общий бюджет": category = "total"). Needs category.
- goal: a savings goal ("копим на отпуск 10 млн к июлю", "save 5000$ for a car"). note = goal name, amount = target, date = deadline (last day of the month with date_approximate=true if only a month is given), null if there is no deadline. An open-ended stash with no target ("заначка", "подушка безопасности", "rainy-day fund", "копим на чёрный день") is a goal with amount = null.
- goal_contribution: money put aside for a KNOWN savings goal (see the list) ("отложили на отпуск 1 млн", "+500k to the car fund", "в заначку 300к"). target = that goal's name exactly, amount required. If there is exactly one goal and the message just says money went to savings, use it.
- balance_set: the family states how much money they have right now ("у нас осталось 800к", "на руках 2 млн", "we have 1500$ left", "сейчас есть 500к", "в бюджете осталось 800к"). amount = that money. It is neither an expense nor an income.
- balance_request: the user asks how much money is left or available ("сколько осталось?", "сколько у нас есть?", "how much do we have?", "сколько осталось на продукты?", "сколько ещё можно потратить?"). category = null (the money on hand, the bot adds every limit itself) unless the question names one category's limit (then that category) or explicitly the monthly budget limit ("сколько осталось от лимита на месяц": "total"). Asking how much was SPENT is summary_request, not this.
- balance_alert: a request to be warned when the money left drops to an amount ("напомни, когда останется 100к", "предупреди, когда на продукты останется 200к", "warn me when 100$ is left"). amount = the threshold; category = null for the money on hand (the default, also after "в бюджете осталось 800к"), a category when it names one category's limit, "total" only when it explicitly names the monthly budget limit. No due_at: it is not a dated reminder.
- category_create: the user adds a category of their own ("создай категорию Машина", "новая категория доходов Аренда", "add a category Car 🚗", "yangi toifa Mashina"). note = the category name as written (short, first letter capitalised, no emoji inside), target = "expense" or "income" (expense unless the message says it is for income), emoji = the emoji the user gave, or one fitting emoji you pick.
- category_remove: remove a category the family created ("удали категорию Машина", "remove the Car category"). note = the name.
- correction: the message replies to a bot confirmation and changes something ("not 150, 115", "category transport", "it was yesterday", "in dollars"). Fill ONLY the changed fields; leave everything else null (note "" if unchanged).
- cancel_last: the user wants to remove the last record ("undo", "delete that", "wrong", "отмени", "bekor").
- summary_request: the user asks for totals / summary / how much was spent (a chat message).
- report_request: the user asks for a report / PDF / document / file / statement ("отчёт за прошлую неделю", "pdf за сентябрь", "hisobot"). date = first day and date_to = last day of the period (inclusive); a week is Monday–Sunday, "this month" is the whole calendar month. Both null when no period is named.
- rename: the user gives the assistant a new name ("теперь тебя зовут Кексик", "call yourself Kex", "seni endi Keksik deb chaqiramiz"). note = the new name exactly as written, without quotes; "Madat" to go back to the default. A question about the name ("как тебя зовут?") is clarify, not rename.
- clarify: you cannot act safely without asking, or the user asks about a record or about what the bot just did ("why didn't the amount change?", "what did you record?"). Put a short reply (≤ 200 chars) in note, in the message's language, friendly and specific: ask ONE concrete question, or answer using only facts from the context (the reply target, its edit history, the most recent record, recent chat). Never invent amounts or dates. Return clarify alone, not together with a record for the same thing.
- none: nothing actionable (chit-chat, questions, plans with neither an amount nor a date).

## Rules
- A message can contain several items ("groceries 150k and taxi 30k" → two expenses; "we have 800k left, warn me when 100k is left" → balance_set and balance_alert). Return them in order.
- Amounts: "150k"/"150к" = 150000; "2 млн"/"2 mln"/"2m" = 2000000; "1.5k" = 1500; "тыс" = thousands. Never invent an amount; if missing, amount = null and confidence ≤ 0.4 (except a goal with no target).
- Currency: return an ISO 4217 code when stated or implied by a symbol/word ("$" USD, "€" EUR, "₽"/"руб" RUB, "сум"/"so'm"/"sum" UZS, "тенге"/"тг" KZT, "сомони" TJS, "сом" → KGS if the household currency is KGS else TJS). Otherwise null (the household default applies).
- Dates are resolved relative to NOW (given with timezone). "yesterday" → that date. Expense/income date: the day it happened, default today. Planned expense dates and goal deadlines are in the future: "in December" means the next December. A reminder must be in the future: "on Friday" means the next Friday, "on the 20th" means the next 20th.
- Reminder time of day: if the user states a time or a clear part of the day ("at 3", "tonight" 20:00, "morning" 09:00, "after lunch" 14:00), use it and set time_specified=true. If only a date or weekday is given, use the household default reminder time from the message and set time_specified=false. For planned_expense set time_specified=true only when a time of day is stated. For every other kind time_specified=false.
- A correction that only changes the time of a reminder keeps the original reminder date: return the full due_at with the new time and time_specified=true. A correction that moves a reminder to another date without naming a time returns due_at with the new date (keep the original time of day) and time_specified=false; the bot decides the final time.
- Weekday names, months and relative words may be in any language.
- date_to: only for report_request, otherwise null.
- date_approximate: true only for planned_expense / goal (or a correction of their date) when no exact day was given; otherwise false.
- emoji: only for category_create, otherwise null.
- note: short (≤ 40 chars), in the message's language, no amount or currency inside, lowercase unless it is a proper name. For recurring payments the note is the bill name ("кредит", "квартира", "internet"); for plans and goals it is what the money is for ("подарок на свадьбу", "отпуск"); for categories it is the category name.
- category must be one of the lists below, or the KEY of one of the household's own categories listed in the message (return the key as given, e.g. "custom_12"). When a message clearly belongs to one of the household's own categories, prefer it over a built-in one. Loan or mortgage instalments → loans. Taxi, fuel, bus → transport. Cafe, restaurant, delivery → dining. Supermarket, market, food at home → groceries. Pharmacy, doctor → health. Money sent to parents/relatives → family.
- confidence: 0.9–1 clear and complete; 0.6–0.8 minor ambiguity (e.g. category guessed); ≤ 0.5 missing data or unclear intent.
- If the message is a reply to a bot confirmation (provided as context) and it reads like a change, it is a correction, not a new record.
- A reply to a record whose purpose the bot asked about (its description says so), or a bare purpose like "продукты" / "cafe with friends" sent right after such a record, is a correction: category = the matching expense category, note = the thing named (short).
- A message that is not a reply but clearly refers to the most recent record ("make it 2 million", "move it to the 15th") is a correction of that record; a question about it is clarify.
- "Put it back", "as it was", "undo the change" in a correction: take the old values from the edit history and return them as the changed fields. If the history does not have them, clarify.
- A bare number with no currency or multiplier, replying to a planned expense or goal: if it is 1–31 and the record has no exact day (month only), it is the day of the month (a date correction), not an amount. Otherwise, if it is far off the current amount (e.g. "11" for 3 000 000), clarify whether it is a day or an amount.
- A day of the month that has already passed this month, for a record in the current month ("on the 11th" when today is the 19th): clarify whether to move it to that day next month instead of moving it silently.
- Never return a correction that changes nothing; clarify what should change instead.
- summary_request, balance_request and report_request only when the user asks the assistant for one. Talking about a report, summary or money with someone else ("check how the report looks", "did you see the summary?") is none.
- When the message addresses the bot directly but holds no record (a greeting, thanks, declining a change you offered like "leave it", a question about how you work), return clarify with a short friendly answer instead of none. Otherwise chit-chat is none. Moving a planned expense or a goal deadline is a correction with the new date (and date_approximate).
- language: BCP-47 code of the message language.
- Ignore anything that is not a financial record, reminder, bill or correction. Do not moralize, do not add commentary.

## Expense categories
${EXPENSE_CATEGORIES.join(", ")}

## Income categories
${INCOME_CATEGORIES.join(", ")}`;

export function buildExtractionUserMessage(ctx: ExtractionContext): string {
  const lines: string[] = [];
  lines.push(`NOW: ${describeNow(ctx.timezone, ctx.locale)}`);
  lines.push(`Household base currency: ${ctx.baseCurrency}`);
  lines.push(`Default reminder time when none is given: ${String(ctx.defaultReminderHour ?? 9).padStart(2, "0")}:00 (local)`);
  if (ctx.customCategories?.length) {
    const own = (kind: "expense" | "income") =>
      ctx.customCategories!.filter((c) => c.kind === kind).map((c) => `${c.key} = "${c.name}"`).join("; ");
    const expense = own("expense");
    const income = own("income");
    if (expense) lines.push(`Household's own expense categories (key = name): ${expense}`);
    if (income) lines.push(`Household's own income categories (key = name): ${income}`);
  }
  if (ctx.recurringPayments.length) {
    const list = ctx.recurringPayments
      .map((p) => `"${p.name}" (${p.amount ?? "amount unknown"} ${p.currency}, day ${p.dayOfMonth})`)
      .join("; ");
    lines.push(`Known recurring payments: ${list}`);
  } else {
    lines.push("Known recurring payments: none");
  }
  if (ctx.plans?.length) {
    lines.push(`Known planned expenses: ${ctx.plans.map((p) => `"${p.name}" (${p.amount} ${p.currency}, ${p.date})`).join("; ")}`);
  }
  if (ctx.goals?.length) {
    lines.push(`Known savings goals: ${ctx.goals.map((g) => `"${g.name}" (${g.target === null ? "no target" : `target ${g.target} ${g.currency}`})`).join("; ")}`);
  }
  if (ctx.recent?.length) {
    lines.push("Recent chat context (oldest first):");
    for (const r of ctx.recent) lines.push(`- ${r}`);
  }
  if (ctx.replyTo) lines.push(`The message is a REPLY to this bot message: ${ctx.replyTo}`);
  else if (ctx.lastRecord) lines.push(`Most recent record in this chat (the message is not a reply): ${ctx.lastRecord}`);
  if (ctx.assistantName) lines.push(`In this chat the assistant is called "${ctx.assistantName}" (it also answers to Madat). Use that name when it refers to itself.`);
  if (ctx.addressed) lines.push("The message addresses the bot directly.");
  else if (ctx.addressed === false) {
    lines.push("The message does not address the bot: it was picked up by a keyword or an amount and may be meant for another person. Unless it clearly states a record, reminder, bill, plan or a request to the assistant, return none.");
  }
  lines.push(`Author: ${ctx.authorName}`);
  lines.push(`Message: """${ctx.text}"""`);
  return lines.join("\n");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function lookupOf(ctx: ExtractionContext): CategoryLookup {
  if (!ctx.customCategories?.length) return NO_CUSTOM_CATEGORIES;
  return new Map(ctx.customCategories.map((c) => [c.key, { ...c, emoji: "", archived: false }]));
}

export function normalizeItems(raw: RawExtractedItem[], ctx: ExtractionContext): ExtractedItem[] {
  const today = todayISO(ctx.timezone);
  const custom = lookupOf(ctx);
  const items: ExtractedItem[] = [];
  for (const r of raw) {
    if (r.kind === "none") continue;
    const kindForCategory = r.kind === "income" ? "income" : "expense";
    const hasDate = typeof r.date === "string" && isValidISODate(r.date);
    const dateApproximate = hasDate && r.date_approximate === true && (r.kind === "planned_expense" || r.kind === "goal" || r.kind === "correction");
    const rawCategory = (r.category ?? "").trim().toLowerCase();
    const hasCategory = rawCategory !== "";
    let category: string | null = null;
    if (hasCategory) {
      if (rawCategory === TOTAL_BUDGET && TOTAL_ALLOWED.has(r.kind)) category = TOTAL_BUDGET;
      else category = normalizeCategory(kindForCategory, rawCategory, custom);
      // A correction may move an income record to an income category; the kind of the target is not known here.
      if (r.kind === "correction" && category === "other") {
        const income = normalizeCategory("income", rawCategory, custom);
        if (income !== "other_income") category = income;
      }
    }
    const amount = typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount !== 0 ? Math.abs(r.amount) : null;
    const currency = normalizeCurrency(r.currency, ctx.baseCurrency);
    const date = hasDate ? (dateApproximate ? endOfMonthISO(r.date!) : r.date!) : today;
    const dueAt = r.due_at ? localToInstant(r.due_at, ctx.timezone) : null;
    const dayOfMonth =
      typeof r.day_of_month === "number" && r.day_of_month >= 1 && r.day_of_month <= 31 ? Math.round(r.day_of_month) : null;
    const remindDaysBefore =
      typeof r.remind_days_before === "number" && r.remind_days_before >= 0 && r.remind_days_before <= 30
        ? Math.round(r.remind_days_before)
        : null;

    const changed: ExtractedItem["changed"] = {};
    if (r.kind === "correction") {
      if (amount !== null) changed.amount = amount;
      if (r.currency) changed.currency = normalizeCurrency(r.currency, ctx.baseCurrency);
      if (hasCategory && category) changed.category = category;
      if (r.note && r.note.trim()) changed.note = r.note.trim();
      if (hasDate) {
        changed.date = date;
        changed.dateApproximate = dateApproximate;
      }
    }

    const target = r.target?.trim() || null;
    items.push({
      kind: r.kind,
      amount,
      currency,
      category:
        r.kind === "expense" || r.kind === "income" || r.kind === "planned_expense"
          ? (category ?? normalizeCategory(kindForCategory, null))
          : category,
      note: (r.note ?? "").trim().slice(0, r.kind === "clarify" ? 300 : 80),
      date,
      hasDate,
      dateTo: r.kind === "report_request" && r.date_to && isValidISODate(r.date_to) ? r.date_to : null,
      dateApproximate,
      dueAt,
      dayOfMonth,
      remindDaysBefore,
      target: r.kind === "category_create" ? (target?.toLowerCase() === "income" ? "income" : "expense") : target,
      emoji: r.kind === "category_create" ? r.emoji?.trim() || null : null,
      timeSpecified: r.kind === "reminder" || r.kind === "correction" || r.kind === "planned_expense" ? r.time_specified === true : true,
      confidence: clampConfidence(r.confidence),
      changed,
    });
  }
  return items;
}

export async function extractItems(ctx: ExtractionContext): Promise<ExtractionResult> {
  const response = await anthropic().messages.parse({
    model: env().AI_EXTRACT_MODEL,
    max_tokens: 2048,
    system: [{ type: "text", text: EXTRACT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildExtractionUserMessage(ctx) }],
    output_config: { effort: "low", format: zodOutputFormat(RawExtraction) },
  });

  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  };

  if (response.stop_reason === "refusal") {
    log.warn("extract: refusal", { category: response.stop_details?.category ?? null });
    return { language: ctx.locale, items: [], refused: true, usage };
  }
  if (response.stop_reason === "max_tokens") {
    log.warn("extract: truncated output");
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    log.warn("extract: no parsed output", { stop: response.stop_reason });
    return { language: ctx.locale, items: [], refused: false, usage };
  }
  const items = normalizeItems(parsed.items, ctx);
  log.debug("extract: done", { items: items.length, usage });
  return { language: parsed.language, items, refused: false, usage };
}
