CREATE TABLE "record_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"record_type" text NOT NULL,
	"record_id" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_edits" ADD CONSTRAINT "record_edits_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_edits_record_idx" ON "record_edits" USING btree ("record_type","record_id");