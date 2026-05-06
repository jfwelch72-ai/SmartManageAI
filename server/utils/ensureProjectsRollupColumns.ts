import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureProjectsRollupColumns(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'program_id')::boolean AS program_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'division_id')::boolean AS division_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'primary_trade_type')::boolean AS trade_exists
    `);
    const row = colCheck.rows[0] as { program_exists: boolean; division_exists: boolean; trade_exists: boolean };

    if (row.program_exists && row.division_exists && row.trade_exists) {
      logInfo("[migration] projects rollup columns — already present, skipped");
      return;
    }

    if (!row.program_exists) {
      await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "program_id" text`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "projects_program_id_idx" ON "projects" ("program_id")`);
    }
    if (!row.division_exists) {
      await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "division_id" text`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "projects_division_id_idx" ON "projects" ("division_id")`);
    }
    if (!row.trade_exists) {
      await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "primary_trade_type" trade_type`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "projects_primary_trade_type_idx" ON "projects" ("primary_trade_type")`);
    }
    logInfo("[migration] projects rollup columns — applied");
  } catch (err) {
    logError("[migration] Failed to ensure projects rollup columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
