-- Task #1069: capture which admin clicked Resend on a previously-failed
-- alert delivery so the in-app history can show "Resent by Jane at 3:14pm"
-- next to the new outcome row. Automatic dispatches written by the
-- backfill worker keep `source='automatic'` and `triggered_by_id=NULL`,
-- preserving their existing rendering.
ALTER TABLE crm_transcript_backfill_alert_deliveries
  ADD COLUMN IF NOT EXISTS triggered_by_id varchar,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'automatic';
