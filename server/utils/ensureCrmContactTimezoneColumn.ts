import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure the `crm_contacts.timezone` column exists.
 *
 * The Drizzle schema (`shared/schema/features.ts`) defines `timezone text`
 * on `crm_contacts`, and downstream code paths (the CRM CSV import worker
 * via Drizzle's auto-generated RETURNING clause, the
 * `ensureCrmContactTimezoneBackfill` startup step, and per-contact
 * timezone inference) all assume the column exists. Older databases
 * created before the column was added are missing it, which causes every
 * contact insert to fail with `column "timezone" does not exist` and
 * leaves the contact CSV import reporting 0 inserts / N errors.
 *
 * This idempotent migration adds the column to match the schema. It must
 * run before `ensureCrmContactTimezoneBackfill`.
 */
export async function ensureCrmContactTimezoneColumn(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "timezone" text`,
  );
}
