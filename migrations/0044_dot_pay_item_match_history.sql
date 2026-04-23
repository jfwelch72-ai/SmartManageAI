-- Task #1164 — record accept/reject decisions on auto-suggested DOT pay items
-- so the matcher can boost frequently-used items per org/agency on subsequent
-- bid-tab imports.

CREATE TABLE IF NOT EXISTS dot_pay_item_match_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agency_id varchar REFERENCES dot_agencies(id) ON DELETE SET NULL,
  pay_item_id varchar NOT NULL REFERENCES dot_pay_items(id) ON DELETE CASCADE,
  description_normalized text NOT NULL,
  description_raw text NOT NULL,
  accepted boolean NOT NULL,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_desc_idx
  ON dot_pay_item_match_history(organization_id, description_normalized);
CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_item_idx
  ON dot_pay_item_match_history(organization_id, pay_item_id);
CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_agency_idx
  ON dot_pay_item_match_history(organization_id, agency_id);
