// Task #2783 — Track demo request leads inside the CRM.
// Idempotent startup helper: creates the demo_lead_crm_config singleton table
// so Super Admins can configure which CRM organization receives demo leads.
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

export async function ensureDemoLeadCrmConfig(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS demo_lead_crm_config (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        target_org_id VARCHAR,
        initial_stage TEXT NOT NULL DEFAULT 'LEAD',
        crm_org_type TEXT NOT NULL DEFAULT 'CONTRACTOR',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      INSERT INTO demo_lead_crm_config (id) VALUES ('singleton')
      ON CONFLICT (id) DO NOTHING
    `);

    logInfo("[migration] demo_lead_crm_config table ready");
  } catch (err) {
    logError(err, { helper: "ensureDemoLeadCrmConfig" });
    throw err;
  }
}
