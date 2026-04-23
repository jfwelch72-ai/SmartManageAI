import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1181: ensure the organization_payroll_settings table has the per-org
 * certified payroll digest schedule columns (cadence, weekday, hour, timezone,
 * lastSentAt) so admins can pick their own send day/time/timezone instead of
 * relying on the previously hard-coded Monday 8am UTC weekly run.
 *
 * Defaults are chosen to preserve the original behavior: cadence='WEEKLY',
 * weekday=1 (Monday), hour=8, timezone='UTC', lastSentAt=NULL.
 */
export async function ensureCertifiedPayrollDigestScheduleColumns(): Promise<void> {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'organization_payroll_settings'
      AND column_name IN (
        'certified_payroll_digest_cadence',
        'certified_payroll_digest_weekday',
        'certified_payroll_digest_hour',
        'certified_payroll_digest_timezone',
        'certified_payroll_digest_last_sent_at'
      )
  `);
  const present = new Set(
    (cols.rows as Array<{ column_name: string }>).map((r) => r.column_name),
  );

  if (!present.has("certified_payroll_digest_cadence")) {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
      ADD COLUMN certified_payroll_digest_cadence text NOT NULL DEFAULT 'WEEKLY'
    `);
    console.log("[migration] organization_payroll_settings.certified_payroll_digest_cadence — applied");
  }
  if (!present.has("certified_payroll_digest_weekday")) {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
      ADD COLUMN certified_payroll_digest_weekday integer NOT NULL DEFAULT 1
    `);
    console.log("[migration] organization_payroll_settings.certified_payroll_digest_weekday — applied");
  }
  if (!present.has("certified_payroll_digest_hour")) {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
      ADD COLUMN certified_payroll_digest_hour integer NOT NULL DEFAULT 8
    `);
    console.log("[migration] organization_payroll_settings.certified_payroll_digest_hour — applied");
  }
  if (!present.has("certified_payroll_digest_timezone")) {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
      ADD COLUMN certified_payroll_digest_timezone text NOT NULL DEFAULT 'UTC'
    `);
    console.log("[migration] organization_payroll_settings.certified_payroll_digest_timezone — applied");
  }
  if (!present.has("certified_payroll_digest_last_sent_at")) {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
      ADD COLUMN certified_payroll_digest_last_sent_at timestamp
    `);
    console.log("[migration] organization_payroll_settings.certified_payroll_digest_last_sent_at — applied");
  }
}
