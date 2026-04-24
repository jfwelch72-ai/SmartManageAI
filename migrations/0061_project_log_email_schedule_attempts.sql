-- Task #1652 — per-schedule send history.
--
-- The schedule row only carries the *most recent* attempt
-- (last_attempt_at / last_attempt_status / last_attempt_error /
-- last_attempt_recipient_count, added by 0058). That's enough to
-- show "this morning's send failed", but admins debugging a flaky
-- distribution list need to see trend data — "this failed 5 times
-- this week, then succeeded once after I edited the list" — and
-- support needs a paper trail of who triggered each manual send.
--
-- This migration adds a small append-only history table so every
-- cron tick + manual "Send now" click writes an immutable row.
-- One row per attempt, never updated. The schedule row keeps its
-- "most recent" columns so existing UI badges + dedupe logic don't
-- have to change.
--
-- Columns:
--   * schedule_id        - FK to project_log_email_schedules. ON
--                          DELETE CASCADE so deleting a schedule
--                          cleans up its history too (the row only
--                          makes sense in the context of a schedule).
--   * organization_id    - FK to organizations for tenant scoping.
--                          Cascading on org delete matches the
--                          schedule's behaviour.
--   * project_id         - FK to projects. Cascading on project
--                          delete matches the schedule's behaviour.
--   * log_type           - 'RFI' | 'SUBMITTAL', mirrored from the
--                          schedule so reads don't need a join.
--   * status             - 'SUCCESS' | 'FAILURE' | 'NO_RECIPIENTS',
--                          same vocabulary as last_attempt_status.
--   * error              - human-readable reason on FAILURE /
--                          NO_RECIPIENTS, NULL on SUCCESS.
--   * recipient_count    - how many addresses we tried.
--   * trigger_type       - 'CRON' | 'MANUAL'. Lets the UI distinguish
--                          scheduled runs from admin-triggered
--                          retries at a glance.
--   * triggered_by_id    - FK to users when trigger_type = MANUAL,
--                          NULL on CRON. ON DELETE SET NULL so
--                          deleting the user keeps the history
--                          (they may have left the company but the
--                          paper trail still matters).
--   * created_at         - when the attempt happened.
CREATE TABLE IF NOT EXISTS project_log_email_schedule_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id varchar NOT NULL REFERENCES project_log_email_schedules(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id varchar NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_type text NOT NULL,
  status text NOT NULL,
  error text,
  recipient_count integer NOT NULL DEFAULT 0,
  trigger_type text NOT NULL,
  triggered_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- The settings card reads "last 10 attempts for this schedule" so
-- the (schedule_id, created_at desc) index covers the only query
-- the UI runs.
CREATE INDEX IF NOT EXISTS project_log_email_schedule_attempts_schedule_idx
  ON project_log_email_schedule_attempts (schedule_id, created_at DESC);

-- Tenant-scoped admin tooling (super-admin "show me every failed
-- attempt across the org") can use the org index.
CREATE INDEX IF NOT EXISTS project_log_email_schedule_attempts_org_idx
  ON project_log_email_schedule_attempts (organization_id);
