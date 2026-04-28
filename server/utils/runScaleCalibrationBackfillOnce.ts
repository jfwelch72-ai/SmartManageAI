// Task #2350 — One-shot backfill that emits synthetic structured
// `scale_calibration` audit_log rows for every `takeoff_sheets` row that was
// calibrated before Task #2325 introduced the structured writer. Without
// this, the new Scale History panel shows only the "Current" section for
// pre-#2325 sheets and an empty timeline below it.
//
// The actual work lives in `server/scripts/backfill-scale-calibrations.ts`
// (`runScaleCalibrationBackfill`) so it is also runnable as a standalone
// CLI. This wrapper only handles the post-deploy bookkeeping:
//   * `one_shot_jobs` ledger row gates execution to a single successful run
//     per environment (subsequent startups are a single SELECT).
//   * `one_shot_job_runs` coverage row records every run for the admin
//     "One-shot jobs" panel.
//   * Failures intentionally do NOT mark the job done — the next deploy
//     will retry automatically.
//
// Idempotency belt-and-braces: the underlying SQL also uses NOT EXISTS to
// skip sheets that already have a structured scale_calibration audit row,
// so even if the ledger row is somehow lost the worst case is a zero-row
// re-run, never duplicate timeline entries.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";
import { oneShotJobRuns } from "@shared/schema";
import {
  runScaleCalibrationBackfill,
  type ScaleCalibrationBackfillStats,
} from "../scripts/backfill-scale-calibrations";
import {
  registerOneShotJob,
  type OneShotJobRunResult,
} from "./oneShotJobRegistry";

export const JOB_NAME = "backfill_scale_calibrations_v1";

export type RunScaleCalibrationBackfillOnceResult =
  | { status: "skipped_already_complete" }
  | { status: "completed"; elapsedMs: number; stats: ScaleCalibrationBackfillStats }
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

async function markJobComplete(
  name: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO "one_shot_jobs" ("name", "details", "completed_at")
    VALUES (${name}, ${JSON.stringify(details)}::jsonb, now())
    ON CONFLICT ("name") DO UPDATE SET
      "details" = EXCLUDED."details",
      "completed_at" = EXCLUDED."completed_at"
  `);
}

async function recordCoverageRow(
  status: string,
  durationMs: number,
  startedAt: Date,
  finishedAt: Date,
  details: Record<string, unknown> | null,
  errorText: string | null,
): Promise<void> {
  try {
    await db.insert(oneShotJobRuns).values({
      jobName: JOB_NAME,
      runByUserId: null,
      status,
      ledgerCleared: false,
      durationMs,
      errorText,
      details,
      startedAt,
      finishedAt,
    });
  } catch (err) {
    logWarn(
      `[migration] scale_calibration_backfill — failed to record one_shot_job_runs coverage row (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function runScaleCalibrationBackfillOnce(): Promise<RunScaleCalibrationBackfillOnceResult> {
  try {
    await ensureOneShotJobsTable();

    if (await isJobComplete(JOB_NAME)) {
      logInfo(
        "[migration] scale_calibration_backfill — already completed, skipped",
      );
      return { status: "skipped_already_complete" };
    }

    const startedAt = new Date();
    const start = Date.now();
    let stats: ScaleCalibrationBackfillStats;
    try {
      stats = await runScaleCalibrationBackfill();
    } catch (err) {
      const elapsed = Date.now() - start;
      const finishedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      logError(
        "[migration] scale_calibration_backfill — run failed; will retry on next startup",
        {},
        err instanceof Error ? err : new Error(message),
      );
      await recordCoverageRow(
        "failed",
        elapsed,
        startedAt,
        finishedAt,
        null,
        message,
      );
      return { status: "failed", error: message };
    }

    const elapsed = Date.now() - start;
    const finishedAt = new Date();
    const detailPayload = {
      inserted: stats.inserted,
      alreadyHadStructured: stats.alreadyHadStructured,
      missingCalibratedBy: stats.missingCalibratedBy,
      candidatesScanned: stats.candidatesScanned,
      elapsedMs: elapsed,
    };
    await markJobComplete(JOB_NAME, detailPayload);
    await recordCoverageRow(
      "completed",
      elapsed,
      startedAt,
      finishedAt,
      detailPayload,
      null,
    );
    logInfo(
      `[migration] scale_calibration_backfill — completed in ${elapsed}ms ` +
        `(inserted=${stats.inserted}, alreadyHadStructured=${stats.alreadyHadStructured}, ` +
        `missingCalibratedBy=${stats.missingCalibratedBy}, candidatesScanned=${stats.candidatesScanned})`,
    );
    return { status: "completed", elapsedMs: elapsed, stats };
  } catch (err) {
    logWarn(
      `[migration] scale_calibration_backfill — bookkeeping failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      status: "bookkeeping_error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Register in the generic one-shot registry so the admin "One-shot jobs"
// panel can re-run the backfill (or run it dry) without a bespoke endpoint.
// `runOneShotJob` clears the ledger row before invoking us, so the
// once-runner will actually re-execute rather than short-circuit on the
// SELECT check.
registerOneShotJob({
  name: JOB_NAME,
  title: "Takeoff scale-calibration history backfill",
  description:
    "Emits one synthetic `scale_calibration` audit_log row for every " +
    "takeoff sheet that was calibrated before the structured Scale History " +
    "writer (Task #2325) shipped, so the panel shows a baseline timeline " +
    "entry for sheets calibrated under the old code path. Idempotent. " +
    "(Task #2350)",
  parameters: [
    {
      name: "dryRun",
      label: "Dry run",
      description:
        "Scan and report how many synthetic rows would be inserted without " +
        "writing them. Skips marking the ledger complete.",
      type: "boolean",
      default: false,
    },
  ],
  run: async (params): Promise<OneShotJobRunResult> => {
    const dryRun = params.dryRun === true;

    // Default re-run (not dry) preserves the existing ledger-writing
    // behavior by going through the once-runner. A dry run runs the
    // underlying script directly so it never marks the ledger complete.
    if (!dryRun) {
      const result = await runScaleCalibrationBackfillOnce();
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
    }

    const start = Date.now();
    try {
      const stats = await runScaleCalibrationBackfill({ dryRun: true });
      return {
        status: "completed",
        details: {
          dryRun: true,
          inserted: stats.inserted,
          alreadyHadStructured: stats.alreadyHadStructured,
          missingCalibratedBy: stats.missingCalibratedBy,
          candidatesScanned: stats.candidatesScanned,
          elapsedMs: Date.now() - start,
        },
      };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
