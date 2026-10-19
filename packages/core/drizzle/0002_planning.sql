CREATE TABLE "budgets" (
	"household_id" integer NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_household_id_category_pk" PRIMARY KEY("household_id","category")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"title" text NOT NULL,
	"target_amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"deadline" date,
	"status" text DEFAULT 'active' NOT NULL,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"title" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"planned_on" date NOT NULL,
	"date_approximate" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "plan_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plan_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "goal_id" integer;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_household_idx" ON "goals" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "goals_bot_msg_idx" ON "goals" USING btree ("source_chat_id","bot_message_id");--> statement-breakpoint
CREATE INDEX "plans_household_idx" ON "plans" USING btree ("household_id","status","planned_on");--> statement-breakpoint
CREATE INDEX "plans_bot_msg_idx" ON "plans" USING btree ("source_chat_id","bot_message_id");--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_plan_idx" ON "reminders" USING btree ("plan_id") WHERE "reminders"."plan_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_goal_idx" ON "transactions" USING btree ("goal_id");