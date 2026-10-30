import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { createTestDb, type DbHandle } from "../db/client.js";
import { getOrCreateHousehold } from "./households.js";
import { createTransaction, softDeleteTransaction, updateTransaction } from "./transactions.js";
import { setBudget } from "./planning.js";
import { BALANCE_SCOPE, deleteBalance, evaluateAlerts, explainBalance, listAlerts, loadBalance, previousBalance, removeAlert, setAlert, setBalance } from "./balance.js";
import { archiveCustomCategory, createCustomCategory, loadCategoryLookup, normalizeCategoryName, normalizeEmoji } from "./categories.js";
import { customCategoryKey, normalizeCategory } from "../categories.js";
import { loadMonthlySummary } from "./summary.js";

let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe("balance checkpoints", () => {
  it("counts records after the checkpoint, shows the discrepancy and falls back when a checkpoint is deleted", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -4001, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const today = DateTime.now().setZone(household.timezone).toISODate()!;
    const yesterday = DateTime.now().setZone(household.timezone).minus({ days: 1 }).toISODate()!;
    const add = (kind: "expense" | "income", amount: number, occurredOn = today, extra = {}) =>
      createTransaction(handle.db, { householdId: household.id, kind, amount, currency: "UZS", amountBase: amount, baseCurrency: "UZS", category: kind === "expense" ? "groceries" : "salary", occurredOn, ...extra });

    expect(await loadBalance(handle.db, household)).toBeNull();
    await add("expense", 999999); // before the checkpoint: already part of the stated money
    const first = await setBalance(handle.db, household, { amount: 800000, currency: "UZS" });
    expect(first.previous).toBeNull();
    expect(first.balance.expected).toBeNull();

    await add("expense", 150000);
    await add("income", 50000);
    await add("expense", 70000, yesterday); // backfilled past day: not counted
    const pending = await add("expense", 30000, today, { status: "pending" });
    const info = (await loadBalance(handle.db, household))!;
    expect(info).toMatchObject({ start: 800000, income: 50000, expense: 150000, current: 700000 });

    await updateTransaction(handle.db, pending.id, { status: "confirmed" });
    expect((await loadBalance(handle.db, household))?.current).toBe(670000);
    await softDeleteTransaction(handle.db, pending.id);
    expect((await loadBalance(handle.db, household))?.current).toBe(700000);

    const second = await setBalance(handle.db, household, { amount: 500000, currency: "UZS" });
    expect(second.previous?.current).toBe(700000);
    expect(second.balance.expected).toBe(700000);
    expect((await loadBalance(handle.db, household))?.current).toBe(500000);

    const month = DateTime.now().setZone(household.timezone).toFormat("yyyy-LL");
    expect((await loadMonthlySummary(handle.db, household, month)).balance).toMatchObject({ current: 500000, amount: 500000, asOf: today });

    // How the records got to 700 000: the first checkpoint plus what was recorded between the two (later records do not count).
    await add("expense", 100000);
    expect((await previousBalance(handle.db, household.id, second.balance))?.id).toBe(first.balance.id);
    expect(await explainBalance(handle.db, household, second.balance)).toMatchObject({ start: 800000, income: 50000, expense: 150000, expected: 700000 });
    expect(await explainBalance(handle.db, household, first.balance)).toBeNull();

    expect(await deleteBalance(handle.db, second.balance.id)).toBe(true);
    expect((await loadBalance(handle.db, household))?.current).toBe(600000);
  });

  it("fires an alert once when the balance drops below the threshold and re-arms above it", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -4002, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const today = DateTime.now().setZone(household.timezone).toISODate()!;
    const add = (kind: "expense" | "income", amount: number, category = "groceries") =>
      createTransaction(handle.db, { householdId: household.id, kind, amount, currency: "UZS", amountBase: amount, baseCurrency: "UZS", category, occurredOn: today });

    await setAlert(handle.db, household.id, BALANCE_SCOPE, 100000, "UZS");
    // No balance known yet: nothing to compare with.
    expect(await evaluateAlerts(handle.db, household)).toEqual([]);
    await setBalance(handle.db, household, { amount: 300000, currency: "UZS" });
    expect(await evaluateAlerts(handle.db, household)).toEqual([]);
    await add("expense", 250000);
    const fired = await evaluateAlerts(handle.db, household);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ threshold: 100000, value: 50000 });
    expect(fired[0]?.alert.scope).toBe(BALANCE_SCOPE);
    // Still below: silent. Back above: re-armed silently, then fires again on the next drop.
    expect(await evaluateAlerts(handle.db, household)).toEqual([]);
    expect((await listAlerts(handle.db, household.id))[0]?.armed).toBe(false);
    await add("income", 200000);
    expect(await evaluateAlerts(handle.db, household)).toEqual([]);
    expect((await listAlerts(handle.db, household.id))[0]?.armed).toBe(true);
    await add("expense", 200000);
    expect(await evaluateAlerts(handle.db, household)).toHaveLength(1);

    // A category alert watches what is left of the limit; the month total too.
    await setBudget(handle.db, household.id, "dining", 300000, "UZS");
    await setBudget(handle.db, household.id, "total", 1000000, "UZS");
    await setAlert(handle.db, household.id, "dining", 100000, "UZS");
    await setAlert(handle.db, household.id, "total", 400000, "UZS");
    expect(await evaluateAlerts(handle.db, household)).toEqual([]);
    await add("expense", 250000, "dining");
    const events = await evaluateAlerts(handle.db, household);
    // dining: 50k left of 300k (fires); total: 1M − 700k = 300k left < 400k (fires).
    expect(events.map((e) => [e.alert.scope, e.value, e.limit])).toEqual([["dining", 50000, 300000], ["total", 300000, 1000000]]);
    expect(await removeAlert(handle.db, household.id, "dining")).toBe(true);
    expect(await removeAlert(handle.db, household.id, "dining")).toBe(false);
    expect((await listAlerts(handle.db, household.id)).map((a) => a.scope)).toEqual(["balance", "total"]);
  });
});

