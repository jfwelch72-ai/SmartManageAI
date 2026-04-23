import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1115: SWPPP inspections need an explicit open/resolved state plus
 * resolver attribution so inspectors can close out corrective actions and
 * the UI can highlight overdue open items. Backfills resolved status from
 * the legacy `corrective_action_completed_at` timestamp.
 */
export async function ensureSwpppCorrectiveActionStatus(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE swppp_inspections
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OPEN',
        ADD COLUMN IF NOT EXISTS resolved_at timestamp,
        ADD COLUMN IF NOT EXISTS resolved_by_id varchar REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS resolution_notes text
    `);
    await db.execute(sql`
      UPDATE swppp_inspections
         SET status = 'RESOLVED',
             resolved_at = corrective_action_completed_at
       WHERE corrective_action_completed_at IS NOT NULL
         AND status = 'OPEN'
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS swppp_status_idx ON swppp_inspections(status)`);
    console.log("[migration] swppp_inspections status/resolved columns ready");
  } catch (err) {
    logError(
      "[migration] ensureSwpppCorrectiveActionStatus failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
