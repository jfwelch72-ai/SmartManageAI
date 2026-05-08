/**
 * Task #2690 — equipment PM engine idempotency.
 *
 * Pins the four scenarios called out in the task brief:
 *   (a) A second insert for the same `(schedule_id, pm_cycle_key)` while a
 *       prior PENDING / IN_PROGRESS row exists is rejected by the partial
 *       unique index and surfaced as `skippedReasons.alreadyOpen`.
 *   (b) After the prior row is COMPLETED, a new cycle with a fresh
 *       `pm_cycle_key` (next `nextDueAt` snapshot) is inserted successfully.
 *   (c) Two concurrent `generateDuePmWorkOrders` invocations against the
 *       same set of due schedules produce exactly one new row per schedule;
 *       the loser is counted as `skippedReasons.raceLost`.
 *   (d) A pre-existing `[PM:<id>]` description-tagged row picks up its
 *       schedule_id + pm_cycle_key after `ensureEquipmentRepairsPmIdempotency`
 *       runs (the one-shot backfill).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const { db } = await import("../db");
const { generateDuePmWorkOrders, buildPmCycleKey } = await import("../equipmentPmEngine");
const { ensureEquipmentRepairsPmIdempotency } = await import("../utils/ensureEquipmentRepairsPmIdempotency");
const {
  organizations,
  users,
  equipment,
  equipmentMaintenanceSchedules,
  equipmentRepairs,
} = await import("@shared/schema");

let orgId: string;
let userId: string;

async function seedEquipment(currentHours = "0") {
  const id = randomUUID();
  const [eq_] = await db.insert(equipment).values({
    organizationId: orgId,
    name: `Excavator ${id.slice(0, 6)}`,
    equipmentCode: `EQ-${id.slice(0, 8)}`,
    type: "HEAVY_EQUIPMENT",
    status: "AVAILABLE",
    currentHours,
  }).returning();
  return eq_;
}

async function seedSchedule(equipmentId: string, opts: { nextDueAt?: Date; nextDueHours?: string } = {}) {
  const [sched] = await db.insert(equipmentMaintenanceSchedules).values({
    equipmentId,
    maintenanceType: "PREVENTATIVE",
    name: "Oil Change",
    intervalDays: 90,
    nextDueAt: opts.nextDueAt ?? new Date(Date.now() - 60_000),
    nextDueHours: opts.nextDueHours ?? null,
    isActive: true,
  }).returning();
  return sched;
}

async function activeRepairsForSchedule(scheduleId: string) {
  return db.select().from(equipmentRepairs).where(eq(equipmentRepairs.scheduleId, scheduleId));
}

beforeAll(async () => {
  // Make sure the partial unique index + columns exist on the test DB.
  await ensureEquipmentRepairsPmIdempotency();

  const oId = randomUUID();
  await db.insert(organizations).values({
    id: oId,
    name: `PM Test Org ${oId.slice(0, 8)}`,
    slug: `pm-test-${oId.slice(0, 8)}`,
  });
  const uId = randomUUID();
  await db.insert(users).values({
    id: uId,
    organizationId: oId,
    firstName: "PM",
    lastName: "Tester",
    email: `pm-tester-${uId}@example.test`,
    role: "ADMIN",
  });
  orgId = oId;
  userId = uId;
});

beforeEach(async () => {
  // Clear any rows leaked between tests so the per-test counters are
  // deterministic. Equipment cascades to repairs + schedules via FK.
  await db.delete(equipment).where(eq(equipment.organizationId, orgId));
});

describe("buildPmCycleKey", () => {
  it("uses the nextDueAt ISO snapshot trimmed to seconds", () => {
    const due = new Date("2026-05-01T12:34:56.789Z");
    expect(buildPmCycleKey({ nextDueAt: due, now: new Date() })).toBe("2026-05-01T12:34:56");
  });
  it("falls back to a YYYY-MM-DD stamp for hours-only schedules", () => {
    const now = new Date("2026-05-08T01:02:03.456Z");
    expect(buildPmCycleKey({ nextDueAt: null, now })).toBe("2026-05-08");
  });
});

describe("partial unique index — DB-level rejection", () => {
  it("rejects a direct second insert for the same (schedule_id, pm_cycle_key) while an active row exists", async () => {
    const eq_ = await seedEquipment();
    const sched = await seedSchedule(eq_.id);
    const cycleKey = "2026-05-01T00:00:00";

    await db.insert(equipmentRepairs).values({
      equipmentId: eq_.id,
      scheduleId: sched.id,
      pmCycleKey: cycleKey,
      repairNumber: `PM-A-${randomUUID().slice(0, 6)}`,
      description: `[PM:${sched.id}] active`,
      status: "PENDING",
      problemReportedById: userId,
    });

    let caught: unknown = null;
    try {
      await db.insert(equipmentRepairs).values({
        equipmentId: eq_.id,
        scheduleId: sched.id,
        pmCycleKey: cycleKey,
        repairNumber: `PM-B-${randomUUID().slice(0, 6)}`,
        description: `[PM:${sched.id}] dupe`,
        status: "PENDING",
        problemReportedById: userId,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code?: string }).code).toBe("23505");

    // After the active row is COMPLETED, the partial predicate releases
    // and an insert with the *same* (schedule_id, pm_cycle_key) succeeds.
    await db.update(equipmentRepairs)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(and(
        eq(equipmentRepairs.scheduleId, sched.id),
        eq(equipmentRepairs.pmCycleKey, cycleKey),
        eq(equipmentRepairs.status, "PENDING"),
      ));

    await db.insert(equipmentRepairs).values({
      equipmentId: eq_.id,
      scheduleId: sched.id,
      pmCycleKey: cycleKey,
      repairNumber: `PM-C-${randomUUID().slice(0, 6)}`,
      description: `[PM:${sched.id}] reopen`,
      status: "PENDING",
      problemReportedById: userId,
    });

    const rows = await activeRepairsForSchedule(sched.id);
    expect(rows).toHaveLength(2);
    const statuses = rows.map(r => r.status).sort();
    expect(statuses).toEqual(["COMPLETED", "PENDING"]);
  });
});

describe("generateDuePmWorkOrders — single-pod idempotency", () => {
  it("(a) second invocation with the same active row skips with alreadyOpen", async () => {
    const eq_ = await seedEquipment();
    const sched = await seedSchedule(eq_.id);

    const first = await generateDuePmWorkOrders({
      organizationId: orgId,
      systemUserId: userId,
    });
    expect(first.generated).toBe(1);
    expect(first.skipped).toBe(0);
    expect(first.skippedReasons.alreadyOpen).toBe(0);

    const second = await generateDuePmWorkOrders({
      organizationId: orgId,
      systemUserId: userId,
    });
    expect(second.generated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.skippedReasons.alreadyOpen).toBe(1);
    expect(second.skippedReasons.raceLost).toBe(0);

    const rows = await activeRepairsForSchedule(sched.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].pmCycleKey).not.toBeNull();
  });

  it("(b) after the prior row is COMPLETED, a new cycle inserts successfully", async () => {
    const eq_ = await seedEquipment();
    const sched = await seedSchedule(eq_.id);

    const first = await generateDuePmWorkOrders({
      organizationId: orgId,
      systemUserId: userId,
    });
    expect(first.generated).toBe(1);

    // Mark the open WO as COMPLETED so the partial unique index no
    // longer covers it, then bump the schedule's nextDueAt to a fresh
    // value so the next invocation sees a brand-new pm_cycle_key.
    await db.update(equipmentRepairs)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(and(
        eq(equipmentRepairs.scheduleId, sched.id),
        eq(equipmentRepairs.status, "PENDING"),
      ));

    const newDue = new Date(Date.now() - 30_000);
    newDue.setUTCSeconds(newDue.getUTCSeconds() + 1);
    await db.update(equipmentMaintenanceSchedules)
      .set({ nextDueAt: newDue })
      .where(eq(equipmentMaintenanceSchedules.id, sched.id));

    const second = await generateDuePmWorkOrders({
      organizationId: orgId,
      systemUserId: userId,
    });
    expect(second.generated).toBe(1);
    expect(second.skipped).toBe(0);

    const rows = await activeRepairsForSchedule(sched.id);
    expect(rows).toHaveLength(2);
    const statuses = rows.map(r => r.status).sort();
    expect(statuses).toEqual(["COMPLETED", "PENDING"]);
    const pendingRow = rows.find(r => r.status === "PENDING")!;
    const completedRow = rows.find(r => r.status === "COMPLETED")!;
    expect(pendingRow.pmCycleKey).not.toBe(completedRow.pmCycleKey);
  });

  it("(c) two concurrent invocations produce exactly one new row per schedule", async () => {
    const eq_ = await seedEquipment();
    const sched = await seedSchedule(eq_.id);

    const [a, b] = await Promise.all([
      generateDuePmWorkOrders({ organizationId: orgId, systemUserId: userId }),
      generateDuePmWorkOrders({ organizationId: orgId, systemUserId: userId }),
    ]);

    const totalGenerated = a.generated + b.generated;
    const totalRaceLost = a.skippedReasons.raceLost + b.skippedReasons.raceLost;
    const totalAlreadyOpen = a.skippedReasons.alreadyOpen + b.skippedReasons.alreadyOpen;
    expect(totalGenerated).toBe(1);
    // The loser was either pre-empted by the unique index (raceLost) or
    // observed the winner's row in its idempotency check (alreadyOpen).
    // Both outcomes count as a clean skip.
    expect(totalRaceLost + totalAlreadyOpen).toBe(1);

    const rows = await activeRepairsForSchedule(sched.id);
    expect(rows).toHaveLength(1);
  });
});

describe("ensureEquipmentRepairsPmIdempotency — backfill", () => {
  it("(d) tags pre-existing [PM:<id>] rows with schedule_id + pm_cycle_key", async () => {
    const eq_ = await seedEquipment();
    const due = new Date("2026-04-15T08:00:00.000Z");
    const sched = await seedSchedule(eq_.id, { nextDueAt: due });

    // Insert a row that LOOKS like a pre-Task-#2690 PM-engine emission:
    // description carries the [PM:<id>] tag but schedule_id / pm_cycle_key
    // are NULL. Using the engine's column names directly here so the
    // backfill is what's actually being exercised.
    const [legacy] = await db.insert(equipmentRepairs).values({
      equipmentId: eq_.id,
      repairNumber: `PM-LEGACY-${randomUUID().slice(0, 8)}`,
      description: `[PM:${sched.id}] Oil Change (auto-generated, due by date)`,
      status: "PENDING",
      problemReportedById: userId,
    }).returning();
    expect(legacy.scheduleId).toBeNull();
    expect(legacy.pmCycleKey).toBeNull();

    await ensureEquipmentRepairsPmIdempotency();

    const [rehydrated] = await db.select().from(equipmentRepairs)
      .where(eq(equipmentRepairs.id, legacy.id));
    expect(rehydrated.scheduleId).toBe(sched.id);
    expect(rehydrated.pmCycleKey).toBe("2026-04-15T08:00:00");

    // And the partial unique index should now refuse a brand-new active
    // row for the same cycle.
    const next = await generateDuePmWorkOrders({
      organizationId: orgId,
      systemUserId: userId,
    });
    expect(next.generated).toBe(0);
    expect(next.skippedReasons.alreadyOpen).toBe(1);
  });
});
