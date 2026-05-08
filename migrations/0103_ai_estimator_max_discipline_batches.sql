-- Task #2626 — Per-org configurable cap on AI Estimator map-reduce batches
-- per discipline. Replaces the hardcoded MAX_DISCIPLINE_BATCHES=25 in
-- server/services/aiEstimator/mapReduceDraft.ts. Default of 25 keeps
-- existing behaviour for tenants that have not tuned this value.
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS max_discipline_batches integer NOT NULL DEFAULT 25;
