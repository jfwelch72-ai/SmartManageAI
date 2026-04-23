// Task #1405 — Post-deploy one-shot that fans out the new "integration sync
// gave up" admin alert (Task #1391) for sync rows that were already
// exhausted before the notification feature shipped.
//
// recordSyncFailure only fires the alert on the *transition* into exhausted
// state, so any row that already had retry_count >= MAX_SYNC_RETRIES at
// deploy time would never fire one without manual intervention. This runner
// performs that fan-out exactly once per environment, then records a
// `one_shot_jobs` ledger row so subsequent startups are a single SELECT.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";
import { backfillExhaustedSyncRetryAlerts } from "../services/integrationSyncRetryNotifications";
import {
  registerOneShotJob,
  type OneShotJobRunResult,
} from "./oneShotJobRegistry";

export const JOB_NAME = "backfill_exhausted_sync_retry_alerts_v1";

export type RunExhaustedSyncRetryAlertsBackfillOnceResult =
  | { status: "skipped_already_complete" }
  | { status: "completed"; elapsedMs: number; stats: Awaited<ReturnType<typeof backfillExhaustedSyncRetryAlerts>> }
  | { status: "failed"; error: string }
  | { status: "bookkeeping_error"; error: string };

async function ensureOneShotJobsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "one_shot_jobs" (
      "name" text PRIMARY KEY,
      "completed_at" timestamp NOT NULL DEFAULT now(),
      "details" jsonb
    )
  `);
}

async function isJobComplete(name: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT 1 FROM "one_shot_jobs" WHERE "name" = ${name} LIMIT 1`,
  );
  return res.rows.length > 0;
}

async function markJobComplete(name: string, details: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    INSERT INTO "one_shot_jobs" ("name", "details", "completed_at")
    VALUES (${name}, ${JSON.stringify(details)}::jsonb, now())
    ON CONFLICT ("name") DO UPDATE SET
      "details" = EXCLUDED."details",
      "completed_at" = EXCLUDED."completed_at"
  `);
}

export async function runExhaustedSyncRetryAlertsBackfillOnce(): Promise<RunExhaustedSyncRetryAlertsBackfillOnceResult> {
  try {
    await ensureOneShotJobsTable();

    if (await isJobComplete(JOB_NAME)) {
      logInfo("[migration] exhausted_sync_retry_alerts_backfill — already completed, skipped");
      return { status: "skipped_already_complete" };
    }

    const start = Date.now();
    let stats: Awaited<ReturnType<typeof backfillExhaustedSyncRetryAlerts>>;
    try {
      stats = await backfillExhaustedSyncRetryAlerts();
    } catch (err) {
      // Don't mark the ledger on failure — let the next startup retry. We
      // never want a notification problem to crash the app.
      logError(
        "[migration] exhausted_sync_retry_alerts_backfill — run failed; will retry on next startup",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }

    const elapsed = Date.now() - start;
    await markJobComplete(JOB_NAME, {
      ...stats,
      elapsedMs: elapsed,
    });
    logInfo(
      `[migration] exhausted_sync_retry_alerts_backfill — completed in ${elapsed}ms ` +
        `(claimedRows=${stats.claimedRows}, groupsNotified=${stats.groupsNotified}, ` +
        `groupsWithoutAdmins=${stats.groupsWithoutAdmins}, recipients=${stats.recipients})`,
    );
    return { status: "completed", elapsedMs: elapsed, stats };
  } catch (err) {
    logWarn(
      `[migration] exhausted_sync_retry_alerts_backfill — bookkeeping failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { status: "bookkeeping_error", error: err instanceof Error ? err.message : String(err) };
  }
}

// Task #1448 — register this job in the generic one-shot registry. Re-runs
// must clear the ledger row first because the once-runner short-circuits
// when the ledger row already exists (otherwise the re-run would be a no-op
// SELECT). The structured result from the once-runner is mapped onto the
// registry's normalized OneShotJobRunResult shape so the admin UI can show
// stats / error reason.
registerOneShotJob({
  name: JOB_NAME,
  title: "Exhausted sync retry alerts backfill",
  description:
    "Re-fans the \"integration sync gave up\" admin summary alert (Task #1391) " +
    "for any integration_sync_state row that was already exhausted before the " +
    "notification feature shipped. Use after a notification provider outage " +
    "or for staging re-tests. (Task #1405)",
  run: async (): Promise<OneShotJobRunResult> => {
    // The shared `runOneShotJob` registry helper has already cleared the
    // ledger row before invoking us, so the once-runner will actually
    // perform work instead of short-circuiting on the SELECT check.
    const result = await runExhaustedSyncRetryAlertsBackfillOnce();
    if (result.status === "completed") {
      return {
        status: "completed",
        details: { elapsedMs: result.elapsedMs, ...result.stats },
      };
    }
    if (result.status === "skipped_already_complete") {
      return { status: "skipped_already_complete" };
    }
    return { status: result.status, error: result.error };
  },
});
