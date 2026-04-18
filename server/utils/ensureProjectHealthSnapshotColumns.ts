import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureProjectHealthSnapshotColumns(): Promise<void> {
  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'project_health_snapshots'
      )::boolean AS table_exists
    `);
    if (tableCheck.rows[0]?.table_exists !== true) {
      console.log("[migration] project_health_snapshots compliance_score — table absent, skipped");
      return;
    }

    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'project_health_snapshots' AND column_name = 'compliance_score'
      )::boolean AS col_exists
    `);
    if (colCheck.rows[0]?.col_exists === true) {
      console.log("[migration] project_health_snapshots compliance_score — already present, skipped");
      return;
    }

    await db.execute(sql`ALTER TABLE "project_health_snapshots" ADD COLUMN IF NOT EXISTS "compliance_score" integer`);
    console.log("[migration] project_health_snapshots compliance_score — applied");
  } catch (err) {
    logError("[migration] Failed to ensure project_health_snapshots columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
