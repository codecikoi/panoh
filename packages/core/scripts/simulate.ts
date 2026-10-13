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
    replyTo: text.startsWith("не ") ? "expense record: amount 150000 UZS, category groceries, note \"продукты\", date 2026-10-13" : undefined,
  });
  console.log(`\n> ${text}  (${Date.now() - started} ms, tokens in/out/cached: ${result.usage?.input}/${result.usage?.output}/${result.usage?.cacheRead})`);
  for (const item of result.items) {
    console.log("  ", JSON.stringify({ ...item, dueAt: item.dueAt?.toISOString() ?? null }));
  }
  if (!result.items.length) console.log("   (nothing)");
}
