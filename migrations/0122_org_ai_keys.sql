-- 0122_org_ai_keys.sql
-- Task #2948 — Bring-Your-Own-Key (BYOK) for AI providers per organization.
-- One row per (organization, provider) storing the AES-256-GCM encrypted key
-- and a 4-char hint for display. Deleting a row reverts the org to the
-- platform-global env-var key.
CREATE TABLE IF NOT EXISTS org_ai_keys (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  encrypted_key TEXT NOT NULL,
  key_hint VARCHAR(4) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS org_ai_keys_org_idx ON org_ai_keys (organization_id);
