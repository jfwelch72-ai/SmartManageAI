-- Migration 018: Add takeoff line_style, sheet rotation, bim_storey_associations, takeoff_conditions
-- Applied as part of Task #119 stabilization

-- 1. Add line_style column to takeoff_measurements
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS line_style TEXT NOT NULL DEFAULT 'solid';

-- 2. Add rotation column to takeoff_sheets
ALTER TABLE takeoff_sheets ADD COLUMN IF NOT EXISTS rotation INTEGER NOT NULL DEFAULT 0;

-- 3. Create bim_storey_associations table
CREATE TABLE IF NOT EXISTS bim_storey_associations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id VARCHAR REFERENCES bids(id) ON DELETE CASCADE,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
  bim_document_id VARCHAR NOT NULL,
  storey_express_id INTEGER NOT NULL,
  storey_name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bim_storey_assoc_sheet_idx ON bim_storey_associations(sheet_id);
CREATE INDEX IF NOT EXISTS bim_storey_assoc_bid_idx ON bim_storey_associations(bid_id);

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
CREATE INDEX IF NOT EXISTS takeoff_conditions_last_used_idx ON takeoff_conditions(last_used_at);
