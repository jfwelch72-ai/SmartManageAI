-- Historical Cost Database & Bid Leveling Schema Changes
-- Applied: 2026-03-27

-- Add inclusions and exclusions to bid subcontractor quotes (for bid leveling)
ALTER TABLE bid_subcontractor_quotes ADD COLUMN IF NOT EXISTS inclusions text;
ALTER TABLE bid_subcontractor_quotes ADD COLUMN IF NOT EXISTS exclusions text;

-- Add ASSEMBLY to estimate_line_item_source enum
ALTER TYPE estimate_line_item_source ADD VALUE IF NOT EXISTS 'ASSEMBLY';

-- Create historical_costs table
CREATE TABLE IF NOT EXISTS historical_costs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id varchar REFERENCES projects(id) ON DELETE SET NULL,
  project_name text,
  project_type text,
  cost_code text,
  scope_category text NOT NULL,
  trade text,
  description text NOT NULL,
  quantity decimal(12,2) NOT NULL,
  unit text NOT NULL,
  unit_cost decimal(12,4) NOT NULL,
  total_cost decimal(14,2) NOT NULL,
  material_cost decimal(12,2),
  labor_cost decimal(12,2),
  equipment_cost decimal(12,2),
  subcontract_cost decimal(12,2),
  completed_date date,
  source text DEFAULT 'MANUAL',
  created_at timestamp NOT NULL DEFAULT now()
);

-- Create indexes for historical_costs
CREATE INDEX IF NOT EXISTS historical_costs_org_idx ON historical_costs(organization_id);
CREATE INDEX IF NOT EXISTS historical_costs_scope_category_idx ON historical_costs(scope_category);
CREATE INDEX IF NOT EXISTS historical_costs_trade_idx ON historical_costs(trade);
CREATE INDEX IF NOT EXISTS historical_costs_cost_code_idx ON historical_costs(cost_code);
CREATE INDEX IF NOT EXISTS historical_costs_completed_date_idx ON historical_costs(completed_date);
