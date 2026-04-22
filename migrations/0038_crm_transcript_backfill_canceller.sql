-- Task #1070 — backfill cancellation reason and the admin who stopped each
-- run. Lets the active job card, history row, and run-completed Slack/email
-- show "Sam stopped this at 2pm because <reason>" instead of just "Cancelled".
ALTER TABLE "crm_transcript_backfill_jobs"
  ADD COLUMN IF NOT EXISTS "cancelled_by_id" varchar
    REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "crm_transcript_backfill_jobs"
  ADD COLUMN IF NOT EXISTS "cancellation_reason" text;
