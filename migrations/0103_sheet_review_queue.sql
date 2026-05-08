-- Task #2623 — Sheet classification confidence + review queue.
--
-- 1. Per-sheet numeric confidence (0..1) and free-text rationale on
--    `takeoff_sheets`, alongside the existing coarse band column. The
--    raw 0..1 score drives the "needs review" filter and the band is
--    kept for backward compatibility with existing UI.
-- 2. Reviewer audit columns (`reviewed_by_id`, `reviewed_at`) populated
--    when an estimator confirms or overrides the AI classification.
-- 3. Per-org `low_confidence_threshold` (default 0.6) on
--    `ai_estimator_org_factors` so each tenant can tune what counts as
--    "needs review" without a code change.
--
-- All operations are idempotent so the file is safe to replay.

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS discipline_confidence_score double precision;

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS discipline_rationale text;

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS reviewed_by_id varchar REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp;

-- Partial index supporting the "needs review" queue: rows that the AI
-- (or heuristic) classified but a human has not yet confirmed.
CREATE INDEX IF NOT EXISTS takeoff_sheets_review_queue_idx
  ON takeoff_sheets (bid_id, discipline_confidence_score)
  WHERE discipline_source IS NOT NULL AND discipline_source <> 'USER';

ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS low_confidence_threshold double precision NOT NULL DEFAULT 0.6;