describe("custom categories", () => {
  it("validates names and emoji", () => {
    expect(normalizeCategoryName("  машина ")).toBe("Машина");
    expect(normalizeCategoryName('"Car wash"')).toBe("Car wash");
    expect(normalizeCategoryName("123")).toBeNull();
    expect(normalizeCategoryName("x".repeat(40))).toBeNull();
    expect(normalizeEmoji("🚗")).toBe("🚗");
    expect(normalizeEmoji("👨‍👩‍👧")).toBe("👨‍👩‍👧");
    expect(normalizeEmoji("ab")).toBeNull();
    expect(normalizeEmoji("🚗🚕")).toBeNull();
    expect(normalizeEmoji(null)).toBeNull();
  });

  it("stores, resolves and archives a household's categories", async () => {
    const { household } = await getOrCreateHousehold(handle.db, { chatId: -4003, chatType: "supergroup" }, { locale: "ru", currency: "UZS", timezone: "Asia/Tashkent" });
    const car = await createCustomCategory(handle.db, { householdId: household.id, kind: "expense", name: "Машина", emoji: "🚗" });
    const rent = await createCustomCategory(handle.db, { householdId: household.id, kind: "income", name: "Аренда", emoji: "🏡" });
    const lookup = await loadCategoryLookup(handle.db, household.id);
    expect(lookup.get(customCategoryKey(car.id))).toMatchObject({ kind: "expense", name: "Машина", emoji: "🚗", archived: false });
    expect(normalizeCategory("expense", "машина", lookup)).toBe(customCategoryKey(car.id));
    expect(normalizeCategory("income", "аренда", lookup)).toBe(customCategoryKey(rent.id));
    expect(normalizeCategory("expense", "аренда", lookup)).toBe("other");
    expect(normalizeCategory("expense", customCategoryKey(car.id), lookup)).toBe(customCategoryKey(car.id));

    await setBudget(handle.db, household.id, customCategoryKey(car.id), 1000000, "UZS");
    await archiveCustomCategory(handle.db, car.id);
    const after = await loadCategoryLookup(handle.db, household.id);
    expect(after.get(customCategoryKey(car.id))?.archived).toBe(true);
    expect(normalizeCategory("expense", "машина", after)).toBe("other");
    const month = DateTime.now().setZone(household.timezone).toFormat("yyyy-LL");
    const summary = await loadMonthlySummary(handle.db, household, month);
    expect(summary.outlook.budgets).toEqual([]);
    expect(summary.customCategories[customCategoryKey(car.id)]?.name).toBe("Машина");
  });
});
