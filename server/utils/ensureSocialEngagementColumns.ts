import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureSocialEngagementColumns(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'social_media_posts' AND column_name = 'engagement_likes'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_likes" integer DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_comments" integer DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_shares" integer DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_reach" integer DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_impressions" integer DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_clicks" integer DEFAULT 0`);
      await db.execute(sql`ALTER TABLE "social_media_posts" ADD COLUMN IF NOT EXISTS "engagement_updated_at" timestamp`);
      console.log("[migration] social engagement columns — applied");
    } else {
      console.log("[migration] social engagement columns — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure social engagement columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
