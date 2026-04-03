CREATE TABLE IF NOT EXISTS executive_digests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  executive_summary TEXT NOT NULL,
  key_highlights JSON NOT NULL,
  sections JSON NOT NULL,
  action_items JSON NOT NULL,
  kpi_snapshot JSON NOT NULL,
  generated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS executive_digests_org_period_idx ON executive_digests(organization_id, period);
CREATE INDEX IF NOT EXISTS executive_digests_generated_at_idx ON executive_digests(generated_at);
