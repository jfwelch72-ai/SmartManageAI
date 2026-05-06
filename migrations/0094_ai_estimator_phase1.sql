-- Task #2466 — AI Estimator real-world upgrade, Phase 1.
--
-- 1) Sheet indexing & trade routing: per-sheet discipline + sheet number
--    columns on `takeoff_sheets`, populated by the AI sheet-index pass.
-- 2) Legend symbol scaffolding (`ai_estimator_legend_symbols`) so the
--    legend-parsing pass has a place to land its results.
-- 3) Assemblies catalog (`ai_estimator_assemblies` + `_components`) so
--    Phase 2 draft generation can prefer assemblies over raw line items.
-- 4) Org-level estimating factors (`ai_estimator_org_factors`) for
--    waste %, productivity overrides, city cost index and prevailing wage.
--
-- All operations are idempotent so the file is safe to replay.

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS discipline text;

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS sheet_number text;

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS discipline_confidence text;

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS discipline_source text;

CREATE INDEX IF NOT EXISTS takeoff_sheets_discipline_idx
  ON takeoff_sheets (discipline)
  WHERE discipline IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_estimator_legend_symbols (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id varchar REFERENCES projects(id) ON DELETE CASCADE,
  bid_id varchar REFERENCES bids(id) ON DELETE CASCADE,
  legend_sheet_id varchar REFERENCES takeoff_sheets(id) ON DELETE SET NULL,
  glyph_bbox jsonb,
  symbol_code text NOT NULL,
  definition text NOT NULL,
  trade text,
  count integer NOT NULL DEFAULT 0,
  occurrences jsonb,
  source text NOT NULL DEFAULT 'AI_DETECTED',
  confidence text NOT NULL DEFAULT 'MEDIUM',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_estimator_legend_symbols_org_idx
  ON ai_estimator_legend_symbols (organization_id);
CREATE INDEX IF NOT EXISTS ai_estimator_legend_symbols_project_idx
  ON ai_estimator_legend_symbols (project_id);
CREATE INDEX IF NOT EXISTS ai_estimator_legend_symbols_bid_idx
  ON ai_estimator_legend_symbols (bid_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_estimator_legend_symbols_uniq
  ON ai_estimator_legend_symbols (organization_id, bid_id, symbol_code);

CREATE TABLE IF NOT EXISTS ai_estimator_assemblies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  cost_code text,
  trade_type text,
  driving_measurement_type text NOT NULL,
  driving_unit text NOT NULL,
  waste_factor double precision NOT NULL DEFAULT 0,
  production_rate_per_hour double precision,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_estimator_assemblies_org_idx
  ON ai_estimator_assemblies (organization_id);
CREATE INDEX IF NOT EXISTS ai_estimator_assemblies_cost_code_idx
  ON ai_estimator_assemblies (organization_id, cost_code);
CREATE UNIQUE INDEX IF NOT EXISTS ai_estimator_assemblies_uniq_name
  ON ai_estimator_assemblies (organization_id, name);

CREATE TABLE IF NOT EXISTS ai_estimator_assembly_components (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id varchar NOT NULL REFERENCES ai_estimator_assemblies(id) ON DELETE CASCADE,
  component_type text NOT NULL,
  description text NOT NULL,
  cost_code text,
  qty_per_driving_unit double precision NOT NULL DEFAULT 1,
  unit text NOT NULL,
  default_unit_cost numeric(14, 4),
  waste_factor double precision NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_estimator_assembly_components_assembly_idx
  ON ai_estimator_assembly_components (assembly_id);

CREATE TABLE IF NOT EXISTS ai_estimator_org_factors (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  waste_factors_by_category jsonb DEFAULT '{}'::jsonb,
  productivity_overrides jsonb DEFAULT '{}'::jsonb,
  city_cost_index_default double precision NOT NULL DEFAULT 1.0,
  prevailing_wage_default boolean NOT NULL DEFAULT false,
  notes text,
  updated_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_estimator_org_factors_uniq_org
  ON ai_estimator_org_factors (organization_id);
