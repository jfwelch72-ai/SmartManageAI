-- Task #2577 — Takeoff & Estimating Phase B.
--
-- Adds:
--   * takeoff_sheets per-page extracted text cache (text-layer + OCR fallback)
--   * ai_estimator_legend_symbols.review_status for the schedule symbol
--     review lifecycle (PENDING_REVIEW / ACCEPTED / REJECTED / EDITED).
--   * takeoff_measurements.source_symbol_id + a partial unique index so
--     re-accepting the same schedule symbol UPDATEs the existing
--     measurement instead of inserting a duplicate.

ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS extracted_text_by_page jsonb;
ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS extracted_text_source text;
ALTER TABLE takeoff_sheets
  ADD COLUMN IF NOT EXISTS extracted_text_at timestamp;

ALTER TABLE ai_estimator_legend_symbols
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'PENDING_REVIEW';

CREATE INDEX IF NOT EXISTS ai_estimator_legend_symbols_review_status_idx
  ON ai_estimator_legend_symbols (review_status);

ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS source_symbol_id varchar;

CREATE UNIQUE INDEX IF NOT EXISTS takeoff_measurements_source_symbol_uniq
  ON takeoff_measurements (source_symbol_id)
  WHERE source_symbol_id IS NOT NULL;
