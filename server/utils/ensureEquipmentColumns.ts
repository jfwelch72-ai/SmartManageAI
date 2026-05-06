import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureEquipmentColumns(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'equipment' AND column_name = 'depreciation_method'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "depreciation_method" text`);
      await db.execute(sql`ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "useful_life_years" integer`);
      await db.execute(sql`ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "salvage_value" numeric(12, 2)`);
      await db.execute(sql`ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "in_service_date" date`);
      logInfo("[migration] equipment depreciation columns — applied");
    } else {
      logInfo("[migration] equipment depreciation columns — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure equipment depreciation columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
