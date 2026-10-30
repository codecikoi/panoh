/**
 * Runs the extraction prompt against sample messages without Telegram. Needs ANTHROPIC_API_KEY.
 *   pnpm tsx scripts/simulate.ts "продукты 150к" "напомни завтра в 10 позвонить маме"
 * With no arguments a built-in sample set is used. A prefix makes the message a reply to a bot message:
 *   "> text"  a plain expense record · ">> text" a record with two positions · ">b text" a balance checkpoint
 */
import { extractItems } from "../src/ai/extract.js";

const REPLY_TARGETS: Record<string, string> = {
  ">>": 'expense record: amount 333000 UZS, category groceries, note "корзинка продукты + виноград", date 2026-10-30; positions: "корзинка продукты" 313000, "виноград" 20000',
  ">b":
    "balance checkpoint: the family said they had 100000 UZS on 2026-10-30; the bot counts the money on hand from this figure. Just before it the records gave 369000 UZS: the previous checkpoint 800000 UZS (2026-10-29) + income 0 − expenses 431000 recorded between the two (the bot counts only records made after a checkpoint and dated on or after its day). The family's figure differs from that by -269000; the bot counts from the family's figure now.",
  ">": 'expense record: amount 313000 UZS, category groceries, note "корзинка продукты", date 2026-10-30',
};

function splitReply(raw: string): { text: string; replyTo?: string } {
  for (const prefix of Object.keys(REPLY_TARGETS)) {
    if (raw.startsWith(`${prefix} `)) return { text: raw.slice(prefix.length + 1), replyTo: REPLY_TARGETS[prefix] };
  }
  return { text: raw, replyTo: raw.startsWith("не ") ? 'expense record: amount 150000 UZS, category groceries, note "продукты", date 2026-10-13' : undefined };
}

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
      "> добавь ещё 20к виноград",
      ">> убери виноград",
      "остаток на продукты 100к",
      ">b по каким записям 369к?",
    ];

for (const raw of samples) {
  const started = Date.now();
  const { text, replyTo } = splitReply(raw);
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
    replyTo,
  });
  console.log(`\n> ${raw}  (${Date.now() - started} ms, tokens in/out/cached: ${result.usage?.input}/${result.usage?.output}/${result.usage?.cacheRead})`);
  for (const item of result.items) {
    console.log("  ", JSON.stringify({ ...item, dueAt: item.dueAt?.toISOString() ?? null }));
  }
  if (!result.items.length) console.log("   (nothing)");
}
