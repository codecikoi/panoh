import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Bot } from "grammy";

vi.mock("../../../../packages/core/src/ai/extract.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../../packages/core/src/ai/extract.ts")>();
  return { ...mod, extractItems: vi.fn() };
});
vi.mock("../../../../packages/core/src/ai/insights.ts", () => ({ generateInsights: vi.fn().mockResolvedValue(null) }));
process.env.LOG_LEVEL = "warn";

import { createTestDb, extractItems, listRecentTransactions, listOpenReminders, listRecurring, type DbHandle, type ExtractedItem } from "@budgie/core";
process.env.DEFAULT_LOCALE = "ru";
process.env.DEFAULT_CURRENCY = "UZS";
process.env.DEFAULT_TIMEZONE = "Asia/Tashkent";

import { createBot } from "./bot.js";
import type { BotContext } from "./context.js";

const me = {
  id: 999,
  is_bot: true,
  first_name: "Budgie",
  username: "BudgieTestBot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;
const chat = { id: -100500, type: "supergroup" as const, title: "Семья" };
const zoir = { id: 42, is_bot: false, first_name: "Zoir", language_code: "ru" };

interface Call { method: string; payload: Record<string, unknown> }
const calls: Call[] = [];
let nextMessageId = 100;
let updateId = 1;

function item(partial: Partial<ExtractedItem>): ExtractedItem {
  return {
    kind: "expense", amount: null, currency: "UZS", category: null, note: "", date: "2026-10-13", dueAt: null,
    dayOfMonth: null, remindDaysBefore: null, target: null, confidence: 0.95, changed: {}, ...partial,
  };
}

function mockExtraction(items: ExtractedItem[]) {
  vi.mocked(extractItems).mockResolvedValueOnce({ language: "ru", items, refused: false });
}

async function sendText(bot: Bot<BotContext>, text: string, extra: Record<string, unknown> = {}): Promise<number> {
  const message_id = nextMessageId++;
  const update = { update_id: updateId++, message: { message_id, date: 1760000000, chat, from: zoir, text, ...extra } } as unknown as Update;
  await bot.handleUpdate(update);
  return message_id;
}

async function press(bot: Bot<BotContext>, data: string, messageId: number, text = "") {
  const update = {
    update_id: updateId++,
    callback_query: { id: String(updateId), from: zoir, chat_instance: "ci", data, message: { message_id: messageId, date: 1760000000, chat, text } },
  } as unknown as Update;
  await bot.handleUpdate(update);
}

const sent = () => calls.filter((c) => c.method === "sendMessage");
const lastSent = () => sent().at(-1)!;
const reactions = () => calls.filter((c) => c.method === "setMessageReaction").map((c) => JSON.stringify(c.payload.reaction));

let handle: DbHandle;
let bot: Bot<BotContext>;

beforeAll(async () => {
  handle = await createTestDb();
  // Fake Telegram transport below every grammY transformer, so parse_mode etc. are exercised for real.
  const fakeFetch: typeof fetch = async (input, init) => {
    const method = String(input).split("/").pop() ?? "";
    const payload = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ method, payload });
    let result: unknown = true;
    if (method === "sendMessage") {
      result = { message_id: nextMessageId++, date: 1760000000, chat: { id: payload.chat_id, type: "supergroup", title: "x" }, text: payload.text };
    }
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
  };
  bot = createBot("1:test", { db: handle.db }, { botInfo: me, client: { fetch: fakeFetch } });
});

afterAll(async () => {
  await handle.close();
});

beforeEach(() => {
  calls.length = 0;
});

