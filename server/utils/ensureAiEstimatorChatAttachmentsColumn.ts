import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * AI Estimator chat attachments — adds the `attachments` JSONB column to
 * `ai_estimator_chat_messages`. Idempotent (ADD COLUMN IF NOT EXISTS).
 * Mirrors migration 0112_ai_estimator_chat_attachments.sql so fresh DBs and
 * reconciled DBs converge.
 */
export async function ensureAiEstimatorChatAttachmentsColumn(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE ai_estimator_chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB`,
  );
  logInfo("[migration] ai_estimator_chat_messages.attachments — column ready");
}
