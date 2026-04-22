-- Task #797 — Per-recipient locale + 12h/24h + optional weekday
-- preferences for the quiet-hours catch-up digest timestamps.
--
-- Adds:
--   * pg enum  job_metric_alert_quiet_hours_digest_time_format
--   * users.job_metric_alert_quiet_hours_digest_locale         (text, nullable)
--   * users.job_metric_alert_quiet_hours_digest_time_format    (enum, default 12h)
--   * users.job_metric_alert_quiet_hours_digest_show_weekday   (boolean, default false NOT NULL)
--
-- Defaults preserve the legacy en-US, 12-hour, no-weekday rendering so
-- existing recipients see no behavior change until they explicitly opt in.
--
-- IMPORTANT: This file MUST be safe to run against a *completely empty*
-- database (the test bootstrap may apply it before `drizzle-kit push` has
-- created the baseline schema). The DO block below only touches the
-- `users` table when it already exists; once `drizzle-kit push` creates
-- the table the next run will add the new columns.

DO $$
BEGIN
  CREATE TYPE job_metric_alert_quiet_hours_digest_time_format AS ENUM ('12h', '24h');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_locale text;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_time_format
        job_metric_alert_quiet_hours_digest_time_format NOT NULL DEFAULT '12h';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS job_metric_alert_quiet_hours_digest_show_weekday
        boolean NOT NULL DEFAULT false;
  END IF;
END $$;
