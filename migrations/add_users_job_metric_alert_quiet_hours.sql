-- Task #748: optional quiet-hours window for job-metric alert emails.
-- Stored on the users table so each Super Admin controls their own
-- quiet window. `enabled` defaults to FALSE so existing admins keep
-- receiving emails 24/7 until they opt in. Times are HH:MM strings,
-- weekdays are integers (0=Sunday … 6=Saturday); a null/empty weekday
-- array means the window applies every day.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "job_metric_alert_quiet_hours_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "job_metric_alert_quiet_hours_start" text,
  ADD COLUMN IF NOT EXISTS "job_metric_alert_quiet_hours_end" text,
  ADD COLUMN IF NOT EXISTS "job_metric_alert_quiet_hours_timezone" text,
  ADD COLUMN IF NOT EXISTS "job_metric_alert_quiet_hours_weekdays" integer[];
