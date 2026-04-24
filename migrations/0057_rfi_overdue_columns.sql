-- Task #1599: nightly RFI overdue escalation sweep + external assignee fanout.
-- See server/utils/ensureRfiOverdueColumns.ts for the runtime mirror.
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamp;
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0;
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS external_assignee_email text;
