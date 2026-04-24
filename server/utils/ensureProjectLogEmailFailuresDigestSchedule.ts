import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1732 — per-org schedule for the daily project-log-email
 * failures-digest fan-out (`processProjectLogEmailFailuresDigest`
 * in server/jobs/jobRunner.ts).
 *
 * Adds four columns to `organizations`:
 *   * `project_log_email_failures_digest_cadence`   text NOT NULL
 *       DEFAULT 'DAILY'  — OFF/DAILY/WEEKLY
 *   * `project_log_email_failures_digest_weekday`   integer NOT NULL
 *       DEFAULT 1        — 0=Sun..6=Sat (matches `getLocalDateParts`)
 *   * `project_log_email_failures_digest_hour`      integer NOT NULL
 *       DEFAULT 8        — local hour 0-23
 *   * `project_log_email_failures_digest_timezone`  text NOT NULL
 *       DEFAULT 'UTC'    — IANA timezone name
 *
 * Mirrors `migrations/0063_project_log_email_failures_digest_schedule.sql`
 * so freshly-pulled dev DBs auto-apply the new columns without needing
 * `npx drizzle-kit migrate`. Idempotent (`IF NOT EXISTS`) and the
 * defaults preserve the original hard-coded "08:00 UTC daily" behavior
 * for existing rows so this is a safe no-op upgrade.
 */
export async function ensureProjectLogEmailFailuresDigestSchedule(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_cadence text NOT NULL DEFAULT 'DAILY',
        ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_weekday integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_hour integer NOT NULL DEFAULT 8,
        ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_timezone text NOT NULL DEFAULT 'UTC'
    `);
    console.log(
      "[migration] organizations.project_log_email_failures_digest_* columns ready",
    );
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailFailuresDigestSchedule failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
