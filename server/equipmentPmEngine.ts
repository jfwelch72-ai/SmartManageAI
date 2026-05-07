import { db } from "./db";
import { equipment, equipmentMaintenanceSchedules, equipmentRepairs } from "@shared/schema";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";

/**
 * PM auto-WO generation engine.
 *
 * Walks active maintenance schedules and creates a PENDING entry in
 * equipmentRepairs for any schedule that is currently due (by date or
 * hour-meter), provided one is not already open for the same schedule.
 *
 * The repair description is prefixed with `[PM:<scheduleId>]` so we can
 * idempotently detect existing open work orders without a schema change.
 */
export interface PmGenerationResult {
  generated: number;
  skipped: number;
  scheduleIds: string[];
}

const PM_TAG = (scheduleId: string) => `[PM:${scheduleId}]`;

export async function generateDuePmWorkOrders(opts: {
  organizationId?: string;
  systemUserId: string;
  now?: Date;
} = { systemUserId: "system" }): Promise<PmGenerationResult> {
  const now = opts.now ?? new Date();
  const result: PmGenerationResult = { generated: 0, skipped: 0, scheduleIds: [] };

  // Pull active schedules joined with their equipment so we know currentHours +
  // organizationId; optionally scope to one org.
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

    const dateDue = row.nextDueAt instanceof Date ? row.nextDueAt <= now : false;
    const hoursDue = row.nextDueHours != null && row.currentHours != null
      ? Number(row.currentHours) >= Number(row.nextDueHours)
      : false;

    if (!dateDue && !hoursDue) continue;

    // Idempotency: skip if a PENDING/IN_PROGRESS work order already exists
    // for this schedule (description tag match).
    const existing = await db
      .select({ id: equipmentRepairs.id })
      .from(equipmentRepairs)
      .where(and(
        eq(equipmentRepairs.equipmentId, row.equipmentId),
        sql`${equipmentRepairs.description} LIKE ${'%' + PM_TAG(row.scheduleId) + '%'}`,
        sql`${equipmentRepairs.status} IN ('PENDING','IN_PROGRESS')`,
      ))
      .limit(1);

    if (existing.length > 0) {
      result.skipped += 1;
      continue;
    }

    // Generate a unique repair number: "PM-<equipmentCode>-<yyyymmdd>-<rand>"
    const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const repairNumber = `PM-${row.equipmentCode}-${stamp}-${rand}`;

    const dueReason = dateDue && hoursDue ? "date+hours" : dateDue ? "date" : "hours";
    const desc = `${PM_TAG(row.scheduleId)} ${row.name} (auto-generated, due by ${dueReason})`;

    await db.insert(equipmentRepairs).values({
      equipmentId: row.equipmentId,
      repairNumber,
      description: desc,
      status: "PENDING",
      problemReportedById: opts.systemUserId,
      problemDescription: `Preventative maintenance due. Schedule: ${row.name}.`,
      hoursAtReport: row.currentHours ?? undefined,
    });

    result.generated += 1;
    result.scheduleIds.push(row.scheduleId);
  }

  return result;
}

export const PM_DESCRIPTION_TAG = PM_TAG;
