import { describe, expect, it } from "vitest";
import type { CategoryStat } from "@madat/core";
import { monthChanges } from "./changes";

const c = (category: string, amount: number, prevAmount: number): CategoryStat => ({
  category, emoji: "", amount, count: 1, share: 0, prevAmount, delta: amount - prevAmount, deltaPct: prevAmount > 0 ? Math.round(((amount - prevAmount) / prevAmount) * 100) : null,
});

describe("monthChanges", () => {
  it("ranks growth and drops, folds vanished categories into drops and lists new ones", () => {
    const categories = [c("groceries", 1500, 1000), c("dining", 200, 500), c("kids", 600, 600), c("travel", 900, 0), c("health", 300, 100)];
    const changes = monthChanges({ hasPrev: true, categories, newCategories: [categories[3]!], droppedCategories: [c("pets", 0, 400)] });
    expect(changes.grew.map((x) => x.category)).toEqual(["groceries", "health"]);
    expect(changes.dropped.map((x) => x.category)).toEqual(["pets", "dining"]);
    expect(changes.appeared.map((x) => x.category)).toEqual(["travel"]);
  });

  it("says there is nothing to compare with in the first month", () => {
    expect(monthChanges({ hasPrev: false, categories: [c("groceries", 1, 0)], newCategories: [], droppedCategories: [] }).firstMonth).toBe(true);
  });
});
