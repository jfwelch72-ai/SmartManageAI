-- Task #744: capture whether an alert email was actually attempted (vs. just
-- "not sent because the threshold was not crossed") and the SendGrid error
-- message when delivery failed. Lets Super Admins see paging failures on the
-- dashboard instead of them being silently logged.

ALTER TABLE "job_metric_alert_events"
  ADD COLUMN IF NOT EXISTS "email_attempted" boolean NOT NULL DEFAULT false;

ALTER TABLE "job_metric_alert_events"
  ADD COLUMN IF NOT EXISTS "email_error" text;
