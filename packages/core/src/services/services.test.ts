import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { createTestDb, type DbHandle } from "../db/client.js";
import { getOrCreateHousehold, upsertUser, ensureMember, isMember, listHouseholdsForTelegramUser, updateHousehold } from "./households.js";
import { createTransaction, listTransactionsForMonth, softDeleteTransaction, listRecentTransactions } from "./transactions.js";
import { createRecurring, ensureRemindersFor, markPaid, matchRecurringByName, nextDue, upcomingPayments } from "./recurring.js";
import { createReminder, dueReminders, listOpenReminders, markReminderSent, snoozeReminder } from "./reminders.js";
import { loadMonthlySummary } from "./summary.js";
import { markProcessed } from "./processed.js";
import { findLastRecord } from "./records.js";

let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe("services (pglite)", () => {
  it("creates households, users and memberships", async () => {
    const { household, created } = await getOrCreateHousehold(handle.db, { chatId: -1001, chatType: "supergroup", title: "Семья" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    expect(created).toBe(true);
    expect(household.baseCurrency).toBe("UZS");
    const again = await getOrCreateHousehold(handle.db, { chatId: -1001, chatType: "supergroup" }, { locale: "en", currency: "USD", timezone: "UTC" });
    expect(again.created).toBe(false);
    expect(again.household.id).toBe(household.id);

    const user = await upsertUser(handle.db, { id: 42, firstName: "Zoir", languageCode: "ru" });
    await ensureMember(handle.db, household.id, user.id);
    await ensureMember(handle.db, household.id, user.id);
    expect(await isMember(handle.db, household.id, 42)).toBe(true);
    expect(await isMember(handle.db, household.id, 43)).toBe(false);
    expect((await listHouseholdsForTelegramUser(handle.db, 42)).map((h) => h.id)).toEqual([household.id]);
  });

  it("records transactions and summarises the month", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -1001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const month = DateTime.now().setZone("Asia/Tashkent").toFormat("yyyy-LL");
    const today = DateTime.now().setZone("Asia/Tashkent").toISODate()!;
    const a = await createTransaction(handle.db, { householdId: household.id, kind: "expense", amount: 150000, currency: "UZS", baseCurrency: "UZS", category: "groceries", note: "продукты", occurredOn: today });
    await createTransaction(handle.db, { householdId: household.id, kind: "expense", amount: 20000, currency: "UZS", baseCurrency: "UZS", category: "transport", occurredOn: today, status: "pending" });
    await createTransaction(handle.db, { householdId: household.id, kind: "income", amount: 9000000, currency: "UZS", baseCurrency: "UZS", category: "salary", occurredOn: today });
    expect(a.amount).toBe(150000);

    const confirmed = await listTransactionsForMonth(handle.db, household.id, month);
    expect(confirmed).toHaveLength(2);
    const summary = await loadMonthlySummary(handle.db, household, month);
    expect(summary.expense).toBe(150000);
    expect(summary.income).toBe(9000000);
    expect(summary.pendingCount).toBe(1);

    await softDeleteTransaction(handle.db, a.id);
    expect((await listRecentTransactions(handle.db, household.id)).some((t) => t.id === a.id)).toBe(false);
  });

  it("schedules recurring payment reminders idempotently and marks them paid", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -1001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const rp = await createRecurring(handle.db, { householdId: household.id, name: "кредит", amount: 2000000, currency: "UZS", dayOfMonth: 15 });
    await ensureRemindersFor(handle.db, rp, household);
    await ensureRemindersFor(handle.db, rp, household);
    const open = await listOpenReminders(handle.db, household.id, 50);
    const forPayment = open.filter((r) => r.recurringPaymentId === rp.id);
    expect(forPayment.length).toBeGreaterThanOrEqual(1);
    expect(forPayment.length).toBeLessThanOrEqual(2);
    expect(new Set(forPayment.map((r) => r.kind)).size).toBe(forPayment.length);

    const due = nextDue(rp, household.timezone);
    expect(due.date.endsWith("-15")).toBe(true);
    const list = [rp];
    expect(matchRecurringByName(list, "оплатили кредит")?.id).toBe(rp.id);
    expect(matchRecurringByName(list, "Кредит")?.id).toBe(rp.id);
    expect(matchRecurringByName(list, "квартира")).toBeUndefined();

    const paid = await markPaid(handle.db, rp, due.period);
    expect(paid?.lastPaidPeriod).toBe(due.period);
    const after = (await listOpenReminders(handle.db, household.id, 50)).filter((r) => r.recurringPaymentId === rp.id);
    expect(after).toHaveLength(0);
    const next = nextDue(paid!, household.timezone);
    expect(next.period > due.period).toBe(true);
    expect(upcomingPayments([paid!], household.timezone, 60).length).toBeLessThanOrEqual(1);
  });

  it("delivers and snoozes reminders", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -1001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const past = new Date(Date.now() - 60_000);
    const r = await createReminder(handle.db, { householdId: household.id, title: "позвонить маме", dueAt: past });
    const due = await dueReminders(handle.db, new Date());
    expect(due.map((x) => x.id)).toContain(r.id);
    await markReminderSent(handle.db, r.id, 777);
    expect((await dueReminders(handle.db, new Date())).map((x) => x.id)).not.toContain(r.id);
    const snoozed = await snoozeReminder(handle.db, r.id, new Date(Date.now() + 3600_000));
    expect(snoozed?.status).toBe("scheduled");
    expect(snoozed?.snoozeCount).toBe(1);
    const last = await findLastRecord(handle.db, household.id);
    expect(last?.type).toBe("reminder");
  });

  it("deduplicates processed messages and updates settings", async () => {
    expect(await markProcessed(handle.db, -1001, 10)).toBe(true);
    expect(await markProcessed(handle.db, -1001, 10)).toBe(false);
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -1001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const updated = await updateHousehold(handle.db, household.id, { triggers: { prefix: "#", keywords: ["кофе"] } });
    expect(updated.triggers).toEqual({ prefix: "#", keywords: ["кофе"] });
  });
});
