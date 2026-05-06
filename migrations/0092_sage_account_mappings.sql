-- Task #1600 — Sage Intacct Phase A: per-(connection, costCode, mappingType)
-- mapping table that records the Sage GL account a SmartManageAI cost code
-- should post against when journalising via the Sage Intacct XML Gateway.
-- Mirrors qbo_account_mappings (migrations/0006*) so the admin Sage mapping
-- panel can reuse the QBO panel's CRUD/auto-map workflow.
CREATE TABLE IF NOT EXISTS sage_account_mappings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id varchar NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  cost_code text NOT NULL,
  sage_account_id text NOT NULL,
  sage_account_name text NOT NULL,
  mapping_type text NOT NULL DEFAULT 'cost_code',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sage_account_mappings_org_idx
  ON sage_account_mappings(organization_id);

CREATE INDEX IF NOT EXISTS sage_account_mappings_connection_idx
  ON sage_account_mappings(connection_id);

CREATE UNIQUE INDEX IF NOT EXISTS sage_account_mappings_unique
  ON sage_account_mappings(organization_id, connection_id, cost_code, mapping_type);
