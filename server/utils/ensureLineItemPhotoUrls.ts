import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureLineItemPhotoUrls(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'estimate_line_items' AND column_name = 'photo_urls'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    await db.execute(sql`
      ALTER TABLE estimate_line_items
      ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}'::text[]
    `);

    if (!colAlreadyExists) {
      await db.execute(sql`
        UPDATE estimate_line_items
        SET photo_urls = ARRAY[photo_url]
        WHERE photo_url IS NOT NULL
          AND (photo_urls IS NULL OR cardinality(photo_urls) = 0)
      `);
    }

    logInfo(colAlreadyExists
      ? "[migration] estimate_line_items.photo_urls — already present, skipped"
      : "[migration] estimate_line_items.photo_urls — applied and backfilled");
  } catch (err) {
    logError(
      "[migration] Failed to ensure estimate_line_items.photo_urls:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
