-- Task #1021: Per-admin delivery preferences for the CRM transcript
-- backfill completion summary email added in Task #1006.
--
-- Defaults preserve the existing behavior (every admin keeps receiving
-- the email summary for every run) so admins see no change until they
-- explicitly pick a different channel or enable the failure-only filter.

DO $$ BEGIN
  CREATE TYPE backfill_summary_channel AS ENUM ('email', 'slack', 'teams', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS crm_backfill_summary_channel backfill_summary_channel
    NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS crm_backfill_summary_on_failure_only boolean
    NOT NULL DEFAULT false;
