import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1637 — fan out an in-app notification when a per-project
 * scheduled RFI / submittal log email transitions into FAILURE or
 * NO_RECIPIENTS. Mirrors `migrations/0059_project_log_email_failure_notifications.sql`
 * so freshly-pulled dev DBs auto-apply the new columns without
 * needing `npx drizzle-kit migrate`.
 *
 * Adds (idempotently):
 *   * `last_edited_by_id`            - who last edited the cadence;
 *                                      one of the failure-notification
 *                                      recipients alongside the
 *                                      project manager. ON DELETE SET
 *                                      NULL so deleting the user
 *                                      doesn't block the row.
 *   * `last_failure_notified_at`     - timestamp of the most recent
 *                                      failure fan-out (diagnostic).
 *   * `last_failure_notified_status` - dedupe gate ("FAILURE" |
 *                                      "NO_RECIPIENTS"). The cron only
 *                                      fans a fresh notification when
 *                                      the new attempt's status
 *                                      differs, so a persistent
 *                                      failure isn't re-notified every
 *                                      hourly tick.
 *
 * The companion ALTER TYPE ADD VALUE for PROJECT_LOG_EMAIL_FAILED is
 * applied by `ensureNotificationEnumValues`.
 */
export async function ensureProjectLogEmailFailureNotifications(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE project_log_email_schedules
        ADD COLUMN IF NOT EXISTS last_edited_by_id varchar
          REFERENCES users(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      ALTER TABLE project_log_email_schedules
        ADD COLUMN IF NOT EXISTS last_failure_notified_at timestamp
    `);
    await db.execute(sql`
      ALTER TABLE project_log_email_schedules
        ADD COLUMN IF NOT EXISTS last_failure_notified_status text
    `);
    console.log(
      "[migration] project_log_email_schedules failure-notification columns ready",
    );
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailFailureNotifications failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
