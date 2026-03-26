-- AIA Progress Billing Tables Migration
-- Creates pay_applications, stored_materials, retention_releases tables

-- Create missing enum types
DO $$ BEGIN
  CREATE TYPE stored_material_status AS ENUM ('ON_SITE', 'OFF_SITE', 'INCORPORATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE retention_release_type AS ENUM ('PARTIAL', 'FINAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE retention_release_status AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RELEASED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create pay_applications table
CREATE TABLE IF NOT EXISTS pay_applications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sov_id VARCHAR NOT NULL REFERENCES schedule_of_values(id) ON DELETE CASCADE,

  application_number INTEGER NOT NULL,
  period_to DATE,

  architect_name TEXT,
  architect_address TEXT,
  owner_name TEXT,
  owner_address TEXT,
  contractor_name TEXT,
  contractor_address TEXT,
  contract_date DATE,
  contract_for TEXT,

  original_contract_sum DECIMAL(14, 2),
  net_change_by_change_orders DECIMAL(14, 2),
  contract_sum_to_date DECIMAL(14, 2),
  total_completed_and_stored DECIMAL(14, 2),
  retainage_percent DECIMAL(5, 2),
  total_retained DECIMAL(14, 2),
  total_earned_less_retainage DECIMAL(14, 2),
  less_previous_certificates DECIMAL(14, 2),
  current_payment_due DECIMAL(14, 2),
  balance_to_finish DECIMAL(14, 2),

  status sov_status NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by_id VARCHAR REFERENCES users(id),
  rejection_reason TEXT,

  paid_amount DECIMAL(14, 2) DEFAULT 0,
  paid_at TIMESTAMP,
  payment_reference TEXT,
  payment_method TEXT,

  created_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pay_app_project_idx ON pay_applications(project_id);
CREATE INDEX IF NOT EXISTS pay_app_org_idx ON pay_applications(organization_id);
CREATE INDEX IF NOT EXISTS pay_app_sov_idx ON pay_applications(sov_id);

-- Create stored_materials table
CREATE TABLE IF NOT EXISTS stored_materials (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sov_id VARCHAR NOT NULL REFERENCES schedule_of_values(id) ON DELETE CASCADE,
  sov_line_item_id VARCHAR REFERENCES sov_line_items(id) ON DELETE SET NULL,

  description TEXT NOT NULL,
  storage_location TEXT,
  storage_status stored_material_status NOT NULL DEFAULT 'ON_SITE',
  delivery_date DATE,
  incorporated_date DATE,
  amount DECIMAL(14, 2) NOT NULL,
  vendor TEXT,
  invoice_reference TEXT,
  notes TEXT,

  created_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stored_mat_project_idx ON stored_materials(project_id);
CREATE INDEX IF NOT EXISTS stored_mat_org_idx ON stored_materials(organization_id);
CREATE INDEX IF NOT EXISTS stored_mat_sov_idx ON stored_materials(sov_id);
CREATE INDEX IF NOT EXISTS stored_mat_line_item_idx ON stored_materials(sov_line_item_id);

-- Create retention_releases table
CREATE TABLE IF NOT EXISTS retention_releases (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sov_id VARCHAR REFERENCES schedule_of_values(id) ON DELETE SET NULL,

  release_type retention_release_type NOT NULL,
  status retention_release_status NOT NULL DEFAULT 'REQUESTED',
  amount DECIMAL(14, 2) NOT NULL,
  reason TEXT,
  approved_by_id VARCHAR REFERENCES users(id),
  approved_at TIMESTAMP,
  released_at TIMESTAMP,

  requested_by_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ret_release_project_idx ON retention_releases(project_id);
CREATE INDEX IF NOT EXISTS ret_release_org_idx ON retention_releases(organization_id);
