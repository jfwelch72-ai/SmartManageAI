-- Task #924: Bulk-edit toolbar in the Calls tab needs to reassign ownership and
-- stamp follow-up dates without overwriting the original logger (createdById).
-- Adds an explicit owner_id (backfilled from created_by_id so existing routing
-- is preserved) and a follow_up_at timestamp.

ALTER TABLE crm_calls
  ADD COLUMN IF NOT EXISTS owner_id VARCHAR
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE crm_calls
  ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMP;

UPDATE crm_calls
  SET owner_id = created_by_id
  WHERE owner_id IS NULL AND created_by_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_calls_owner_idx
  ON crm_calls (owner_id);

CREATE INDEX IF NOT EXISTS crm_calls_follow_up_at_idx
  ON crm_calls (follow_up_at);
