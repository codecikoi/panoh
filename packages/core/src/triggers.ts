import type { TriggerConfig } from "./db/schema.js";

export const BUILTIN_KEYWORDS: Record<string, string[]> = {
  en: [
    "spent", "spend", "paid", "pay", "bought", "buy", "expense", "expenses", "income", "salary", "earned", "received",
    "remind", "reminder", "loan", "credit", "mortgage", "payment", "rent", "bill", "bills", "subscription",
    "summary", "report", "stats", "undo", "cancel", "delete", "fix", "budget",
  ],
  ru: [
    "потратил", "потратила", "потратили", "трата", "траты", "купил", "купила", "купили", "заплатил", "заплатила",
    "заплатили", "оплатил", "оплатила", "оплатили", "оплата", "расход", "расходы", "доход", "доходы", "зарплата",
    "зп", "получил", "получила", "получили", "напомни", "напомнить", "напоминание", "кредит", "ипотека", "платёж",
    "платеж", "платежи", "аренда", "квартплата", "коммуналка", "подписка", "сводка", "итоги", "отчёт", "отчет",
    "статистика", "отмени", "отменить", "удали", "удалить", "исправь", "исправить", "бюджет", "записал", "запиши",
  ],
  uz: [
    "sarfladim", "sarfladik", "sarflandi", "xarajat", "xarajatlar", "sotib oldim", "sotib oldik", "oldim", "to'ladim",
    "to'ladik", "to'lov", "tuladim", "daromad", "maosh", "oylik", "oldik", "eslat", "eslatma", "eslatib", "kredit",
    "ipoteka", "ijara", "kommunal", "obuna", "hisobot", "xulosa", "statistika", "bekor", "o'chir", "tuzat", "byudjet",
    "yozib", "yoz",
  ],
};

const MONEY_PATTERN =
  /\d[\d\s.,'’]*\s?(?:k|к|тыс\.?|тысяч|млн\.?|миллион[а-я]*|mln|ming|million)?\s?(?:сум[а-я]*|sum|so'm|so‘m|soʻm|сўм|uzs|руб[а-я]*|р\.|₽|rub|\$|usd|доллар[а-я]*|dollars?|bucks|€|eur|евро|£|gbp|₸|тенге|тг|kzt|сом[а-я]*|somoni|tjs|kgs|грн|₴|uah|₺|try|лир[а-я]*|¥|jpy|cny|₹|inr|₩|krw|aed|дирхам[а-я]*)(?![\p{L}])/iu;

export interface TriggerInput {
  text: string;
  locale: string;
  botUsername?: string;
  isReplyToBot?: boolean;
  isPrivateChat?: boolean;
  config?: TriggerConfig | null;
}

export interface TriggerResult {
  process: boolean;
  reason: "private" | "mention" | "reply" | "prefix" | "keyword" | "money" | "none";
  /** True when the user clearly addressed the bot (mention, reply or prefix). */
  explicit: boolean;
  /** Message text with the trigger prefix / mention stripped. */
  cleaned: string;
}

export function effectiveKeywords(locale: string, config?: TriggerConfig | null): string[] {
  const base = BUILTIN_KEYWORDS[locale] ?? [];
  const english = locale === "en" ? [] : BUILTIN_KEYWORDS.en ?? [];
  const extra = config?.keywords ?? [];
  return [...new Set([...base, ...english, ...extra].map((k) => k.toLowerCase()))];
}

function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    if (!kw) return false;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?![\\p{L}])`, "iu").test(lower);
  });
}

export function evaluateTrigger(input: TriggerInput): TriggerResult {
  const text = input.text.trim();
  const config = input.config ?? {};
  const prefix = config.prefix ?? "+";
  const mentionEnabled = config.mention ?? true;
  const moneyEnabled = config.moneyPattern ?? true;

  if (input.isPrivateChat) return { process: true, reason: "private", explicit: true, cleaned: text };

  if (mentionEnabled && input.botUsername) {
    const mention = new RegExp(`@${input.botUsername}\\b`, "i");
    if (mention.test(text)) {
      return { process: true, reason: "mention", explicit: true, cleaned: text.replace(mention, "").trim() };
    }
  }
  if (mentionEnabled && input.isReplyToBot) return { process: true, reason: "reply", explicit: true, cleaned: text };
  if (prefix && text.startsWith(prefix) && text.length > prefix.length) {
    return { process: true, reason: "prefix", explicit: true, cleaned: text.slice(prefix.length).trim() };
  }
  if (containsKeyword(text, effectiveKeywords(input.locale, config))) {
    return { process: true, reason: "keyword", explicit: false, cleaned: text };
  }
  if (moneyEnabled && MONEY_PATTERN.test(text)) return { process: true, reason: "money", explicit: false, cleaned: text };
  return { process: false, reason: "none", explicit: false, cleaned: text };
}
