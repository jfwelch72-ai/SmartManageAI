-- 0108_mobile_sync_events.sql
-- Task #2693: Mobile Sync Conflict Resolution Hardening
-- Structured event log for every push sync operation, recording strategy,
-- outcome, and both versions on conflicts for PM review.

CREATE TABLE IF NOT EXISTS mobile_sync_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  device_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,

  local_id TEXT,
  server_id TEXT,

  operation TEXT NOT NULL,

  strategy TEXT NOT NULL,

  outcome TEXT NOT NULL,

  client_timestamp TIMESTAMPTZ,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  logical_clock INTEGER,

  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,

  conflict_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mobile_sync_events_org_idx ON mobile_sync_events(organization_id);
CREATE INDEX IF NOT EXISTS mobile_sync_events_device_idx ON mobile_sync_events(device_id);
CREATE INDEX IF NOT EXISTS mobile_sync_events_entity_type_idx ON mobile_sync_events(entity_type);
CREATE INDEX IF NOT EXISTS mobile_sync_events_outcome_idx ON mobile_sync_events(outcome);
CREATE INDEX IF NOT EXISTS mobile_sync_events_created_at_idx ON mobile_sync_events(created_at);

-- Add logical_clock column to outbox table if it doesn't already exist
-- (used to track Lamport timestamps from mobile devices)
ALTER TABLE offline_sync_queue ADD COLUMN IF NOT EXISTS logical_clock INTEGER;
