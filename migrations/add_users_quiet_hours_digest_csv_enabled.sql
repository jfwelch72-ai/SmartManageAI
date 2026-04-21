-- Task #764 — Opt-in CSV attachment for the quiet-hours digest email.
-- Adds a NOT NULL boolean defaulting to false so existing Super Admins
-- continue to receive only the in-email digest until they explicitly
-- enable the CSV attachment in their Notification Preferences.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_csv_enabled
    boolean NOT NULL DEFAULT false;
