import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #754 / #761 / #764 / #776: per-Super-Admin "catch-up" digest email
 * for job-metric alerts that fire while the user is in their quiet-hours
 * window. This migration ensures all related users.* columns and the
 * digest-format enum exist on a fresh DB.
 */
export async function ensureUsersJobMetricAlertQuietHoursDigestColumns(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_metric_alert_quiet_hours_digest_format') THEN
          CREATE TYPE job_metric_alert_quiet_hours_digest_format AS ENUM ('summary', 'full', 'grouped');
        END IF;
      END$$;
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_last_digest_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_format job_metric_alert_quiet_hours_digest_format NOT NULL DEFAULT 'full',
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_csv_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_max_events INTEGER NOT NULL DEFAULT 100
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
