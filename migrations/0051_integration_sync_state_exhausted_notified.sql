-- Task #1391: email/in-app fan-out to org admins the first time an
-- integration sync row exhausts its automatic retry budget. The new
-- `exhausted_notified_at` column lets recordSyncFailure / the retry sweep
-- gate the notification so a single exhaustion event produces exactly one
-- admin alert (manual retry / next successful sync clears the marker so a
-- future re-exhaustion re-fires it).
--
-- The companion ALTER TYPE for the new INTEGRATION_SYNC_RETRIES_EXHAUSTED
-- notification_type enum value is handled by ensureNotificationEnumValues.
--
-- Idempotent ADD COLUMN IF NOT EXISTS — safe to re-run.
ALTER TABLE integration_sync_state
  ADD COLUMN IF NOT EXISTS exhausted_notified_at timestamp;
