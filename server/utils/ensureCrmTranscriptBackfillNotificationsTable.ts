import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1022 — audit trail of admins emailed when a CRM transcript backfill
 * run completes. Recipient addresses are snapshotted (text[]) so the list
 * survives admin role changes after the run. Idempotent; safe to run on
 * every cold start.
 */
export async function ensureCrmTranscriptBackfillNotificationsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_transcript_backfill_notifications" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "job_id" varchar NOT NULL REFERENCES "crm_transcript_backfill_jobs"("id") ON DELETE CASCADE,
      "channel" text NOT NULL DEFAULT 'EMAIL',
      "recipient_emails" text[] NOT NULL DEFAULT '{}'::text[],
      "recipient_count" integer NOT NULL DEFAULT 0,
      "notified_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_notifications_job_idx" ON "crm_transcript_backfill_notifications"("job_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_notifications_notified_at_idx" ON "crm_transcript_backfill_notifications"("notified_at")`,
  );
  logInfo("[migration] crm_transcript_backfill_notifications table ready");
}
