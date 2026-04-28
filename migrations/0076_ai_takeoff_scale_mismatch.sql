-- Task #2335 — Persist AI takeoff scale-mismatch evaluations.
--
-- Background: Task #2322 added an in-line amber banner to the AI takeoff
-- panel when the model's inferred drawing scale disagreed with the user's
-- calibrated px/ft by more than 5%. The warning was per-analysis only —
-- it lived in the JSON `metadata_json` blob and was never indexed, so an
-- estimator running 30 sheets had to eyeball each one and there was no
-- way to roll up calibration drift at the project / org level.
--
-- This migration materialises the result of that comparison onto
-- `ai_takeoff_analyses` so the AI takeoff dashboard can answer:
--   - "How many sheets in this project / org had a scale mismatch?"
--   - "What % of analyses tripped the warning this week?"
--   - "Which sheets are still misaligned (detected vs calibrated)?"
--
-- Columns:
--   `scale_mismatch_detected` — true when delta > 5% tolerance at write
--                               time; false on uncalibrated sheets or
--                               when the model didn't emit a parseable
--                               drawingScale (matches the existing
--                               `null result` semantics of the warning).
--   `detected_scale_label`   — model-emitted scale snapped to the nearest
--                               preset, e.g. `1/8" = 1'-0"`.
--   `calibrated_scale_label` — user's verified scale label / px-per-ft
--                               fallback as shown in the takeoff UI.
--   `scale_delta_percent`    — absolute relative delta (0.50 = 50% off);
--                               kept on every row (not just mismatches)
--                               so analysts can study near-threshold
--                               drift over time.
--
-- All four columns are nullable except the boolean (defaulted false) so
-- the migration is non-destructive on legacy rows. Idempotent ADD COLUMN
-- IF NOT EXISTS guards in case the columns were applied out-of-band.
ALTER TABLE "ai_takeoff_analyses"
  ADD COLUMN IF NOT EXISTS "scale_mismatch_detected" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "detected_scale_label" text,
  ADD COLUMN IF NOT EXISTS "calibrated_scale_label" text,
  ADD COLUMN IF NOT EXISTS "scale_delta_percent" double precision;

-- Composite index used by the dashboard rollup query
-- (organization_id + scale_mismatch_detected, ordered by created_at DESC
-- so "this week's mismatches" stays cheap on busy orgs).
CREATE INDEX IF NOT EXISTS "ai_takeoff_scale_mismatch_idx"
  ON "ai_takeoff_analyses" ("organization_id", "scale_mismatch_detected", "created_at");
