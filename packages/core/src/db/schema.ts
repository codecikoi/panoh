import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export interface TriggerConfig {
  /** Message prefix that always triggers processing (default "+"). Empty string disables. */
  prefix?: string;
  /** Extra keywords added to the built-in list for the household locale. */
  keywords?: string[];
  /** Whether a "number + currency" pattern triggers processing (default true). */
  moneyPattern?: boolean;
  /** Whether mentioning the bot or replying to it triggers processing (default true). */
  mention?: boolean;
}

const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" });
const tgId = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const households = pgTable(
  "households",
  {
    id: serial("id").primaryKey(),
    telegramChatId: tgId("telegram_chat_id").notNull(),
    chatType: text("chat_type").notNull().default("group"),
    title: text("title"),
    baseCurrency: text("base_currency").notNull().default("USD"),
    timezone: text("timezone").notNull().default("UTC"),
    locale: text("locale").notNull().default("en"),
    triggers: jsonb("triggers").$type<TriggerConfig>().notNull().default({}),
    remindDaysBefore: integer("remind_days_before").notNull().default(2),
    reminderHour: integer("reminder_hour").notNull().default(9),
    summaryDay: integer("summary_day").notNull().default(1),
    summaryHour: integer("summary_hour").notNull().default(9),
    lastMonthlySummary: text("last_monthly_summary"),
    setupDone: boolean("setup_done").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("households_chat_idx").on(t.telegramChatId)],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramUserId: tgId("telegram_user_id").notNull(),
    firstName: text("first_name"),
    username: text("username"),
    locale: text("locale"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_tg_idx").on(t.telegramUserId)],
);

export const householdMembers = pgTable(
  "household_members",
  {
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

export const recurringPayments = pgTable(
  "recurring_payments",
  {
    id: serial("id").primaryKey(),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    amount: money("amount"),
    currency: text("currency").notNull(),
    category: text("category").notNull().default("loans"),
    dayOfMonth: integer("day_of_month").notNull(),
    remindDaysBefore: integer("remind_days_before"),
    active: boolean("active").notNull().default(true),
    lastPaidPeriod: text("last_paid_period"),
    sourceChatId: tgId("source_chat_id"),
    sourceMessageId: tgId("source_message_id"),
    botMessageId: tgId("bot_message_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recurring_household_idx").on(t.householdId, t.active)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<"expense" | "income">().notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    amountBase: money("amount_base"),
    baseCurrency: text("base_currency").notNull(),
    category: text("category").notNull(),
    note: text("note").notNull().default(""),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    status: text("status").$type<"confirmed" | "pending" | "deleted">().notNull().default("confirmed"),
    confidence: real("confidence"),
    rawText: text("raw_text"),
    recurringPaymentId: integer("recurring_payment_id").references(() => recurringPayments.id, { onDelete: "set null" }),
    period: text("period"),
    sourceChatId: tgId("source_chat_id"),
    sourceMessageId: tgId("source_message_id"),
    botMessageId: tgId("bot_message_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("transactions_household_date_idx").on(t.householdId, t.occurredOn),
    index("transactions_bot_msg_idx").on(t.sourceChatId, t.botMessageId),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<"reminder" | "payment_upcoming" | "payment_due">().notNull().default("reminder"),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"scheduled" | "sent" | "done" | "cancelled">().notNull().default("scheduled"),
    recurringPaymentId: integer("recurring_payment_id").references(() => recurringPayments.id, { onDelete: "cascade" }),
    period: text("period"),
    snoozeCount: integer("snooze_count").notNull().default(0),
    /** True while the time of day is the household default (no explicit time given by the user). */
    defaultTime: boolean("default_time").notNull().default(false),
    sourceChatId: tgId("source_chat_id"),
    sourceMessageId: tgId("source_message_id"),
    botMessageId: tgId("bot_message_id"),
    notifiedMessageId: tgId("notified_message_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reminders_due_idx").on(t.status, t.dueAt),
    index("reminders_household_idx").on(t.householdId, t.status),
    index("reminders_bot_msg_idx").on(t.sourceChatId, t.botMessageId),
    uniqueIndex("reminders_recurring_period_idx")
      .on(t.recurringPaymentId, t.period, t.kind)
      .where(sql`${t.recurringPaymentId} is not null`),
  ],
);

export const exchangeRates = pgTable("exchange_rates", {
  currency: text("currency").primaryKey(),
  rate: numeric("rate", { precision: 18, scale: 6, mode: "number" }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processedMessages = pgTable(
  "processed_messages",
  {
    chatId: tgId("chat_id").notNull(),
    messageId: tgId("message_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.messageId] })],
);

export const insightsCache = pgTable(
  "insights_cache",
  {
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    locale: text("locale").notNull(),
    payload: jsonb("payload").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.month, t.locale] })],
);

export type Household = typeof households.$inferSelect;
export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type RecurringPayment = typeof recurringPayments.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type NewReminder = typeof reminders.$inferInsert;
export type NewRecurringPayment = typeof recurringPayments.$inferInsert;
