import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureScheduleBaselinesTable(): Promise<void> {
  const tableExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'schedule_baselines'
    ) AS exists
  `);
  const exists = (tableExists.rows[0] as { exists: boolean }).exists;

  if (!exists) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "schedule_baselines" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "schedule_id" varchar NOT NULL REFERENCES "project_schedules"("id") ON DELETE CASCADE,
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "locked_at" timestamp NOT NULL DEFAULT now(),
        "locked_by_user_id" varchar REFERENCES "users"("id"),
        "is_archived" boolean NOT NULL DEFAULT false,
        "schedule_start_date" date,
        "schedule_end_date" date,
        "task_snapshots_json" text NOT NULL DEFAULT '[]',
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "schedule_baselines_schedule_idx" ON "schedule_baselines" ("schedule_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "schedule_baselines_org_idx" ON "schedule_baselines" ("organization_id")`);
    console.log("[migration] schedule_baselines — table created");
  }

  const columnCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'project_schedules'
        AND column_name = 'active_baseline_id'
    ) AS exists
  `);
  const colExists = (columnCheck.rows[0] as { exists: boolean }).exists;
  if (!colExists) {
    await db.execute(sql`ALTER TABLE "project_schedules" ADD COLUMN "active_baseline_id" varchar`);
    console.log("[migration] project_schedules.active_baseline_id — column added");
  }
}
