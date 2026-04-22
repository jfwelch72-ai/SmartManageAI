-- Task #1033 — audit trail for the admin "send test alert" button on the
-- transcript backfill page. Each row records who triggered the test alert,
-- when, and the per-channel (Slack + email) success/failure so admins can
-- see in-app who last sent a test instead of grepping server logs.
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
);

CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_test_alerts_org_sent_at_idx"
  ON "crm_transcript_backfill_test_alerts" ("organization_id", "sent_at");
