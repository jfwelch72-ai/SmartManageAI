import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensurePermitTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'project_permits') AS permits_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;
  if (row.permits_exist) {
    console.log("[migration] project_permits table — already present, skipped");
    return;
  }

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "permit_status" AS ENUM ('APPLIED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRED', 'RENEWED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "permit_type" AS ENUM ('BUILDING', 'DEMOLITION', 'EXCAVATION', 'ELECTRICAL', 'PLUMBING', 'MECHANICAL', 'FIRE_SAFETY', 'ENVIRONMENTAL', 'OCCUPANCY', 'CUSTOM');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "project_permits" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "permit_type" "permit_type" NOT NULL,
      "custom_type" text,
      "permit_number" text,
      "status" "permit_status" NOT NULL DEFAULT 'APPLIED',
      "issuing_authority" text,
      "applied_date" date,
      "issued_date" date,
      "expiry_date" date,
      "linked_inspection_ids" text,
      "linked_document_ids" text,
      "notes" text,
      "created_by_id" varchar NOT NULL REFERENCES "users"("id"),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_permits_project_id_idx" ON "project_permits"("project_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_permits_status_idx" ON "project_permits"("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_permits_expiry_date_idx" ON "project_permits"("expiry_date")`);

  console.log("[migration] project_permits table — created");
}
