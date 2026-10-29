import type { CustomCategoryInfo, Insights, MonthlySummary, Plan, RecurringPayment, Reminder, Transaction, MonthOutlook } from "@madat/core";

/** Dates arrive as ISO strings over JSON. */
type Json<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };

export interface Household {
  id: number;
  title: string | null;
  chatType: string;
  baseCurrency: string;
  timezone: string;
  locale: string;
  /** The family's own categories; their names are merged into the strings as `cat.<key>`. */
  categories: CustomCategoryInfo[];
}

export interface MeResponse {
  user: { id: number; firstName: string };
  households: Household[];
}

export interface SummaryResponse {
  household: Household;
  summary: MonthlySummary;
  insights: Insights | null;
}

export type Tx = Json<Transaction>;
export type PlanRow = Json<Plan>;
export type ReminderRow = Json<Reminder>;
export type RecurringRow = Json<RecurringPayment> & { next: { date: string; period: string; paid: boolean } };
export type Outlook = MonthOutlook & { month: string };
export type { Insights, MonthlySummary };
