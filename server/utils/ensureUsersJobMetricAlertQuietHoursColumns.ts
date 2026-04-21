import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #748: per-Super-Admin quiet-hours window for job-metric alert
 * emails. The job-metric alert engine consults these columns and skips
 * email delivery (in-app still fires) when the recipient's local time
 * falls inside [start, end) on one of the selected weekdays.
 *
 * `enabled` defaults to FALSE so existing admins keep receiving emails
 * 24/7 until they explicitly opt in.
 */
export async function ensureUsersJobMetricAlertQuietHoursColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_start TEXT,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_end TEXT,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_timezone TEXT,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_weekdays INTEGER[]
    `);
    console.log("[migration] users job_metric_alert_quiet_hours columns ready");
  } catch (err) {
    logError(
      "[migration] ensureUsersJobMetricAlertQuietHoursColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
