/**
 * Fills a separate local PGlite database with a demo family for dashboard development.
 *   PGLITE_DIR=./data/pglite-demo pnpm --filter @madat/api demo:seed
 *   PGLITE_DIR=./data/pglite-demo BOT_TOKEN=dev PORT=8081 pnpm dev:api     # then open http://localhost:5173/?debugUser=42
 */
import {
  nowIn,
  createDb, createGoal, createPlan, createRecurring, createReminder, createTransaction, ensureMember, getOrCreateHousehold, setBudget, upsertUser,
} from "@madat/core";

const handle = await createDb();
await handle.migrate();
const db = handle.db;
const { household, created } = await getOrCreateHousehold(db, { chatId: -100777, chatType: "group", title: "Семья" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
const user = await upsertUser(db, { id: 42, languageCode: "ru" });
await ensureMember(db, household.id, user.id);
if (!created) {
  console.log("demo household already exists:", household.id);
  process.exit(0);
}
type DateTime = ReturnType<typeof nowIn>;
const now = nowIn(household.timezone);
const add = (kind: "expense" | "income", amount: number, category: string, note: string, d: DateTime, extra = {}) =>
  createTransaction(db, { householdId: household.id, kind, amount, currency: "UZS", amountBase: amount, baseCurrency: "UZS", category, note, occurredOn: d.toISODate()!, ...extra });
const day = (n: number) => now.set({ day: Math.min(n, now.day) });
await add("income", 9000000, "salary", "зарплата", day(5));
await add("income", 1200000, "freelance", "сайт для клиента", day(9));
const spends: [number, string, string, number][] = [
  [1450000, "groceries", "Корзинка", 1], [380000, "groceries", "рынок", 3], [260000, "groceries", "Макро", 12], [220000, "dining", "кафе с друзьями", 6],
  [2000000, "loans", "кредит", 15], [600000, "kids", "садик", 2], [150000, "transport", "такси", 4], [90000, "transport", "заправка", 10],
  [320000, "health", "аптека", 8], [180000, "subscriptions", "интернет", 11], [450000, "clothing", "куртка", 14], [75000, "pets", "корм коту", 7],
  [900000, "travel", "билеты в Самарканд", 13],
];
for (const [a, c, n, d] of spends) await add("expense", a, c, n, day(d));
await createTransaction(db, { householdId: household.id, kind: "expense", amount: 40, currency: "USD", amountBase: 512000, baseCurrency: "UZS", category: "entertainment", note: "Netflix + Spotify", occurredOn: day(3).toISODate()!, status: "confirmed" });
await add("expense", 120000, "dining", "кофе", day(16), { status: "pending" });
const prev = now.minus({ months: 1 });
for (const [a, c] of [[1200000, "groceries"], [500000, "dining"], [2000000, "loans"], [600000, "kids"], [300000, "transport"], [250000, "beauty"], [100000, "pets"]] as const) {
  await add("expense", a, c, c, prev.set({ day: 10 }));
}
await add("income", 9000000, "salary", "зарплата", prev.set({ day: 5 }));
await setBudget(db, household.id, "groceries", 2300000, "UZS");
await setBudget(db, household.id, "dining", 200000, "UZS");
await setBudget(db, household.id, "transport", 600000, "UZS");
const goal = await createGoal(db, { householdId: household.id, title: "отпуск в Турции", targetAmount: 10000000, currency: "UZS", deadline: now.plus({ months: 8 }).endOf("month").toISODate()! });
await add("expense", 1500000, "savings", "отпуск", prev.set({ day: 20 }), { goalId: goal.id });
await createGoal(db, { householdId: household.id, title: "новый ноутбук", targetAmount: 15000000, currency: "UZS", deadline: null });
await createPlan(db, { householdId: household.id, title: "подарок на свадьбу", amount: 3000000, currency: "UZS", category: "gifts", plannedOn: now.endOf("month").toISODate()!, dateApproximate: true });
await createPlan(db, { householdId: household.id, title: "ремонт машины", amount: 5000000, currency: "UZS", category: "transport", plannedOn: now.plus({ months: 1 }).set({ day: 12 }).toISODate()! });
await createRecurring(db, { householdId: household.id, name: "кредит", amount: 2000000, currency: "UZS", category: "loans", dayOfMonth: 15 });
await createRecurring(db, { householdId: household.id, name: "интернет", amount: 180000, currency: "UZS", category: "utilities", dayOfMonth: 28 });
await createReminder(db, { householdId: household.id, kind: "reminder", title: "позвонить в банк", dueAt: now.plus({ days: 2 }).set({ hour: 10, minute: 0 }).toJSDate() });
console.log("demo household created:", household.id);
await handle.close();
