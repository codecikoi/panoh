/**
 * Renders a sample PDF report from made-up data, to check the layout after design changes (needs Chrome/Chromium).
 *   pnpm --filter @madat/bot report:preview /tmp/report.pdf [locale] [week]
 * Writes the HTML next to the PDF as well.
 */
import { writeFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { createGoal, createPlan, createTestDb, createTransaction, getOrCreateHousehold, loadReport, monthPeriod, setBudget, weekPeriod, todayISO } from "@madat/core";
import { renderReportHtml } from "../src/report/html.js";
import { htmlToPdf } from "../src/report/pdf.js";

const out = process.argv[2]!;
const locale = process.argv[3] ?? "ru";
const handle = await createTestDb();
const db = handle.db;
const { household } = await getOrCreateHousehold(db, { chatId: -1, chatType: "group", title: "Семья Зоира" }, { locale, currency: "UZS", timezone: "Asia/Tashkent" });
const tz = household.timezone;
const today = DateTime.now().setZone(tz);
const month = today.toFormat("yyyy-LL");
const prev = today.minus({ months: 1 });
const add = (kind: "expense" | "income", amount: number, category: string, note: string, d: DateTime, extra = {}) =>
  createTransaction(db, { householdId: household.id, kind, amount, currency: "UZS", amountBase: amount, baseCurrency: "UZS", category, note, occurredOn: d.toISODate()!, ...extra });
await add("income", 9000000, "salary", "зарплата", today.set({ day: 5 }));
await add("income", 1200000, "freelance", "проект <b>сайт</b>", today.set({ day: 9 }));
const spends: [number, string, string][] = [
  [1450000, "groceries", "Корзинка"], [380000, "groceries", "рынок"], [220000, "dining", "кафе с друзьями"], [2000000, "loans", "кредит"],
  [600000, "kids", "садик"], [150000, "transport", "такси"], [90000, "transport", "заправка"], [320000, "health", "аптека"],
  [180000, "subscriptions", "интернет"], [450000, "clothing", "куртка"], [75000, "pets", "корм коту"], [1000000, "savings", "отпуск"],
];
spends.forEach(([a, c, n], i) => add("expense", a, c, n, today.set({ day: Math.min(1 + i * 2, today.day) })));
await createTransaction(db, { householdId: household.id, kind: "expense", amount: 40, currency: "USD", amountBase: 512000, baseCurrency: "UZS", category: "entertainment", note: "Netflix + Spotify", occurredOn: today.set({ day: 3 }).toISODate()! });
for (const [a, c] of [[1200000, "groceries"], [500000, "dining"], [2000000, "loans"], [600000, "kids"], [300000, "transport"]] as const)
  await add("expense", a, c, c, prev.set({ day: 10 }));
await add("income", 9000000, "salary", "зарплата", prev.set({ day: 5 }));
await setBudget(db, household.id, "groceries", 2000000, "UZS");
await setBudget(db, household.id, "dining", 200000, "UZS");
await setBudget(db, household.id, "transport", 600000, "UZS");
const goal = await createGoal(db, { householdId: household.id, title: "отпуск в Турции", targetAmount: 10000000, currency: "UZS", deadline: today.plus({ months: 8 }).endOf("month").toISODate()! });
await add("expense", 1500000, "savings", "отпуск", prev.set({ day: 20 }), { goalId: goal.id });
await createPlan(db, { householdId: household.id, title: "подарок на свадьбу", amount: 3000000, currency: "UZS", category: "gifts", plannedOn: today.endOf("month").toISODate()!, dateApproximate: true });
const period = process.argv[4] === "week" ? weekPeriod(todayISO(tz)) : monthPeriod(month);
const data = await loadReport(db, household, period, { insights: false });
data.month && (data.month.insights = { highlights: ["Продукты — самая большая статья: 28% расходов.", "Кафе уже вышли за лимит."], tips: ["Попробуйте закупаться раз в неделю по списку."], mood: "neutral" });
const html = renderReportHtml({ locale, tz, assistantName: "Кексик", title: household.title, data });
await writeFile(out.replace(/\.pdf$/, ".html"), html);
const t0 = Date.now();
await writeFile(out, await htmlToPdf(html));
console.log("pdf ok", Date.now() - t0, "ms");
await handle.close();
