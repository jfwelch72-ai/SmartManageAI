import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1076 — per-admin opt-in for the two streams of CRM transcript-backfill
 * alert delivery failure emails (Task #1051 real-time + Task #1065 daily
 * digest). Adds the `alert_failure_email_mode` enum + column on `users`.
 *
 * The default `'both'` preserves the legacy behavior so existing admins keep
 * receiving every real-time and digest email until they pick a quieter mode.
 * Idempotent: safe to run on every startup.
 */
export async function ensureUsersAlertFailureEmailModeColumn(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE alert_failure_email_mode AS ENUM ('both', 'realtime', 'digest', 'none');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "alert_failure_email_mode" alert_failure_email_mode NOT NULL DEFAULT 'both'
  `);
}
