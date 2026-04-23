-- Task #1332: persisted failure tracking for background integration syncs.
--
-- The Davis-Bacon (DOL/SAM.gov) auto-sync queued during project create/update
-- was fire-and-forget — failures were only written to server logs, so users
-- didn't find out until a certified payroll report still showed the
-- missing-decision banner. Adding `last_attempt_at` and `last_error` columns
-- to `integration_sync_state` lets the auto-sync record per-decision failure
-- state and surface it in the UI, and lets a successful subsequent sync
-- naturally clear the prior failure.
--
-- Idempotent ADD COLUMN IF NOT EXISTS — safe to re-run.
ALTER TABLE integration_sync_state
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamp;

ALTER TABLE integration_sync_state
  ADD COLUMN IF NOT EXISTS last_error text;

-- Notification type emitted when a Davis-Bacon background sync errors so the
-- integration owner sees an in-app heads-up instead of silently failing.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DAVIS_BACON_AUTO_SYNC_FAILED';
