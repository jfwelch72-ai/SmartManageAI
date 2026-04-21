-- Task #761 — Per-recipient detail level for the quiet-hours digest email.
-- Adds a new enum and a NOT NULL column on users defaulting to 'full' so
-- existing Super Admins keep the original digest layout until they pick
-- a different one in their Notification Preferences.

DO $$ BEGIN
  CREATE TYPE job_metric_alert_quiet_hours_digest_format AS ENUM ('summary', 'full', 'grouped');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_format
    job_metric_alert_quiet_hours_digest_format NOT NULL DEFAULT 'full';
