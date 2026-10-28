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

/** Icon for any category string coming from the database, falling back to the "other" box. */
export function categoryIcon(category: string): IconName {
  return CATEGORY_ICON[category as Category] ?? "package";
}

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function isIncomeCategory(value: string): value is IncomeCategory {
  return (INCOME_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeCategory(kind: "expense" | "income", value: string | null | undefined): Category {
  const v = (value ?? "").trim().toLowerCase();
  if (kind === "expense") return isExpenseCategory(v) ? v : "other";
  return isIncomeCategory(v) ? v : "other_income";
}
