import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2400 — AI Estimator provenance + exclusion tables.
 *
 * Idempotent startup migration that creates:
 *   1. `ai_estimator_rate_samples` — one row per contributing sample so
 *      senior estimators can drill down to see which project/bid/line
 *      item each learned-rate value came from.
 *   2. `ai_estimator_excluded_sources` — projects (and optionally bids)
 *      that should be excluded from the learning pool, toggled by
 *      senior estimators with canManageAiEstimator permission.
 *
 * Safe to run on every boot — both uses CREATE TABLE IF NOT EXISTS.
 */
export async function ensureAiEstimatorProvenanceTables(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ai_estimator_rate_samples (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        learned_rate_id varchar REFERENCES ai_estimator_learned_rates(id) ON DELETE CASCADE,
        cost_code text NOT NULL,
        metric text NOT NULL,
        unit text NOT NULL,
        value decimal(14,4) NOT NULL,
        source_type text NOT NULL,
        source_row_id varchar,
        project_id varchar REFERENCES projects(id) ON DELETE SET NULL,
        bid_id varchar REFERENCES bids(id) ON DELETE SET NULL,
        recorded_at timestamp NOT NULL DEFAULT now()
      );
    `));

    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS ai_estimator_rate_samples_org_idx
        ON ai_estimator_rate_samples (organization_id);
      CREATE INDEX IF NOT EXISTS ai_estimator_rate_samples_rate_idx
        ON ai_estimator_rate_samples (learned_rate_id);
      CREATE INDEX IF NOT EXISTS ai_estimator_rate_samples_project_idx
        ON ai_estimator_rate_samples (project_id);
      CREATE INDEX IF NOT EXISTS ai_estimator_rate_samples_cost_code_idx
        ON ai_estimator_rate_samples (organization_id, cost_code, metric, unit);
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ai_estimator_excluded_sources (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id varchar REFERENCES projects(id) ON DELETE CASCADE,
        bid_id varchar REFERENCES bids(id) ON DELETE CASCADE,
        reason text,
        excluded_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        excluded_at timestamp NOT NULL DEFAULT now()
      );
    `));

    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS ai_estimator_excluded_sources_org_idx
        ON ai_estimator_excluded_sources (organization_id);
      CREATE INDEX IF NOT EXISTS ai_estimator_excluded_sources_project_idx
        ON ai_estimator_excluded_sources (project_id);
      CREATE UNIQUE INDEX IF NOT EXISTS ai_estimator_excluded_sources_uniq
        ON ai_estimator_excluded_sources (organization_id, project_id)
        WHERE project_id IS NOT NULL;
    `));

    logInfo("[migration] ai_estimator_provenance_tables — tables ready");
  } catch (err) {
    logError("[migration] Failed to ensure AI estimator provenance tables", {}, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
