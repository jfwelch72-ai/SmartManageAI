-- Task #1115: Let inspectors mark SWPPP corrective actions as resolved.
-- Adds an open/resolved status flag plus who/when resolved it so the list
-- can highlight outstanding storm-water work and overdue items.
ALTER TABLE swppp_inspections
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS resolved_at timestamp,
  ADD COLUMN IF NOT EXISTS resolved_by_id varchar REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolution_notes text;

-- Backfill: any inspection that already had a completion timestamp should
-- be considered resolved so existing records don't suddenly look "open".
UPDATE swppp_inspections
   SET status = 'RESOLVED',
       resolved_at = corrective_action_completed_at
 WHERE corrective_action_completed_at IS NOT NULL
   AND status = 'OPEN';

CREATE INDEX IF NOT EXISTS swppp_status_idx ON swppp_inspections(status);
