-- Task #2414 — Claude knowledge-index enrichment pass.
--
-- Adds columns that back the post-ingestion enrichment step in
-- `server/services/aiEstimator/enrichment.ts`:
--   • ai_estimator_knowledge_index.enriched_summary — 1–4 sentence
--     narrative summary written by Claude. Falls back to
--     `content_snippet` when null (org without AI_PROVIDER_TAKEOFF,
--     enrichment errored, or row not yet enriched).
--   • ai_estimator_knowledge_index.enriched_at — timestamp the
--     enrichment was written; unset when no enrichment ran.
--   • ai_estimator_ingest_runs.rows_enriched — counter for the
--     number of knowledge-index rows the post-ingestion pass enriched
--     during the run.
--
-- All idempotent ADD COLUMN IF NOT EXISTS so the file is safe to
-- replay; reconcileSchemaDrift would also auto-add these on a fresh
-- dev DB but the explicit migration keeps long-lived dev/prod DBs
-- in sync without an extra `npx drizzle-kit push`.

ALTER TABLE ai_estimator_knowledge_index
  ADD COLUMN IF NOT EXISTS enriched_summary text;

ALTER TABLE ai_estimator_knowledge_index
  ADD COLUMN IF NOT EXISTS enriched_at timestamp;

ALTER TABLE ai_estimator_ingest_runs
  ADD COLUMN IF NOT EXISTS rows_enriched integer NOT NULL DEFAULT 0;
