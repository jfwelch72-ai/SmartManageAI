/**
 * Task #2948 — Startup helper that adds the key_source column to ai_action_audit
 * and the supporting index. Idempotent (ADD COLUMN IF NOT EXISTS).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

export async function ensureAiActionAuditKeySource(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE ai_action_audit
        ADD COLUMN IF NOT EXISTS key_source TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_action_audit_key_source_idx
        ON ai_action_audit (key_source)
    `);
    logInfo("[ensureAiActionAuditKeySource] ai_action_audit.key_source column ready");
  } catch (err) {
    logError(
      "[ensureAiActionAuditKeySource] Failed to add key_source to ai_action_audit",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
