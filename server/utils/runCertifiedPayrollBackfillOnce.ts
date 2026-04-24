import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";
import {
  runCertifiedPayrollBackfill,
  type BackfillStats,
} from "../scripts/backfill-certified-payroll-reports";
import {
  registerOneShotJob,
  readOneShotJobLedgerRow,
  type OneShotJobRunResult,
} from "./oneShotJobRegistry";

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

// Task #1448 — register this job in the generic one-shot registry so the
// admin "One-shot jobs" panel can surface and re-run it without a bespoke
// endpoint or UI card.
registerOneShotJob({
  name: JOB_NAME,
  title: "Certified payroll PDF backfill",
  description:
    "Scans object storage for previously generated certified payroll PDFs " +
    "and inserts matching `certified_payroll_reports` rows so they appear in " +
    "the audit table. (Task #1118)",
  // Task #1531 — orgFilter / dryRun were previously only available via the
  // bespoke `POST /api/admin/jobs/certified-payroll-backfill/run` endpoint.
  // Declaring them here lets the generic One-shot jobs panel collect them
  // and ops scripts call the unified rerun endpoint with the same options.
  parameters: [
    {
      name: "orgFilter",
      label: "Org ID (optional)",
      description:
        "Limit the backfill to a single organization. Leave blank to scan every org.",
      type: "string",
      default: "",
      placeholder: "org_…",
    },
    {
      name: "dryRun",
      label: "Dry run",
      description:
        "Scan and report what would be inserted without writing rows. Skips marking the ledger complete.",
      type: "boolean",
      default: false,
    },
  ],
  run: async (params): Promise<OneShotJobRunResult> => {
    const orgFilterRaw = typeof params.orgFilter === "string" ? params.orgFilter.trim() : "";
    const orgFilter = orgFilterRaw.length > 0 ? orgFilterRaw : null;
    const dryRun = params.dryRun === true;

    // Default re-run (no org filter, not dry) preserves the existing
    // ledger-writing behavior by going through the once-runner. Any
    // operator-specified variant runs the underlying backfill directly so
    // a dry-run or scoped run never marks the ledger as "completed for the
    // whole environment".
    if (!orgFilter && !dryRun) {
      await runCertifiedPayrollBackfillOnce();
      const ledger = await readOneShotJobLedgerRow(JOB_NAME);
      if (!ledger) {
        return {
          status: "failed",
          error:
            "Certified payroll backfill did not mark itself complete — see " +
            "server logs for the underlying error.",
        };
      }
      return { status: "completed", details: ledger.details ?? undefined };
    }

    const start = Date.now();
    try {
      const stats = await runCertifiedPayrollBackfill({ orgFilter, dryRun });
      return {
        status: "completed",
        details: {
          orgFilter: orgFilter ?? "*",
          dryRun,
          inserted: stats.inserted,
          alreadyPresent: stats.alreadyPresent,
          missingPayRun: stats.missingPayRun,
          skippedNonMatching: stats.skippedNonMatching,
          totalListed: stats.totalListed,
          orgsScanned: stats.orgsScanned,
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
