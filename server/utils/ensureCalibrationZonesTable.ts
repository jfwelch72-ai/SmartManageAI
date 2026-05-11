import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2780 — Multi-region calibration zones in Takeoff workspace.
 *
 * Idempotent startup helper that mirrors `migrations/0116_calibration_zones.sql`:
 * creates the `takeoff_sheet_calibration_zones` table that stores named
 * calibration regions (each with its own px-per-foot scale) layered on top
 * of a takeoff sheet.
 *
 * Note: `CREATE TABLE IF NOT EXISTS` can still raise a 23505 unique_violation
 * on `pg_type_typname_nsp_index` when the table's composite type already exists
 * in the catalog (e.g. after a prior successful run). We catch that specific code
 * and treat it as "already exists — skip" to keep boot idempotent.
 */
export async function ensureCalibrationZonesTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS takeoff_sheet_calibration_zones (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        polygon_points JSONB NOT NULL,
        px_per_foot DOUBLE PRECISION NOT NULL,
        created_by_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS calibration_zones_sheet_idx ON takeoff_sheet_calibration_zones(sheet_id)`);

    logInfo("[migration] takeoff_sheet_calibration_zones table ready");
  } catch (err: unknown) {
    const pgErr = err as { code?: string; constraint?: string };
    if (
      pgErr?.code === "23505" &&
      pgErr?.constraint === "pg_type_typname_nsp_index"
    ) {
      logInfo("[migration] takeoff_sheet_calibration_zones already exists, skipped");
      return;
    }
    logError(err, { helper: "ensureCalibrationZonesTable" });
    throw err;
  }
}
