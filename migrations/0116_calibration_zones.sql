-- Task #2780: Add takeoff_sheet_calibration_zones table for multi-region calibration
-- Task #2804: Registered in migrationStartupCoverage.ts — this is the canonical numbered
--             migration. ensureCalibrationZonesTable is kept only as a belt-and-suspenders
--             safety net. Table, FK, and index below are the authoritative schema definition.
CREATE TABLE IF NOT EXISTS takeoff_sheet_calibration_zones (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  polygon_points JSONB NOT NULL,
  px_per_foot DOUBLE PRECISION NOT NULL,
  created_by_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calibration_zones_sheet_idx ON takeoff_sheet_calibration_zones (sheet_id);
