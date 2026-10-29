import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { budgets, customCategories, type CustomCategory, type NewCustomCategory } from "../db/schema.js";
import { customCategoryKey, type CategoryLookup, type CustomCategoryInfo } from "../categories.js";

export const CATEGORY_NAME_MAX = 32;

/** Trims and validates a category name; null when it is unusable. */
export function normalizeCategoryName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
  if (!name || name.length > CATEGORY_NAME_MAX || !/\p{L}/u.test(name)) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One emoji (a single grapheme that is pictographic), or null. */
export function normalizeEmoji(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((s) => s.segment);
  if (graphemes.length !== 1) return null;
  return /\p{Extended_Pictographic}/u.test(value) ? value : null;
}

export function toCategoryInfo(row: CustomCategory): CustomCategoryInfo {
  return { key: customCategoryKey(row.id), kind: row.kind, name: row.name, emoji: row.emoji, archived: row.status === "archived" };
}

export async function listCustomCategories(db: Db, householdId: number): Promise<CustomCategory[]> {
  return db.select().from(customCategories).where(eq(customCategories.householdId, householdId)).orderBy(asc(customCategories.id));
}

/** All custom categories of a household (archived ones included, so old records keep their names), keyed. */
export async function loadCategoryLookup(db: Db, householdId: number): Promise<CategoryLookup> {
  const rows = await listCustomCategories(db, householdId);
  return new Map(rows.map((r) => [customCategoryKey(r.id), toCategoryInfo(r)]));
}

export async function createCustomCategory(db: Db, input: NewCustomCategory): Promise<CustomCategory> {
  const rows = await db.insert(customCategories).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to insert category");
  return row;
}

export async function getCustomCategory(db: Db, id: number): Promise<CustomCategory | undefined> {
  const rows = await db.select().from(customCategories).where(eq(customCategories.id, id)).limit(1);
  return rows[0];
}

/** Archives a custom category and drops its limit; records keep the key and still show its name. */
export async function archiveCustomCategory(db: Db, id: number): Promise<CustomCategory | undefined> {
  const rows = await db
    .update(customCategories)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(customCategories.id, id), eq(customCategories.status, "active")))
    .returning();
  const row = rows[0];
  if (row) await db.delete(budgets).where(and(eq(budgets.householdId, row.householdId), eq(budgets.category, customCategoryKey(row.id))));
  return row;
}

/** Brings an archived category back (same key, so its old records are counted again). */
export async function restoreCustomCategory(db: Db, id: number): Promise<CustomCategory | undefined> {
  const rows = await db.update(customCategories).set({ status: "active", updatedAt: new Date() }).where(eq(customCategories.id, id)).returning();
  return rows[0];
}
