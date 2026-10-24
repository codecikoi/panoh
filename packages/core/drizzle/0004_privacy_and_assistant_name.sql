ALTER TABLE "households" ADD COLUMN "assistant_name" text;--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "raw_text";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";--> statement-breakpoint
-- Private chats used to be titled with the person's first name; names are no longer stored.
UPDATE "households" SET "title" = NULL WHERE "chat_type" = 'private';