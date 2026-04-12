import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureEstimateSubcontractorTables(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'organization_id'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    await db.execute(sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id VARCHAR REFERENCES organizations(id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notifications_org_user_read_idx ON notifications (organization_id, user_id, is_read)`);
    await db.execute(sql`
      UPDATE notifications n
      SET organization_id = u.organization_id
      FROM users u
      WHERE n.user_id = u.id
        AND n.organization_id IS NULL
        AND u.organization_id IS NOT NULL
    `);
    console.log(colAlreadyExists
      ? "[migration] notifications.organization_id — already present, skipped"
      : "[migration] notifications.organization_id — applied");
  } catch (err) {
    logError("[migration] Failed to ensure notifications.organization_id:", {}, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  try {
    const tblCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'estimate_line_item_subcontractors'
      )::boolean AS tbl_exists
    `);
    const tblAlreadyExists = tblCheck.rows[0]?.tbl_exists === true;

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS estimate_line_item_subcontractors (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        line_item_id VARCHAR NOT NULL REFERENCES estimate_line_items(id) ON DELETE CASCADE,
        subcontractor_quote_id VARCHAR NOT NULL REFERENCES bid_subcontractor_quotes(id) ON DELETE CASCADE,
        allocated_cost DECIMAL(12, 2) NOT NULL DEFAULT '0',
        is_selected BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS eli_sub_line_item_idx ON estimate_line_item_subcontractors(line_item_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS eli_sub_quote_idx ON estimate_line_item_subcontractors(subcontractor_quote_id)`);
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE estimate_line_item_subcontractors
          ADD CONSTRAINT eli_sub_unique_assignment UNIQUE(line_item_id, subcontractor_quote_id);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$
    `);
    console.log(tblAlreadyExists
      ? "[migration] estimate_line_item_subcontractors — already present, skipped"
      : "[migration] estimate_line_item_subcontractors — applied");
  } catch (err) {
    logError("[migration] Failed to ensure estimate_line_item_subcontractors:", {}, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
