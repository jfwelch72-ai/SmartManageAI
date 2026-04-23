-- Task #1354: scheduled retry of failed background syncs with exponential
-- backoff (initially: Davis-Bacon wage decisions).
--
-- The auto-sync persistence added in Task #1332 (last_attempt_at,
-- last_error) tells us a row failed, but recovery still required a human
-- to click "Retry sync" in the project payroll banner. These two columns
-- let the new wage_decision_retry job (server/jobs/jobRunner.ts ->
-- processFailedWageDecisionRetries) pick failed rows up automatically
-- on a backoff schedule until either the retry succeeds or
-- MAX_WAGE_DECISION_RETRIES is reached.
--
--   retry_count   - number of consecutive failed attempts since the last
--                   success. Reset to 0 by a successful sync and by the
--                   manual-retry path (queueWageDecisionSync manualRetry).
--   next_retry_at - when the retry job should re-attempt this row. Null
--                   on healthy rows AND on rows that have exhausted the
--                   max retry attempts and now need manual intervention.
--
-- Idempotent ADD COLUMN IF NOT EXISTS — safe to re-run.
ALTER TABLE integration_sync_state
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE integration_sync_state
  ADD COLUMN IF NOT EXISTS next_retry_at timestamp;
