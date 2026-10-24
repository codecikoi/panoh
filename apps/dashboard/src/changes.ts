import type { CategoryStat, MonthlySummary } from "@madat/core";

export interface Changes {
  /** Last month had no records: nothing to compare with. */
  firstMonth: boolean;
  grew: CategoryStat[];
  dropped: CategoryStat[];
  appeared: CategoryStat[];
}

/** Biggest moves against last month: growth, drops (including categories that went to zero) and new categories. */
export function monthChanges(s: Pick<MonthlySummary, "hasPrev" | "categories" | "newCategories" | "droppedCategories">, limit = 3): Changes {
  if (!s.hasPrev) return { firstMonth: true, grew: [], dropped: [], appeared: [] };
  const grew = s.categories.filter((c) => c.prevAmount > 0 && c.delta > 0).sort((a, b) => b.delta - a.delta);
  const dropped = [...s.categories.filter((c) => c.prevAmount > 0 && c.delta < 0), ...s.droppedCategories].sort((a, b) => a.delta - b.delta);
  return { firstMonth: false, grew: grew.slice(0, limit), dropped: dropped.slice(0, limit), appeared: s.newCategories.slice(0, limit) };
}
