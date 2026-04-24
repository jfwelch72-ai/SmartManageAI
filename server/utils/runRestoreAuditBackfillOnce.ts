// Task #1871 — One-shot backfill that promotes legacy restore-style
// audit_log rows (written before Task #1847 introduced the dedicated
// `RESTORE` audit_action enum value) to action='RESTORE' so auditors
// filtering for "every restore on this entity" pick them up alongside
// the new first-class rows.
//
// Two legacy shapes are matched, both gated by entity_type =
// 'planDocumentMarkup' and the shim `op: "restore"` field that the
// pre-#1847 routes always wrote into newValue:
//
//   * Per-id markup restore route   — `action: "UPDATE"` +
//     `new_value: { op: "restore", deletedAt: null }`.
//   * Bulk cached-snapshot restore  — `action: "CREATE"` +
//     `new_value: { op: "restore", requested, inserted, ids }`.
//
// The backfill flips `action` to RESTORE and strips the now-meaningless
// `op` shim from the JSON payload (the action itself carries that
// meaning). It does NOT touch the bulk soft-delete restore route's
// rows — those use `op: "restoreBulk"` and are part of a separate flow
// that wasn't covered by #1847.
//
// Idempotent: the WHERE clause excludes rows already at action='RESTORE',
// so a re-run after the first deploy is a no-op zero-row UPDATE. A
// `one_shot_jobs` ledger row gates the work at startup so subsequent
// boots are a single SELECT, and a `one_shot_job_runs` coverage row is
// inserted after each successful run so the admin "One-shot jobs"
// history shows when the backfill ran and how many rows it touched.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";
import { oneShotJobRuns } from "@shared/schema";
import {
  registerOneShotJob,
  type OneShotJobRunResult,
} from "./oneShotJobRegistry";

export const JOB_NAME = "backfill_restore_style_audit_rows_v1";

export interface RestoreAuditBackfillStats {
  rowsUpdated: number;
}

export type RunRestoreAuditBackfillOnceResult =
  | { status: "skipped_already_complete" }
  | { status: "completed"; elapsedMs: number; stats: RestoreAuditBackfillStats }
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

/**
 * Promote qualifying audit_log rows to action='RESTORE' and strip the
 * `op: "restore"` shim from the JSON payload. Returns the number of
 * rows updated. Safe to call repeatedly — already-promoted rows are
 * filtered out by `action != 'RESTORE'`.
 *
 * The pre-`new_value::jsonb` text LIKE filter narrows the candidate
 * set to rows whose newValue plausibly contains the `op` field before
 * we attempt a JSONB cast. Combined with the entity_type filter
 * (planDocumentMarkup audit rows are always JSON-serialized via
 * `logAudit(..., newValue: JSON.stringify(...))`), this keeps the
 * cast safe in practice while still being defensive against any
 * stray non-JSON rows.
 */
export async function backfillRestoreStyleAuditRows(): Promise<RestoreAuditBackfillStats> {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id, new_value
      FROM audit_log
      WHERE entity_type = 'planDocumentMarkup'
        AND action <> 'RESTORE'
        AND new_value IS NOT NULL
        AND new_value LIKE '%"op"%'
        AND new_value LIKE '%"restore"%'
    ),
    qualifying AS (
      SELECT id, (new_value::jsonb) AS payload
      FROM candidates
      WHERE (new_value::jsonb ->> 'op') = 'restore'
    )
    UPDATE audit_log a
    SET
      action = 'RESTORE',
      new_value = CASE
        WHEN (q.payload - 'op') = '{}'::jsonb THEN NULL
        ELSE (q.payload - 'op')::text
      END
    FROM qualifying q
    WHERE a.id = q.id
    RETURNING a.id
  `);
  return { rowsUpdated: result.rows.length };
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
      `[migration] restore_audit_backfill — failed to record one_shot_job_runs coverage row (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function runRestoreAuditBackfillOnce(): Promise<RunRestoreAuditBackfillOnceResult> {
  try {
    await ensureOneShotJobsTable();

    if (await isJobComplete(JOB_NAME)) {
      logInfo("[migration] restore_audit_backfill — already completed, skipped");
      return { status: "skipped_already_complete" };
    }

    const startedAt = new Date();
    const start = Date.now();
    let stats: RestoreAuditBackfillStats;
    try {
      stats = await backfillRestoreStyleAuditRows();
    } catch (err) {
      const elapsed = Date.now() - start;
      const finishedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      // Don't mark the ledger on failure — let the next startup retry.
      logError(
        "[migration] restore_audit_backfill — run failed; will retry on next startup",
        {},
        err instanceof Error ? err : new Error(message),
      );
      await recordCoverageRow("failed", elapsed, startedAt, finishedAt, null, message);
      return { status: "failed", error: message };
    }

    const elapsed = Date.now() - start;
    const finishedAt = new Date();
    await markJobComplete(JOB_NAME, {
      rowsUpdated: stats.rowsUpdated,
      elapsedMs: elapsed,
    });
    await recordCoverageRow(
      "completed",
      elapsed,
      startedAt,
      finishedAt,
      { rowsUpdated: stats.rowsUpdated },
      null,
    );
    logInfo(
      `[migration] restore_audit_backfill — completed in ${elapsed}ms ` +
        `(rowsUpdated=${stats.rowsUpdated})`,
    );
    return { status: "completed", elapsedMs: elapsed, stats };
  } catch (err) {
    logWarn(
      `[migration] restore_audit_backfill — bookkeeping failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { status: "bookkeeping_error", error: err instanceof Error ? err.message : String(err) };
  }
}

// Register in the generic one-shot registry so the admin "One-shot
// jobs" panel can re-run the backfill without a bespoke endpoint.
// `runOneShotJob` clears the ledger row before invoking us, so the
// once-runner will actually re-execute the UPDATE rather than
// short-circuiting on the SELECT check. The structured result is
// mapped onto the registry's normalized OneShotJobRunResult shape so
// the admin UI can show stats / error reason.
registerOneShotJob({
  name: JOB_NAME,
  title: "Restore-style audit row backfill",
  description:
    "Promotes legacy plan-document-markup audit_log rows that recorded a " +
    "restore via the pre-#1847 `op: \"restore\"` JSON shim to the dedicated " +
    "`action='RESTORE'` enum value, so auditors filtering by action pick up " +
    "older entries alongside new ones. Idempotent. (Task #1871)",
  run: async (): Promise<OneShotJobRunResult> => {
    const result = await runRestoreAuditBackfillOnce();
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
