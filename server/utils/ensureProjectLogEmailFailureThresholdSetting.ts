import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1668 — per-org override for the repeated-failure backstop
 * notification threshold on the per-project scheduled RFI / submittal
 * log email worker (`maybeNotifyProjectLogEmailRepeatedFailure` in
 * server/jobs/jobRunner.ts).
 *
 * Task #1651 introduced the backstop with only an env-var knob
 * (PROJECT_LOG_EMAIL_FAILURE_THRESHOLD, default 3). This column lets
 * each org dial in its own tolerance — NULL means "use the env / global
 * default", a positive integer overrides it for that org's schedules.
 *
 * Mirrors `migrations/0062_project_log_email_failure_threshold_setting.sql`
 * so freshly-pulled dev DBs auto-apply the new column without needing
 * `npx drizzle-kit migrate`. Idempotent + nullable so existing rows are
 * unaffected (they continue to read the env / global default).
 */
export async function ensureProjectLogEmailFailureThresholdSetting(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS project_log_email_failure_threshold integer
    `);
    logInfo(
      "[migration] organizations.project_log_email_failure_threshold column ready",
    );
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailFailureThresholdSetting failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
