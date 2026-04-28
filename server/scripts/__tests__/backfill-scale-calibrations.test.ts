/**
 * Task #2350 — integration tests for the scale-calibration audit backfill.
 *
 * Exercises the real Postgres-side INSERT…SELECT statement against the live
 * test DB to make sure:
 *   (a) Sheets calibrated before the structured Scale History writer
 *       (Task #2325) get a synthetic `scale_calibration` audit_log row
 *       with the right shape: kind="scale_calibration", source="backfill",
 *       all the relevant scale_* fields, and createdAt = the sheet's
 *       scale_calibrated_at (so it lands at the right point in the
 *       timeline).
 *   (b) Sheets that already have ANY structured scale_calibration audit
 *       row are left alone (idempotency / "don't overwrite the real
 *       calibration trail").
 *   (c) Sheets without a recorded calibrator (scale_calibrated_by_id IS
 *       NULL) are skipped — audit_log.user_id is NOT NULL with an FK to
 *       users.id, so we can't fabricate a row for them.
 *   (d) Sheets that were never calibrated (no scale_px_per_foot or
 *       scale_calibrated_at) are skipped.
 *   (e) A second invocation is a no-op zero-row INSERT (idempotency).
 *   (f) Dry-run mode reports counts without writing rows.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";

import { db } from "../../db";
import {
  auditLog,
  organizations,
  takeoffSheets,
  users,
} from "@shared/schema";

import { runScaleCalibrationBackfill } from "../backfill-scale-calibrations";

const PREFIX = "__scale_bf__";

let orgId: string;
let userId: string;
const insertedSheetIds: string[] = [];

async function cleanupAuditAndSheets() {
  if (insertedSheetIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, insertedSheetIds));
    await db.delete(takeoffSheets).where(inArray(takeoffSheets.id, insertedSheetIds));
  }
  insertedSheetIds.length = 0;
}

beforeAll(async () => {
  // Clean up leftovers from any previously failed run.
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  for (const row of orgRows.rows ?? []) {
    // takeoff_sheets has no direct org FK, so we wipe sheets owned by users
    // we created, plus the users + org themselves.
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.organizationId, row.id));
    const userIds = userRows.map((r) => r.id);
    if (userIds.length > 0) {
      await db
        .delete(takeoffSheets)
        .where(inArray(takeoffSheets.scaleCalibratedById, userIds));
    }
    await db.delete(users).where(eq(users.organizationId, row.id));
    await db.delete(organizations).where(eq(organizations.id, row.id));
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}org`, slug: `${PREFIX}org-${Date.now()}` })
    .returning();
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Scale",
      lastName: "Backfill",
      email: `${PREFIX}user-${Date.now()}@example.invalid`,
      role: "ADMIN",
      isActive: true,
      passwordHash: "x",
    })
    .returning();
  userId = user.id;
});

afterAll(async () => {
  await cleanupAuditAndSheets();
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

beforeEach(async () => {
  await cleanupAuditAndSheets();
});

interface SheetOpts {
  scalePxPerFoot?: number | null;
  scaleCalibratedAt?: Date | null;
  scaleCalibratedById?: string | null;
  scaleSource?: string;
  scaleConfidence?: string;
  scaleLabel?: string | null;
  units?: string;
}

async function insertSheet(opts: SheetOpts = {}): Promise<string> {
  const [sheet] = await db
    .insert(takeoffSheets)
    .values({
      imageUrl: `https://example.invalid/${PREFIX}${Math.random()}.png`,
      sheetIndex: 0,
      scalePxPerFoot: opts.scalePxPerFoot ?? null,
      scaleCalibratedAt: opts.scaleCalibratedAt ?? null,
      scaleCalibratedById:
        opts.scaleCalibratedById === undefined ? userId : opts.scaleCalibratedById,
      scaleSource: opts.scaleSource ?? "USER_TWO_POINT",
      scaleConfidence: opts.scaleConfidence ?? "HIGH",
      scaleLabel: opts.scaleLabel ?? "1\" = 20'",
      units: opts.units ?? "ft",
    })
    .returning();
  insertedSheetIds.push(sheet.id);
  return sheet.id;
}

async function getStructuredScaleEntries(sheetId: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, sheetId));
  return rows
    .map((r) => {
      const raw = r.newValue;
      if (!raw || !raw.startsWith("{")) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.kind !== "scale_calibration") return null;
        return { row: r, payload: parsed as Record<string, unknown> };
      } catch {
        return null;
      }
    })
    .filter((e): e is { row: typeof rows[number]; payload: Record<string, unknown> } => e !== null);
}

describe("runScaleCalibrationBackfill", () => {
  it("inserts a synthetic scale_calibration audit row for a previously-calibrated sheet", async () => {
    const calibratedAt = new Date("2025-06-15T12:34:56.000Z");
    const sheetId = await insertSheet({
      scalePxPerFoot: 24.5,
      scaleCalibratedAt: calibratedAt,
      scaleSource: "USER_TWO_POINT",
      scaleConfidence: "HIGH",
      scaleLabel: "1\" = 20'",
      units: "ft",
    });

    const stats = await runScaleCalibrationBackfill();
    expect(stats.inserted).toBeGreaterThanOrEqual(1);

    const entries = await getStructuredScaleEntries(sheetId);
    expect(entries).toHaveLength(1);
    const { row, payload } = entries[0];

    // Audit row metadata
    expect(row.action).toBe("UPDATE");
    expect(row.userId).toBe(userId);
    expect(row.entityType).toBe("takeoff_sheet");
    expect(row.entityId).toBe(sheetId);
    expect(row.oldValue).toBeNull();
    // createdAt is pinned to the sheet's calibration timestamp so the entry
    // lands at the right point in the panel timeline (not at "now").
    const createdAtMs = (row.createdAt instanceof Date
      ? row.createdAt
      : new Date(row.createdAt as unknown as string)
    ).getTime();
    expect(createdAtMs).toBe(calibratedAt.getTime());

    // JSON payload shape — matches the structured writer's contract enough
    // for the GET /scale-history endpoint's tryParse to fold it in.
    expect(payload).toMatchObject({
      kind: "scale_calibration",
      scalePxPerFoot: 24.5,
      scaleLabel: "1\" = 20'",
      units: "ft",
      scaleSource: "USER_TWO_POINT",
      scaleConfidence: "HIGH",
      scaleCalibratedById: userId,
      source: "backfill",
    });
    // scaleCalibratedAt is serialized as an ISO 8601 timestamp parseable by
    // `new Date(...)` in the panel reader.
    expect(typeof payload.scaleCalibratedAt).toBe("string");
    expect(new Date(payload.scaleCalibratedAt as string).toISOString()).toBe(
      calibratedAt.toISOString(),
    );
  });

  it("skips sheets that already have any structured scale_calibration audit row", async () => {
    const calibratedAt = new Date("2025-07-01T08:00:00.000Z");
    const sheetId = await insertSheet({
      scalePxPerFoot: 10,
      scaleCalibratedAt: calibratedAt,
    });

    // Pre-existing structured row mimicking what the live calibration
    // writer would have written (compact JSON.stringify form, no space
    // after the colon). The backfill must NOT add a second row.
    await db.insert(auditLog).values({
      userId,
      entityType: "takeoff_sheet",
      entityId: sheetId,
      action: "UPDATE",
      oldValue: null,
      newValue: JSON.stringify({
        kind: "scale_calibration",
        scalePxPerFoot: 10,
        scaleLabel: null,
        units: "ft",
        scaleSource: "USER_TWO_POINT",
        scaleConfidence: "HIGH",
        scaleCalibratedById: userId,
        scaleCalibratedAt: calibratedAt.toISOString(),
        source: "calibration",
      }),
    });

    await runScaleCalibrationBackfill();

    const entries = await getStructuredScaleEntries(sheetId);
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.source).toBe("calibration");
  });

  it("detects existing structured rows whether they were written in compact or spaced JSON form", async () => {
    // Regression for the idempotency-detection bug: the synthetic rows this
    // backfill writes are produced by Postgres' json_build_object(...)::text,
    // which serializes with a space after the colon (e.g.
    // `{"kind": "scale_calibration", ...}`). The detection predicate must
    // therefore tolerate whitespace around the colon — otherwise a second
    // run of the backfill would not see the rows the first run inserted and
    // would happily insert duplicates.
    const calibratedAt = new Date("2025-07-15T09:00:00.000Z");
    const sheetId = await insertSheet({
      scalePxPerFoot: 14,
      scaleCalibratedAt: calibratedAt,
    });

    // Hand-craft a structured row in the SPACED form Postgres emits, to
    // simulate either (a) a prior backfill run, or (b) a future writer
    // that uses jsonb on the server side.
    await db.execute(sql`
      INSERT INTO audit_log (user_id, entity_type, entity_id, action, old_value, new_value, created_at)
      VALUES (
        ${userId},
        'takeoff_sheet',
        ${sheetId},
        'UPDATE',
        NULL,
        ${'{"kind": "scale_calibration", "scalePxPerFoot": 14, "source": "backfill"}'},
        ${calibratedAt.toISOString()}
      )
    `);

    await runScaleCalibrationBackfill();

    const entries = await getStructuredScaleEntries(sheetId);
    expect(entries).toHaveLength(1);
  });

  it("skips sheets without a recorded calibrator (audit_log.user_id is NOT NULL)", async () => {
    const sheetId = await insertSheet({
      scalePxPerFoot: 12,
      scaleCalibratedAt: new Date("2025-08-01T00:00:00.000Z"),
      scaleCalibratedById: null,
    });

    const stats = await runScaleCalibrationBackfill();
    // The candidate is reported in stats but no audit row gets inserted.
    expect(stats.missingCalibratedBy).toBeGreaterThanOrEqual(1);

    const entries = await getStructuredScaleEntries(sheetId);
    expect(entries).toHaveLength(0);
  });

  it("skips sheets that were never calibrated", async () => {
    const sheetId = await insertSheet({
      scalePxPerFoot: null,
      scaleCalibratedAt: null,
      scaleCalibratedById: null,
    });

    await runScaleCalibrationBackfill();

    const entries = await getStructuredScaleEntries(sheetId);
    expect(entries).toHaveLength(0);
  });

  it("is idempotent: a second invocation does not insert duplicate rows for the same sheet", async () => {
    const sheetId = await insertSheet({
      scalePxPerFoot: 18,
      scaleCalibratedAt: new Date("2025-09-15T10:00:00.000Z"),
    });

    await runScaleCalibrationBackfill();
    const afterFirst = await getStructuredScaleEntries(sheetId);
    expect(afterFirst).toHaveLength(1);
    const firstRowId = afterFirst[0].row.id;

    await runScaleCalibrationBackfill();
    const afterSecond = await getStructuredScaleEntries(sheetId);
    expect(afterSecond).toHaveLength(1);
    // Same audit_log row — not replaced, not duplicated.
    expect(afterSecond[0].row.id).toBe(firstRowId);
  });

  it("dry-run reports counts without writing audit rows", async () => {
    const sheetId = await insertSheet({
      scalePxPerFoot: 8,
      scaleCalibratedAt: new Date("2025-10-05T00:00:00.000Z"),
    });

    const stats = await runScaleCalibrationBackfill({ dryRun: true });
    expect(stats.dryRun).toBe(true);
    expect(stats.inserted).toBeGreaterThanOrEqual(1);
    // Crucially: NO audit row was actually written for this sheet.
    const entries = await getStructuredScaleEntries(sheetId);
    expect(entries).toHaveLength(0);
  });
});
