import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1290 — audit log of individual feature-flag flips made via the
 * per-flag toggle (outside trade preset application). Mirrors the
 * `featureFlagManualChanges` Drizzle table in
 * `shared/schema/features.ts`. Idempotent; safe to run on every cold start.
 */
export async function ensureFeatureFlagManualChangesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "feature_flag_manual_changes" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "flag_key" text NOT NULL,
      "previous_value" boolean NOT NULL,
      "new_value" boolean NOT NULL,
      "changed_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "changed_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "ffmc_org_changed_at_idx"
      ON "feature_flag_manual_changes" ("organization_id", "changed_at")
  `);
  logInfo("[migration] feature_flag_manual_changes table ready");
}
