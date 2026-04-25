import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1955: Per-organization object-storage quota covering the shared
 * `gallery/<orgId>/` prefix used by both the website builder image
 * library and the social-media post media uploader. Adds the column
 * idempotently so existing deployments pick it up on boot without a
 * manual migration:
 *   - storage_quota_bytes  (default 107,374,182,400 = 100 GB)
 *
 * The default lifts the ceiling well above the legacy 3 GB hard-cap
 * that was removed so users weren't blocked, but every org is now
 * subject to a configurable, server-side enforced limit.
 */
export async function ensureOrganizationStorageQuotaColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint NOT NULL DEFAULT 107374182400
    `);
    console.log("[migration] organizations.storage_quota_bytes column ready");
  } catch (err) {
    logError(
      "[migration] ensureOrganizationStorageQuotaColumn failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
