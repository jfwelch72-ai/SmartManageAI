import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1164 — `dot_pay_item_match_history` records each accept/reject
 * decision on an auto-suggested DOT pay item from bid-tab import. The
 * matcher reads it back to boost frequently-used items per organization
 * (and per agency where known) so estimators don't keep re-confirming the
 * same suggestions. Mirrors `migrations/0044_dot_pay_item_match_history.sql`.
 */
export async function ensureDotPayItemMatchHistory(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dot_pay_item_match_history (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        agency_id varchar REFERENCES dot_agencies(id) ON DELETE SET NULL,
        pay_item_id varchar NOT NULL REFERENCES dot_pay_items(id) ON DELETE CASCADE,
        description_normalized text NOT NULL,
        description_raw text NOT NULL,
        accepted boolean NOT NULL,
        user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_desc_idx
        ON dot_pay_item_match_history(organization_id, description_normalized)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_item_idx
        ON dot_pay_item_match_history(organization_id, pay_item_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_agency_idx
        ON dot_pay_item_match_history(organization_id, agency_id)
    `);
    // Task #1247 — batch_id groups all rows recorded by a single bid-tab
    // import so the user can one-click "undo" the whole batch from the
    // post-import toast. Nullable for back-compat with existing rows.
    await db.execute(sql`
      ALTER TABLE dot_pay_item_match_history
        ADD COLUMN IF NOT EXISTS batch_id varchar
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_batch_idx
        ON dot_pay_item_match_history(organization_id, batch_id)
    `);
    console.log("[migration] dot_pay_item_match_history table ready");
  } catch (err) {
    logError(
      "[migration] ensureDotPayItemMatchHistory failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
