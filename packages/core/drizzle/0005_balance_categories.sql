CREATE TABLE "alerts" (
	"household_id" integer NOT NULL,
	"user_id" integer,
	"scope" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"armed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_household_id_scope_pk" PRIMARY KEY("household_id","scope")
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"as_of" date NOT NULL,
	"expected" numeric(18, 2),
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"bot_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer,
	"kind" text DEFAULT 'expense' NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '📦' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "target_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_categories" ADD CONSTRAINT "custom_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_categories" ADD CONSTRAINT "custom_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balances_household_idx" ON "balances" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "custom_categories_household_idx" ON "custom_categories" USING btree ("household_id","status");