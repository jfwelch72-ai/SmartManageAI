-- Drawing Sets & Version Pinning + Revision Notification Support
-- Task #202: Drawing version pinning & revision auto-notifications

-- 1. Create geofence_enforcement enum if not exists
DO $$ BEGIN
  CREATE TYPE geofence_enforcement AS ENUM ('OFF', 'WARN', 'BLOCK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add geofence_enforcement column to projects if not exists
DO $$ BEGIN
  ALTER TABLE projects ADD COLUMN geofence_enforcement geofence_enforcement NOT NULL DEFAULT 'OFF';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 3. Add DOCUMENT_REVISION_CREATED to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DOCUMENT_REVISION_CREATED';

-- 4. Create drawing_sets table
CREATE TABLE IF NOT EXISTS drawing_sets (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drawing_sets_project_idx ON drawing_sets(project_id);
CREATE INDEX IF NOT EXISTS drawing_sets_org_idx ON drawing_sets(organization_id);

-- 5. Create drawing_set_items table
CREATE TABLE IF NOT EXISTS drawing_set_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  drawing_set_id VARCHAR NOT NULL REFERENCES drawing_sets(id) ON DELETE CASCADE,
  sheet_id VARCHAR NOT NULL REFERENCES takeoff_sheets(id) ON DELETE CASCADE,
  revision_id VARCHAR,
  pinned_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT drawing_set_items_set_sheet UNIQUE(drawing_set_id, sheet_id)
);

CREATE INDEX IF NOT EXISTS drawing_set_items_set_idx ON drawing_set_items(drawing_set_id);
CREATE INDEX IF NOT EXISTS drawing_set_items_sheet_idx ON drawing_set_items(sheet_id);
