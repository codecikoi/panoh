CREATE TABLE "reminder_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"title" text NOT NULL,
	"freq" text NOT NULL,
	"weekdays" integer[],
	"day_of_month" integer,
	"hour" integer,
	"minute" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "series_id" integer;--> statement-breakpoint
ALTER TABLE "reminder_series" ADD CONSTRAINT "reminder_series_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_series" ADD CONSTRAINT "reminder_series_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_series_household_idx" ON "reminder_series" USING btree ("household_id","active");--> statement-breakpoint
CREATE INDEX "reminder_series_bot_msg_idx" ON "reminder_series" USING btree ("source_chat_id","bot_message_id");--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_series_id_reminder_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."reminder_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_series_period_idx" ON "reminders" USING btree ("series_id","period") WHERE "reminders"."series_id" is not null;