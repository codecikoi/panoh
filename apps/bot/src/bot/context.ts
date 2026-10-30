import type { Context } from "grammy";
import { NO_CUSTOM_CATEGORIES, loadCategoryLookup, loadMemberNames, type CategoryLookup, type Db, type Household, type User } from "@madat/core";

export interface Scope {
  household: Household;
  user?: User;
  locale: string;
  tz: string;
  currency: string;
  /** The family's own categories (archived ones included, for old records). */
  categories: CategoryLookup;
  /** First names of the members by user id, for "who recorded it" lines (empty until they are known). */
  names: ReadonlyMap<number, string>;
}

export interface Deps {
  db: Db;
  dashboardUrl?: string;
  dashboardLink?: string;
}

export type BotContext = Context & { scope: Scope; deps: Deps };

export function scopeFromHousehold(
  household: Household,
  user?: User,
  categories: CategoryLookup = NO_CUSTOM_CATEGORIES,
  names: ReadonlyMap<number, string> = new Map(),
): Scope {
  return { household, user, locale: household.locale, tz: household.timezone, currency: household.baseCurrency, categories, names };
}

/** Scope with the household's own categories and member names loaded (for anything that renders records or summaries). */
export async function loadScope(db: Db, household: Household, user?: User): Promise<Scope> {
  const [categories, names] = await Promise.all([loadCategoryLookup(db, household.id), loadMemberNames(db, household.id)]);
  return scopeFromHousehold(household, user, categories, names);
}
