-- Task #1480: append-only audit history of every PM acknowledgement of a
-- Davis-Bacon rate-change flag. The base `wage_decision_rate_changes`
-- table holds at most one row per (organization, decision, classification)
-- — a re-arm via a subsequent stale-refresh diff overwrites the prior
-- acknowledged_at/acknowledged_by_user_id, so it cannot satisfy auditors
-- who want a full chronological trail of every acknowledgement event,
-- including superseded and auto-cleared ones. This table captures each
-- acknowledgement event with the diff payload that was acknowledged so
-- the prevailing-wage panel's "View history" affordance can render the
-- complete trail per classification.
--
-- Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS wage_decision_rate_change_acknowledgements (
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
  detected_at timestamp NOT NULL,
  acknowledged_at timestamp NOT NULL DEFAULT now(),
  acknowledged_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wage_decision_rate_change_ack_org_decision_class_idx
  ON wage_decision_rate_change_acknowledgements(organization_id, decision_number, classification);
CREATE INDEX IF NOT EXISTS wage_decision_rate_change_ack_acknowledged_at_idx
  ON wage_decision_rate_change_acknowledgements(acknowledged_at);
