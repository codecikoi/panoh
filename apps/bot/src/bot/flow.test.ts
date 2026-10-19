import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Bot } from "grammy";

vi.mock("../../../../packages/core/src/ai/extract.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../../packages/core/src/ai/extract.ts")>();
  return { ...mod, extractItems: vi.fn() };
});
vi.mock("../../../../packages/core/src/ai/insights.ts", () => ({ generateInsights: vi.fn().mockResolvedValue(null) }));
process.env.LOG_LEVEL = "warn";

import {
  createTestDb,
  extractItems,
  getHouseholdByChatId,
  getPlan,
  getPlanReminder,
  getReminder,
  listActiveGoals,
  listBudgets,
  listOpenPlans,
  listRecentTransactions,
  listOpenReminders,
  listRecurring,
  markReminderDone,
  updateReminder,
  type DbHandle,
  type ExtractedItem,
} from "@madat/core";
import { DateTime } from "luxon";
process.env.DEFAULT_LOCALE = "ru";
process.env.DEFAULT_CURRENCY = "UZS";
process.env.DEFAULT_TIMEZONE = "Asia/Tashkent";

import { createBot } from "./bot.js";
import { createScheduler } from "../scheduler.js";
import type { BotContext } from "./context.js";

const me = {
  id: 999,
  is_bot: true,
  first_name: "Madat",
  username: "MadatTestBot",
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
    kind: "expense", amount: null, currency: "UZS", category: null, note: "", date: "2026-10-13", hasDate: false, dateApproximate: false, dueAt: null,
    dayOfMonth: null, remindDaysBefore: null, target: null, timeSpecified: true, confidence: 0.95, changed: {}, ...partial,
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
    expect(String(lastSent().payload.text)).toContain("@MadatTestBot");
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

  it("records an expense when addressed by name", async () => {
    mockExtraction([item({ amount: 25000, category: "transport", note: "такси" })]);
    await sendText(bot, "Мадат, такси 25к");
    expect(extractItems).toHaveBeenCalledWith(expect.objectContaining({ text: "такси 25к" }));
    expect(lastSent().payload.text).toContain("Расход");
    expect(reactions().at(-1)).toContain("✍");
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

  it("offers a time picker when a reminder came without a time and applies the chosen hour", async () => {
    const tomorrow9 = DateTime.now().setZone("Asia/Tashkent").plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    mockExtraction([item({ kind: "reminder", note: "запись к педиатру", dueAt: tomorrow9.toJSDate(), timeSpecified: false })]);
    await sendText(bot, "напомни завтра про запись к педиатру");
    const confirmation = lastSent();
    expect(confirmation.payload.text).toContain("по умолчанию");
    expect(JSON.stringify(confirmation.payload.reply_markup)).toContain("Изменить время");
    const reminder = (await listOpenReminders(handle.db, 1)).find((r) => r.title === "запись к педиатру")!;
    expect(reminder.botMessageId).toBeTypeOf("number");

    await press(bot, `rem:time:${reminder.id}`, reminder.botMessageId!, "x");
    const picker = calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(JSON.stringify(picker.payload.reply_markup)).toContain(`rem:time:${reminder.id}:14`);

    await press(bot, `rem:time:${reminder.id}:14`, reminder.botMessageId!, "x");
    const updated = (await getReminder(handle.db, reminder.id))!;
    expect(DateTime.fromJSDate(updated.dueAt).setZone("Asia/Tashkent").hour).toBe(14);
    expect(DateTime.fromJSDate(updated.dueAt).setZone("Asia/Tashkent").toISODate()).toBe(tomorrow9.toISODate());
    const final = calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(final.payload.text).not.toContain("по умолчанию");
    expect(final.payload.text).toContain("14:00");
  });

  it("moves a default-time reminder when the user replies with a time", async () => {
    const tomorrow9 = DateTime.now().setZone("Asia/Tashkent").plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    mockExtraction([item({ kind: "reminder", note: "забрать посылку", dueAt: tomorrow9.toJSDate(), timeSpecified: false })]);
    await sendText(bot, "напомни завтра забрать посылку");
    const reminder = (await listOpenReminders(handle.db, 1)).find((r) => r.title === "забрать посылку")!;
    mockExtraction([item({ kind: "correction", dueAt: tomorrow9.set({ hour: 16, minute: 30 }).toJSDate(), timeSpecified: true })]);
    await sendText(bot, "в 16:30", { reply_to_message: { message_id: reminder.botMessageId, from: me, chat, date: 1, text: "x" } });
    const updated = (await getReminder(handle.db, reminder.id))!;
    const local = DateTime.fromJSDate(updated.dueAt).setZone("Asia/Tashkent");
    expect(local.toFormat("HH:mm")).toBe("16:30");
    expect(local.toISODate()).toBe(tomorrow9.toISODate());
    const edited = calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(edited.payload.text).toContain("16:30");
    expect(edited.payload.text).not.toContain("по умолчанию");
    expect(reactions().at(-1)).toContain("👌");
  });

  it("keeps the default-time hint when a reminder is moved to another date without a time", async () => {
    const base = DateTime.now().setZone("Asia/Tashkent").set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    mockExtraction([item({ kind: "reminder", note: "сдать анализы", dueAt: base.plus({ days: 1 }).toJSDate(), timeSpecified: false })]);
    await sendText(bot, "напомни завтра сдать анализы");
    const reminder = (await listOpenReminders(handle.db, 1)).find((r) => r.title === "сдать анализы")!;
    mockExtraction([item({ kind: "correction", dueAt: base.plus({ days: 2 }).toJSDate(), timeSpecified: false })]);
    await sendText(bot, "перенеси на послезавтра", { reply_to_message: { message_id: reminder.botMessageId, from: me, chat, date: 1, text: "x" } });
    const updated = (await getReminder(handle.db, reminder.id))!;
    expect(DateTime.fromJSDate(updated.dueAt).setZone("Asia/Tashkent").toISODate()).toBe(base.plus({ days: 2 }).toISODate());
    const edited = calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(edited.payload.text).toContain("по умолчанию");
    expect(JSON.stringify(edited.payload.reply_markup)).toContain("Изменить время");
  });

  it("keeps an explicit time when a reminder is only moved to another date", async () => {
    const day = DateTime.now().setZone("Asia/Tashkent").plus({ days: 3 }).set({ hour: 15, minute: 30, second: 0, millisecond: 0 });
    mockExtraction([item({ kind: "reminder", note: "врач", dueAt: day.toJSDate(), timeSpecified: true })]);
    await sendText(bot, "напомни через 3 дня в 15:30 врач");
    const reminder = (await listOpenReminders(handle.db, 1)).find((r) => r.title === "врач")!;
    expect(reminder.defaultTime).toBe(false);
    mockExtraction([item({ kind: "correction", dueAt: day.plus({ days: 1 }).set({ hour: 9, minute: 0 }).toJSDate(), timeSpecified: false })]);
    await sendText(bot, "перенеси на день позже", { reply_to_message: { message_id: reminder.botMessageId, from: me, chat, date: 1, text: "x" } });
    const moved = DateTime.fromJSDate((await getReminder(handle.db, reminder.id))!.dueAt).setZone("Asia/Tashkent");
    expect(moved.toISODate()).toBe(day.plus({ days: 1 }).toISODate());
    expect(moved.toFormat("HH:mm")).toBe("15:30");
    expect(calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.text).not.toContain("по умолчанию");
  });

  it("rejects malformed hours and rolls a past hour over to the next day", async () => {
    const now = DateTime.now().setZone("Asia/Tashkent");
    mockExtraction([item({ kind: "reminder", note: "полить цветы", dueAt: now.plus({ minutes: 1 }).toJSDate(), timeSpecified: false })]);
    await sendText(bot, "напомни сегодня полить цветы");
    const reminder = (await listOpenReminders(handle.db, 1)).find((r) => r.title === "полить цветы")!;
    for (const bad of ["99", "", "-5", "abc"]) {
      await press(bot, `rem:time:${reminder.id}:${bad}`, reminder.botMessageId!, "x");
      expect((await getReminder(handle.db, reminder.id))!.dueAt).toEqual(reminder.dueAt);
    }
    await press(bot, `rem:time:${reminder.id}:0`, reminder.botMessageId!, "x");
    const rolled = DateTime.fromJSDate((await getReminder(handle.db, reminder.id))!.dueAt).setZone("Asia/Tashkent");
    expect(rolled.toFormat("HH:mm")).toBe("00:00");
    expect(rolled > now).toBe(true);
    expect(rolled.toISODate()).toBe(now.plus({ days: 1 }).toISODate());
  });

  it("does not resurrect a finished reminder through the time picker", async () => {
    const reminder = (await listOpenReminders(handle.db, 1)).find((r) => r.title === "забрать посылку")!;
    await markReminderDone(handle.db, reminder.id);
    await press(bot, `rem:time:${reminder.id}:12`, reminder.botMessageId!, "x");
    expect((await getReminder(handle.db, reminder.id))?.status).toBe("done");
    expect(calls.filter((c) => c.method === "editMessageText")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "answerCallbackQuery").at(-1)?.payload.text).toContain("уже нет");
  });

  it("changes the default reminder hour from settings and moves scheduled payment reminders", async () => {
    mockExtraction([item({ kind: "recurring_payment", note: "интернет", amount: 200000, dayOfMonth: 28, category: "utilities" })]);
    await sendText(bot, "+ интернет 200к каждое 28 число");
    const before = (await listOpenReminders(handle.db, 1, 100)).filter((r) => r.kind !== "reminder" && r.status === "scheduled");
    expect(before.length).toBeGreaterThan(0);
    await press(bot, "set:hour", 556, "settings");
    expect(JSON.stringify(calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.reply_markup)).toContain("set:hour:10");
    await press(bot, "set:hour:10", 556, "settings");
    expect((await getHouseholdByChatId(handle.db, chat.id))?.reminderHour).toBe(10);
    expect(calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.text).toContain("10:00");
    for (const r of before) {
      const moved = (await getReminder(handle.db, r.id))!;
      expect(DateTime.fromJSDate(moved.dueAt).setZone("Asia/Tashkent").hour).toBe(10);
      expect(DateTime.fromJSDate(moved.dueAt).setZone("Asia/Tashkent").toISODate()).toBe(DateTime.fromJSDate(r.dueAt).setZone("Asia/Tashkent").toISODate());
    }
  });

  it("replies with a summary on /summary and on a summary request", async () => {
    await sendText(bot, "/summary", { entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    expect(lastSent().payload.text).toContain("📊");
    expect(lastSent().payload.text).toContain("Кредиты");
    mockExtraction([item({ kind: "summary_request" })]);
    await sendText(bot, "@MadatTestBot сводка");
    expect(sent().some((c) => String(c.payload.text).includes("📊"))).toBe(true);
  });

  it("tells the user when nothing was found in an explicit request", async () => {
    mockExtraction([]);
    await sendText(bot, "@MadatTestBot как дела?");
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

  it("plans a month-only expense, then pins the date with a reply", async () => {
    const tz = "Asia/Tashkent";
    const nextMonthEnd = DateTime.now().setZone(tz).plus({ months: 1 }).endOf("month").toISODate()!;
    mockExtraction([item({ kind: "planned_expense", amount: 3000000, category: "gifts", note: "подарок на свадьбу", date: nextMonthEnd, hasDate: true, dateApproximate: true, timeSpecified: false })]);
    await sendText(bot, "+ в следующем месяце подарок на свадьбу 3 млн");
    const confirmation = lastSent();
    expect(confirmation.payload.text).toContain("🗓");
    expect(confirmation.payload.text).toContain("без точной даты");
    expect(confirmation.payload.text).toContain("Всего на");
    expect(JSON.stringify(confirmation.payload.reply_markup)).toContain("plan:del:");
    const plan = (await listOpenPlans(handle.db, 1)).find((p) => p.title === "подарок на свадьбу")!;
    expect(plan).toMatchObject({ plannedOn: nextMonthEnd, dateApproximate: true, amount: 3000000 });
    expect((await getPlanReminder(handle.db, plan.id))?.status).toBe("scheduled");

    const exact = `${nextMonthEnd.slice(0, 7)}-15`;
    mockExtraction([item({ kind: "correction", date: exact, hasDate: true, changed: { date: exact, dateApproximate: false } })]);
    await sendText(bot, "15 числа", { reply_to_message: { message_id: plan.botMessageId, from: me, chat, date: 1, text: "x" } });
    const moved = (await getPlan(handle.db, plan.id))!;
    expect(moved).toMatchObject({ plannedOn: exact, dateApproximate: false });
    const reminder = (await getPlanReminder(handle.db, plan.id))!;
    expect(DateTime.fromJSDate(reminder.dueAt).setZone(tz).toISODate()).toBe(exact);
    const edited = calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(edited.payload.text).not.toContain("без точной даты");
    expect(reactions().at(-1)).toContain("👌");
  });

  it("marks a plan paid from a message and shows plan vs fact", async () => {
    mockExtraction([item({ kind: "payment_done", target: "подарок на свадьбу", note: "купили подарок", amount: 2800000 })]);
    await sendText(bot, "+ купили подарок на свадьбу за 2.8 млн");
    expect(lastSent().payload.text).toContain("Оплачено по плану");
    expect(lastSent().payload.text).toContain("план");
    expect((await listOpenPlans(handle.db, 1)).some((p) => p.title === "подарок на свадьбу")).toBe(false);
    const [tx] = await listRecentTransactions(handle.db, 1, 1);
    expect(tx).toMatchObject({ amount: 2800000, category: "gifts", note: "подарок на свадьбу" });
    expect(tx?.planId).toBeTypeOf("number");
  });

  it("sends the planned-day alert and records the payment from its button", async () => {
    const day = DateTime.now().setZone("Asia/Tashkent").plus({ days: 2 }).toISODate()!;
    mockExtraction([item({ kind: "planned_expense", amount: 2000000, category: "kids", note: "коляска", date: day, hasDate: true })]);
    await sendText(bot, "+ послезавтра купить коляску 2 млн");
    expect(lastSent().payload.text).toMatch(/свободно|не хватает|Всего на/i);
    const plan = (await listOpenPlans(handle.db, 1)).find((p) => p.title === "коляска")!;
    const reminder = (await getPlanReminder(handle.db, plan.id))!;
    await updateReminder(handle.db, reminder.id, { dueAt: new Date(Date.now() - 1000) });

    const before = sent().length;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    try {
      await createScheduler(bot.api, { db: handle.db }).tick();
    } finally {
      vi.unstubAllGlobals();
    }
    const alert = sent().slice(before).find((c) => String(c.payload.text).includes("коляска"))!;
    expect(alert.payload.text).toContain("по плану");
    expect(JSON.stringify(alert.payload.reply_markup)).toContain(`plan:paid:${plan.id}`);

    await press(bot, `plan:paid:${plan.id}`, 777, "alert");
    expect(calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.text).toContain("Оплачено по плану");
    expect((await getPlan(handle.db, plan.id))?.status).toBe("done");
    expect((await listRecentTransactions(handle.db, 1, 1))[0]).toMatchObject({ amount: 2000000, planId: plan.id, botMessageId: 777 });
    // A second press on the same alert does nothing.
    await press(bot, `plan:paid:${plan.id}`, 777, "alert");
    expect((await listRecentTransactions(handle.db, 1, 5)).filter((t) => t.planId === plan.id)).toHaveLength(1);
  });

  it("sets a category limit and warns on the expense that crosses it", async () => {
    mockExtraction([item({ kind: "budget_limit", category: "groceries", amount: 200000 })]);
    await sendText(bot, "+ лимит на продукты 200к");
    expect(lastSent().payload.text).toContain("Лимит на");
    expect((await listBudgets(handle.db, 1)).map((b) => [b.category, b.amount])).toEqual([["groceries", 200000]]);

    mockExtraction([item({ amount: 180000, category: "groceries", note: "рынок" })]);
    await sendText(bot, "+ рынок 180к");
    expect(lastSent().payload.text).toContain("🚨");
    expect(lastSent().payload.text).toContain("превышен");

    await sendText(bot, "/budgets", { entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    expect(lastSent().payload.text).toContain("Лимиты на месяц");
    expect(JSON.stringify(lastSent().payload.reply_markup)).toContain("bud:rm:groceries");
  });

  it("creates a savings goal and records a contribution", async () => {
    const tz = "Asia/Tashkent";
    const deadline = DateTime.now().setZone(tz).plus({ months: 3 }).endOf("month").toISODate()!;
    mockExtraction([item({ kind: "goal", amount: 10000000, note: "отпуск", date: deadline, hasDate: true, dateApproximate: true })]);
    await sendText(bot, "+ копим на отпуск 10 млн");
    expect(lastSent().payload.text).toContain("Копилка");
    expect(lastSent().payload.text).toContain("в месяц");
    const [goal] = await listActiveGoals(handle.db, 1);
    expect(goal).toMatchObject({ title: "отпуск", targetAmount: 10000000, deadline });

    const today = DateTime.now().setZone(tz).toISODate()!;
    mockExtraction([item({ kind: "goal_contribution", target: "отпуск", amount: 1000000, date: today })]);
    await sendText(bot, "+ отложили на отпуск 1 млн");
    expect(lastSent().payload.text).toContain("Накоплено");
    expect(lastSent().payload.text).toContain("10%");
    expect((await listRecentTransactions(handle.db, 1, 1))[0]).toMatchObject({ category: "savings", goalId: goal!.id });

    await sendText(bot, "/goals", { entities: [{ type: "bot_command", offset: 0, length: 6 }] });
    expect(lastSent().payload.text).toContain("отпуск");
    await sendText(bot, "/summary", { entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    expect(lastSent().payload.text).toContain("Копилки");
    expect(lastSent().payload.text).toContain("Лимиты");
  });

  it("lists and cancels plans", async () => {
    const later = DateTime.now().setZone("Asia/Tashkent").plus({ months: 2 }).toISODate()!;
    mockExtraction([item({ kind: "planned_expense", amount: 5000000, category: "transport", note: "ремонт машины", date: later, hasDate: true })]);
    await sendText(bot, "+ ремонт машины 5 млн");
    const plan = (await listOpenPlans(handle.db, 1)).find((p) => p.title === "ремонт машины")!;
    await sendText(bot, "/plans", { entities: [{ type: "bot_command", offset: 0, length: 6 }] });
    expect(lastSent().payload.text).toContain("ремонт машины");
    await press(bot, `plan:del:${plan.id}`, plan.botMessageId!, "plan");
    expect((await getPlan(handle.db, plan.id))?.status).toBe("cancelled");
    expect((await getPlanReminder(handle.db, plan.id))?.status).toBe("cancelled");
  });

  it("asks for a date when a plan has none", async () => {
    mockExtraction([item({ kind: "planned_expense", amount: 900000, category: "household", note: "пылесос" })]);
    await sendText(bot, "+ хотим купить пылесос 900к");
    expect(lastSent().payload.text).toContain("Когда планируете");
    expect((await listOpenPlans(handle.db, 1)).some((p) => p.title === "пылесос")).toBe(false);
  });

  it("holds back an implausible amount, keeps history and answers honestly", async () => {
    const tz = "Asia/Tashkent";
    const monthEnd = DateTime.now().setZone(tz).endOf("month").toISODate()!;
    mockExtraction([item({ kind: "planned_expense", amount: 3000000, category: "other", note: "расходы в этом месяце", date: monthEnd, hasDate: true, dateApproximate: true })]);
    await sendText(bot, "Мадат у меня в этом месяце ещё будут 3 миллиона расходов");
    const plan = (await listOpenPlans(handle.db, 1)).find((p) => p.title === "расходы в этом месяце")!;
    const reply = { reply_to_message: { message_id: plan.botMessageId, from: me, chat, date: 1, text: "x" } };

    // "11" read as an amount: not applied, asked with Yes/No instead.
    mockExtraction([item({ kind: "correction", amount: 11, changed: { amount: 11 } })]);
    await sendText(bot, "11", reply);
    expect((await getPlan(handle.db, plan.id))?.amount).toBe(3000000);
    expect(lastSent().payload.text).toContain("Поменять сумму");
    expect(JSON.stringify(lastSent().payload.reply_markup)).toContain(`fix:amt:plan:${plan.id}:11`);
    expect(reactions().at(-1)).toContain("🤔");
    await press(bot, `fix:keep:plan:${plan.id}`, 901, "q");
    expect(calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.text).toContain("Оставил");

    // A real change is applied and remembered.
    const day = `${monthEnd.slice(0, 7)}-28`;
    mockExtraction([item({ kind: "correction", changed: { date: day, dateApproximate: false } })]);
    await sendText(bot, "28 числа", reply);
    expect((await getPlan(handle.db, plan.id))?.plannedOn).toBe(day);
    mockExtraction([item({ kind: "correction", changed: {} })]);
    await sendText(bot, "сумму верни как было", reply);
    expect(extractItems).toHaveBeenLastCalledWith(expect.objectContaining({ replyTo: expect.stringContaining("Edit history") }));
    expect(String(vi.mocked(extractItems).mock.lastCall![0].replyTo)).toContain(`"${monthEnd}"`);
    // Nothing changed: no 👌, the bot says it did not understand.
    expect(lastSent().payload.text).toContain("Не понял");
    expect(reactions().at(-1)).toContain("🤔");

    // A question about the record is answered by the model's clarify text; the last record is in context.
    mockExtraction([item({ kind: "clarify", note: "Сумма плана сейчас 3 000 000 сум. Поменять?" })]);
    await sendText(bot, "Мадат почему сумму не изменил?");
    expect(extractItems).toHaveBeenLastCalledWith(expect.objectContaining({ lastRecord: expect.stringContaining("расходы в этом месяце") }));
    expect(lastSent().payload.text).toBe("Сумма плана сейчас 3 000 000 сум. Поменять?");
    expect(reactions().at(-1)).toContain("🤔");

    // "Yes" on a held amount applies it.
    mockExtraction([item({ kind: "correction", amount: 5000, changed: { amount: 5000 } })]);
    await sendText(bot, "5000", reply);
    await press(bot, `fix:amt:plan:${plan.id}:5000`, 902, "q");
    expect((await getPlan(handle.db, plan.id))?.amount).toBe(5000);
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
