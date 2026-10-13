import { lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { processedMessages } from "../db/schema.js";

/** Returns false when the message was already processed (webhook retries, duplicate updates). */
export async function markProcessed(db: Db, chatId: number, messageId: number): Promise<boolean> {
  const rows = await db.insert(processedMessages).values({ chatId, messageId }).onConflictDoNothing().returning({ chatId: processedMessages.chatId });
  return rows.length > 0;
}

export async function cleanupProcessed(db: Db, olderThan: Date): Promise<void> {
  await db.delete(processedMessages).where(lt(processedMessages.createdAt, olderThan));
}
