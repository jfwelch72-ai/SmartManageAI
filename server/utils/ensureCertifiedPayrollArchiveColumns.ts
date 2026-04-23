import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1117: ensure the certified_payroll_reports table has the archive
 * columns (archived_at, archived_by_id, archive_reason) and supporting index
 * so admins can soft-hide obsolete reports from the org-wide history page.
 */
export async function ensureCertifiedPayrollArchiveColumns(): Promise<void> {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'certified_payroll_reports'
      AND column_name IN ('archived_at', 'archived_by_id', 'archive_reason')
  `);
  const present = new Set(
    (cols.rows as Array<{ column_name: string }>).map((r) => r.column_name),
  );

  if (!present.has("archived_at")) {
    await db.execute(sql`ALTER TABLE certified_payroll_reports ADD COLUMN archived_at timestamp`);
    console.log("[migration] certified_payroll_reports.archived_at — applied");
  }
  if (!present.has("archived_by_id")) {
    await db.execute(sql`
      ALTER TABLE certified_payroll_reports
      ADD COLUMN archived_by_id varchar REFERENCES users(id)
    `);
    console.log("[migration] certified_payroll_reports.archived_by_id — applied");
  }
  if (!present.has("archive_reason")) {
    await db.execute(sql`ALTER TABLE certified_payroll_reports ADD COLUMN archive_reason text`);
    console.log("[migration] certified_payroll_reports.archive_reason — applied");
  }

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS certified_payroll_reports_archived_at_idx
      ON certified_payroll_reports (archived_at)
  `);
}
