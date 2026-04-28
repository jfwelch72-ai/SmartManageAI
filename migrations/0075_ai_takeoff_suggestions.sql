-- Task #2323 — AI takeoff closed-loop feedback
--
-- One row per AI-detected item plus a per-org confidence calibration
-- table. The JSON blob on `ai_takeoff_analyses.detected_items_json`
-- stays for backward-compat reads, but tracking (accept / reject /
-- edit-and-accept) lives on the new `ai_takeoff_suggestions` table
-- so the per-org accuracy dashboard and the nightly calibration job
-- can aggregate without a JSON parse.
--
-- The companion startup helper `ensureAiTakeoffSuggestionsTables`
-- is idempotent and ALSO backfills one PENDING suggestion row per
-- detected item from existing `detected_items_json` blobs, so
-- long-lived dev DBs without a fresh `npm run db:push` still get the
-- backfill on next boot.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_takeoff_suggestion_status') THEN
    CREATE TYPE ai_takeoff_suggestion_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EDITED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_takeoff_reject_reason') THEN
    CREATE TYPE ai_takeoff_reject_reason AS ENUM (
      'WRONG_TRADE', 'DUPLICATE', 'NOT_PRESENT',
      'WRONG_QUANTITY', 'WRONG_LOCATION', 'OTHER'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_takeoff_suggestions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id varchar NOT NULL REFERENCES ai_takeoff_analyses(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trade_type trade_type NOT NULL,
  item_key text NOT NULL,
  item_type text NOT NULL,
  description text NOT NULL,
  quantity double precision NOT NULL,
  unit text NOT NULL,
  confidence double precision NOT NULL,
  bounding_box_json text,
  status ai_takeoff_suggestion_status NOT NULL DEFAULT 'PENDING',
  reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  accepted_measurement_id varchar REFERENCES takeoff_measurements(id) ON DELETE SET NULL,
  edited_quantity double precision,
  edited_unit text,
  edited_item_type text,
  reject_reason ai_takeoff_reject_reason,
  reject_note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_takeoff_sug_analysis_idx
  ON ai_takeoff_suggestions (analysis_id);
CREATE INDEX IF NOT EXISTS ai_takeoff_sug_org_trade_status_idx
  ON ai_takeoff_suggestions (organization_id, trade_type, status);

CREATE TABLE IF NOT EXISTS ai_takeoff_confidence_calibration (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trade_type trade_type NOT NULL,
  model_confidence_bucket integer NOT NULL,
  empirical_acceptance_rate double precision NOT NULL,
  sample_count integer NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_takeoff_calib_org_trade_bucket_uq
  ON ai_takeoff_confidence_calibration (organization_id, trade_type, model_confidence_bucket);
