-- Task #2578 — Takeoff & Estimating Phase C
-- Pricing data sources, crew composition, alternates/allowances/contingencies,
-- export targets. Additive only; safe to replay.

-- 1. Cost-book provider abstraction (RSMeans-like).
CREATE TABLE IF NOT EXISTS cost_book_providers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider_kind text NOT NULL DEFAULT 'BUILTIN', -- BUILTIN | RSMEANS | CRAFTSMAN | CUSTOM
  api_endpoint text,
  api_key_env_var text,
  is_active boolean NOT NULL DEFAULT true,
  default_region text,
  notes text,
  last_synced_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_book_providers_org_idx ON cost_book_providers (organization_id);

CREATE TABLE IF NOT EXISTS cost_book_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id varchar NOT NULL REFERENCES cost_book_providers(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_code text NOT NULL,        -- e.g. RSMeans line code "033053500250"
  csi_division text,                -- e.g. "03 30 53"
  description text NOT NULL,
  unit text NOT NULL,               -- CY, SF, EA, LF, TON, HR, LS
  base_region text,                 -- e.g. "National Average" or "30-City Avg"
  material_cost numeric(12,4) NOT NULL DEFAULT 0,
  labor_cost numeric(12,4) NOT NULL DEFAULT 0,
  equipment_cost numeric(12,4) NOT NULL DEFAULT 0,
  total_cost numeric(12,4) NOT NULL DEFAULT 0,
  labor_hours numeric(10,4),
  crew_code text,                   -- references provider crew like "C-14C"
  as_of_date date NOT NULL,
  raw_payload jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_book_entries_provider_idx ON cost_book_entries (provider_id);
CREATE INDEX IF NOT EXISTS cost_book_entries_org_idx ON cost_book_entries (organization_id);
CREATE INDEX IF NOT EXISTS cost_book_entries_source_code_idx ON cost_book_entries (organization_id, source_code);
CREATE INDEX IF NOT EXISTS cost_book_entries_csi_idx ON cost_book_entries (csi_division);

CREATE TABLE IF NOT EXISTS cost_book_geo_factors (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id varchar NOT NULL REFERENCES cost_book_providers(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  region_code text NOT NULL,        -- e.g. "NYC-100", "LA-900"
  region_name text NOT NULL,
  city text,
  state text,
  postal_code text,
  material_factor numeric(6,3) NOT NULL DEFAULT 1.000,
  labor_factor numeric(6,3) NOT NULL DEFAULT 1.000,
  equipment_factor numeric(6,3) NOT NULL DEFAULT 1.000,
  total_factor numeric(6,3) NOT NULL DEFAULT 1.000,
  as_of_date date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_book_geo_factors_provider_idx ON cost_book_geo_factors (provider_id);
CREATE INDEX IF NOT EXISTS cost_book_geo_factors_region_idx ON cost_book_geo_factors (organization_id, region_code);

-- 2. Crew composition templates (estimating crews — distinct from workforce
--    `crews`). Each template aggregates worker classifications + equipment
--    items and a default daily duration / production rate.
CREATE TABLE IF NOT EXISTS estimating_crew_templates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  trade_type text,
  description text,
  default_hours_per_day numeric(5,2) NOT NULL DEFAULT 8.00,
  default_production_unit text,         -- SF, CY, LF, TON
  default_production_per_day numeric(12,2),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS estimating_crew_templates_org_code_uniq
  ON estimating_crew_templates (organization_id, code);

CREATE TABLE IF NOT EXISTS estimating_crew_template_workers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_template_id varchar NOT NULL REFERENCES estimating_crew_templates(id) ON DELETE CASCADE,
  job_classification_id varchar REFERENCES job_classifications(id) ON DELETE SET NULL,
  classification_label text NOT NULL,    -- e.g. "Foreman", "Skilled Laborer"
  count integer NOT NULL DEFAULT 1,
  hourly_rate numeric(10,4) NOT NULL DEFAULT 0,
  burden_percent numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimating_crew_workers_template_idx
  ON estimating_crew_template_workers (crew_template_id);

CREATE TABLE IF NOT EXISTS estimating_crew_template_equipment (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_template_id varchar NOT NULL REFERENCES estimating_crew_templates(id) ON DELETE CASCADE,
  equipment_label text NOT NULL,         -- e.g. "Excavator CAT 320"
  count integer NOT NULL DEFAULT 1,
  daily_rate numeric(12,4) NOT NULL DEFAULT 0,
  fuel_cost_per_day numeric(12,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimating_crew_equipment_template_idx
  ON estimating_crew_template_equipment (crew_template_id);

-- 3. Alternates / allowances / contingencies grouping (for proposal toggles).
CREATE TABLE IF NOT EXISTS estimate_alternate_groups (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id varchar NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  code text NOT NULL,                    -- "ALT-1"
  name text NOT NULL,
  description text,
  default_included boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS estimate_alternate_groups_estimate_code_uniq
  ON estimate_alternate_groups (estimate_id, code);

-- 4. Sub-bid leveling sheets (in-house vs N subs, normalized inclusions).
CREATE TABLE IF NOT EXISTS estimate_leveling_sheets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id varchar NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  scope_label text NOT NULL,
  in_house_cost numeric(12,2),
  inclusion_keys jsonb NOT NULL DEFAULT '[]'::jsonb,  -- canonical item list
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_leveling_sheets_estimate_idx
  ON estimate_leveling_sheets (estimate_id);

CREATE TABLE IF NOT EXISTS estimate_leveling_sheet_columns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  leveling_sheet_id varchar NOT NULL REFERENCES estimate_leveling_sheets(id) ON DELETE CASCADE,
  source_kind text NOT NULL,            -- 'IN_HOUSE' | 'SUB_QUOTE'
  subcontractor_quote_id varchar REFERENCES bid_subcontractor_quotes(id) ON DELETE SET NULL,
  label text NOT NULL,
  base_amount numeric(12,2) NOT NULL DEFAULT 0,
  included_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  add_for_excluded numeric(12,2) NOT NULL DEFAULT 0,
  normalized_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_recommended boolean NOT NULL DEFAULT false,
  notes text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_leveling_columns_sheet_idx
  ON estimate_leveling_sheet_columns (leveling_sheet_id);

-- 5. Extend estimate_line_items with line type, cost-book provenance, crew link.
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'BASE';
  -- BASE | ALTERNATE | ALLOWANCE | CONTINGENCY
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS alternate_group_id varchar
    REFERENCES estimate_alternate_groups(id) ON DELETE SET NULL;
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS allowance_basis text;
  -- when line_type=ALLOWANCE: 'FIXED' | 'PERCENT_OF_BASE'
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS contingency_percent numeric(5,2);
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS cost_book_entry_id varchar
    REFERENCES cost_book_entries(id) ON DELETE SET NULL;
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS cost_book_source text;          -- provider name snapshot
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS cost_book_source_code text;     -- snapshot of code
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS cost_book_as_of_date date;
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS cost_book_geo_factor numeric(6,3);
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS crew_template_id varchar
    REFERENCES estimating_crew_templates(id) ON DELETE SET NULL;
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS crew_days numeric(8,2);

CREATE INDEX IF NOT EXISTS estimate_line_items_line_type_idx
  ON estimate_line_items (line_type);
CREATE INDEX IF NOT EXISTS estimate_line_items_alternate_group_idx
  ON estimate_line_items (alternate_group_id)
  WHERE alternate_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_line_items_cost_book_entry_idx
  ON estimate_line_items (cost_book_entry_id)
  WHERE cost_book_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_line_items_crew_template_idx
  ON estimate_line_items (crew_template_id)
  WHERE crew_template_id IS NOT NULL;

-- 6. Pin org default cost-book provider + region.
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS default_cost_book_provider_id varchar
    REFERENCES cost_book_providers(id) ON DELETE SET NULL;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS default_cost_book_region_code text;
