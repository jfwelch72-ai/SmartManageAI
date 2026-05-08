import { db } from "./db";
import { equipment, equipmentMaintenanceSchedules, equipmentRepairs } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * PM auto-WO generation engine.
 *
 * Walks active maintenance schedules and creates a PENDING entry in
 * `equipment_repairs` for any schedule that is currently due (by date or
 * hour-meter), provided one is not already open for the same schedule
 * cycle.
 *
 * Idempotency contract (Task #2690)
 * --------------------------------
 * Each PM-generated row carries:
 *   - `schedule_id` — real FK back to the originating
 *     `equipment_maintenance_schedules` row.
 *   - `pm_cycle_key` — a stable string that identifies a single PM
 *     occurrence (`nextDueAt` snapshot for date-based schedules, or a
 *     `YYYY-MM-DD` cycle stamp for hours-only schedules).
 * A partial unique index on `(schedule_id, pm_cycle_key) WHERE status
 * NOT IN ('COMPLETED','CANCELLED')` enforces "at most one active WO per
 * cycle" at the DB layer. Concurrent runs across pods that lose the
 * race get a SQLSTATE `23505` unique-violation, which the engine maps
 * to `skippedReasons.raceLost` instead of crashing. The legacy
 * `[PM:<scheduleId>]` description prefix is still written for human
 * readability but is no longer load-bearing.
 */
export interface PmGenerationSkipReasons {
  alreadyOpen: number;
  raceLost: number;
  notDue: number;
}

export interface PmGenerationResult {
  /** Total schedules walked (after the optional org filter). */
  checked: number;
  /** Number of brand-new PENDING repairs inserted this tick. */
  generated: number;
  /** Total schedules skipped this tick (sum of `skippedReasons`). */
  skipped: number;
  /** Per-reason breakdown of `skipped`. */
  skippedReasons: PmGenerationSkipReasons;
  /**
   * Schedule IDs for which a new WO was inserted. Kept for the
   * existing route response shape and the cron summary log.
   */
  scheduleIds: string[];
}

const PM_TAG = (scheduleId: string) => `[PM:${scheduleId}]`;

/**
 * Build the stable per-cycle key the partial unique index is keyed on.
 * Prefer the schedule's `nextDueAt` snapshot when present (datetime ISO
 * trimmed to seconds — millisecond jitter would otherwise let us insert
 * two rows for the "same" cycle), and fall back to a YYYY-MM-DD stamp
 * computed from `now` so an hours-only schedule still gets at most one
 * row per day.
 */
export function buildPmCycleKey(opts: {
  nextDueAt: Date | null | undefined;
  now: Date;
}): string {
  const { nextDueAt, now } = opts;
  if (nextDueAt instanceof Date && !Number.isNaN(nextDueAt.getTime())) {
    return nextDueAt.toISOString().slice(0, 19);
  }
  return now.toISOString().slice(0, 10);
}

export async function generateDuePmWorkOrders(opts: {
  organizationId?: string;
  systemUserId: string;
  now?: Date;
} = { systemUserId: "system" }): Promise<PmGenerationResult> {
  const now = opts.now ?? new Date();
  const result: PmGenerationResult = {
    checked: 0,
    generated: 0,
    skipped: 0,
    skippedReasons: { alreadyOpen: 0, raceLost: 0, notDue: 0 },
    scheduleIds: [],
  };

  // Pull active schedules joined with their equipment so we know
  // currentHours + organizationId; optionally scope to one org.
  const rows = await db
    .select({
      scheduleId: equipmentMaintenanceSchedules.id,
      equipmentId: equipmentMaintenanceSchedules.equipmentId,
      name: equipmentMaintenanceSchedules.name,
      maintenanceType: equipmentMaintenanceSchedules.maintenanceType,
      nextDueAt: equipmentMaintenanceSchedules.nextDueAt,
      nextDueHours: equipmentMaintenanceSchedules.nextDueHours,
      equipmentCode: equipment.equipmentCode,
      equipmentName: equipment.name,
      organizationId: equipment.organizationId,
      currentHours: equipment.currentHours,
    })
    .from(equipmentMaintenanceSchedules)
    .innerJoin(equipment, eq(equipmentMaintenanceSchedules.equipmentId, equipment.id))
    .where(eq(equipmentMaintenanceSchedules.isActive, true));

  for (const row of rows) {
    if (opts.organizationId && row.organizationId !== opts.organizationId) continue;
    result.checked += 1;

    const dateDue = row.nextDueAt instanceof Date ? row.nextDueAt <= now : false;
    const hoursDue = row.nextDueHours != null && row.currentHours != null
      ? Number(row.currentHours) >= Number(row.nextDueHours)
      : false;

    if (!dateDue && !hoursDue) {
      result.skipped += 1;
      result.skippedReasons.notDue += 1;
      continue;
    }

    const cycleKey = buildPmCycleKey({ nextDueAt: row.nextDueAt, now });

    // Idempotency check: indexed `(schedule_id, pm_cycle_key)` lookup
    // for any active row covering this cycle. Treats PENDING and
    // IN_PROGRESS as "already covered".
    const existing = await db
      .select({ id: equipmentRepairs.id })
      .from(equipmentRepairs)
      .where(and(
        eq(equipmentRepairs.scheduleId, row.scheduleId),
        eq(equipmentRepairs.pmCycleKey, cycleKey),
        inArray(equipmentRepairs.status, ["PENDING", "IN_PROGRESS"]),
      ))
      .limit(1);

    if (existing.length > 0) {
      result.skipped += 1;
      result.skippedReasons.alreadyOpen += 1;
      continue;
    }

    // Generate a unique repair number: "PM-<equipmentCode>-<yyyymmdd>-<rand>"
    const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const repairNumber = `PM-${row.equipmentCode}-${stamp}-${rand}`;

    const dueReason = dateDue && hoursDue ? "date+hours" : dateDue ? "date" : "hours";
    const desc = `${PM_TAG(row.scheduleId)} ${row.name} (auto-generated, due by ${dueReason})`;

    try {
      await db.insert(equipmentRepairs).values({
        equipmentId: row.equipmentId,
        scheduleId: row.scheduleId,
        pmCycleKey: cycleKey,
        repairNumber,
        description: desc,
        status: "PENDING",
        problemReportedById: opts.systemUserId,
        problemDescription: `Preventative maintenance due. Schedule: ${row.name}.`,
        hoursAtReport: row.currentHours ?? undefined,
      });
      result.generated += 1;
      result.scheduleIds.push(row.scheduleId);
    } catch (err) {
      // SQLSTATE 23505 = unique_violation. Triggered when a concurrent
      // generator on another pod won the race for this cycle. The
      // database is now in the desired state (exactly one active WO),
      // so we count it as a skip rather than a failure.
      if (isUniqueViolation(err)) {
        result.skipped += 1;
        result.skippedReasons.raceLost += 1;
        continue;
      }
      throw err;
    }
  }

  return result;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code === "23505";
}

export const PM_DESCRIPTION_TAG = PM_TAG;
