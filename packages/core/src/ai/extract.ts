import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client.js";
import { env } from "../config.js";
import { log } from "../logger.js";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, normalizeCategory, type Category } from "../categories.js";
import { normalizeCurrency } from "../money.js";
import { describeNow, isValidISODate, localToInstant, todayISO } from "../dates.js";

export const ITEM_KINDS = [
  "expense",
  "income",
  "reminder",
  "recurring_payment",
  "payment_done",
  "correction",
  "cancel_last",
  "summary_request",
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
  due_at: z.string().nullable(),
  day_of_month: z.number().int().nullable(),
  remind_days_before: z.number().int().nullable(),
  target: z.string().nullable(),
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
  /** ISO date for expense / income. */
  date: string;
  /** Instant for reminders (already converted from household local time). */
  dueAt: Date | null;
  dayOfMonth: number | null;
  remindDaysBefore: number | null;
  target: string | null;
  confidence: number;
  /** Fields explicitly set by a correction. */
  changed: Partial<{ amount: number; currency: string; category: Category; note: string; date: string }>;
}

export interface ExtractionContext {
  text: string;
  authorName: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  recurringPayments: { name: string; amount: number | null; currency: string; dayOfMonth: number }[];
  /** Short description of the bot message the user replied to, if any. */
  replyTo?: string;
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
- reminder: a one-off thing to do at a date/time. Needs due_at (local date-time, "YYYY-MM-DDTHH:mm") and note (what to do).
- recurring_payment: a bill that repeats every month on a fixed day (loan, rent, kindergarten, internet...). Needs day_of_month, note (short name), optional amount, optional remind_days_before.
- payment_done: the user says a KNOWN recurring payment (see the list in the user message) was paid. Set target to that payment's name exactly. Optional amount if stated.
- correction: the message replies to a bot confirmation and changes something ("not 150, 115", "category transport", "it was yesterday", "in dollars"). Fill ONLY the changed fields; leave everything else null (note "" if unchanged).
- cancel_last: the user wants to remove the last record ("undo", "delete that", "wrong", "отмени", "bekor").
- summary_request: the user asks for totals / summary / how much was spent.
- none: nothing actionable (chit-chat, questions, plans without money or dates).

## Rules
- A message can contain several items ("groceries 150k and taxi 30k" → two expenses). Return them in order.
- Amounts: "150k"/"150к" = 150000; "2 млн"/"2 mln"/"2m" = 2000000; "1.5k" = 1500; "тыс" = thousands. Never invent an amount; if missing, amount = null and confidence ≤ 0.4.
- Currency: return an ISO 4217 code when stated or implied by a symbol/word ("$" USD, "€" EUR, "₽"/"руб" RUB, "сум"/"so'm"/"sum" UZS, "тенге"/"тг" KZT, "сомони" TJS, "сом" → KGS if the household currency is KGS else TJS). Otherwise null (the household default applies).
- Dates are resolved relative to NOW (given with timezone). "yesterday" → that date. Expense/income date: the day it happened, default today. For reminders without a time use 09:00; "tonight" 20:00; "morning" 09:00; "after lunch" 14:00. A reminder must be in the future: "on Friday" means the next Friday, "on the 20th" means the next 20th.
- Weekday names, months and relative words may be in any language.
- note: short (≤ 40 chars), in the message's language, no amount or currency inside, lowercase unless it is a proper name. For recurring payments the note is the bill name ("кредит", "квартира", "internet").
- category must be one of the lists below. Loan or mortgage instalments → loans. Taxi, fuel, bus → transport. Cafe, restaurant, delivery → dining. Supermarket, market, food at home → groceries. Pharmacy, doctor → health. Money sent to parents/relatives → family.
- confidence: 0.9–1 clear and complete; 0.6–0.8 minor ambiguity (e.g. category guessed); ≤ 0.5 missing data or unclear intent.
- If the message is a reply to a bot confirmation (provided as context) and it reads like a change, it is a correction, not a new record.
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
  if (ctx.recurringPayments.length) {
    const list = ctx.recurringPayments
      .map((p) => `"${p.name}" (${p.amount ?? "amount unknown"} ${p.currency}, day ${p.dayOfMonth})`)
      .join("; ");
    lines.push(`Known recurring payments: ${list}`);
  } else {
    lines.push("Known recurring payments: none");
  }
  if (ctx.recent?.length) {
    lines.push("Recent chat context (oldest first):");
    for (const r of ctx.recent) lines.push(`- ${r}`);
  }
  if (ctx.replyTo) lines.push(`The message is a REPLY to this bot message: ${ctx.replyTo}`);
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
    const hasCategory = typeof r.category === "string" && r.category.trim() !== "";
    const category: Category | null = hasCategory ? normalizeCategory(kindForCategory, r.category) : null;
    const amount = typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount !== 0 ? Math.abs(r.amount) : null;
    const currency = normalizeCurrency(r.currency, ctx.baseCurrency);
    const date = r.date && isValidISODate(r.date) ? r.date : today;
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
      if (r.date && isValidISODate(r.date)) changed.date = r.date;
    }

    items.push({
      kind: r.kind,
      amount,
      currency,
      category: r.kind === "expense" || r.kind === "income" ? (category ?? normalizeCategory(kindForCategory, null)) : category,
      note: (r.note ?? "").trim().slice(0, 80),
      date,
      dueAt,
      dayOfMonth,
      remindDaysBefore,
      target: r.target?.trim() || null,
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
