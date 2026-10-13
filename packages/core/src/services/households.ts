import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { householdMembers, households, users, type Household, type User } from "../db/schema.js";
import { pickLocale } from "../i18n/index.js";

export interface ChatInfo {
  chatId: number;
  chatType: "private" | "group" | "supergroup" | "channel";
  title?: string | null;
}

export interface TgUserInfo {
  id: number;
  firstName?: string | null;
  username?: string | null;
  languageCode?: string | null;
}

export interface HouseholdDefaults {
  locale: string;
  currency: string;
  timezone: string;
}

const LOCALE_DEFAULTS: Record<string, { currency: string; timezone: string }> = {
  uz: { currency: "UZS", timezone: "Asia/Tashkent" },
  kk: { currency: "KZT", timezone: "Asia/Almaty" },
  ky: { currency: "KGS", timezone: "Asia/Bishkek" },
  tg: { currency: "TJS", timezone: "Asia/Dushanbe" },
  uk: { currency: "UAH", timezone: "Europe/Kyiv" },
  tr: { currency: "TRY", timezone: "Europe/Istanbul" },
  az: { currency: "AZN", timezone: "Asia/Baku" },
  de: { currency: "EUR", timezone: "Europe/Berlin" },
  it: { currency: "EUR", timezone: "Europe/Rome" },
  nl: { currency: "EUR", timezone: "Europe/Amsterdam" },
  pl: { currency: "PLN", timezone: "Europe/Warsaw" },
  ro: { currency: "RON", timezone: "Europe/Bucharest" },
  fa: { currency: "IRR", timezone: "Asia/Tehran" },
  he: { currency: "ILS", timezone: "Asia/Jerusalem" },
  hi: { currency: "INR", timezone: "Asia/Kolkata" },
  bn: { currency: "BDT", timezone: "Asia/Dhaka" },
  ur: { currency: "PKR", timezone: "Asia/Karachi" },
  id: { currency: "IDR", timezone: "Asia/Jakarta" },
  ms: { currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
  vi: { currency: "VND", timezone: "Asia/Ho_Chi_Minh" },
  th: { currency: "THB", timezone: "Asia/Bangkok" },
  ko: { currency: "KRW", timezone: "Asia/Seoul" },
  ja: { currency: "JPY", timezone: "Asia/Tokyo" },
  zh: { currency: "CNY", timezone: "Asia/Shanghai" },
};

/**
 * Best-effort defaults from a Telegram language code. Languages spoken in many countries (en, ru, es, fr, pt, ar)
 * keep the configured defaults; the household can change everything with /settings.
 */
export function guessDefaults(languageCode: string | null | undefined, fallback: HouseholdDefaults): HouseholdDefaults {
  const locale = pickLocale(languageCode, fallback.locale);
  const base = languageCode?.toLowerCase().split(/[-_]/)[0] ?? "";
  const known = LOCALE_DEFAULTS[base];
  if (!known) return { ...fallback, locale };
  return { locale, currency: known.currency, timezone: known.timezone };
}

export async function getHouseholdByChatId(db: Db, chatId: number): Promise<Household | undefined> {
  const rows = await db.select().from(households).where(eq(households.telegramChatId, chatId)).limit(1);
  return rows[0];
}

export async function getHouseholdById(db: Db, id: number): Promise<Household | undefined> {
  const rows = await db.select().from(households).where(eq(households.id, id)).limit(1);
  return rows[0];
}

export async function getOrCreateHousehold(
  db: Db,
  chat: ChatInfo,
  defaults: HouseholdDefaults,
): Promise<{ household: Household; created: boolean }> {
  const existing = await getHouseholdByChatId(db, chat.chatId);
  if (existing) return { household: existing, created: false };
  const inserted = await db
    .insert(households)
    .values({
      telegramChatId: chat.chatId,
      chatType: chat.chatType,
      title: chat.title ?? null,
      baseCurrency: defaults.currency,
      timezone: defaults.timezone,
      locale: defaults.locale,
    })
    .onConflictDoNothing()
    .returning();
  const household = inserted[0] ?? (await getHouseholdByChatId(db, chat.chatId));
  if (!household) throw new Error("Failed to create household");
  return { household, created: inserted.length > 0 };
}

export async function updateHousehold(db: Db, id: number, patch: Partial<Household>): Promise<Household> {
  const rows = await db
    .update(households)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(households.id, id))
    .returning();
  const row = rows[0];
  if (!row) throw new Error(`Household ${id} not found`);
  return row;
}

export async function upsertUser(db: Db, tg: TgUserInfo): Promise<User> {
  const values = {
    telegramUserId: tg.id,
    firstName: tg.firstName ?? null,
    username: tg.username ?? null,
    locale: tg.languageCode ?? null,
  };
  const rows = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: { firstName: values.firstName, username: values.username, locale: values.locale, updatedAt: new Date() },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to upsert user");
  return row;
}

export async function ensureMember(db: Db, householdId: number, userId: number, role = "member"): Promise<void> {
  await db.insert(householdMembers).values({ householdId, userId, role }).onConflictDoNothing();
}

export async function listHouseholdsForTelegramUser(db: Db, telegramUserId: number): Promise<Household[]> {
  const user = await db.select().from(users).where(eq(users.telegramUserId, telegramUserId)).limit(1);
  const u = user[0];
  if (!u) return [];
  const memberships = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, u.id));
  const ids = memberships.map((m) => m.householdId);
  if (!ids.length) return [];
  return db.select().from(households).where(inArray(households.id, ids)).orderBy(desc(households.updatedAt));
}

export async function isMember(db: Db, householdId: number, telegramUserId: number): Promise<boolean> {
  const rows = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), eq(users.telegramUserId, telegramUserId)))
    .limit(1);
  return rows.length > 0;
}

export async function listAllHouseholds(db: Db): Promise<Household[]> {
  return db.select().from(households);
}
