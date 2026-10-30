import type { Transaction, TransactionItem } from "../db/schema.js";
import { roundMoney } from "../money.js";

/** Joins the notes of a record's positions: "корзинка продукты + виноград". */
export const NOTE_JOINER = " + ";

type ItemSource = Pick<Transaction, "amount" | "note" | "userId" | "items">;

export interface ItemsPatch {
  amount: number;
  note: string;
  items: TransactionItem[] | null;
}

/** The positions of a record: the stored list, or the record itself as its only position. */
export function itemsOf(tx: ItemSource): TransactionItem[] {
  return tx.items?.length ? tx.items : [{ amount: tx.amount, note: tx.note, userId: tx.userId }];
}

export function joinNotes(items: TransactionItem[]): string {
  return items.map((i) => i.note.trim()).filter(Boolean).join(NOTE_JOINER);
}

function patchOf(items: TransactionItem[]): ItemsPatch {
  if (items.length <= 1) {
    const only = items[0];
    return { amount: only?.amount ?? 0, note: only?.note ?? "", items: null };
  }
  return { amount: roundMoney(items.reduce((sum, i) => sum + i.amount, 0)), note: joinNotes(items), items };
}

/** "Add 20k grapes": the record becomes a list of positions; the total and the joined note follow from them. */
export function withItemAdded(tx: ItemSource, item: TransactionItem): ItemsPatch {
  return patchOf([...itemsOf(tx), { ...item, note: item.note.trim().slice(0, 80) }]);
}

/** The position a user named ("grapes"), by its note: exact, then containing, then contained in the query. −1 when none. */
export function findItem(items: TransactionItem[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  const notes = items.map((i) => i.note.trim().toLowerCase());
  let idx = notes.findIndex((n) => n === q);
  if (idx < 0) idx = notes.findIndex((n) => n.includes(q));
  if (idx < 0) idx = notes.findIndex((n) => n !== "" && q.includes(n));
  return idx;
}

/** Drops one position; null when the record has no such position or only one (that would be a delete). */
export function withItemRemoved(tx: ItemSource, index: number): ItemsPatch | null {
  const items = itemsOf(tx);
  if (items.length < 2 || index < 0 || index >= items.length) return null;
  return patchOf(items.filter((_, i) => i !== index));
}

/** Who is behind how much of a record, in the currency `baseAmount` is in (positions split the converted total pro rata). */
export function splitByAuthor(tx: ItemSource, baseAmount: number): { userId: number | null; amount: number }[] {
  const items = itemsOf(tx);
  if (items.length === 1 || tx.amount <= 0) return [{ userId: items[0]?.userId ?? tx.userId, amount: baseAmount }];
  return items.map((i) => ({ userId: i.userId ?? tx.userId, amount: roundMoney((baseAmount * i.amount) / tx.amount) }));
}
