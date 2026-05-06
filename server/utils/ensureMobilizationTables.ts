import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureMobilizationTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'mobilization_checklists') AS checklists_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'mobilization_checklist_items') AS items_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'method_statements') AS statements_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;
  if (row.checklists_exist && row.items_exist && row.statements_exist) {
    logInfo("[migration] mobilization tables — already present, skipped");
    return;
  }

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "mobilization_checklist_status" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "mobilization_item_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "method_statement_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  if (!row.checklists_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "mobilization_checklists" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" VARCHAR NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "status" "mobilization_checklist_status" NOT NULL DEFAULT 'DRAFT',
        "completed_at" TIMESTAMP,
        "completed_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "created_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  if (!row.items_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "mobilization_checklist_items" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "checklist_id" VARCHAR NOT NULL REFERENCES "mobilization_checklists"("id") ON DELETE CASCADE,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "category" TEXT NOT NULL DEFAULT 'General',
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "status" "mobilization_item_status" NOT NULL DEFAULT 'PENDING',
        "assigned_to_user_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "assigned_to_name" TEXT,
        "due_date" TIMESTAMP,
        "completed_at" TIMESTAMP,
        "completed_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "notes" TEXT,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  if (!row.statements_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "method_statements" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" VARCHAR NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "work_activity" TEXT NOT NULL,
        "sequence_of_operations" TEXT,
        "equipment_resources" TEXT,
        "hazards" TEXT,
        "control_measures" TEXT,
        "ppe" TEXT,
        "emergency_procedures" TEXT,
        "status" "method_statement_status" NOT NULL DEFAULT 'DRAFT',
        "linked_schedule_task_id" VARCHAR,
        "linked_safety_checklist_id" VARCHAR,
        "submitted_at" TIMESTAMP,
        "submitted_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "approved_at" TIMESTAMP,
        "approved_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "rejected_at" TIMESTAMP,
        "rejection_reason" TEXT,
        "created_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  logInfo("[migration] mobilization tables — created successfully");
}
