-- Task #913: per-view default grouping for the My Work page.
-- The My Work saved-views table was deliberately split out from the org-wide
-- saved-views table so it could carry My-Work-specific options. This migration
-- adds the first such option: a nullable `grouping` column that records how
-- the user wants the work list grouped (e.g. "none", "project", "status",
-- "due-week"). NULL means "no preference" — when the saved view is applied
-- the page falls back to the user's last-used local grouping.
--
-- The table itself is created by Task #898's schema push of
-- `my_work_saved_views` (see shared/schema/features.ts). This migration is
-- intentionally narrow and only adds the new column. Idempotent — safe to
-- re-run.
ALTER TABLE my_work_saved_views
  ADD COLUMN IF NOT EXISTS grouping text;
