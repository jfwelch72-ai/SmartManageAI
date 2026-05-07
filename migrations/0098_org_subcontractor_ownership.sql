-- Per-org link to global subcontractors directory.
-- Backfills any existing org<->sub relationships from subcontractor_bid_invitations.
CREATE TABLE IF NOT EXISTS org_subcontractor_ownership (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subcontractor_id varchar NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  source varchar(20) NOT NULL DEFAULT 'CSV_IMPORT',
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT org_sub_ownership_unique UNIQUE (organization_id, subcontractor_id)
);
CREATE INDEX IF NOT EXISTS org_sub_ownership_org_idx ON org_subcontractor_ownership(organization_id);
CREATE INDEX IF NOT EXISTS org_sub_ownership_sub_idx ON org_subcontractor_ownership(subcontractor_id);
