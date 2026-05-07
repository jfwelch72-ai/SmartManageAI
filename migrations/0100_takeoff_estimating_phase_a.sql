-- Task #2576 — Takeoff & Estimating Phase A (Trustworthiness).
--
-- Additive only; safe to replay.
--
-- 1) Org-level estimating factors: extend `ai_estimator_org_factors` with
--    explicit roll-up percentages (labor burden, small tools, OH, profit,
--    bond, escalation). Existing rows backfill to 0 (= no markup).
-- 2) Per-estimate factor override: optional column on `estimates` storing a
--    JSON snapshot of the org factors at write time so an estimate can pin
--    a value that differs from the current org default. Audited at the
--    route level via `audit_log`.
-- 3) Takeoff scope tag: BASE vs CO. New `scope_tag` column on
--    `takeoff_measurements` (default 'BASE') plus a nullable
--    `change_order_id` FK so a CO-scoped measurement points at its CO.

ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS labor_burden_percent double precision NOT NULL DEFAULT 0;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS small_tools_percent double precision NOT NULL DEFAULT 0;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS overhead_percent double precision NOT NULL DEFAULT 0;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS profit_percent double precision NOT NULL DEFAULT 0;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS bond_percent double precision NOT NULL DEFAULT 0;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS escalation_percent double precision NOT NULL DEFAULT 0;
ALTER TABLE ai_estimator_org_factors
  ADD COLUMN IF NOT EXISTS default_waste_factor double precision NOT NULL DEFAULT 0;

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS estimating_factors_override jsonb;

ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS scope_tag text NOT NULL DEFAULT 'BASE';
ALTER TABLE takeoff_measurements
  ADD COLUMN IF NOT EXISTS change_order_id varchar;

CREATE INDEX IF NOT EXISTS takeoff_measurements_scope_tag_idx
  ON takeoff_measurements (scope_tag);
CREATE INDEX IF NOT EXISTS takeoff_measurements_change_order_idx
  ON takeoff_measurements (change_order_id)
  WHERE change_order_id IS NOT NULL;
