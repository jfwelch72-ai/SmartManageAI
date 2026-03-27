DO $$ BEGIN
  CREATE TYPE cost_source_category AS ENUM ('LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACTOR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE cost_origin_module AS ENUM ('ESTIMATE', 'PO', 'PAYROLL', 'TM', 'RECEIPT', 'CHANGE_ORDER', 'EQUIPMENT', 'SUBCONTRACTOR');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE cost_transaction_status AS ENUM ('ACTIVE', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS cost_transactions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_code TEXT NOT NULL DEFAULT 'UNASSIGNED',
  source_category cost_source_category NOT NULL,
  origin_module cost_origin_module NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  transaction_date DATE NOT NULL,
  reference_id VARCHAR,
  description TEXT,
  status cost_transaction_status NOT NULL DEFAULT 'ACTIVE',
  voided_at TIMESTAMP,
  voided_by VARCHAR REFERENCES users(id),
  void_reason TEXT,
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cost_transactions_project_idx ON cost_transactions(project_id);
CREATE INDEX IF NOT EXISTS cost_transactions_cost_code_idx ON cost_transactions(cost_code);
CREATE INDEX IF NOT EXISTS cost_transactions_source_category_idx ON cost_transactions(source_category);
CREATE INDEX IF NOT EXISTS cost_transactions_origin_module_idx ON cost_transactions(origin_module);
CREATE INDEX IF NOT EXISTS cost_transactions_status_idx ON cost_transactions(status);
CREATE INDEX IF NOT EXISTS cost_transactions_transaction_date_idx ON cost_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS cost_transactions_reference_idx ON cost_transactions(reference_id);
