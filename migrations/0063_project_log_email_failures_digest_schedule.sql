-- Task #1732: per-org schedule for the daily project-log-email
-- failures-digest fan-out (`processProjectLogEmailFailuresDigest` in
-- server/jobs/jobRunner.ts).
--
-- Background
-- ----------
-- Task #1637 added a daily 08:00 UTC roll-up email summarising every
-- per-project log schedule that failed (or had no recipients) in the
-- last 24h, fanned out to all active ADMIN/SUPER_ADMIN users in each
-- org. The cron registration `"0 8 * * *"` and the recipient list
-- were both hard-coded, so:
--
--   * orgs in non-UTC timezones got a digest at random local hours
--     (00:00 PT, 16:00 in Tokyo, etc), buried below the rest of the
--     morning email pile;
--   * orgs that already triage failures via the per-failure ping
--     (Task #1637 send-time alert) and the consecutive-failure
--     backstop (Task #1651) had no way to opt out of the third
--     channel — they got the digest whether they wanted it or not;
--   * orgs that wanted a quieter cadence (e.g. weekly Monday-morning
--     review) had no knob to dial it back.
--
-- This migration adds four columns mirroring the per-org override
-- pattern already in use for `project_log_email_failure_threshold`
-- (Task #1668) and `organization_payroll_settings.*_digest_*` (the
-- certified-payroll weekly digest cadence knobs):
--
--   * `project_log_email_failures_digest_cadence`  - text NOT NULL
--       DEFAULT 'DAILY'. One of OFF / DAILY / WEEKLY. OFF disables
--       the digest for that org entirely; DAILY/WEEKLY gate which
--       hourly cron tick actually fires the fan-out.
--   * `project_log_email_failures_digest_weekday` - integer NOT NULL
--       DEFAULT 1 (Monday, ISO 0=Sun..6=Sat to match
--       `getLocalDateParts`). Only consulted when cadence=WEEKLY.
--   * `project_log_email_failures_digest_hour`    - integer NOT NULL
--       DEFAULT 8. Local hour (0-23) at which the digest fires.
--   * `project_log_email_failures_digest_timezone` - text NOT NULL
--       DEFAULT 'UTC'. IANA timezone name used to interpret hour
--       and weekday. UTC default preserves the original behavior
--       for orgs that don't touch the new settings.
--
-- The cron registration itself is bumped from `"0 8 * * *"` to
-- `"0 * * * *"` so the handler runs every hour and the per-org gate
-- inside picks which orgs fire on each tick.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_cadence text NOT NULL DEFAULT 'DAILY',
  ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_weekday integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_hour integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS project_log_email_failures_digest_timezone text NOT NULL DEFAULT 'UTC';
