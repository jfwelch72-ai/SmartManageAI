import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1178: ensure the organization_payroll_settings table has the
 * `archived_report_retention_days` column used by the nightly auto-purge
 * job to hard-delete obsolete archived certified payroll PDFs.
 *
 * Default 1095 days (~3 years) matches federal Davis-Bacon record
 * retention. 0 disables the auto-purge for that org.
 */
export async function ensureCertifiedPayrollArchivedRetention(): Promise<void> {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'organization_payroll_settings'
      AND column_name = 'archived_report_retention_days'
  `);
  const present = (cols.rows as Array<{ column_name: string }>).length > 0;
  if (!present) {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
        ADD COLUMN archived_report_retention_days integer NOT NULL DEFAULT 1095
    `);
    logInfo("[migration] organization_payroll_settings.archived_report_retention_days — applied");
  }
}
