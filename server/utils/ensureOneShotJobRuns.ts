import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1528 — mirrors migrations/0056_one_shot_job_runs.sql.
 * Creates `one_shot_job_runs`, the structured history table that
 * captures every admin "Clear ledger & re-run" invocation of a
 * one-shot job. Replaces the previous practice of regex-parsing the
 * free-form `audit_log.new_value` string in the admin panel.
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensureOneShotJobRuns(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `CREATE TABLE IF NOT EXISTS one_shot_job_runs (
         id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
         job_name text NOT NULL,
         run_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
         status text NOT NULL,
         ledger_cleared boolean NOT NULL,
         duration_ms integer NOT NULL,
         error_text text,
         started_at timestamp NOT NULL,
         finished_at timestamp NOT NULL,
         created_at timestamp NOT NULL DEFAULT now()
       )`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS one_shot_job_runs_job_started_idx ON one_shot_job_runs(job_name, started_at)`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS one_shot_job_runs_started_at_idx ON one_shot_job_runs(started_at)`,
    ));
    // Task #1871 — additive details column for one-shot runs that
    // surface counts / stats (e.g. the restore-style audit backfill
    // recording how many audit_log rows it promoted). Idempotent
    // ADD COLUMN IF NOT EXISTS keeps long-lived deployments happy.
    await db.execute(sql.raw(
      `ALTER TABLE one_shot_job_runs ADD COLUMN IF NOT EXISTS details jsonb`,
    ));
    logInfo("[migration] one_shot_job_runs ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure one_shot_job_runs:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
