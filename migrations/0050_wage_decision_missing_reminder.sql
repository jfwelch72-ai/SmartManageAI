-- Task #1344: daily reminder when a project's Davis-Bacon wage decision has
-- been missing from the local cache for more than 24 hours. Surfaces to all
-- org admins (in-app + email via SendGrid) so certified payroll deadlines
-- aren't missed because nobody happened to open the payroll page to see the
-- in-app banner introduced in Task #1330. Throttled to no more than one
-- reminder per project per week (keyed off the notifications table itself,
-- so no extra schema is needed for throttling).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'WAGE_DECISION_MISSING_REMINDER';
