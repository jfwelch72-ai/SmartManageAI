-- Task #1599: per-org cap + cadence for the document-control overdue
-- sweeps (RFIs and submittal reviews). Mirrors the SWPPP per-org policy
-- column pair. See server/utils/ensureDocOverdueReminderSettings.ts.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS doc_overdue_reminder_max_count integer NOT NULL DEFAULT 5;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS doc_overdue_reminder_interval_hours integer NOT NULL DEFAULT 22;
