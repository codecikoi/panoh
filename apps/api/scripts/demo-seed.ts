/**
 * Fills a separate local PGlite database with a demo family for dashboard development.
 *   PGLITE_DIR=./data/pglite-demo pnpm --filter @madat/api demo:seed
 *   PGLITE_DIR=./data/pglite-demo BOT_TOKEN=dev PORT=8081 pnpm dev:api     # then open http://localhost:5173/?debugUser=42
 */
import {
  nowIn,
  createBalance, createCustomCategory, createDb, createGoal, createPlan, createRecurring, createReminder, createTransaction, customCategoryKey, ensureMember,
  getOrCreateHousehold, setBudget, upsertUser,
} from "@madat/core";

const handle = await createDb();
await handle.migrate();
const db = handle.db;
const { household, created } = await getOrCreateHousehold(db, { chatId: -100777, chatType: "group", title: "Семья" }, { locale: "ru", currency: "USD", timezone: "Asia/Tashkent" });
const user = await upsertUser(db, { id: 42, languageCode: "ru", firstName: "Зоир" });
await ensureMember(db, household.id, user.id);
const partner = await upsertUser(db, { id: 43, languageCode: "ru", firstName: "Малика" });
await ensureMember(db, household.id, partner.id);
if (!created) {
  console.log("demo household already exists:", household.id);
  process.exit(0);
}
type DateTime = ReturnType<typeof nowIn>;
const now = nowIn(household.timezone);
let turn = 0;
// Records alternate between the two members, so "who spent what" has something to show.
const add = (kind: "expense" | "income", amount: number, category: string, note: string, d: DateTime, extra = {}) =>
  createTransaction(db, {
    householdId: household.id, userId: turn++ % 3 === 0 ? partner.id : user.id, kind, amount, currency: "USD", amountBase: amount, baseCurrency: "USD", category, note, occurredOn: d.toISODate()!, ...extra,
  });
const day = (n: number) => now.set({ day: Math.min(n, now.day) });
await add("income", 3000, "salary", "зарплата", day(5));
await add("income", 400, "freelance", "сайт для клиента", day(9));
const spends: [number, string, string, number][] = [
  [115, "groceries", "Корзинка", 1], [30, "groceries", "рынок", 3], [20, "groceries", "Макро", 12], [17, "dining", "кафе с друзьями", 6],
  [160, "loans", "кредит", 15], [50, "kids", "садик", 2], [12, "transport", "такси", 4], [7, "transport", "заправка", 10],
  [25, "health", "аптека", 8], [15, "subscriptions", "интернет", 11], [35, "clothing", "куртка", 14], [6, "pets", "корм коту", 7],
  [70, "travel", "билеты в Самарканд", 13], [40, "entertainment", "Netflix + Spotify", 3],
];
for (const [a, c, n, d] of spends) await add("expense", a, c, n, day(d));
// A record built up by replies: positions with their own authors.
await add("expense", 48, "groceries", "корзинка + виноград", day(5), {
  userId: user.id,
  items: [{ amount: 42, note: "корзинка", userId: user.id }, { amount: 6, note: "виноград", userId: partner.id }],
});
// A family category, the month budget, an open stash and a balance checkpoint, so every new block has data.
const car = await createCustomCategory(db, { householdId: household.id, kind: "expense", name: "Машина", emoji: "🚗" });
await add("expense", 22, customCategoryKey(car.id), "мойка", day(9));
await add("expense", 45, customCategoryKey(car.id), "страховка", day(15));
await setBudget(db, household.id, "total", 1200, "USD");
await setBudget(db, household.id, customCategoryKey(car.id), 60, "USD");
const stash = await createGoal(db, { householdId: household.id, title: "заначка", targetAmount: null, currency: "USD", deadline: null });
await add("expense", 50, "savings", "заначка", day(6), { goalId: stash.id });
await createBalance(db, { householdId: household.id, amount: 1800, currency: "USD", asOf: day(1).toISODate()!, expected: null, createdAt: day(1).startOf("day").toJSDate() });
await add("expense", 9, "dining", "кофе", day(16), { status: "pending" });
const prev = now.minus({ months: 1 });
for (const [a, c] of [[95, "groceries"], [40, "dining"], [160, "loans"], [50, "kids"], [25, "transport"], [20, "beauty"], [8, "pets"]] as const) {
  await add("expense", a, c, c, prev.set({ day: 10 }));
}
await add("income", 3000, "salary", "зарплата", prev.set({ day: 5 }));
await setBudget(db, household.id, "groceries", 180, "USD");
await setBudget(db, household.id, "dining", 15, "USD");
await setBudget(db, household.id, "transport", 50, "USD");
const goal = await createGoal(db, { householdId: household.id, title: "отпуск в Турции", targetAmount: 800, currency: "USD", deadline: now.plus({ months: 8 }).endOf("month").toISODate()! });
await add("expense", 120, "savings", "отпуск", prev.set({ day: 20 }), { goalId: goal.id });
await createGoal(db, { householdId: household.id, title: "новый ноутбук", targetAmount: 1200, currency: "USD", deadline: null });
await createPlan(db, { householdId: household.id, title: "подарок на свадьбу", amount: 250, currency: "USD", category: "gifts", plannedOn: now.endOf("month").toISODate()!, dateApproximate: true });
await createPlan(db, { householdId: household.id, title: "ремонт машины", amount: 400, currency: "USD", category: "transport", plannedOn: now.plus({ months: 1 }).set({ day: 12 }).toISODate()! });
await createRecurring(db, { householdId: household.id, name: "кредит", amount: 160, currency: "USD", category: "loans", dayOfMonth: 15 });
await createRecurring(db, { householdId: household.id, name: "интернет", amount: 15, currency: "USD", category: "utilities", dayOfMonth: 28 });
await createReminder(db, { householdId: household.id, kind: "reminder", title: "оплатить садик", dueAt: now.plus({ days: 2 }).set({ hour: 9, minute: 0 }).toJSDate() });
console.log("demo household created:", household.id);
await handle.close();
