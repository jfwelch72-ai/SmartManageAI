-- Migration 019: Add missing takeoff columns and tables
-- Adds line_style/line_width to quantity_categories,
-- group_id/line_width to takeoff_measurements,
-- Creates takeoff_measurement_groups and takeoff_sheet_links tables

-- 1. Add missing columns to quantity_categories
ALTER TABLE quantity_categories ADD COLUMN IF NOT EXISTS line_style TEXT NOT NULL DEFAULT 'solid';
ALTER TABLE quantity_categories ADD COLUMN IF NOT EXISTS line_width INTEGER NOT NULL DEFAULT 3;

-- 2. Create takeoff_measurement_groups table
CREATE TABLE IF NOT EXISTS takeoff_measurement_groups (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  bid_id VARCHAR REFERENCES bids(id) ON DELETE CASCADE,
  sheet_id VARCHAR REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS takeoff_measurement_groups_project_idx ON takeoff_measurement_groups(project_id);
CREATE INDEX IF NOT EXISTS takeoff_measurement_groups_bid_idx ON takeoff_measurement_groups(bid_id);
CREATE INDEX IF NOT EXISTS takeoff_measurement_groups_sheet_idx ON takeoff_measurement_groups(sheet_id);

-- 3. Add missing columns to takeoff_measurements (group_id FK requires groups table to exist first)
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS group_id VARCHAR REFERENCES takeoff_measurement_groups(id) ON DELETE SET NULL;
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS line_width INTEGER NOT NULL DEFAULT 3;
CREATE INDEX IF NOT EXISTS takeoff_measurements_group_idx ON takeoff_measurements(group_id);

-- 4. Create takeoff_sheet_links table
CREATE TABLE IF NOT EXISTS takeoff_sheet_links (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
  target_sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  label TEXT,
  auto_detected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS takeoff_sheet_links_source_idx ON takeoff_sheet_links(source_sheet_id);
CREATE INDEX IF NOT EXISTS takeoff_sheet_links_target_idx ON takeoff_sheet_links(target_sheet_id);
