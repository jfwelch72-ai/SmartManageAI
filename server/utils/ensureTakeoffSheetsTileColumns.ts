import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2760 — Server-side PDF tile pre-rendering.
 *
 * Adds three nullable columns to `takeoff_sheets` that the real tile renderer
 * stamps after a successful pre-render pass:
 *
 *   tileStatus        TEXT  — null | 'RENDERING' | 'READY' | 'FAILED'
 *   tiledAt           TIMESTAMP — when the last successful render finished
 *   tileStoragePrefix TEXT  — GCS object-key prefix where tiles are stored,
 *                            e.g. <PRIVATE_OBJECT_DIR>/<orgId>/tiles/<planDocId>/
 *
 * All three are nullable so existing rows silently read as un-rendered until
 * the job queue backfills them. The client falls back to client-side rendering
 * when tileStatus is null or 'FAILED'.
 */
export async function ensureTakeoffSheetsTileColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS tile_status TEXT`);
  await db.execute(sql`ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS tiled_at TIMESTAMP`);
  await db.execute(sql`ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS tile_storage_prefix TEXT`);
  logInfo("[migration] takeoff_sheets tile columns — table ready");
}
