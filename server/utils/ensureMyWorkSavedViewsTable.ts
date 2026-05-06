import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #898 introduced the dedicated `my_work_saved_views` table that backs
 * the My Work page's saved-view dropdown (served by /api/me/work/views).
 *
 * Task #912: any saved views users created on the My Work page before #898
 * still live in the shared `user_saved_views` table with `view_key = 'my-work'`
 * and would otherwise silently disappear from the dropdown. This migration:
 *
 *   1. Ensures the `my_work_saved_views` table + indexes exist (safety net
 *      so the backfill never runs against a missing table on a fresh DB
 *      that hasn't had `db:push` run yet).
 *   2. Copies every legacy `view_key = 'my-work'` row from `user_saved_views`
 *      into `my_work_saved_views`, preserving the original `id` and the
 *      `user_id`, `organization_id`, `name`, `view`, `filters_json`,
 *      `is_shared`, and `created_at` columns.
 *
 * The backfill is idempotent: rows already copied are skipped via
 * `ON CONFLICT (id) DO NOTHING`, so leaving this step in place across
 * deploys is safe. Old `user_saved_views` rows are intentionally left in
 * place — deleting them is reserved for a follow-up cleanup once we are
 * confident every environment has been migrated.
 */
export async function ensureMyWorkSavedViewsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "my_work_saved_views" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "view" text NOT NULL,
        "filters_json" text NOT NULL DEFAULT '{}',
        "is_shared" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "my_work_saved_views_user_idx" ON "my_work_saved_views"("user_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "my_work_saved_views_org_shared_idx" ON "my_work_saved_views"("organization_id","is_shared")`);

    const legacyExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_saved_views'
      ) AS exists
    `);
    const hasLegacy = (legacyExists.rows[0] as { exists: boolean } | undefined)?.exists === true;
    if (!hasLegacy) {
      logInfo("[migration] my_work_saved_views table ready (no legacy table to backfill)");
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO "my_work_saved_views"
        ("id", "user_id", "organization_id", "name", "view", "filters_json", "is_shared", "created_at")
      SELECT
        u."id", u."user_id", u."organization_id", u."name", u."view", u."filters_json", u."is_shared", u."created_at"
      FROM "user_saved_views" u
      WHERE u."view_key" = 'my-work'
      ON CONFLICT ("id") DO NOTHING
    `);
    const copied = (result as { rowCount?: number }).rowCount ?? 0;
    if (copied > 0) {
      logInfo(`[migration] my_work_saved_views table ready — applied (backfilled ${copied} legacy my-work view${copied === 1 ? "" : "s"})`);
    } else {
      logInfo("[migration] my_work_saved_views table ready");
    }
  } catch (err) {
    logError(
      "[migration] ensureMyWorkSavedViewsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
