-- Migration: Add permission_presets table for built-in and custom permission presets
CREATE TABLE IF NOT EXISTS permission_presets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  target_role varchar(50) NOT NULL,
  permissions text NOT NULL,
  is_built_in boolean NOT NULL DEFAULT false,
  organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permission_presets_org_idx ON permission_presets(organization_id);
CREATE INDEX IF NOT EXISTS permission_presets_role_idx ON permission_presets(target_role);
