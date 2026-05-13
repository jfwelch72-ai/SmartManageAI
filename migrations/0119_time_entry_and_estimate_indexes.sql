-- Task #2843 — Add composite indexes to speed up filtered time-entry and
-- estimate queries. Without these, the list endpoints do full table scans as
-- data grows.

CREATE INDEX IF NOT EXISTS idx_time_entries_user_date
  ON time_entries(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_project_date
  ON time_entries(project_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_estimates_project_version
  ON estimates(project_id, version_number DESC);
