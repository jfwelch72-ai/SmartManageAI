import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";
import {
  runCertifiedPayrollBackfill,
  type BackfillStats,
} from "../scripts/backfill-certified-payroll-reports";

export const JOB_NAME = "backfill_certified_payroll_reports_v1";

/**
 * Generic one-shot job ledger. Stores a single row per named job once it has
 * completed successfully so future startups skip the work entirely. Failures
 * intentionally do NOT mark the job done — they are logged and the next
 * startup will re-attempt the backfill.
 */
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

/**
 * Delete a one-shot job ledger row so the post-deploy runner will re-execute
 * it on the next startup. Used by the Super Admin "re-run backfill" endpoint
 * (Task #1176) so admins don't have to drop into psql.
 */
export async function clearOneShotJob(name: string): Promise<boolean> {
  await ensureOneShotJobsTable();
  const res = await db.execute(
    sql`DELETE FROM "one_shot_jobs" WHERE "name" = ${name}`,
  );
  return (res.rowCount ?? 0) > 0;
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

/**
 * Post-deploy one-shot runner for the certified-payroll backfill (Task #1118).
 *
 * Invoked from `runStartupMigrations` so every tenant automatically gets
 * `certified_payroll_reports` rows for PDFs that were generated before the
 * audit table existed. Behavior:
 *   - Records a per-environment "done" flag in `one_shot_jobs` after the
 *     first successful run; subsequent startups are no-ops (single SELECT).
 *   - Failures are logged and swallowed so they never crash the app — the
 *     flag is NOT written, so the next deploy retries automatically.
 *   - When PRIVATE_OBJECT_DIR is unset (test/dev environments without
 *     object storage), the run is a no-op AND we record the flag so we
 *     don't keep probing the table on every startup.
 */
export async function runCertifiedPayrollBackfillOnce(): Promise<void> {
  try {
    await ensureOneShotJobsTable();

    if (await isJobComplete(JOB_NAME)) {
      logInfo("[migration] certified_payroll_backfill — already completed, skipped");
      return;
    }

    const start = Date.now();
    let stats: BackfillStats;
    try {
      stats = await runCertifiedPayrollBackfill();
    } catch (err) {
      logError(
        "[migration] certified_payroll_backfill — run failed; will retry on next startup",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    const elapsed = Date.now() - start;

    if (stats.skippedReason === "no_private_dir") {
      // No object storage configured in this environment — record the flag so
      // we don't re-list/scan on every startup. If object storage is later
      // configured the operator can DELETE the row to re-trigger.
      await markJobComplete(JOB_NAME, {
        skippedReason: "no_private_dir",
        elapsedMs: elapsed,
      });
      logInfo(
        "[migration] certified_payroll_backfill — PRIVATE_OBJECT_DIR not set; marked done",
      );
      return;
    }

    await markJobComplete(JOB_NAME, {
      inserted: stats.inserted,
      alreadyPresent: stats.alreadyPresent,
      missingPayRun: stats.missingPayRun,
      skippedNonMatching: stats.skippedNonMatching,
      totalListed: stats.totalListed,
      orgsScanned: stats.orgsScanned,
      elapsedMs: elapsed,
    });
    logInfo(
      `[migration] certified_payroll_backfill — completed in ${elapsed}ms ` +
        `(inserted=${stats.inserted}, alreadyPresent=${stats.alreadyPresent}, ` +
        `missingPayRun=${stats.missingPayRun}, orgsScanned=${stats.orgsScanned})`,
    );
  } catch (err) {
    // Defensive: anything thrown from the ledger plumbing itself (table
    // create, select, insert) must not crash startup. Worst case, the job
    // re-runs on the next deploy.
    logWarn(
      `[migration] certified_payroll_backfill — bookkeeping failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
