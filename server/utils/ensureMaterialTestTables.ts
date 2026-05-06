import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureMaterialTestTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'material_tests') AS mt_exist,
           EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ppe_compliance_logs') AS ppe_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;

  if (!row.mt_exist) {
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "material_test_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "material_test_type" AS ENUM ('CONCRETE_CYLINDER_BREAK', 'SOIL_COMPACTION', 'STEEL_TENSILE', 'AGGREGATE_GRADATION', 'ASPHALT_CORE', 'MOISTURE_CONTENT', 'REBAR_MILL_CERT', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "material_tests" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "test_number" text NOT NULL,
        "material_type" text NOT NULL,
        "test_type" "material_test_type" NOT NULL,
        "custom_test_type" text,
        "sample_id" text,
        "test_date" date NOT NULL,
        "lab_name" text,
        "test_results" text,
        "status" "material_test_status" NOT NULL DEFAULT 'PENDING',
        "spec_requirement" text,
        "report_file_url" text,
        "report_file_name" text,
        "notes" text,
        "punch_list_item_id" varchar REFERENCES "punch_list_items"("id") ON DELETE SET NULL,
        "created_by_id" varchar NOT NULL REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_tests_project_id_idx" ON "material_tests"("project_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_tests_status_idx" ON "material_tests"("status")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_tests_test_type_idx" ON "material_tests"("test_type")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "material_tests_test_date_idx" ON "material_tests"("test_date")`);

    logInfo("[migration] material_tests table — created");
  } else {
    logInfo("[migration] material_tests table — already present, skipped");
  }

  if (!row.ppe_exist) {
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "ppe_type" AS ENUM ('HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'EYE_PROTECTION', 'STEEL_TOES', 'FALL_PROTECTION');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "ppe_compliance_status" AS ENUM ('COMPLIANT', 'VIOLATION');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "ppe_compliance_logs" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "check_date" date NOT NULL,
        "worker_name" text NOT NULL,
        "worker_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
        "ppe_type" "ppe_type" NOT NULL,
        "compliance_status" "ppe_compliance_status" NOT NULL,
        "notes" text,
        "checked_by_id" varchar NOT NULL REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "ppe_compliance_logs_project_id_idx" ON "ppe_compliance_logs"("project_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "ppe_compliance_logs_check_date_idx" ON "ppe_compliance_logs"("check_date")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "ppe_compliance_logs_status_idx" ON "ppe_compliance_logs"("compliance_status")`);

    logInfo("[migration] ppe_compliance_logs table — created");
  } else {
    logInfo("[migration] ppe_compliance_logs table — already present, skipped");
  }

  await db.execute(sql`
    ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "safety_officer_id" varchar REFERENCES "users"("id") ON DELETE SET NULL
  `);
}
