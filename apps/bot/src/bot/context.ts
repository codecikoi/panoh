import type { Context } from "grammy";
import { NO_CUSTOM_CATEGORIES, loadCategoryLookup, type CategoryLookup, type Db, type Household, type User } from "@madat/core";

export interface Scope {
  household: Household;
  user?: User;
  locale: string;
  tz: string;
  currency: string;
  /** The family's own categories (archived ones included, for old records). */
  categories: CategoryLookup;
}

export interface Deps {
  db: Db;
  dashboardUrl?: string;
  dashboardLink?: string;
}

export type BotContext = Context & { scope: Scope; deps: Deps };

export function scopeFromHousehold(household: Household, user?: User, categories: CategoryLookup = NO_CUSTOM_CATEGORIES): Scope {
  return { household, user, locale: household.locale, tz: household.timezone, currency: household.baseCurrency, categories };
}

/** Scope with the household's own categories loaded (for anything that names categories: summaries, reports, confirmations). */
export async function loadScope(db: Db, household: Household, user?: User): Promise<Scope> {
  return scopeFromHousehold(household, user, await loadCategoryLookup(db, household.id));
}
