import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2142 — Add the three takeoff mobile/stylus precision columns to
 * user_settings so each user can tune palm rejection, the stylus
 * long-press snap-HUD threshold, and whether the two-finger rotate
 * gesture is honored on touch devices.
 *
 * Defaults match Section 7 of the Takeoff Interaction Map:
 *   • allow_two_finger_rotate = false  (rotate stays off by default)
 *   • palm_rejection_band_px  = 24
 *   • stylus_long_press_ms    = 500
 */
export async function ensureUserSettingsTakeoffStylusPrefs(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS allow_two_finger_rotate BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS palm_rejection_band_px INTEGER NOT NULL DEFAULT 24
    `);
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS stylus_long_press_ms INTEGER NOT NULL DEFAULT 500
    `);
    logInfo("[migration] user_settings takeoff stylus prefs columns ready");
  } catch (err) {
    logError(
      "[migration] ensureUserSettingsTakeoffStylusPrefs failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
