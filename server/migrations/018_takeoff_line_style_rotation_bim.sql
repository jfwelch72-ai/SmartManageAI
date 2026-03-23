-- Migration 018: Add takeoff line_style, sheet rotation, bim_storey_associations, takeoff_conditions
-- Applied as part of Task #119 stabilization

-- 1. Add line_style column to takeoff_measurements
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS line_style TEXT NOT NULL DEFAULT 'solid';

-- 2. Add rotation column to takeoff_sheets
ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS rotation INTEGER NOT NULL DEFAULT 0;

-- 3. Create bim_storey_associations table
CREATE TABLE IF NOT EXISTS bim_storey_associations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bim_storey_id TEXT NOT NULL,
  bim_storey_name TEXT NOT NULL,
  sheet_id VARCHAR REFERENCES takeoff_sheets(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bim_storey_assoc_project_idx ON bim_storey_associations(project_id);
CREATE INDEX IF NOT EXISTS bim_storey_assoc_sheet_idx ON bim_storey_associations(sheet_id);

-- 4. Create takeoff_conditions table (organization-scoped)
CREATE TABLE IF NOT EXISTS takeoff_conditions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL,
  name TEXT NOT NULL,
  measurement_type TEXT NOT NULL DEFAULT 'LINEAR',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  category_name TEXT,
  unit_cost DOUBLE PRECISION,
  cost_code_id VARCHAR,
  assembly_id VARCHAR,
  line_style TEXT NOT NULL DEFAULT 'solid',
  label_template TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS takeoff_conditions_org_idx ON takeoff_conditions(organization_id);
