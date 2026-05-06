import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #740: Add receives_job_metric_alert_emails column to users so each
 * Super Admin can opt out of job-metric alert emails. Defaults to TRUE
 * (opted in) to preserve existing behaviour for admins who never touch the
 * toggle.
 */
export async function ensureUsersJobMetricAlertEmailsColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS receives_job_metric_alert_emails BOOLEAN NOT NULL DEFAULT TRUE
    `);
    logInfo("[migration] users receives_job_metric_alert_emails column ready");
  } catch (err) {
    logError(
      "[migration] ensureUsersJobMetricAlertEmailsColumn failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
