-- Task #2625 — Auto-takeoff revision diff view.
-- Stores each successful auto-takeoff (map-reduce) run as an immutable
-- revision so estimators can pick two runs and diff them side-by-side
-- before promoting selected entries into the live takeoff.
--
-- Schema is also declared in `shared/schema/features/ai_estimator.ts`
-- and is auto-applied by `reconcileSchemaDrift` at boot; this migration
-- file exists so the table is also created on environments that bypass
-- the drift reconciler (e.g. fresh deploys that ship `migrations/`).

CREATE TABLE IF NOT EXISTS ai_takeoff_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bid_id varchar NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'map_reduce',
  plan_set_version jsonb,
  model_id text,
  prompt_version text,
  provider text,
  disciplines jsonb,
  measurements jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  confidence integer,
  discipline_coverage jsonb,
  llm_call_count integer,
  partial boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_takeoff_revisions_org_idx ON ai_takeoff_revisions (organization_id);
CREATE INDEX IF NOT EXISTS ai_takeoff_revisions_bid_idx ON ai_takeoff_revisions (bid_id);
CREATE INDEX IF NOT EXISTS ai_takeoff_revisions_created_at_idx ON ai_takeoff_revisions (created_at);
