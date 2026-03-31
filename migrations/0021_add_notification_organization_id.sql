-- Add organizationId column to notifications table for cross-org isolation
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id VARCHAR REFERENCES organizations(id);

-- Create composite index for org-scoped notification queries
CREATE INDEX IF NOT EXISTS notifications_org_user_read_idx ON notifications (organization_id, user_id, is_read);

-- Backfill existing notifications from user's organization
UPDATE notifications n
SET organization_id = u.organization_id
FROM users u
WHERE n.user_id = u.id
  AND n.organization_id IS NULL
  AND u.organization_id IS NOT NULL;
