-- Task #902: weekly per-project KPI snapshot table for the portfolio
-- Heatmap and Financial Rollup sparklines + 12-week direction-of-travel
-- deltas. One row per project per ISO week (Sunday UTC), upserted by the
-- nightly portfolio_kpi_snapshot job.
CREATE TABLE IF NOT EXISTS "project_kpi_snapshots" (
  "id"              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_id"      varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "week_start"      date NOT NULL,
  "health"          integer NOT NULL DEFAULT 0,
  "spi"             numeric(8,3) NOT NULL DEFAULT 1,
  "cpi"             numeric(8,3) NOT NULL DEFAULT 1,
  "burn"            numeric(14,2) NOT NULL DEFAULT 0,
  "variance_pct"    numeric(8,2) NOT NULL DEFAULT 0,
  "schedule_pct"    integer NOT NULL DEFAULT 0,
  "expected_pct"    integer NOT NULL DEFAULT 0,
  "open_rfis"       integer NOT NULL DEFAULT 0,
  "open_cos"        integer NOT NULL DEFAULT 0,
  "open_punch"      integer NOT NULL DEFAULT 0,
  "captured_at"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "project_kpi_snap_project_idx"
  ON "project_kpi_snapshots" ("project_id");
CREATE INDEX IF NOT EXISTS "project_kpi_snap_week_idx"
  ON "project_kpi_snapshots" ("week_start");
CREATE UNIQUE INDEX IF NOT EXISTS "project_kpi_snap_project_week_uniq"
  ON "project_kpi_snapshots" ("project_id", "week_start");
