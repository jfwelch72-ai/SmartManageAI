import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #754: per-Super-Admin "catch-up" digest email summarizing the
 * job-metric alerts that fired while the user was inside their
 * quiet-hours window. The digest job consults these columns to decide
 * whether to send a digest and to dedupe per-window deliveries.
 *
 * `enabled` defaults to TRUE so existing Super Admins receive the
 * digest by default once they configure quiet hours; they can opt out
 * from the Notification Preferences page. `last_digest_at` is nullable
 * — it advances each tick a digest is evaluated for the recipient.
 */
export async function ensureUsersJobMetricAlertQuietHoursDigestColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_last_digest_at TIMESTAMP
    `);
    console.log("[migration] users job_metric_alert_quiet_hours_digest columns ready");
  } catch (err) {
    logError(
      "[migration] ensureUsersJobMetricAlertQuietHoursDigestColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
