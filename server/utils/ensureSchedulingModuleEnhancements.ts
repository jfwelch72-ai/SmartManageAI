import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureSchedulingModuleEnhancements(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE schedule_dependency_type AS ENUM ('FS', 'SS', 'FF', 'SF');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await db.execute(sql`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SCHEDULE_TASK_RESCHEDULED'`);
    await db.execute(sql`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SCHEDULE_BASELINE_SLIP'`);

    await db.execute(sql`
      ALTER TABLE project_schedules
        ADD COLUMN IF NOT EXISTS look_ahead_horizon_weeks integer NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS last_slip_notified_at timestamp,
        ADD COLUMN IF NOT EXISTS last_slip_variance_days integer
    `);

    await db.execute(sql`
      ALTER TABLE project_schedule_tasks
        ADD COLUMN IF NOT EXISTS wbs_code varchar(64),
        ADD COLUMN IF NOT EXISTS outline_level integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cost_code_id varchar,
        ADD COLUMN IF NOT EXISTS purchase_order_id varchar,
        ADD COLUMN IF NOT EXISTS submittal_id varchar,
        ADD COLUMN IF NOT EXISTS external_source_ref varchar(128)
    `);

    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'schedule_task_dependencies'
      )::boolean AS table_exists
    `);
    const tableExists = tableCheck.rows[0]?.table_exists === true;

    if (!tableExists) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS schedule_task_dependencies (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          schedule_id varchar NOT NULL REFERENCES project_schedules(id) ON DELETE CASCADE,
          predecessor_task_id varchar NOT NULL REFERENCES project_schedule_tasks(id) ON DELETE CASCADE,
          successor_task_id varchar NOT NULL REFERENCES project_schedule_tasks(id) ON DELETE CASCADE,
          dependency_type schedule_dependency_type NOT NULL DEFAULT 'FS',
          lag_days integer NOT NULL DEFAULT 0,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS schedule_task_deps_schedule_idx ON schedule_task_dependencies(schedule_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS schedule_task_deps_successor_idx ON schedule_task_dependencies(successor_task_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS schedule_task_deps_predecessor_idx ON schedule_task_dependencies(predecessor_task_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS schedule_task_deps_unique_edge_idx ON schedule_task_dependencies(successor_task_id, predecessor_task_id)`);
      console.log("[migration] schedule_task_dependencies table — created");
    } else {
      console.log("[migration] schedule_task_dependencies table — already present, skipped");
    }

    // Ensure the unique edge index covers (successor, predecessor) only — older
    // builds may have created it as (successor, predecessor, dependency_type).
    await db.execute(sql`DROP INDEX IF EXISTS schedule_task_deps_unique_edge_idx`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS schedule_task_deps_unique_edge_idx
      ON schedule_task_dependencies(successor_task_id, predecessor_task_id)
    `);
  } catch (err) {
    logError(
      "[migration] Failed to ensure scheduling module enhancements:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
