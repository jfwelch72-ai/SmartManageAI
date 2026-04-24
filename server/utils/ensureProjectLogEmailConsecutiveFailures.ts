import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1651 — running tally of consecutive FAILURE / NO_RECIPIENTS
 * attempts on a project's scheduled RFI / submittal log email. The
 * worker uses it to fire a one-shot backstop notification to every
 * ADMIN / MANAGER / SUPER_ADMIN in the org once the streak crosses
 * the configured threshold (default 3, env-overridable via
 * PROJECT_LOG_EMAIL_FAILURE_THRESHOLD), so a quietly-broken
 * distribution list can't go un-noticed for weeks just because nobody
 * happens to open the project settings card.
 *
 * Mirrors `migrations/0060_project_log_email_consecutive_failures.sql`
 * so freshly-pulled dev DBs auto-apply the new column without needing
 * `npx drizzle-kit migrate`. Idempotent + NOT NULL DEFAULT 0 so
 * existing rows behave as if they had no prior failures the first
 * time the new worker observes them.
 */
export async function ensureProjectLogEmailConsecutiveFailures(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE project_log_email_schedules
        ADD COLUMN IF NOT EXISTS consecutive_failure_count integer NOT NULL DEFAULT 0
    `);
    console.log(
      "[migration] project_log_email_schedules consecutive_failure_count column ready",
    );
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailConsecutiveFailures failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
