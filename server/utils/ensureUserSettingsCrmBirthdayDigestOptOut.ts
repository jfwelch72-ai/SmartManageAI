import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #696: Add crm_birthday_digest_opt_out column to user_settings so each
 * user can silence the weekly CRM contact birthday digest. Defaults to FALSE
 * (opted in) to preserve existing behaviour for users who never touch the
 * toggle.
 */
export async function ensureUserSettingsCrmBirthdayDigestOptOut(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS crm_birthday_digest_opt_out BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("[migration] user_settings crm_birthday_digest_opt_out column ready");
  } catch (err) {
    logError(
      "[migration] ensureUserSettingsCrmBirthdayDigestOptOut failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