describe("bot flow", () => {
  it("ignores unmarked chatter without calling the model", async () => {
    await sendText(bot, "ты где? скоро буду");
    expect(extractItems).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
  });

  it("sends the group welcome on /start", async () => {
    await sendText(bot, "/start", { entities: [{ type: "bot_command", offset: 0, length: 6 }] });
    expect(lastSent().payload.text).toContain("Привет");
    expect(String(lastSent().payload.text)).toContain("@BudgieTestBot");
  });

  it("records an expense from a prefixed message and confirms it", async () => {
    mockExtraction([item({ amount: 150000, category: "groceries", note: "продукты" })]);
    await sendText(bot, "+ продукты 150к");
    expect(extractItems).toHaveBeenCalledWith(expect.objectContaining({ text: "продукты 150к", baseCurrency: "UZS", timezone: "Asia/Tashkent" }));
    const confirmation = lastSent();
    expect(confirmation.payload.text).toContain("Расход");
    expect(confirmation.payload.text).toContain("Продукты");
    expect(confirmation.payload.parse_mode).toBe("HTML");
    expect(confirmation.payload.reply_markup).toBeTruthy();
    expect(reactions().at(-1)).toContain("✍");
    const rows = await listRecentTransactions(handle.db, 1);
    expect(rows[0]).toMatchObject({ amount: 150000, category: "groceries", status: "confirmed" });
    expect(rows[0]?.botMessageId).toBeTypeOf("number");
  });

  it("asks for confirmation when the model is unsure, then confirms via button", async () => {
    mockExtraction([item({ amount: 20000, category: "transport", note: "такси", confidence: 0.4 })]);
    await sendText(bot, "потратил на такси 20к");
    expect(lastSent().payload.text).toContain("🤔");
    const pending = (await listRecentTransactions(handle.db, 1))[0]!;
    expect(pending.status).toBe("pending");
    await press(bot, `tx:yes:${pending.id}`, pending.botMessageId!, "🤔 ...");
    const edited = calls.find((c) => c.method === "editMessageText");
    expect(edited?.payload.text).toContain("Расход");
    expect((await listRecentTransactions(handle.db, 1))[0]?.status).toBe("confirmed");
  });

  it("applies a correction sent as a reply to the confirmation", async () => {
    const before = (await listRecentTransactions(handle.db, 1))[0]!;
    mockExtraction([item({ kind: "correction", amount: 25000, changed: { amount: 25000 } })]);
    await sendText(bot, "не 20, а 25", { reply_to_message: { message_id: before.botMessageId, from: me, chat, date: 1, text: "x" } });
    expect(extractItems).toHaveBeenLastCalledWith(expect.objectContaining({ replyTo: expect.stringContaining("20000") }));
    const after = (await listRecentTransactions(handle.db, 1))[0]!;
    expect(after.id).toBe(before.id);
    expect(after.amount).toBe(25000);
    expect(calls.some((c) => c.method === "editMessageText" && String(c.payload.text).includes("25"))).toBe(true);
    expect(reactions().at(-1)).toContain("👌");
  });

  it("creates reminders and recurring payments, then marks a payment paid", async () => {
    mockExtraction([item({ kind: "reminder", note: "позвонить маме", dueAt: new Date(Date.now() + 3600_000) })]);
    await sendText(bot, "напомни через час позвонить маме");
    expect(lastSent().payload.text).toContain("⏰");
    expect((await listOpenReminders(handle.db, 1)).some((r) => r.title === "позвонить маме")).toBe(true);

    mockExtraction([item({ kind: "recurring_payment", note: "кредит", amount: 2000000, dayOfMonth: 15, category: "loans" })]);
    await sendText(bot, "кредит 2 млн каждое 15 число");
    expect(lastSent().payload.text).toContain("🔁");
    const [rp] = await listRecurring(handle.db, 1);
    expect(rp).toMatchObject({ name: "кредит", amount: 2000000, dayOfMonth: 15 });
    expect((await listOpenReminders(handle.db, 1)).some((r) => r.recurringPaymentId === rp!.id)).toBe(true);

    mockExtraction([item({ kind: "payment_done", target: "кредит", note: "оплатили кредит" })]);
    await sendText(bot, "оплатили кредит");
    expect(lastSent().payload.text).toContain("Оплачено");
    const [paid] = await listRecurring(handle.db, 1);
    expect(paid?.lastPaidPeriod).toMatch(/^\d{4}-\d{2}$/);
    expect((await listRecentTransactions(handle.db, 1))[0]).toMatchObject({ note: "кредит", amount: 2000000, recurringPaymentId: rp!.id });
  });

  it("replies with a summary on /summary and on a summary request", async () => {
    await sendText(bot, "/summary", { entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    expect(lastSent().payload.text).toContain("📊");
    expect(lastSent().payload.text).toContain("Кредиты");
    mockExtraction([item({ kind: "summary_request" })]);
    await sendText(bot, "@BudgieTestBot сводка");
    expect(sent().some((c) => String(c.payload.text).includes("📊"))).toBe(true);
  });

  it("tells the user when nothing was found in an explicit request", async () => {
    mockExtraction([]);
    await sendText(bot, "@BudgieTestBot как дела?");
    expect(lastSent().payload.text).toContain("🤷");
  });

  it("undoes the last record", async () => {
    mockExtraction([item({ amount: 5000, category: "dining", note: "кофе" })]);
    await sendText(bot, "+ кофе 5к");
    mockExtraction([item({ kind: "cancel_last" })]);
    await sendText(bot, "+ отмени");
    expect(lastSent().payload.text).toContain("🗑");
    expect((await listRecentTransactions(handle.db, 1))[0]?.note).not.toBe("кофе");
  });

  it("changes settings from inline buttons", async () => {
    await sendText(bot, "/settings", { entities: [{ type: "bot_command", offset: 0, length: 9 }] });
    const settingsMsg = lastSent();
    expect(settingsMsg.payload.text).toContain("UZS");
    await press(bot, "set:cur:USD", 555, "settings");
    const edited = calls.filter((c) => c.method === "editMessageText").at(-1);
    expect(edited?.payload.text).toContain("USD");
  });
});
