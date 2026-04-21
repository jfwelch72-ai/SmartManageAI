-- Task #776 — Per-recipient cap on how many recent alerts the
-- quiet-hours digest email and in-app preview surface.
-- Defaults to 100 so existing Super Admins keep the prior hard-coded
-- cap until they pick a different value in Notification Preferences.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_max_events
    integer NOT NULL DEFAULT 100;
