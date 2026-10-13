CREATE TABLE "exchange_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"chat_type" text DEFAULT 'group' NOT NULL,
	"title" text,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"triggers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remind_days_before" integer DEFAULT 2 NOT NULL,
	"reminder_hour" integer DEFAULT 9 NOT NULL,
	"summary_day" integer DEFAULT 1 NOT NULL,
	"summary_hour" integer DEFAULT 9 NOT NULL,
	"last_monthly_summary" text,
	"setup_done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights_cache" (
	"household_id" integer NOT NULL,
	"month" text NOT NULL,
	"locale" text NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insights_cache_household_id_month_locale_pk" PRIMARY KEY("household_id","month","locale")
);
--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"chat_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_messages_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"amount" numeric(18, 2),
	"currency" text NOT NULL,
	"category" text DEFAULT 'loans' NOT NULL,
	"day_of_month" integer NOT NULL,
	"remind_days_before" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_paid_period" text,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"kind" text DEFAULT 'reminder' NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"recurring_payment_id" integer,
	"period" text,
	"snooze_count" integer DEFAULT 0 NOT NULL,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"notified_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"amount_base" numeric(18, 2),
	"base_currency" text NOT NULL,
	"category" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"occurred_on" date NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"confidence" real,
	"raw_text" text,
	"recurring_payment_id" integer,
	"period" text,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"first_name" text,
	"username" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights_cache" ADD CONSTRAINT "insights_cache_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_recurring_payment_id_recurring_payments_id_fk" FOREIGN KEY ("recurring_payment_id") REFERENCES "public"."recurring_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_payment_id_recurring_payments_id_fk" FOREIGN KEY ("recurring_payment_id") REFERENCES "public"."recurring_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "households_chat_idx" ON "households" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE INDEX "recurring_household_idx" ON "recurring_payments" USING btree ("household_id","active");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "reminders_household_idx" ON "reminders" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "reminders_bot_msg_idx" ON "reminders" USING btree ("source_chat_id","bot_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_recurring_period_idx" ON "reminders" USING btree ("recurring_payment_id","period","kind") WHERE "reminders"."recurring_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_household_date_idx" ON "transactions" USING btree ("household_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_bot_msg_idx" ON "transactions" USING btree ("source_chat_id","bot_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tg_idx" ON "users" USING btree ("telegram_user_id");