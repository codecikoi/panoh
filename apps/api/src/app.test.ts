import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../packages/core/src/ai/insights.ts", () => ({ generateInsights: vi.fn().mockResolvedValue({ highlights: ["ok"], tips: [], mood: "neutral" }) }));
process.env.LOG_LEVEL = "warn";

import { createCustomCategory, createTestDb, createTransaction, ensureMember, getOrCreateHousehold, setBudget, signInitData, upsertUser, type DbHandle } from "@madat/core";
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
    await createCustomCategory(handle.db, { householdId, kind: "expense", name: "Car", emoji: "🚗" });
    const me = await app.request("/api/me", { headers: { authorization: tma(42) } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { households: { id: number; categories: { key: string; name: string }[]; members: { id: number; name: string }[] }[] };
    expect(body.households.map((h) => h.id)).toEqual([householdId]);
    expect(body.households[0]?.categories).toEqual([expect.objectContaining({ key: "custom_1", name: "Car", emoji: "🚗", kind: "expense", archived: false })]);
    expect(body.households[0]?.members).toEqual([{ id: expect.any(Number), name: "Zoir" }]);

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

  it("serves dashboard strings without auth and falls back to English", async () => {
    const ru = (await (await app.request("/api/i18n/ru")).json()) as { locale: string; strings: Record<string, string> };
    expect(ru.locale).toBe("ru");
    expect(ru.strings["dash.tab_month"]).toBe("Месяц");
    expect(ru.strings["cat.groceries"]).toBe("Продукты");
    expect(Object.keys(ru.strings).some((k) => k.startsWith("welcome."))).toBe(false);
    const xx = (await (await app.request("/api/i18n/xx")).json()) as { locale: string };
    expect(xx.locale).toBe("en");
  });

  it("forwards a PDF request to the bot", async () => {
    const auth = { authorization: tma(42), "content-type": "application/json" };
    const body = JSON.stringify({ from: "2026-10-01", to: "2026-10-31" });
    expect((await app.request(`/api/households/${householdId}/report`, { method: "POST", headers: auth, body })).status).toBe(503);

    const bot = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", bot);
    try {
      const withBot = createApp({ db: handle.db, botToken: token, botUrl: "http://bot:8080", internalToken: "secret" });
      const res = await withBot.request(`/api/households/${householdId}/report`, { method: "POST", headers: auth, body });
      expect(res.status).toBe(200);
      expect(bot).toHaveBeenCalledWith("http://bot:8080/internal/report", expect.objectContaining({ method: "POST" }));
      const [, init] = bot.mock.calls[0]!;
      expect(JSON.parse(init.body)).toEqual({ householdId, from: "2026-10-01", to: "2026-10-31" });
      expect(init.headers.authorization).toBe("Bearer secret");
      const bad = await withBot.request(`/api/households/${householdId}/report`, { method: "POST", headers: auth, body: JSON.stringify({ from: "x", to: "y" }) });
      expect(bad.status).toBe(400);
      const stranger = await withBot.request(`/api/households/${householdId}/report`, { method: "POST", headers: { ...auth, authorization: tma(43) }, body });
      expect(stranger.status).toBe(404);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides households the user is not a member of", async () => {
    const res = await app.request(`/api/households/${householdId}/summary`, { headers: { authorization: tma(43) } });
    expect(res.status).toBe(404);
    const tx = await app.request(`/api/households/${householdId}/transactions?month=2026-13`, { headers: { authorization: tma(42) } });
    expect(tx.status).toBe(400);
  });
});
