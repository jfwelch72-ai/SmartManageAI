import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #763: Add birthday_digest_weekday and birthday_digest_hour columns to
 * user_settings so each user can choose when their weekly CRM contact
 * birthday digest is delivered. Without these columns the GET /api/user-settings
 * route errors out (it selects every column on the table) and the
 * Notification Preferences page fails to load.
 *
 * Defaults match BIRTHDAY_DIGEST_DEFAULT_WEEKDAY (1 = Monday) and
 * BIRTHDAY_DIGEST_DEFAULT_HOUR (8 = 8am local time) from shared/schema.
 */
export async function ensureUserSettingsBirthdayDigestSchedule(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS birthday_digest_weekday INTEGER NOT NULL DEFAULT 1
    `);
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS birthday_digest_hour INTEGER NOT NULL DEFAULT 8
    `);
    logInfo("[migration] user_settings birthday_digest_weekday/hour columns ready");
  } catch (err) {
    logError(
      "[migration] ensureUserSettingsBirthdayDigestSchedule failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
