-- Task #1974: per-notification opaque metadata column.
--
-- Adds a nullable `metadata` jsonb column to `notifications` so the
-- INTEGRATION_SYNC_RETRIES_EXHAUSTED fan-out can persist a
-- {recordLink, recordLabel} pair the in-app bell row renders as a
-- secondary "Open <label>" link. This mirrors the secondary CTA the
-- email composer already renders for QBO failures (Task #1945).
--
-- Resolved at notification-creation time so orphan IDs (record was
-- deleted) leave the fields unset — the bell UI omits the secondary
-- link in that case, same as the email path.
--
-- Idempotent — also mirrored by
-- server/utils/ensureNotificationsMetadata.ts so the column is present
-- after every boot even on environments that don't replay numbered
-- migrations.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS metadata jsonb;
