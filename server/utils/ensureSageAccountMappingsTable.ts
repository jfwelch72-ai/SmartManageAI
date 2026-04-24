import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1600 — mirrors migrations/0057_sage_account_mappings.sql.
 * Creates `sage_account_mappings` so admins can map SmartManageAI cost
 * codes onto Sage Intacct GL accounts the same way the QBO mapping
 * panel does. Idempotent — safe to run on every boot.
 */
export async function ensureSageAccountMappingsTable(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `CREATE TABLE IF NOT EXISTS sage_account_mappings (
         id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
         organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         connection_id varchar NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
         cost_code text NOT NULL,
         sage_account_id text NOT NULL,
         sage_account_name text NOT NULL,
         mapping_type text NOT NULL DEFAULT 'cost_code',
         created_at timestamp NOT NULL DEFAULT now(),
         updated_at timestamp NOT NULL DEFAULT now()
       )`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS sage_account_mappings_org_idx ON sage_account_mappings(organization_id)`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS sage_account_mappings_connection_idx ON sage_account_mappings(connection_id)`,
    ));
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS sage_account_mappings_unique ON sage_account_mappings(organization_id, connection_id, cost_code, mapping_type)`,
    ));
    console.log("[migration] sage_account_mappings ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure sage_account_mappings:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
