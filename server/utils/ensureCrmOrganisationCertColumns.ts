import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureCrmOrganisationCertColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE "crm_organisations" ADD COLUMN IF NOT EXISTS "primary_certification_type" text`);
  await db.execute(sql`ALTER TABLE "crm_organisations" ADD COLUMN IF NOT EXISTS "primary_certification_expiration" date`);
  await db.execute(sql`ALTER TABLE "crm_organisations" ADD COLUMN IF NOT EXISTS "certifications_summary" text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_organisations_primary_cert_idx" ON "crm_organisations" ("primary_certification_type")`);
}
