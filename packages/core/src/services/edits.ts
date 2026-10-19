import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recordEdits, type RecordEdit, type RecordType } from "../db/schema.js";

type Fields = Record<string, unknown>;

function plain(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

/** The fields whose values differ, as {before, after}; null when nothing changed. */
export function diffFields(before: Fields, after: Fields): { before: Fields; after: Fields } | null {
  const b: Fields = {};
  const a: Fields = {};
  for (const key of Object.keys(after)) {
    const from = plain(before[key]);
    const to = plain(after[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    b[key] = from;
    a[key] = to;
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

export async function logEdit(
  db: Db,
  householdId: number,
  recordType: RecordType,
  recordId: number,
  diff: { before: Fields; after: Fields },
): Promise<void> {
  await db.insert(recordEdits).values({ householdId, recordType, recordId, before: diff.before, after: diff.after });
}

/** Most recent edits of a record, oldest first. */
export async function listEdits(db: Db, recordType: RecordType, recordId: number, limit = 5): Promise<RecordEdit[]> {
  const rows = await db
    .select()
    .from(recordEdits)
    .where(and(eq(recordEdits.recordType, recordType), eq(recordEdits.recordId, recordId)))
    .orderBy(desc(recordEdits.createdAt), desc(recordEdits.id))
    .limit(limit);
  return rows.reverse();
}

/** "amount 3000000 → 11; plannedOn 2026-10-31 → 2026-11-11", one line per edit, for the model. */
export function describeEdits(edits: RecordEdit[]): string {
  return edits
    .map((e, i) => {
      const parts = Object.keys(e.after).map((k) => `${k} ${JSON.stringify(e.before[k])} → ${JSON.stringify(e.after[k])}`);
      return `edit ${i + 1}: ${parts.join("; ")}`;
    })
    .join("\n");
}
