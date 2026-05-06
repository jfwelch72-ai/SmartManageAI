import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #567: Add table_density column to user_settings so each user
 * can choose Compact / Cozy / Comfortable row spacing for tables.
 */
export async function ensureUserSettingsTableDensity(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS table_density TEXT NOT NULL DEFAULT 'COZY'
    `);
    logInfo("[migration] user_settings table_density column ready");
  } catch (err) {
    logError(
      "[migration] ensureUserSettingsTableDensity failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
