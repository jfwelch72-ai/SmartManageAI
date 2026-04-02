import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureTakeoffEnhancements(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'quantity_categories' AND column_name = 'waste_factor'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`ALTER TABLE "quantity_categories" ADD COLUMN IF NOT EXISTS "waste_factor" double precision NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "quantity_categories" ADD COLUMN IF NOT EXISTS "unit_cost" double precision`);
      console.log("[migration] quantity_categories waste_factor/unit_cost — applied");
    } else {
      console.log("[migration] quantity_categories waste_factor/unit_cost — already present, skipped");
    }

    const deductionsCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'takeoff_measurements' AND column_name = 'deductions'
      )::boolean AS col_exists
    `);
    const deductionsExists = deductionsCheck.rows[0]?.col_exists === true;

    if (!deductionsExists) {
      await db.execute(sql`ALTER TABLE "takeoff_measurements" ADD COLUMN IF NOT EXISTS "deductions" text`);
      console.log("[migration] takeoff_measurements deductions — applied");
    } else {
      console.log("[migration] takeoff_measurements deductions — already present, skipped");
    }
  } catch (err) {
    console.error("[migration] Failed to ensure takeoff enhancement columns:", err);
  }
}
