-- Public API + marquee integration scaffolds (Task #800)
-- Captures the SQL applied directly because drizzle-kit push hangs on the full
-- workspace schema. Mirrors `shared/schema/features.ts` exactly. Safe to re-run.

-- 1. New provider enum values
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'sage_intacct';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'bluebeam';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'autodesk';

-- 2. integration_api_keys (matches shared/schema/features.ts:integrationApiKeys)
CREATE TABLE IF NOT EXISTS integration_api_keys (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix varchar(16) NOT NULL,
  key_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  rate_limit_per_minute integer NOT NULL DEFAULT 120,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamp,
  expires_at timestamp,
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp
);
CREATE INDEX IF NOT EXISTS integration_api_keys_org_idx ON integration_api_keys (organization_id);
CREATE INDEX IF NOT EXISTS integration_api_keys_prefix_idx ON integration_api_keys (prefix);

-- 3. integration_api_request_log (matches shared/schema/features.ts:integrationApiRequestLog)
CREATE TABLE IF NOT EXISTS integration_api_request_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id varchar REFERENCES integration_api_keys(id) ON DELETE SET NULL,
  method varchar(10) NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer,
  scope_used text,
  error_message text,
  ip text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_api_log_org_idx ON integration_api_request_log (organization_id);
CREATE INDEX IF NOT EXISTS integration_api_log_key_idx ON integration_api_request_log (api_key_id);
CREATE INDEX IF NOT EXISTS integration_api_log_created_idx ON integration_api_request_log (created_at);
