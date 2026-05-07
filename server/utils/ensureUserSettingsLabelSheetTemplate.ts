import { logInfo, logError } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2570 — Add the `label_sheet_template` column to `user_settings`
 * so each user's preferred barcode/QR label sheet (Avery 5160 / 5163 /
 * 5167 / 5267 / 4×6 thermal) is remembered between visits to the
 * Inventory → Labels tab.
 */
export async function ensureUserSettingsLabelSheetTemplate(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS label_sheet_template TEXT NOT NULL DEFAULT 'avery_5160'
    `);
    logInfo("[migration] user_settings label_sheet_template column ready");
  } catch (err) {
    logError(
      "[migration] ensureUserSettingsLabelSheetTemplate failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
