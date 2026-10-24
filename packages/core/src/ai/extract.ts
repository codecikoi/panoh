import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client.js";
import { env } from "../config.js";
import { log } from "../logger.js";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, normalizeCategory, type Category } from "../categories.js";
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
  "correction",
  "cancel_last",
  "summary_request",
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
  due_at: z.string().nullable(),
  day_of_month: z.number().int().nullable(),
  remind_days_before: z.number().int().nullable(),
  target: z.string().nullable(),
  time_specified: z.boolean(),
  confidence: z.number(),
});

const RawExtraction = z.object({
  language: z.string(),
  items: z.array(RawItem),
});

export type RawExtractedItem = z.infer<typeof RawItem>;

export interface ExtractedItem {
  kind: ItemKind;
  amount: number | null;
  currency: string;
  category: Category | null;
  note: string;
  /** ISO date: when an expense / income happened, or the planned date / goal deadline. Defaults to today. */
  date: string;
  /** Whether the model returned a date at all (`date` falls back to today otherwise). */
  hasDate: boolean;
  /** Only a month was given for a plan or goal; `date` is then the last day of that month. */
  dateApproximate: boolean;
  /** Instant for reminders (already converted from household local time). */
  dueAt: Date | null;
  dayOfMonth: number | null;
  remindDaysBefore: number | null;
  target: string | null;
  /** For reminders: whether the user stated a time of day (false = household default time was applied). */
  timeSpecified: boolean;
  confidence: number;
  /** Fields explicitly set by a correction. */
  changed: Partial<{ amount: number; currency: string; category: Category; note: string; date: string; dateApproximate: boolean }>;
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
  goals?: { name: string; target: number; currency: string }[];
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
- expense: money spent. Needs amount (number) and category from the expense list.
- income: money received. Needs amount and category from the income list.
- reminder: a one-off thing to do at a date/time. Needs due_at (local date-time, "YYYY-MM-DDTHH:mm"), note (what to do) and time_specified.
- recurring_payment: a bill that repeats every month on a fixed day (loan, rent, kindergarten, internet...). Needs day_of_month, note (short name), optional amount, optional remind_days_before.
- payment_done: the user says a KNOWN recurring payment or a KNOWN planned expense (see the lists in the user message) was paid or bought. Set target to that item's name exactly. Optional amount if stated (the actual amount may differ from the planned one).
- planned_expense: money the family intends to spend in the future ("в декабре подарок на свадьбу 3 млн", "plan 200$ for new tires next month", "в субботу купить коляску 2 млн"). Needs amount, category, note and date (the planned day). If only a month or a vague period is given, date = the last day of that month/period and date_approximate=true. If a time of day is stated, also set due_at and time_specified=true. Asking to be reminded to pay a specific amount on a date is a planned_expense too (the bot reminds on that day). Past or present tense ("bought", "paid", "spent") is an expense, not a plan.
- budget_limit: a monthly spending limit for one expense category ("лимит на продукты 3 млн", "no more than 1m a month on cafes"). Needs category and amount.
- budget_remove: remove the monthly limit of a category ("убери лимит на кафе"). Needs category.
- goal: a savings goal ("копим на отпуск 10 млн к июлю", "save 5000$ for a car"). note = goal name, amount = target, date = deadline (last day of the month with date_approximate=true if only a month is given), null if there is no deadline.
- goal_contribution: money put aside for a KNOWN savings goal (see the list) ("отложили на отпуск 1 млн", "+500k to the car fund"). target = that goal's name exactly, amount required. If there is exactly one goal and the message just says money went to savings, use it.
- correction: the message replies to a bot confirmation and changes something ("not 150, 115", "category transport", "it was yesterday", "in dollars"). Fill ONLY the changed fields; leave everything else null (note "" if unchanged).
- cancel_last: the user wants to remove the last record ("undo", "delete that", "wrong", "отмени", "bekor").
- summary_request: the user asks for totals / summary / how much was spent.
- rename: the user gives the assistant a new name ("теперь тебя зовут Кексик", "call yourself Kex", "seni endi Keksik deb chaqiramiz"). note = the new name exactly as written, without quotes; "Madat" to go back to the default. A question about the name ("как тебя зовут?") is clarify, not rename.
- clarify: you cannot act safely without asking, or the user asks about a record or about what the bot just did ("why didn't the amount change?", "what did you record?"). Put a short reply (≤ 200 chars) in note, in the message's language, friendly and specific: ask ONE concrete question, or answer using only facts from the context (the reply target, its edit history, the most recent record, recent chat). Never invent amounts or dates. Return clarify alone, not together with a record for the same thing.
- none: nothing actionable (chit-chat, questions, plans with neither an amount nor a date).

## Rules
- A message can contain several items ("groceries 150k and taxi 30k" → two expenses). Return them in order.
- Amounts: "150k"/"150к" = 150000; "2 млн"/"2 mln"/"2m" = 2000000; "1.5k" = 1500; "тыс" = thousands. Never invent an amount; if missing, amount = null and confidence ≤ 0.4.
- Currency: return an ISO 4217 code when stated or implied by a symbol/word ("$" USD, "€" EUR, "₽"/"руб" RUB, "сум"/"so'm"/"sum" UZS, "тенге"/"тг" KZT, "сомони" TJS, "сом" → KGS if the household currency is KGS else TJS). Otherwise null (the household default applies).
- Dates are resolved relative to NOW (given with timezone). "yesterday" → that date. Expense/income date: the day it happened, default today. Planned expense dates and goal deadlines are in the future: "in December" means the next December. A reminder must be in the future: "on Friday" means the next Friday, "on the 20th" means the next 20th.
- Reminder time of day: if the user states a time or a clear part of the day ("at 3", "tonight" 20:00, "morning" 09:00, "after lunch" 14:00), use it and set time_specified=true. If only a date or weekday is given, use the household default reminder time from the message and set time_specified=false. For planned_expense set time_specified=true only when a time of day is stated. For every other kind time_specified=false.
- A correction that only changes the time of a reminder keeps the original reminder date: return the full due_at with the new time and time_specified=true. A correction that moves a reminder to another date without naming a time returns due_at with the new date (keep the original time of day) and time_specified=false; the bot decides the final time.
- Weekday names, months and relative words may be in any language.
- date_approximate: true only for planned_expense / goal (or a correction of their date) when no exact day was given; otherwise false.
- note: short (≤ 40 chars), in the message's language, no amount or currency inside, lowercase unless it is a proper name. For recurring payments the note is the bill name ("кредит", "квартира", "internet"); for plans and goals it is what the money is for ("подарок на свадьбу", "отпуск").
- category must be one of the lists below. Loan or mortgage instalments → loans. Taxi, fuel, bus → transport. Cafe, restaurant, delivery → dining. Supermarket, market, food at home → groceries. Pharmacy, doctor → health. Money sent to parents/relatives → family.
- confidence: 0.9–1 clear and complete; 0.6–0.8 minor ambiguity (e.g. category guessed); ≤ 0.5 missing data or unclear intent.
- If the message is a reply to a bot confirmation (provided as context) and it reads like a change, it is a correction, not a new record.
- A message that is not a reply but clearly refers to the most recent record ("make it 2 million", "move it to the 15th") is a correction of that record; a question about it is clarify.
- "Put it back", "as it was", "undo the change" in a correction: take the old values from the edit history and return them as the changed fields. If the history does not have them, clarify.
- A bare number with no currency or multiplier, replying to a planned expense or goal: if it is 1–31 and the record has no exact day (month only), it is the day of the month (a date correction), not an amount. Otherwise, if it is far off the current amount (e.g. "11" for 3 000 000), clarify whether it is a day or an amount.
- A day of the month that has already passed this month, for a record in the current month ("on the 11th" when today is the 19th): clarify whether to move it to that day next month instead of moving it silently.
- Never return a correction that changes nothing; clarify what should change instead.
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
    lines.push(`Known savings goals: ${ctx.goals.map((g) => `"${g.name}" (target ${g.target} ${g.currency})`).join("; ")}`);
  }
  if (ctx.recent?.length) {
    lines.push("Recent chat context (oldest first):");
    for (const r of ctx.recent) lines.push(`- ${r}`);
  }
  if (ctx.replyTo) lines.push(`The message is a REPLY to this bot message: ${ctx.replyTo}`);
  else if (ctx.lastRecord) lines.push(`Most recent record in this chat (the message is not a reply): ${ctx.lastRecord}`);
  if (ctx.assistantName) lines.push(`In this chat the assistant is called "${ctx.assistantName}" (it also answers to Madat). Use that name when it refers to itself.`);
  if (ctx.addressed) lines.push("The message addresses the bot directly.");
  lines.push(`Author: ${ctx.authorName}`);
  lines.push(`Message: """${ctx.text}"""`);
  return lines.join("\n");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function normalizeItems(raw: RawExtractedItem[], ctx: ExtractionContext): ExtractedItem[] {
  const today = todayISO(ctx.timezone);
  const items: ExtractedItem[] = [];
  for (const r of raw) {
    if (r.kind === "none") continue;
    const kindForCategory = r.kind === "income" ? "income" : "expense";
    const hasDate = typeof r.date === "string" && isValidISODate(r.date);
    const dateApproximate = hasDate && r.date_approximate === true && (r.kind === "planned_expense" || r.kind === "goal" || r.kind === "correction");
    const hasCategory = typeof r.category === "string" && r.category.trim() !== "";
    const category: Category | null = hasCategory ? normalizeCategory(kindForCategory, r.category) : null;
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
      dateApproximate,
      dueAt,
      dayOfMonth,
      remindDaysBefore,
      target: r.target?.trim() || null,
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
