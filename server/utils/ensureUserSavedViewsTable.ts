import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #575: Create user_saved_views table — per-user saved view + filter
 * combinations for list pages (e.g. /projects). Org-scoped, user-scoped.
 */
export async function ensureUserSavedViewsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user_saved_views" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "view_key" text NOT NULL,
        "name" text NOT NULL,
        "view" text NOT NULL,
        "filters_json" text NOT NULL DEFAULT '{}',
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "user_saved_views_user_view_key_idx" ON "user_saved_views"("user_id","view_key")`);
    console.log("[migration] user_saved_views table ready");
  } catch (err) {
    logError(
      "[migration] ensureUserSavedViewsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
