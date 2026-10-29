import type { IconName } from "./brand/icons.js";

export const EXPENSE_CATEGORIES = [
  "groceries",
  "dining",
  "transport",
  "housing",
  "utilities",
  "health",
  "kids",
  "education",
  "clothing",
  "beauty",
  "entertainment",
  "subscriptions",
  "gifts",
  "travel",
  "loans",
  "savings",
  "family",
  "household",
  "pets",
  "other",
] as const;

export const INCOME_CATEGORIES = ["salary", "business", "freelance", "gift", "refund", "other_income"] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type Category = ExpenseCategory | IncomeCategory;

export const CATEGORY_EMOJI: Record<Category, string> = {
  groceries: "🛒",
  dining: "🍽️",
  transport: "🚕",
  housing: "🏠",
  utilities: "💡",
  health: "💊",
  kids: "🧸",
  education: "📚",
  clothing: "👕",
  beauty: "💅",
  entertainment: "🎬",
  subscriptions: "📱",
  gifts: "🎁",
  travel: "✈️",
  loans: "🏦",
  savings: "💰",
  family: "👨‍👩‍👧",
  household: "🧹",
  pets: "🐾",
  other: "📦",
  salary: "💼",
  business: "🏪",
  freelance: "💻",
  gift: "🎀",
  refund: "↩️",
  other_income: "💵",
};

/**
 * Lucide icon for each category: the dashboard and the PDF report draw these instead of the emoji, which stay for chat
 * (Telegram cannot show SVG). Expense and income "gift" differ on purpose: a wrapped gift given vs. money received.
 */
export const CATEGORY_ICON: Record<Category, IconName> = {
  groceries: "shopping-cart",
  dining: "utensils",
  transport: "car",
  housing: "house",
  utilities: "plug-zap",
  health: "pill",
  kids: "baby",
  education: "graduation-cap",
  clothing: "shirt",
  beauty: "sparkles",
  entertainment: "clapperboard",
  subscriptions: "smartphone",
  gifts: "gift",
  travel: "plane",
  loans: "landmark",
  savings: "piggy-bank",
  family: "users",
  household: "spray-can",
  pets: "paw-print",
  other: "package",
  salary: "briefcase",
  business: "store",
  freelance: "laptop",
  gift: "hand-coins",
  refund: "undo-2",
  other_income: "banknote",
};

/** Key of the household-wide monthly limit in `budgets.category` ("budget for the month 5M"). */
export const TOTAL_BUDGET = "total";

/** Icon for any category string coming from the database: the month total gets a wallet, custom categories a tag. */
export function categoryIcon(category: string): IconName {
  if (category === TOTAL_BUDGET) return "wallet";
  if (isCustomCategory(category)) return "tag";
  return CATEGORY_ICON[category as Category] ?? "package";
}

// ---------- custom categories ----------

const CUSTOM_PREFIX = "custom_";

/** A category the family added; `key` is what records store ("custom_12"). */
export interface CustomCategoryInfo {
  key: string;
  kind: "expense" | "income";
  name: string;
  emoji: string;
  /** Removed by the family: still named in old records, not offered for new ones. */
  archived: boolean;
}

/** Custom categories of one household, by key. Empty means none. */
export type CategoryLookup = ReadonlyMap<string, CustomCategoryInfo>;

export const NO_CUSTOM_CATEGORIES: CategoryLookup = new Map();

export function customCategoryKey(id: number): string {
  return `${CUSTOM_PREFIX}${id}`;
}

export function isCustomCategory(value: string): boolean {
  return /^custom_\d+$/.test(value);
}

export function customCategoryId(key: string): number | null {
  const m = /^custom_(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** Emoji for any category key: built-in, the month total, or a custom one (📦 when unknown). */
export function categoryEmoji(category: string, custom: CategoryLookup = NO_CUSTOM_CATEGORIES): string {
  if (category === TOTAL_BUDGET) return "🧮";
  return custom.get(category)?.emoji ?? CATEGORY_EMOJI[category as Category] ?? "📦";
}

/** Custom categories the family can still use, of one kind. */
export function activeCustomCategories(custom: CategoryLookup, kind: "expense" | "income"): CustomCategoryInfo[] {
  return [...custom.values()].filter((c) => c.kind === kind && !c.archived);
}

/** Finds an active custom category by its key or its name (case-insensitive). */
export function findCustomCategory(custom: CategoryLookup, kind: "expense" | "income" | null, value: string): CustomCategoryInfo | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  for (const c of custom.values()) {
    if (c.archived || (kind && c.kind !== kind)) continue;
    if (c.key === v || c.name.toLowerCase() === v) return c;
  }
  return undefined;
}

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function isIncomeCategory(value: string): value is IncomeCategory {
  return (INCOME_CATEGORIES as readonly string[]).includes(value);
}

/** Built-in category key, or the key of an active custom category (by key or name); "other" / "other_income" otherwise. */
export function normalizeCategory(kind: "expense" | "income", value: string | null | undefined, custom: CategoryLookup = NO_CUSTOM_CATEGORIES): string {
  const v = (value ?? "").trim().toLowerCase();
  const own = custom.size ? findCustomCategory(custom, kind, v) : undefined;
  if (own) return own.key;
  if (kind === "expense") return isExpenseCategory(v) ? v : "other";
  return isIncomeCategory(v) ? v : "other_income";
}

/** Whether a stored category key belongs to the expense side (built-in or custom). */
export function categoryKind(category: string, custom: CategoryLookup = NO_CUSTOM_CATEGORIES): "expense" | "income" {
  const own = custom.get(category);
  if (own) return own.kind;
  return isIncomeCategory(category) ? "income" : "expense";
}
