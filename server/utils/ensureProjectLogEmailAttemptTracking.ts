import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1622 — per-attempt outcome tracking for the per-project log
 * email schedules. Mirrors `migrations/0058_project_log_email_attempt_tracking.sql`
 * so freshly-pulled dev DBs auto-apply the new columns without
 * needing `npx drizzle-kit migrate`.
 *
 * Adds (idempotently):
 *   * `last_attempt_at`              - timestamp of the most recent
 *                                      attempt (success, failure, or
 *                                      no-recipients). Distinct from
 *                                      `last_sent_at`, which is still
 *                                      only stamped on success so the
 *                                      existing dedupe windows keep
 *                                      working.
 *   * `last_attempt_status`          - "SUCCESS" | "FAILURE" |
 *                                      "NO_RECIPIENTS".
 *   * `last_attempt_error`           - human-readable reason on
 *                                      FAILURE / NO_RECIPIENTS;
 *                                      cleared on SUCCESS.
 *   * `last_attempt_recipient_count` - how many addresses we tried so
 *                                      admins can distinguish
 *                                      "12 sent" from "0 sent because
 *                                      the list was empty".
 */
export async function ensureProjectLogEmailAttemptTracking(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE project_log_email_schedules
        ADD COLUMN IF NOT EXISTS last_attempt_at timestamp,
        ADD COLUMN IF NOT EXISTS last_attempt_status text,
        ADD COLUMN IF NOT EXISTS last_attempt_error text,
        ADD COLUMN IF NOT EXISTS last_attempt_recipient_count integer
    `);
    console.log(
      "[migration] project_log_email_schedules attempt-tracking columns ready",
    );
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailAttemptTracking failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
