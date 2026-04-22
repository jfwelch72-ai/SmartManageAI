import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureProjectKpiSnapshotsTable(): Promise<void> {
  try {
    const check = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'project_kpi_snapshots'
      )::boolean AS exists
    `);
    if (check.rows[0]?.exists === true) {
      console.log("[migration] project_kpi_snapshots — already present, skipped");
      return;
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "project_kpi_snapshots" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar REFERENCES "organizations"("id") ON DELETE CASCADE,
        "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "week_start" date NOT NULL,
        "health" integer NOT NULL DEFAULT 0,
        "spi" numeric(8,3) NOT NULL DEFAULT 1,
        "cpi" numeric(8,3) NOT NULL DEFAULT 1,
        "burn" numeric(14,2) NOT NULL DEFAULT 0,
        "variance_pct" numeric(8,2) NOT NULL DEFAULT 0,
        "schedule_pct" integer NOT NULL DEFAULT 0,
        "expected_pct" integer NOT NULL DEFAULT 0,
        "open_rfis" integer NOT NULL DEFAULT 0,
        "open_cos" integer NOT NULL DEFAULT 0,
        "open_punch" integer NOT NULL DEFAULT 0,
        "captured_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_kpi_snap_project_idx" ON "project_kpi_snapshots" ("project_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_kpi_snap_week_idx" ON "project_kpi_snapshots" ("week_start")`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "project_kpi_snap_project_week_uniq" ON "project_kpi_snapshots" ("project_id", "week_start")`);

    console.log("[migration] project_kpi_snapshots — applied");
  } catch (err) {
    logError("[migration] Failed to ensure project_kpi_snapshots table:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
