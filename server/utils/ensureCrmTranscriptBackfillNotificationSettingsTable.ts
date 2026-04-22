import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1017 — per-organization destinations for transcript backfill alerts.
 * Idempotent; safe to run on every cold start.
 */
export async function ensureCrmTranscriptBackfillNotificationSettingsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_transcript_backfill_notification_settings" (
      "organization_id" varchar PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
      "slack_webhook_url" text,
      "email_recipients" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "updated_at" timestamp NOT NULL DEFAULT now(),
      "updated_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL
    )
  `);
  // Task #1094: admin-tunable test-alert breach threshold + throttle ledger.
  await db.execute(sql`
    ALTER TABLE "crm_transcript_backfill_notification_settings"
      ADD COLUMN IF NOT EXISTS "test_alert_threshold_per_day" integer,
      ADD COLUMN IF NOT EXISTS "last_threshold_alert_at" timestamp
  `);
  logInfo("[migration] crm_transcript_backfill_notification_settings table ready");
}
