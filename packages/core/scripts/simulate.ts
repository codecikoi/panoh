/**
 * Runs the extraction prompt against sample messages without Telegram. Needs ANTHROPIC_API_KEY.
 *   pnpm tsx scripts/simulate.ts "продукты 150к" "напомни завтра в 10 позвонить маме"
 * With no arguments a built-in sample set is used.
 */
import { extractItems } from "../src/ai/extract.js";

const samples = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "продукты 150к и такси 20к",
      "получил зарплату 9 млн",
      "напомни в пятницу заплатить за садик",
      "кредит 2 млн каждое 15 число",
      "оплатили кредит",
      "не 150, а 115",
      "сводка",
      "ты где? скоро буду",
      "spent 45$ on dinner yesterday",
      "ijara 300$ 1-sanada",
      "в декабре подарок на свадьбу 3 млн",
      "в субботу в 18:00 купить коляску 2 млн",
      "напомни 25 числа заплатить за садик 500к",
      "лимит на продукты 3 млн",
      "убери лимит на кафе",
      "копим на отпуск 10 млн к июлю",
      "отложили на отпуск 1 млн",
      "купили подарок на свадьбу за 2.8 млн",
      "dekabrda to'yga sovg'a 3 mln",
      "купили продукты 200к",
      "у нас в бюджете осталось 800к, напомни когда останется 100к",
      "сколько у нас осталось?",
      "сколько осталось на продукты?",
      "бюджет на месяц 5 млн",
      "создай категорию Машина",
      "новая категория доходов Аренда 🏡",
      "мойка машины 50к",
      "копим в заначку",
      "в заначку 300к",
    ];

for (const text of samples) {
  const started = Date.now();
  const result = await extractItems({
    text,
    authorName: "Zoir",
    locale: "ru",
    timezone: "Asia/Tashkent",
    baseCurrency: "UZS",
    recurringPayments: [{ name: "кредит", amount: 2000000, currency: "UZS", dayOfMonth: 15 }],
    plans: [{ name: "подарок на свадьбу", amount: 3000000, currency: "UZS", date: "2026-12-31" }],
    goals: [{ name: "отпуск", target: 10000000, currency: "UZS" }, { name: "заначка", target: null, currency: "UZS" }],
    customCategories: [{ key: "custom_12", kind: "expense", name: "Машина" }],
    replyTo: text.startsWith("не ") ? "expense record: amount 150000 UZS, category groceries, note \"продукты\", date 2026-10-13" : undefined,
  });
  console.log(`\n> ${text}  (${Date.now() - started} ms, tokens in/out/cached: ${result.usage?.input}/${result.usage?.output}/${result.usage?.cacheRead})`);
  for (const item of result.items) {
    console.log("  ", JSON.stringify({ ...item, dueAt: item.dueAt?.toISOString() ?? null }));
  }
  if (!result.items.length) console.log("   (nothing)");
}
