-- Task #2694: Portal Notification Inbox for External Users
-- Creates portal_notifications and portal_notification_prefs tables
-- for client, subcontractor, and vendor portal users.

CREATE TABLE IF NOT EXISTS portal_notifications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,
  client_portal_access_id VARCHAR REFERENCES client_portal_access(id) ON DELETE CASCADE,
  portal_token_id VARCHAR REFERENCES subcontractor_portal_tokens(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_notif_client_access_idx ON portal_notifications(client_portal_access_id);
CREATE INDEX IF NOT EXISTS portal_notif_portal_token_idx ON portal_notifications(portal_token_id);
CREATE INDEX IF NOT EXISTS portal_notif_user_id_idx ON portal_notifications(user_id);
CREATE INDEX IF NOT EXISTS portal_notif_org_created_idx ON portal_notifications(organization_id, created_at);
CREATE INDEX IF NOT EXISTS portal_notif_is_read_idx ON portal_notifications(is_read);

CREATE TABLE IF NOT EXISTS portal_notification_prefs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,
  client_portal_access_id VARCHAR REFERENCES client_portal_access(id) ON DELETE CASCADE,
  portal_token_id VARCHAR REFERENCES subcontractor_portal_tokens(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_notif_prefs_client_access_idx ON portal_notification_prefs(client_portal_access_id);
CREATE INDEX IF NOT EXISTS portal_notif_prefs_portal_token_idx ON portal_notification_prefs(portal_token_id);
CREATE INDEX IF NOT EXISTS portal_notif_prefs_user_id_idx ON portal_notification_prefs(user_id);

-- Partial unique indexes so we can do per-recipient upserts
CREATE UNIQUE INDEX IF NOT EXISTS portal_notif_prefs_client_uniq
  ON portal_notification_prefs(client_portal_access_id)
  WHERE client_portal_access_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS portal_notif_prefs_token_uniq
  ON portal_notification_prefs(portal_token_id)
  WHERE portal_token_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS portal_notif_prefs_user_uniq
  ON portal_notification_prefs(user_id)
  WHERE user_id IS NOT NULL;
