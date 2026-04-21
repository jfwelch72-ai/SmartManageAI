-- Task #740: per-user opt-out for job-metric alert emails.
-- Defaults to TRUE so existing Super Admins keep receiving emails until
-- they explicitly opt out from the notification settings page.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "receives_job_metric_alert_emails" boolean NOT NULL DEFAULT true;
