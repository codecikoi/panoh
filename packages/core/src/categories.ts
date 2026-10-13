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
  savings: "🐷",
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
