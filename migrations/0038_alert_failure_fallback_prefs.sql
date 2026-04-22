-- Task #1066: per-admin mute for the Task #1051 alert delivery failure
-- fallback emails. `crm_backfill_summary_channel = 'none'` already
-- silences both the run summary AND these fallback emails, but admins
-- who still want completion summaries need a way to mute just the
-- failure fan-out, optionally only for a specific failing channel.
--
-- Defaults preserve existing behavior (every admin keeps getting the
-- fallback emails for both Slack and email failures).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS crm_alert_failure_fallback_enabled boolean
    NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS crm_alert_failure_fallback_muted_channels text[]
    NOT NULL DEFAULT '{}'::text[];
