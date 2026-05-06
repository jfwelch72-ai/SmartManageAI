-- Task #1286: Promote the SWPPP overdue corrective-action escalation
-- policy from hard-coded constants in server/jobs/jobRunner.ts
-- (SWPPP_OVERDUE_REMINDER_CAP / _INTERVAL_MS) to per-organization
-- settings. Admins can now choose how many follow-up reminders they
-- want sent (default 5) and the minimum gap between consecutive
-- fanouts in hours (default 22 — same convention used by the other
-- daily-cadence digests in this codebase).
--
-- The defaults match the legacy constants so upgrading is a no-op
-- for existing organizations. Idempotent ADD COLUMN IF NOT EXISTS.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS swppp_overdue_reminder_max_count integer NOT NULL DEFAULT 5;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS swppp_overdue_reminder_interval_hours integer NOT NULL DEFAULT 22;
