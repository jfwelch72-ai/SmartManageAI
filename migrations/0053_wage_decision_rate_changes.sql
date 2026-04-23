-- Task #1409: per-classification record of the most recent stale-refresh
-- diff for a Davis-Bacon wage decision. processStaleWageDecisions writes
-- one row per (organizationId, decisionNumber, classification) whose
-- rate changed in the latest auto-refresh, replacing any earlier row
-- for the same triple. The project prevailing wage panel reads these
-- rows to flag classifications whose rate just shifted, so PMs can
-- reconcile certified payrolls without cross-referencing the email
-- notification fan-out from Task #1400. The flag clears either when a
-- PM acknowledges it (acknowledged_at is set) or when a subsequent
-- refresh produces no diff for that classification (the row is deleted).
--
-- Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS wage_decision_rate_changes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_number text NOT NULL,
  classification text NOT NULL,
  change_kind text NOT NULL,
  old_base_rate numeric(10, 2),
  new_base_rate numeric(10, 2),
  old_fringe_rate numeric(10, 2),
  new_fringe_rate numeric(10, 2),
  old_total_rate numeric(10, 2),
  new_total_rate numeric(10, 2),
  detected_at timestamp NOT NULL DEFAULT now(),
  acknowledged_at timestamp,
  acknowledged_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wage_decision_rate_changes_org_decision_idx
  ON wage_decision_rate_changes(organization_id, decision_number);
CREATE UNIQUE INDEX IF NOT EXISTS wage_decision_rate_changes_org_decision_class_uniq
  ON wage_decision_rate_changes(organization_id, decision_number, classification);
