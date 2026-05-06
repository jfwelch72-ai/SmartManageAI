import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1480 — mirrors migrations/0055_wage_decision_rate_change_acknowledgements.sql.
 * Creates the append-only history table that records every PM
 * acknowledgement of a Davis-Bacon rate-change flag (including
 * superseded ones the live `wage_decision_rate_changes` table can no
 * longer represent due to its (org, decision, classification) unique
 * constraint).
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensureWageDecisionRateChangeAcknowledgements(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `CREATE TABLE IF NOT EXISTS wage_decision_rate_change_acknowledgements (
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
         detected_at timestamp NOT NULL,
         acknowledged_at timestamp NOT NULL DEFAULT now(),
         acknowledged_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
         created_at timestamp NOT NULL DEFAULT now()
       )`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS wage_decision_rate_change_ack_org_decision_class_idx ON wage_decision_rate_change_acknowledgements(organization_id, decision_number, classification)`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS wage_decision_rate_change_ack_acknowledged_at_idx ON wage_decision_rate_change_acknowledgements(acknowledged_at)`,
    ));
    logInfo("[migration] wage_decision_rate_change_acknowledgements ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure wage_decision_rate_change_acknowledgements:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
