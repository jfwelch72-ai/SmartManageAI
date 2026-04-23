import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1414 — per-admin opt-out for the INTEGRATION_SYNC_RETRIES_EXHAUSTED
 * transactional email. Default `false` so existing admins start receiving
 * the email by default (matching the task's "safest default" requirement).
 * Idempotent: safe to run on every startup.
 */
export async function ensureUsersIntegrationSyncExhaustedEmailOptOutColumn(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "integration_sync_exhausted_email_opt_out" boolean NOT NULL DEFAULT false
  `);
}
