import { and, count, countDistinct, eq, gte, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { households, transactions, users } from "../db/schema.js";

export interface PlatformStats {
  users: number;
  newUsers: number;
  chats: number;
  newChats: number;
  groups: number;
  privateChats: number;
  active7d: number;
  active30d: number;
  records: number;
  newRecords: number;
}

const DAY_MS = 86_400_000;

/** Bot-wide counts for the owner. "New" means the last 7 days; a chat is active when it has a confirmed record in the period. */
export async function loadPlatformStats(db: Db, now = new Date()): Promise<PlatformStats> {
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const month = new Date(now.getTime() - 30 * DAY_MS);
  const confirmed = eq(transactions.status, "confirmed");

  const [[allUsers], [freshUsers], [chats], [freshChats], [groups], [records], [freshRecords], [active7d], [active30d]] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(gte(users.createdAt, week)),
    db.select({ n: count() }).from(households),
    db.select({ n: count() }).from(households).where(gte(households.createdAt, week)),
    db.select({ n: count() }).from(households).where(ne(households.chatType, "private")),
    db.select({ n: count() }).from(transactions).where(confirmed),
    db.select({ n: count() }).from(transactions).where(and(confirmed, gte(transactions.createdAt, week))),
    db.select({ n: countDistinct(transactions.householdId) }).from(transactions).where(and(confirmed, gte(transactions.createdAt, week))),
    db.select({ n: countDistinct(transactions.householdId) }).from(transactions).where(and(confirmed, gte(transactions.createdAt, month))),
  ]);

  return {
    users: allUsers!.n,
    newUsers: freshUsers!.n,
    chats: chats!.n,
    newChats: freshChats!.n,
    groups: groups!.n,
    privateChats: chats!.n - groups!.n,
    active7d: active7d!.n,
    active30d: active30d!.n,
    records: records!.n,
    newRecords: freshRecords!.n,
  };
}
