import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1066: per-admin mute knobs for the Task #1051 alert delivery
 * failure fallback emails. The global `crmBackfillSummaryChannel = "none"`
 * setting already silences both the run summary AND these fallback
 * emails, but admins who still want completion summaries need a way to
 * mute just the fallback fan-out — globally or for a specific failing
 * channel (e.g. ignore Slack failures while still being told about
 * email failures).
 *
 * Defaults preserve existing behavior (every admin keeps getting the
 * fallback emails for both Slack and email failures).
 */
export async function ensureUsersCrmAlertFailureFallbackColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS crm_alert_failure_fallback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS crm_alert_failure_fallback_muted_channels TEXT[] NOT NULL DEFAULT '{}'::text[]
    `);
    console.log("[migration] users crm_alert_failure_fallback_* columns ready");
  } catch (err) {
    logError(
      "[migration] ensureUsersCrmAlertFailureFallbackColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
