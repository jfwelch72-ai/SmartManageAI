-- Task #1259: Send a daily reminder while SWPPP corrective actions stay
-- overdue. The original Task #1173 marker (last_overdue_notified_at)
-- only fired once per overdue cycle. This adds a counter that tracks
-- the number of FOLLOW-UP daily reminders sent after the initial
-- overdue notification, so the nightly sweep can stop nudging the
-- assignee + PM after the configured cap is hit. The counter is reset
-- back to 0 alongside last_overdue_notified_at when the due date is
-- moved forward or the inspection is re-opened.
--
-- Backfill: the default of 0 is intentionally the correct value for
-- pre-existing in-flight rows that already had their initial fanout
-- under Task #1173 (`last_overdue_notified_at IS NOT NULL`). Under the
-- new semantics, "0 follow-ups sent" matches reality for those rows
-- and they will naturally pick up follow-up #1 on the next eligible
-- nightly sweep.
ALTER TABLE swppp_inspections
  ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0;
