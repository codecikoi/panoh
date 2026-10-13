import type { Context } from "grammy";
import type { Db, Household, User } from "@budgie/core";

export interface Scope {
  household: Household;
  user?: User;
  locale: string;
  tz: string;
  currency: string;
}

export interface Deps {
  db: Db;
  dashboardUrl?: string;
  dashboardLink?: string;
}

export type BotContext = Context & { scope: Scope; deps: Deps };

export function scopeFromHousehold(household: Household, user?: User): Scope {
  return { household, user, locale: household.locale, tz: household.timezone, currency: household.baseCurrency };
}
