import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1409 — mirrors migrations/0053_wage_decision_rate_changes.sql.
 * Creates `wage_decision_rate_changes` so the project prevailing wage
 * panel can flag classifications whose rate changed in the most recent
 * Davis-Bacon stale-refresh sweep (`processStaleWageDecisions`).
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensureWageDecisionRateChanges(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `CREATE TABLE IF NOT EXISTS wage_decision_rate_changes (
         id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
         organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         decision_number text NOT NULL,
         classification text NOT NULL,
         change_kind text NOT NULL,
         old_base_rate numeric(10, 2),
         new_base_rate numeric(10, 2),
         old_fringe_rate numeric(10, 2),
         new_fringe_rate numeric(10, 2),
         old_total_rate numeric(10, 2),
         new_total_rate numeric(10, 2),
         detected_at timestamp NOT NULL DEFAULT now(),
         acknowledged_at timestamp,
         acknowledged_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
         created_at timestamp NOT NULL DEFAULT now(),
         updated_at timestamp NOT NULL DEFAULT now()
       )`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS wage_decision_rate_changes_org_decision_idx ON wage_decision_rate_changes(organization_id, decision_number)`,
    ));
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS wage_decision_rate_changes_org_decision_class_uniq ON wage_decision_rate_changes(organization_id, decision_number, classification)`,
    ));
    console.log("[migration] wage_decision_rate_changes ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure wage_decision_rate_changes:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
