import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

/**
 * Task #2848 / #2833 — Workflow & Lifecycle Gap Remediation.
 *
 * migration 0118_workflow_lifecycle_gaps.sql adds three enum values that
 * cannot be synthesized by reconcileSchemaDrift (which creates missing
 * enum types but never appends values to existing ones):
 *
 *   - `SUBMITTAL` on `workflow_entity_type` — enables workflow routing for
 *     submittal documents.
 *
 *   - `WARRANTY_CASE` on `workflow_entity_type` — enables workflow routing
 *     for warranty case records.
 *
 *   - `INVENTORY_ADJUSTMENT` on `approval_entity_type` — enables the
 *     approval pipeline for inventory adjustment transactions.
 *
 * All three use `IF NOT EXISTS` so repeated calls are idempotent.
 */
export async function ensureWorkflowLifecycleEnumValues(): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        `ALTER TYPE workflow_entity_type ADD VALUE IF NOT EXISTS 'SUBMITTAL'`,
      ),
    );
    await db.execute(
      sql.raw(
        `ALTER TYPE workflow_entity_type ADD VALUE IF NOT EXISTS 'WARRANTY_CASE'`,
      ),
    );
    await db.execute(
      sql.raw(
        `ALTER TYPE approval_entity_type ADD VALUE IF NOT EXISTS 'INVENTORY_ADJUSTMENT'`,
      ),
    );
    logInfo(
      "[migration] workflow_entity_type + approval_entity_type — workflow lifecycle enum values ready",
    );
  } catch (err) {
    logError(err, { helper: "ensureWorkflowLifecycleEnumValues" });
    throw err;
  }
}
