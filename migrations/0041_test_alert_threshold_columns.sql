-- Task #1094: per-org admin-tunable threshold for the transcript backfill
-- test-alert button, plus a throttle ledger so we never fan-out the breach
-- notification more than once per throttle window. `null` on the threshold
-- means "use the service-level default" (see DEFAULT_TEST_ALERT_THRESHOLD_PER_DAY
-- in server/services/transcriptBackfillNotifications.ts).
ALTER TABLE crm_transcript_backfill_notification_settings
  ADD COLUMN IF NOT EXISTS test_alert_threshold_per_day integer,
  ADD COLUMN IF NOT EXISTS last_threshold_alert_at timestamp;
