-- 0107_equipment_repairs_pm_idempotency.sql
--
-- Task #2690 — Harden PM work-order idempotency with a real DB constraint.
--
-- Replaces the application-level `description LIKE '%[PM:<id>]%'` guard in
-- `server/equipmentPmEngine.ts` with:
--   1. A real FK from equipment_repairs.schedule_id to equipment_maintenance_schedules(id)
--      (nullable, ON DELETE SET NULL) — so a deleted schedule doesn't cascade away
--      the historical work order.
--   2. A pm_cycle_key text column that uniquely identifies a single PM occurrence
--      (the schedule's nextDueAt snapshot at generation time, or a YYYY-MM-DD
--      cycle stamp for hours-only schedules).
--   3. A partial unique index over (schedule_id, pm_cycle_key) WHERE status
--      NOT IN ('COMPLETED','CANCELLED') so a second insert for the same active
--      cycle fails at the DB layer regardless of pod / race / tag mutation.
--
-- Also backfills schedule_id (and pm_cycle_key where derivable) on existing
-- PM-tagged rows by parsing the `[PM:<id>]` prefix of `description`.
--
-- Idempotent — safe to replay.

ALTER TABLE equipment_repairs
  ADD COLUMN IF NOT EXISTS schedule_id varchar
    REFERENCES equipment_maintenance_schedules(id) ON DELETE SET NULL;

ALTER TABLE equipment_repairs
  ADD COLUMN IF NOT EXISTS pm_cycle_key text;

-- Backfill schedule_id from any historical `[PM:<uuid>]` description prefix.
-- Rows whose extracted id no longer resolves to a live schedule are left
-- with schedule_id = NULL on purpose so the audit job can flag them.
UPDATE equipment_repairs er
   SET schedule_id = ms.id
  FROM equipment_maintenance_schedules ms
 WHERE er.schedule_id IS NULL
   AND er.description ~ '\[PM:[0-9a-fA-F-]+\]'
   AND substring(er.description from '\[PM:([0-9a-fA-F-]+)\]') = ms.id;

-- Backfill pm_cycle_key from the schedule's tracking columns where possible.
-- Prefer next_due_at, fall back to last_performed_at, fall back to the
-- repair's problem_reported_at date so every backfilled row gets a stable key.
UPDATE equipment_repairs er
   SET pm_cycle_key = COALESCE(
         to_char(ms.next_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
         to_char(ms.last_performed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
         to_char(er.problem_reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       )
  FROM equipment_maintenance_schedules ms
 WHERE er.pm_cycle_key IS NULL
   AND er.schedule_id IS NOT NULL
   AND er.schedule_id = ms.id;

-- NON-DESTRUCTIVE pre-existing duplicate handling. We deliberately do
-- NOT auto-cancel live work orders here — that would be silent business-
-- data mutation in a hardening migration. Instead, if any duplicate
-- active rows exist, we install the unique index in a way that lets
-- the existing data sit (the partial predicate is satisfied because
-- duplicate rows are still all in active statuses, but Postgres will
-- raise on the CREATE UNIQUE INDEX if the data violates it). To avoid
-- failing the migration on those pre-existing duplicates, we (a) leave
-- their pm_cycle_key NULL on the older duplicates so the partial
-- predicate (`pm_cycle_key IS NOT NULL`) excludes them from the index,
-- and (b) rely on the periodic audit job + ops dashboard to surface
-- them for human triage. The newer (oldest by problem_reported_at)
-- duplicate keeps its key and is the one the engine will treat as the
-- live cycle.
UPDATE equipment_repairs er
   SET pm_cycle_key = NULL
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY schedule_id, pm_cycle_key
             ORDER BY problem_reported_at ASC, id ASC
           ) AS rn
      FROM equipment_repairs
     WHERE schedule_id IS NOT NULL
       AND pm_cycle_key IS NOT NULL
       AND status NOT IN ('COMPLETED','CANCELLED')
  ) ranked
 WHERE er.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS equipment_repairs_pm_active_cycle_uq
  ON equipment_repairs (schedule_id, pm_cycle_key)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED')
    AND schedule_id IS NOT NULL
    AND pm_cycle_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS equipment_repairs_schedule_idx
  ON equipment_repairs (schedule_id)
  WHERE schedule_id IS NOT NULL;
