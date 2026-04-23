-- Task #1247 — add batch_id so all rows recorded by a single bid-tab import
-- share an identifier. The post-import "Remembered N pay-item choices — Undo"
-- toast uses the batch id to delete the whole feedback batch in one click.
ALTER TABLE dot_pay_item_match_history
  ADD COLUMN IF NOT EXISTS batch_id varchar;

CREATE INDEX IF NOT EXISTS dot_pay_item_match_history_org_batch_idx
  ON dot_pay_item_match_history(organization_id, batch_id);
