-- Migration: Overhead & Fixed Cost Enhancements
-- Adds amortization support, audit history, category weights, monthly targets, and health thresholds

-- 1. Add amortization_months to overhead_cost_items
ALTER TABLE overhead_cost_items ADD COLUMN IF NOT EXISTS amortization_months integer;

-- 2. Create overhead cost action enum
DO $$ BEGIN
  CREATE TYPE overhead_cost_action AS ENUM ('CREATE', 'UPDATE', 'DELETE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Create overhead_cost_history table
CREATE TABLE IF NOT EXISTS overhead_cost_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cost_item_id varchar,
  action overhead_cost_action NOT NULL,
  performed_by_id varchar REFERENCES users(id),
  item_name text NOT NULL,
  previous_data text,
  new_data text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS overhead_cost_history_org_idx ON overhead_cost_history(organization_id);
CREATE INDEX IF NOT EXISTS overhead_cost_history_created_at_idx ON overhead_cost_history(created_at);

-- 4. Add category weights and monthly revenue targets to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overhead_category_weights text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS monthly_revenue_targets text;

-- 5. Add health alert threshold columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overhead_warning_threshold numeric;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overhead_critical_threshold numeric;
