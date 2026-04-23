-- Task #1404: per-connection (and optional per-entityType) mute state for
-- the INTEGRATION_SYNC_RETRIES_EXHAUSTED admin fan-out. Lets org admins
-- silence the notification for a chronically broken integration until
-- they've finished investigating — similar in spirit to the Davis-Bacon
-- mute token (but here the mute is scoped to the integration connection,
-- not the recipient).
--
-- A row with entity_type = NULL mutes every entity type on the
-- connection; a row with a specific entity_type mutes only that pair.
-- The COALESCE expression index enforces "one mute per (connection,
-- entity_type)" because a plain UNIQUE constraint treats NULLs as
-- distinct.
--
-- Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS integration_sync_alert_mutes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id varchar NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  entity_type text,
  muted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_sync_alert_mutes_org_idx
  ON integration_sync_alert_mutes(organization_id);
CREATE INDEX IF NOT EXISTS integration_sync_alert_mutes_connection_idx
  ON integration_sync_alert_mutes(connection_id);
CREATE UNIQUE INDEX IF NOT EXISTS integration_sync_alert_mutes_conn_entity_uniq
  ON integration_sync_alert_mutes(connection_id, COALESCE(entity_type, ''));
