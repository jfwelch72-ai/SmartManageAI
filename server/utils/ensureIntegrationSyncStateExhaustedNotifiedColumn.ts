import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1391 — mirrors migrations/0051_integration_sync_state_exhausted_notified.sql.
 * Adds `exhausted_notified_at` to `integration_sync_state` so the new
 * "exhausted retries" admin fan-out can dedupe across recordSyncFailure
 * calls (only fire once per exhaustion event; clear on success / manual
 * retry so a future re-exhaustion re-fires).
 *
 * Idempotent ADD COLUMN IF NOT EXISTS so it's safe to run on every boot.
 */
export async function ensureIntegrationSyncStateExhaustedNotifiedColumn(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `ALTER TABLE integration_sync_state ADD COLUMN IF NOT EXISTS exhausted_notified_at timestamp`,
    ));
    console.log("[migration] integration_sync_state.exhausted_notified_at ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure integration_sync_state.exhausted_notified_at:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
