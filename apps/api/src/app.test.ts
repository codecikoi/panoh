import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../packages/core/src/ai/insights.ts", () => ({ generateInsights: vi.fn().mockResolvedValue({ highlights: ["ok"], tips: [], mood: "neutral" }) }));
process.env.LOG_LEVEL = "warn";

import { createTestDb, createTransaction, ensureMember, getOrCreateHousehold, setBudget, signInitData, upsertUser, type DbHandle } from "@madat/core";
import { createApp } from "./app.js";

const token = "123:ABC";
let handle: DbHandle;
let app: ReturnType<typeof createApp>;
let householdId: number;

function tma(userId: number): string {
  return `tma ${signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: "Z" }) }, token)}`;
}

beforeAll(async () => {
  handle = await createTestDb();
  app = createApp({ db: handle.db, botToken: token });
  const { household } = await getOrCreateHousehold(handle.db, { chatId: -7, chatType: "supergroup", title: "Fam" }, { locale: "en", currency: "USD", timezone: "UTC" });
  householdId = household.id;
  const user = await upsertUser(handle.db, { id: 42, firstName: "Zoir" });
  await ensureMember(handle.db, householdId, user.id);
  const today = new Date().toISOString().slice(0, 10);
  await createTransaction(handle.db, { householdId, kind: "expense", amount: 45, currency: "USD", baseCurrency: "USD", category: "groceries", note: "milk", occurredOn: today });
});

afterAll(async () => {
  await handle.close();
});

describe("api", () => {
  it("serves health without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("rejects missing or invalid init data", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
    expect((await app.request("/api/me", { headers: { authorization: "tma nope" } })).status).toBe(401);
  });

  it("returns the user's households and summary", async () => {
    const me = await app.request("/api/me", { headers: { authorization: tma(42) } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { households: { id: number }[] };
    expect(body.households.map((h) => h.id)).toEqual([householdId]);

    const summary = await app.request(`/api/households/${householdId}/summary`, { headers: { authorization: tma(42) } });
    expect(summary.status).toBe(200);
    const data = (await summary.json()) as { summary: { expense: number }; insights: { highlights: string[] } | null };
    expect(data.summary.expense).toBe(45);
    expect(data.insights?.highlights).toEqual(["ok"]);
  });

  it("returns limits usage and planning data", async () => {
    await setBudget(handle.db, householdId, "groceries", 100, "USD");
    const res = await app.request(`/api/households/${householdId}/planning`, { headers: { authorization: tma(42) } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { budgets: { category: string; spent: number; pct: number }[]; forecast: unknown };
    expect(data.budgets).toEqual([expect.objectContaining({ category: "groceries", spent: 45, pct: 45 })]);
    expect(data.forecast).toBeTruthy();
    expect((await app.request(`/api/households/${householdId}/planning`, { headers: { authorization: tma(43) } })).status).toBe(404);
    const plans = await app.request(`/api/households/${householdId}/plans`, { headers: { authorization: tma(42) } });
    expect(((await plans.json()) as { plans: unknown[] }).plans).toEqual([]);
  });

  it("hides households the user is not a member of", async () => {
    const res = await app.request(`/api/households/${householdId}/summary`, { headers: { authorization: tma(43) } });
    expect(res.status).toBe(404);
    const tx = await app.request(`/api/households/${householdId}/transactions?month=2026-13`, { headers: { authorization: tma(42) } });
    expect(tx.status).toBe(400);
  });
});
