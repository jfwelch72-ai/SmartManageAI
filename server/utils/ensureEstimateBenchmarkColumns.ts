import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #3038 — Refresh-benchmarks: adds `ai_draft_benchmark_summary` and
 * `ai_draft_overall_confidence` text columns to the `estimates` table so the
 * narrow Phase-4-only benchmark re-run can persist its output without
 * touching any line items.  Idempotent (ADD COLUMN IF NOT EXISTS).
 */
export async function ensureEstimateBenchmarkColumns(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE estimates ADD COLUMN IF NOT EXISTS ai_draft_benchmark_summary TEXT`,
  );
  await db.execute(
    sql`ALTER TABLE estimates ADD COLUMN IF NOT EXISTS ai_draft_overall_confidence TEXT`,
  );
  logInfo("[migration] estimates.ai_draft_benchmark_summary / ai_draft_overall_confidence — columns ready");
}
