import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1089 — mirrors migrations/0037_backfill_summary_preferences.sql, which
 * adds the per-admin delivery preferences for the CRM transcript-backfill
 * completion summary email (Task #1021). Without this startup migration, fresh
 * dev databases miss the `crm_backfill_summary_channel` enum + column on
 * `users`, and the dev login route at `server/authProfileRoutes.ts:835` 500s
 * with `column "crm_backfill_summary_channel" does not exist` when it tries to
 * write the post-login activityLog row.
 *
 * The defaults (`'email'`, `false`) preserve the legacy behavior so existing
 * admins keep receiving the email summary for every run until they pick a
 * different channel or enable the failure-only filter. Idempotent: safe to run
 * on every startup.
 */
export async function ensureUsersCrmBackfillSummaryPreferenceColumns(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE backfill_summary_channel AS ENUM ('email', 'slack', 'teams', 'none');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "crm_backfill_summary_channel" backfill_summary_channel NOT NULL DEFAULT 'email'
  `);
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "crm_backfill_summary_on_failure_only" boolean NOT NULL DEFAULT false
  `);
}
