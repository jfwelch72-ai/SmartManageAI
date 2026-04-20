import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure geocode tracking columns exist on projects.
 * Idempotent.
 */
export async function ensureGeocodeStatusColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "last_geocode_attempt_at" timestamp,
      ADD COLUMN IF NOT EXISTS "last_geocode_status" text,
      ADD COLUMN IF NOT EXISTS "geocode_attempt_count" integer NOT NULL DEFAULT 0
  `);
}
