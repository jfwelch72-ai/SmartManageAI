-- Task #1472: durable per-org history of `davis_bacon.suppression_reset`
-- audit events. Previously this lived in a process-local ring buffer in
-- server/integrations/audit.ts, so a server restart or redeploy wiped
-- the "Last reset by X at Y" history surfaced on the integrations panel.
-- The structured audit logger remains the canonical record; this table
-- is just a fast, org-scoped feed for the UI's most-recent-N display.
--
-- Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS integration_suppression_resets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id varchar NOT NULL,
  decision_number text NOT NULL,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  cleared boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_suppression_resets_org_created_idx
  ON integration_suppression_resets (organization_id, created_at);
