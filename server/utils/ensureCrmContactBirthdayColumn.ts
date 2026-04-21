import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure the crm_contacts table has the typed `birthday` column the CSV
 * importer writes when a column is mapped to the new "birthday" target.
 * Idempotent — safe to run on every cold start.
 */
export async function ensureCrmContactBirthdayColumn(): Promise<void> {
  await db.execute(sql`ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "birthday" date`);
}
