-- Task #1599: nightly submittal-review overdue escalation sweep + external
-- reviewer fanout. See server/utils/ensureSubmittalReviewOverdueColumns.ts
-- for the runtime mirror.
ALTER TABLE submittal_reviews
  ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamp;
ALTER TABLE submittal_reviews
  ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0;
ALTER TABLE submittal_reviews
  ADD COLUMN IF NOT EXISTS reviewer_email text;
