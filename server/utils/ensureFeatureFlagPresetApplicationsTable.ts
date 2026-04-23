import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1119 — audit log of trade-preset applications shown on the
 * Company Settings → Feature Flags tab. Mirrors the
 * `featureFlagPresetApplications` Drizzle table in
 * `shared/schema/features.ts`. Idempotent; safe to run on every cold start.
 */
export async function ensureFeatureFlagPresetApplicationsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "feature_flag_preset_applications" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "trade_type" text NOT NULL,
      "applied_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "applied_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ffpa_org_applied_at_idx"
      ON "feature_flag_preset_applications" ("organization_id", "applied_at")
  `);
  // Task #1314 — extend the audit table to record drift-reset actions
  // alongside full preset applications. `kind` distinguishes "apply" from
  // "reset_drift"; `flag_keys` lists which flags a reset row touched.
  // Idempotent ALTERs so existing rows backfill to kind='apply'.
  await db.execute(sql`
    ALTER TABLE "feature_flag_preset_applications"
      ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'apply'
  `);
  await db.execute(sql`
    ALTER TABLE "feature_flag_preset_applications"
      ADD COLUMN IF NOT EXISTS "flag_keys" text[]
  `);
  logInfo("[migration] feature_flag_preset_applications table ready");
}
