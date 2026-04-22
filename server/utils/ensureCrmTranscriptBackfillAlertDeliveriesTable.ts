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
  logInfo("[migration] crm_transcript_backfill_alert_deliveries table ready");
}
