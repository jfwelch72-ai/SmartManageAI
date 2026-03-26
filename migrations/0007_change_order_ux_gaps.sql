-- Task #178: Change Order Core UX & Workflow Gaps
-- T001: Add unique index for auto-sequential numbering
-- T002: Add cost_code_id column for cost code association

ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS cost_code_id integer;

DO $$ BEGIN
  ALTER TABLE change_orders ADD CONSTRAINT change_orders_cost_code_fk
    FOREIGN KEY (cost_code_id) REFERENCES org_cost_codes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS change_orders_project_number_uniq
  ON change_orders (project_id, change_order_number);
