import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1031 — per-channel alert dispatch history for transcript backfill
 * runs. Lets admins confirm in-app whether the most recent backfill alerts
 * actually reached the configured Slack/email destinations. Idempotent;
 * safe to run on every cold start.
 */
export async function ensureCrmTranscriptBackfillAlertDeliveriesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_transcript_backfill_alert_deliveries" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "job_id" varchar,
      "channel" text NOT NULL,
      "status" text NOT NULL,
      "recipient_summary" text NOT NULL DEFAULT '',
      "error_message" text,
      "attempted_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_alert_deliveries_org_attempted_idx"
      ON "crm_transcript_backfill_alert_deliveries" ("organization_id", "attempted_at")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_alert_deliveries_job_idx"
      ON "crm_transcript_backfill_alert_deliveries" ("job_id")
  `);
  // Task #1069 — record which admin clicked Resend (and that the row was
  // produced by a manual retry rather than an automatic dispatch) so the
  // in-app history can render "Resent by Jane at 3:14pm" alongside the
  // new outcome row. Idempotent ADD COLUMN IF NOT EXISTS keeps this safe
  // on every cold start, including upgrades from the prior schema.
  await db.execute(sql`
    ALTER TABLE "crm_transcript_backfill_alert_deliveries"
      ADD COLUMN IF NOT EXISTS "triggered_by_id" varchar,
      ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'automatic'
  `);
  logInfo("[migration] crm_transcript_backfill_alert_deliveries table ready");
}
