import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #3046 — Benchmark refresh history: creates the
 * `estimate_benchmark_refreshes` table so each "Refresh Benchmarks" action
 * is stored as an immutable row instead of overwriting the estimate columns.
 * Idempotent (CREATE TABLE IF NOT EXISTS).
 */
export async function ensureEstimateBenchmarkRefreshesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS estimate_benchmark_refreshes (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      estimate_id VARCHAR NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      benchmark_summary TEXT NOT NULL,
      overall_confidence TEXT,
      created_by_id VARCHAR NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS estimate_benchmark_refreshes_estimate_created_idx
    ON estimate_benchmark_refreshes (estimate_id, created_at)
  `);
  logInfo("[migration] estimate_benchmark_refreshes table — ensured");
}
