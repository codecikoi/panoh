import { describe, expect, it } from "vitest";
import { findItem, itemsOf, joinNotes, splitByAuthor, withItemAdded, withItemRemoved } from "./items.js";

const plain = { amount: 313000, note: "корзинка продукты", userId: 1, items: null };

describe("record positions", () => {
  it("treats a plain record as its only position and builds a list when one is added", () => {
    expect(itemsOf(plain)).toEqual([{ amount: 313000, note: "корзинка продукты", userId: 1 }]);
    const added = withItemAdded(plain, { amount: 20000, note: " виноград ", userId: 2 });
    expect(added).toEqual({
      amount: 333000,
      note: "корзинка продукты + виноград",
      items: [
        { amount: 313000, note: "корзинка продукты", userId: 1 },
        { amount: 20000, note: "виноград", userId: 2 },
      ],
    });
    // A third one keeps growing the same list; an empty note is skipped in the joined note.
    const third = withItemAdded({ ...plain, ...added }, { amount: 5000, note: "", userId: 2 });
    expect(third.amount).toBe(338000);
    expect(third.note).toBe("корзинка продукты + виноград");
    expect(third.items).toHaveLength(3);
    expect(joinNotes(third.items!)).toBe("корзинка продукты + виноград");
  });

  it("finds a position by its note loosely and removes it, folding back to a plain record", () => {
    const list = withItemAdded(plain, { amount: 20000, note: "виноград", userId: 2 });
    const tx = { ...plain, ...list };
    expect(findItem(itemsOf(tx), "Виноград")).toBe(1);
    expect(findItem(itemsOf(tx), "корзинка")).toBe(0);
    expect(findItem(itemsOf(tx), "зелёный виноград")).toBe(1);
    expect(findItem(itemsOf(tx), "хлеб")).toBe(-1);
    expect(findItem(itemsOf(tx), "  ")).toBe(-1);
    expect(withItemRemoved(tx, 1)).toEqual({ amount: 313000, note: "корзинка продукты", items: null });
    expect(withItemRemoved(tx, 5)).toBeNull();
    // The only position of a plain record cannot be removed: that would be a delete.
    expect(withItemRemoved(plain, 0)).toBeNull();
  });

  it("splits a converted total between the authors of the positions pro rata", () => {
    const tx = { ...plain, ...withItemAdded(plain, { amount: 20000, note: "виноград", userId: 2 }) };
    expect(splitByAuthor(tx, 33.3)).toEqual([
      { userId: 1, amount: 31.3 },
      { userId: 2, amount: 2 },
    ]);
    expect(splitByAuthor(plain, 31.3)).toEqual([{ userId: 1, amount: 31.3 }]);
    // A position without an author falls back to the record's author.
    const anon = { ...plain, items: [{ amount: 100, note: "a", userId: null }, { amount: 100, note: "b", userId: 3 }], amount: 200 };
    expect(splitByAuthor(anon, 200).map((p) => p.userId)).toEqual([1, 3]);
  });
});
