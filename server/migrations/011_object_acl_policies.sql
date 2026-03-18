-- Task #52: Create object_acl_policies table for DB-backed ACL mirror
-- This table stores a copy of each GCS object's ACL policy so that reads can
-- fall back to the DB row if GCS metadata is lost or unavailable.
CREATE TABLE IF NOT EXISTS object_acl_policies (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS object_acl_policies_object_key_idx ON object_acl_policies (object_key);
CREATE INDEX IF NOT EXISTS object_acl_policies_org_idx ON object_acl_policies (organization_id);
