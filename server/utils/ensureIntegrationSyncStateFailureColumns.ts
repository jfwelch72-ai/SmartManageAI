import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1332 — mirrors migrations/0048_integration_sync_state_failure_tracking.sql.
 * Adds `last_attempt_at` and `last_error` columns to `integration_sync_state`
 * so the Davis-Bacon background sync (and any future background syncs that
 * key off `integration_sync_state`) can persist failure state and surface it
 * to users instead of silently logging.
 *
 * Idempotent ADD COLUMN IF NOT EXISTS so it's safe to run on every boot.
 */
export async function ensureIntegrationSyncStateFailureColumns(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `ALTER TABLE integration_sync_state ADD COLUMN IF NOT EXISTS last_attempt_at timestamp`,
    ));
    await db.execute(sql.raw(
      `ALTER TABLE integration_sync_state ADD COLUMN IF NOT EXISTS last_error text`,
    ));
    logInfo("[migration] integration_sync_state failure tracking columns ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure integration_sync_state failure tracking columns:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
