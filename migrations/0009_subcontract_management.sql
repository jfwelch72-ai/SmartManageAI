-- Migration: Subcontract Management - SOV, Pay Applications, Retention, Performance
-- Applied: Task #184 - Subcontract Management Full Flow

-- Add payment term columns to subcontractor_contracts
ALTER TABLE subcontractor_contracts ADD COLUMN IF NOT EXISTS billing_frequency TEXT;
ALTER TABLE subcontractor_contracts ADD COLUMN IF NOT EXISTS payment_due_days INTEGER;
ALTER TABLE subcontractor_contracts ADD COLUMN IF NOT EXISTS early_pay_discount DECIMAL(5, 2);
ALTER TABLE subcontractor_contracts ADD COLUMN IF NOT EXISTS lien_waiver_required BOOLEAN DEFAULT false;

-- Create subcontract_sov_line_items table
CREATE TABLE IF NOT EXISTS subcontract_sov_line_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id VARCHAR NOT NULL REFERENCES subcontractor_contracts(id) ON DELETE CASCADE,
  item_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  scheduled_value DECIMAL(12, 2) NOT NULL,
  original_value DECIMAL(12, 2),
  change_order_ref TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_sov_contract_idx ON subcontract_sov_line_items(contract_id);

-- Create sub_pay_applications table
CREATE TABLE IF NOT EXISTS sub_pay_applications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id VARCHAR NOT NULL REFERENCES subcontractor_contracts(id) ON DELETE CASCADE,
  application_number INTEGER NOT NULL,
  period_to TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_scheduled_value DECIMAL(12, 2),
  total_completed_previous DECIMAL(12, 2),
  total_completed_this_period DECIMAL(12, 2),
  total_materials_stored DECIMAL(12, 2),
  total_completed_to_date DECIMAL(12, 2),
  total_retention_held DECIMAL(12, 2),
  net_amount_due DECIMAL(12, 2),
  submitted_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by_id VARCHAR REFERENCES users(id),
  paid_at TIMESTAMP,
  rejection_reason TEXT,
  created_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_pay_app_contract_idx ON sub_pay_applications(contract_id);
CREATE INDEX IF NOT EXISTS sub_pay_app_status_idx ON sub_pay_applications(status);

-- Create sub_pay_app_line_items table
CREATE TABLE IF NOT EXISTS sub_pay_app_line_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_app_id VARCHAR NOT NULL REFERENCES sub_pay_applications(id) ON DELETE CASCADE,
  sov_line_item_id VARCHAR NOT NULL REFERENCES subcontract_sov_line_items(id) ON DELETE CASCADE,
  previously_completed DECIMAL(12, 2) DEFAULT 0, 
  completed_this_period DECIMAL(12, 2) DEFAULT 0,
  materials_stored DECIMAL(12, 2) DEFAULT 0,
  total_completed DECIMAL(12, 2) DEFAULT 0,
  percent_complete DECIMAL(5, 2) DEFAULT 0,
  retention_held DECIMAL(12, 2) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sub_pay_app_line_pay_app_idx ON sub_pay_app_line_items(pay_app_id);

-- Create sub_retention_releases table
CREATE TABLE IF NOT EXISTS sub_retention_releases (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id VARCHAR NOT NULL REFERENCES subcontractor_contracts(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  release_type TEXT NOT NULL DEFAULT 'PARTIAL',
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT,
  approved_by_id VARCHAR REFERENCES users(id),
  approved_at TIMESTAMP,
  rejected_by_id VARCHAR REFERENCES users(id),
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  requested_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_retention_release_contract_idx ON sub_retention_releases(contract_id);

-- Create sub_performance_scores table
CREATE TABLE IF NOT EXISTS sub_performance_scores (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id VARCHAR NOT NULL REFERENCES subcontractor_contracts(id) ON DELETE CASCADE,
  period_date TIMESTAMP NOT NULL,
  schedule_adherence INTEGER,
  work_completion_percent INTEGER,
  quality_score INTEGER,
  safety_incidents INTEGER DEFAULT 0,
  punch_list_items INTEGER DEFAULT 0,
  overall_rating DECIMAL(3, 1),
  notes TEXT,
  scored_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_perf_contract_idx ON sub_performance_scores(contract_id);

-- Create subcontract_attachments table
CREATE TABLE IF NOT EXISTS subcontract_attachments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id VARCHAR NOT NULL REFERENCES subcontractor_contracts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  category TEXT DEFAULT 'GENERAL',
  uploaded_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sub_attach_contract_idx ON subcontract_attachments(contract_id);

-- Create sov_revision_history table
CREATE TABLE IF NOT EXISTS sov_revision_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  sov_line_item_id VARCHAR REFERENCES subcontract_sov_line_items(id) ON DELETE SET NULL,
  contract_id VARCHAR NOT NULL REFERENCES subcontractor_contracts(id) ON DELETE CASCADE,
  revision_type TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  change_order_ref TEXT,
  changed_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sov_rev_contract_idx ON sov_revision_history(contract_id);
CREATE INDEX IF NOT EXISTS sov_rev_sov_idx ON sov_revision_history(sov_line_item_id);
