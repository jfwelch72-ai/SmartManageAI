CREATE TABLE IF NOT EXISTS budget_line_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_code VARCHAR(20) NOT NULL,
  description VARCHAR(255) NOT NULL,
  division VARCHAR(100) NOT NULL,
  labor_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  material_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  subcontractor_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  equipment_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS budget_line_items_project_idx ON budget_line_items(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS budget_line_items_project_code_uniq ON budget_line_items(project_id, cost_code);
