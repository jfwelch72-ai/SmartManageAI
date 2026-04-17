import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensurePayrollFormVariantColumn(): Promise<void> {
  const enumExists = await db.execute(sql`
    SELECT 1 FROM pg_type WHERE typname = 'payroll_form_variant'
  `);
  if (enumExists.rows.length === 0) {
    await db.execute(sql`
      CREATE TYPE payroll_form_variant AS ENUM (
        'WH_347', 'ODOT_CA_D_9C', 'CALTRANS_CEM_2502', 'TXDOT', 'FDOT', 'GENERIC'
      )
    `);
    console.log("[migration] payroll_form_variant enum — created");
  }

  const colExists = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'payroll_form_variant'
  `);
  if (colExists.rows.length === 0) {
    await db.execute(sql`
      ALTER TABLE projects
      ADD COLUMN payroll_form_variant payroll_form_variant NOT NULL DEFAULT 'WH_347'
    `);
    console.log("[migration] projects.payroll_form_variant — applied");
  }
}
