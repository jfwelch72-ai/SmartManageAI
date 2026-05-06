-- Task #1173: Notify the assigned team when SWPPP corrective actions go overdue.
-- Adds a per-inspection dedupe marker so the nightly overdue sweep only
-- fans out one notification per overdue cycle. The column is cleared
-- back to NULL by the SWPPP routes when the corrective action due date
-- is moved forward or the inspection is re-opened, which re-arms the
-- next overdue cycle naturally.
ALTER TABLE swppp_inspections
  ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamp;
