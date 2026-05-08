import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2690 — Hardened PM work-order idempotency.
 *
 * Idempotent startup helper that mirrors
 * `migrations/0107_equipment_repairs_pm_idempotency.sql`:
 *   1. Adds the nullable `schedule_id` FK + `pm_cycle_key` text column to
 *      `equipment_repairs`.
 *   2. Backfills both columns from any historical `[PM:<uuid>]` description
 *      prefix written by the pre-Task-#2690 engine.
 *   3. Cancels any pre-existing duplicate active rows that would block the
 *      partial unique index, preserving the oldest one so the audit trail
 *      stays intact.
 *   4. Installs the partial unique index that is the load-bearing
 *      idempotency mechanism — a second insert for the same
 *      `(schedule_id, pm_cycle_key)` while the first row's status is
 *      anything other than COMPLETED / CANCELLED fails with SQLSTATE 23505.
 */
export async function ensureEquipmentRepairsPmIdempotency(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE equipment_repairs
        ADD COLUMN IF NOT EXISTS schedule_id varchar
          REFERENCES equipment_maintenance_schedules(id) ON DELETE SET NULL
    `);

    await db.execute(sql`
      ALTER TABLE equipment_repairs
        ADD COLUMN IF NOT EXISTS pm_cycle_key text
    `);

    await db.execute(sql`
      UPDATE equipment_repairs er
         SET schedule_id = ms.id
        FROM equipment_maintenance_schedules ms
       WHERE er.schedule_id IS NULL
         AND er.description ~ '\\[PM:[0-9a-fA-F-]+\\]'
         AND substring(er.description from '\\[PM:([0-9a-fA-F-]+)\\]') = ms.id
    `);

    await db.execute(sql`
      UPDATE equipment_repairs er
         SET pm_cycle_key = COALESCE(
               to_char(ms.next_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
               to_char(ms.last_performed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
               to_char(er.problem_reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
             )
        FROM equipment_maintenance_schedules ms
       WHERE er.pm_cycle_key IS NULL
         AND er.schedule_id IS NOT NULL
         AND er.schedule_id = ms.id
    `);

    // NON-DESTRUCTIVE pre-existing duplicate handling. Do NOT auto-
    // cancel live work orders here. Instead, NULL out pm_cycle_key on
    // the older duplicates so the partial unique-index predicate
    // (`pm_cycle_key IS NOT NULL`) excludes them, leaving the oldest
    // row per group as the canonical live cycle. The periodic audit
    // job (`auditPmWorkOrderDuplicates`) surfaces both kinds of orphan
    // for human triage.
    await db.execute(sql`
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
         AND ranked.rn > 1
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS equipment_repairs_pm_active_cycle_uq
        ON equipment_repairs (schedule_id, pm_cycle_key)
        WHERE status NOT IN ('COMPLETED', 'CANCELLED')
          AND schedule_id IS NOT NULL
          AND pm_cycle_key IS NOT NULL
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS equipment_repairs_schedule_idx
        ON equipment_repairs (schedule_id)
        WHERE schedule_id IS NOT NULL
    `);

    logInfo("[migration] equipment_repairs PM idempotency — applied");
  } catch (err) {
    logError(
      "[migration] Failed to ensure equipment_repairs PM idempotency:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
