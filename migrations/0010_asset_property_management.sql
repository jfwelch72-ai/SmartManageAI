-- Migration: Asset & Property Management
-- Applied: Task #185 - Asset Handover, Warranty Tracking, Maintenance Logs

-- Create enums
DO $$ BEGIN
  CREATE TYPE handover_item_status AS ENUM ('PENDING', 'COMPLETE', 'NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE handover_signoff_role AS ENUM ('CONTRACTOR', 'OWNER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE asset_maintenance_type AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'EMERGENCY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE maintenance_system AS ENUM ('HVAC', 'PLUMBING', 'ELECTRICAL', 'ROOFING', 'STRUCTURAL', 'FIRE_PROTECTION', 'ELEVATOR', 'LANDSCAPING', 'GENERAL', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE recurring_frequency AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create asset_handover_items table
CREATE TABLE IF NOT EXISTS asset_handover_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status handover_item_status NOT NULL DEFAULT 'PENDING',
  document_url TEXT,
  document_filename TEXT,
  completed_at TIMESTAMP,
  completed_by_id VARCHAR REFERENCES users(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS handover_items_project_id_idx ON asset_handover_items(project_id);
CREATE INDEX IF NOT EXISTS handover_items_status_idx ON asset_handover_items(status);

-- Create asset_handover_signoffs table
CREATE TABLE IF NOT EXISTS asset_handover_signoffs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role handover_signoff_role NOT NULL,
  signed_by_user_id VARCHAR NOT NULL REFERENCES users(id),
  signed_by_name TEXT NOT NULL,
  signed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS handover_signoffs_project_id_idx ON asset_handover_signoffs(project_id);

-- Create maintenance_logs table
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TIMESTAMP NOT NULL,
  type asset_maintenance_type NOT NULL,
  system maintenance_system NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cost DECIMAL(12, 2),
  vendor_name TEXT,
  document_url TEXT,
  document_filename TEXT,
  created_by_id VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS maintenance_logs_project_id_idx ON maintenance_logs(project_id);
CREATE INDEX IF NOT EXISTS maintenance_logs_type_idx ON maintenance_logs(type);
CREATE INDEX IF NOT EXISTS maintenance_logs_system_idx ON maintenance_logs(system);
CREATE INDEX IF NOT EXISTS maintenance_logs_date_idx ON maintenance_logs(date);

-- Create maintenance_recurring_schedules table
CREATE TABLE IF NOT EXISTS maintenance_recurring_schedules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  system maintenance_system NOT NULL,
  frequency recurring_frequency NOT NULL,
  description TEXT,
  next_due_date TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_id VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS maint_recurring_project_id_idx ON maintenance_recurring_schedules(project_id);
CREATE INDEX IF NOT EXISTS maint_recurring_active_idx ON maintenance_recurring_schedules(is_active);
