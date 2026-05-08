-- Task #2628 — Close the AI takeoff calibration feedback loop.
--
-- 1. `ai_estimator_calibration_exemplars` — per-(org, trade) curated
--    few-shot set rebuilt nightly from `ai_takeoff_suggestions` reviews.
--    Fed back into the takeoff-draft prompt so subsequent drafts learn
--    from actual user edits / rejects rather than only generic priors.
-- 2. `ai_estimator_calibration_nudges` — admin-reviewable per-trade
--    bias suggestions produced when the team has consistently edited
--    AI quantities away from 1.0x. Accept = write a calibration factor
--    that the prompt also surfaces.
-- 3. `ai_estimator_accuracy_snapshots` — daily accuracy / acceptance /
--    MAPE roll-ups powering the per-org trend dashboard.
-- 4. `trade_calibration_factors` jsonb on `ai_estimator_org_factors` —
--    where ACCEPTED nudges land so the next draft prompt picks them up.
--
-- All operations are idempotent so the file is safe to replay.

ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS trade_calibration_factors jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS ai_estimator_calibration_exemplars (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trade_type text,
  kind text NOT NULL,
  label text NOT NULL,
  item_type text,
  unit text,
  original_quantity double precision,
  final_quantity double precision,
  reject_reason text,
  comment text,
  source_suggestion_id varchar,
  generated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_estimator_calib_exemplar_org_trade_idx
  ON ai_estimator_calibration_exemplars (organization_id, trade_type);

CREATE TABLE IF NOT EXISTS ai_estimator_calibration_nudges (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trade_type text,
  metric text NOT NULL,
  unit text,
  suggested_factor double precision NOT NULL,
  basis text NOT NULL,
  sample_size integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  reviewed_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_estimator_calib_nudge_org_status_idx
  ON ai_estimator_calibration_nudges (organization_id, status);

CREATE TABLE IF NOT EXISTS ai_estimator_accuracy_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trade_type text,
  window_start timestamp NOT NULL,
  window_end timestamp NOT NULL,
  total_suggestions integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  edited_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  acceptance_rate double precision,
  mape double precision,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_estimator_accuracy_org_window_idx
  ON ai_estimator_accuracy_snapshots (organization_id, window_end);
