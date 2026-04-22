-- Task #799: Scheduling module (Gantt + Critical Path) enhancements.
-- Adds typed dependencies (FS/SS/FF/SF + lag), WBS/outline metadata on
-- schedule tasks, look-ahead horizon and slip-tracking fields on schedules,
-- and notification types used to alert stakeholders when activities slip.

DO $$ BEGIN
  CREATE TYPE schedule_dependency_type AS ENUM ('FS', 'SS', 'FF', 'SF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SCHEDULE_TASK_RESCHEDULED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SCHEDULE_BASELINE_SLIP';

ALTER TABLE project_schedules
  ADD COLUMN IF NOT EXISTS look_ahead_horizon_weeks integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_slip_notified_at timestamp,
  ADD COLUMN IF NOT EXISTS last_slip_variance_days integer;

ALTER TABLE project_schedule_tasks
  ADD COLUMN IF NOT EXISTS wbs_code varchar(64),
  ADD COLUMN IF NOT EXISTS outline_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_code_id varchar,
  ADD COLUMN IF NOT EXISTS purchase_order_id varchar,
  ADD COLUMN IF NOT EXISTS submittal_id varchar,
  ADD COLUMN IF NOT EXISTS external_source_ref varchar(128);

CREATE TABLE IF NOT EXISTS schedule_task_dependencies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id varchar NOT NULL REFERENCES project_schedules(id) ON DELETE CASCADE,
  predecessor_task_id varchar NOT NULL REFERENCES project_schedule_tasks(id) ON DELETE CASCADE,
  successor_task_id varchar NOT NULL REFERENCES project_schedule_tasks(id) ON DELETE CASCADE,
  dependency_type schedule_dependency_type NOT NULL DEFAULT 'FS',
  lag_days integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_task_deps_schedule_idx
  ON schedule_task_dependencies(schedule_id);
CREATE INDEX IF NOT EXISTS schedule_task_deps_successor_idx
  ON schedule_task_dependencies(successor_task_id);
CREATE INDEX IF NOT EXISTS schedule_task_deps_predecessor_idx
  ON schedule_task_dependencies(predecessor_task_id);
CREATE UNIQUE INDEX IF NOT EXISTS schedule_task_deps_unique_edge_idx
  ON schedule_task_dependencies(successor_task_id, predecessor_task_id);
