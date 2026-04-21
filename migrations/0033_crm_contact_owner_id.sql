-- Task #699: explicit owner field on CRM contacts so reminders/automations can
-- route by current relationship owner instead of whoever first added the
-- contact (createdById). Backfill from createdById so existing routing is
-- preserved on first deploy.

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS owner_id VARCHAR
    REFERENCES users(id) ON DELETE SET NULL;

UPDATE crm_contacts
  SET owner_id = created_by_id
  WHERE owner_id IS NULL AND created_by_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_contacts_owner_idx
  ON crm_contacts (owner_id);
