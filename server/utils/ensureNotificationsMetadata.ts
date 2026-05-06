import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1974 — adds the `metadata` jsonb column to `notifications` so
 * per-notification metadata (currently the {recordLink, recordLabel}
 * pair the INTEGRATION_SYNC_RETRIES_EXHAUSTED fan-out resolves at
 * creation time) can flow through to the in-app bell row, mirroring
 * the secondary CTA the email composer already renders for QBO
 * failures (Task #1945).
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensureNotificationsMetadata(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `ALTER TABLE notifications
         ADD COLUMN IF NOT EXISTS metadata jsonb`,
    ));
    logInfo("[migration] notifications.metadata ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure notifications.metadata:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
