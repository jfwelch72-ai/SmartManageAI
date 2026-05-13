import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

/**
 * Task #2849 — Startup coverage for website_page_type enum mutations.
 *
 * migration 0002_clumsy_jackpot.sql (drizzle-kit baseline) adds the
 * `CAREERS` value to the `website_page_type` enum via:
 *
 *   ALTER TYPE "public"."website_page_type" ADD VALUE 'CAREERS';
 *
 * `reconcileSchemaDrift` creates missing enum *types* from the Drizzle
 * schema (which already includes CAREERS), but never appends values to
 * an existing enum type.  On a long-lived dev or production DB that was
 * provisioned before CAREERS was added, the value would be silently
 * absent until a request tried to insert a CAREERS page and crashed.
 *
 * All `ALTER TYPE … ADD VALUE IF NOT EXISTS` statements are idempotent.
 */
export async function ensureWebsitePageTypeEnumValues(): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        `ALTER TYPE website_page_type ADD VALUE IF NOT EXISTS 'CAREERS'`,
      ),
    );
    logInfo(
      "[migration] website_page_type — CAREERS enum value ready",
    );
  } catch (err) {
    logError(err, { helper: "ensureWebsitePageTypeEnumValues" });
    throw err;
  }
}
