import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1033 — audit trail for the admin "send test alert" button on the
 * transcript backfill page. Each row records who triggered the test alert,
 * when, and the per-channel (Slack + email) success/failure so admins can
 * see in-app who last sent a test instead of grepping server logs.
 *
 * Mirrors `migrations/0037_crm_transcript_backfill_test_alerts.sql`. Wired
 * into the boot-time runner (Task #1062) because the static migration runner
 * was not auto-applying that file in dev/prod, leaving the
 * `/api/crm/calls/transcripts/backfill/test-alert/{latest,history}` endpoints
 * returning 500s on fresh environments. Idempotent; safe on every cold start.
 */
export async function ensureCrmTranscriptBackfillTestAlertsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_transcript_backfill_test_alerts" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "sent_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "sent_at" timestamp NOT NULL DEFAULT now(),
      "operator_display" text NOT NULL,
      "slack_configured" boolean NOT NULL DEFAULT false,
      "slack_ok" boolean NOT NULL DEFAULT false,
      "slack_error" text,
      "email_configured" boolean NOT NULL DEFAULT false,
      "email_ok" boolean NOT NULL DEFAULT false,
      "email_error" text,
      "email_recipients" jsonb NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_test_alerts_org_sent_at_idx"
      ON "crm_transcript_backfill_test_alerts" ("organization_id", "sent_at")
  `);
  logInfo("[migration] crm_transcript_backfill_test_alerts table ready");
}
