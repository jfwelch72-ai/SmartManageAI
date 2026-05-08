/**
 * Task #2629 — Coverage for the two new server contracts on the
 * measurement PATCH:
 *
 *   1. Optimistic concurrency. The route now bumps a `version`
 *      column atomically on every successful UPDATE. Clients that
 *      send `expectedVersion` (body) or `If-Match` (header) get a
 *      compare-and-swap: a stale value 409s with the server's current
 *      row so the workspace can prompt the user to re-apply their
 *      edit. Callers that omit the version stay on the legacy
 *      last-write-wins path so existing mobile/import callers don't
 *      break until they migrate.
 *
 *   2. Measurement → assembly / cost-line link feeds the learned-rate
 *      library via `recordMeasurementRateSample`. The org-quality
 *      filter (excluded projects/bids) is shared with the rest of
 *      `recordRateSample` → `getExcludedIds`, so a measurement on a
 *      bid the org has marked LOST/CANCELLED (or explicitly excluded)
 *      MUST NOT contribute a sample to the library.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, and, eq } from "drizzle-orm";

import { db } from "../../db";
import {
  users,
  organizations,
  bids,
  aiEstimatorAssemblies,
  aiEstimatorRateSamples,
  aiEstimatorExcludedSources,
} from "@shared/schema";
import { generateToken } from "../../auth";
import { recordMeasurementRateSample } from "../../services/aiEstimator/learnedRates";

const TEST_PREFIX = "__takeoff_meas_v__";

let app: Express;
let server: Server;
let adminToken: string;
let orgId: string;
let qualityBidId: string;
let excludedBidId: string;
let qualitySheetId: string;
let excludedSheetId: string;
let assemblyId: string;

function apiPost(path: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${adminToken}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(path: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${adminToken}`);
  if (headers) for (const [k, v] of Object.entries(headers)) r.set(k, v);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = (orgIdsResult as unknown as { rows: Array<{ id: string }> }).rows;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${id})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM ai_estimator_rate_samples WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM ai_estimator_excluded_sources WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM ai_estimator_assembly_components WHERE assembly_id IN (SELECT id FROM ai_estimator_assemblies WHERE organization_id = ${id})`).catch(() => {});
    await db.execute(sql`DELETE FROM ai_estimator_assemblies WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => {});
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: "Concurrency Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Concurrency",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  // Two bids: the "quality" one stays ACTIVE/WON so its samples
  // contribute to the rate library; the "excluded" one is added to
  // ai_estimator_excluded_sources so its samples must be dropped.
  const [qBid] = await db.insert(bids).values({
    code: `${slug}-Q`,
    name: "Quality Bid",
    clientName: "Quality Client",
    gcOrganizationId: orgId,
  }).returning();
  qualityBidId = qBid.id;

  const [xBid] = await db.insert(bids).values({
    code: `${slug}-X`,
    name: "Excluded Bid",
    clientName: "Excluded Client",
    gcOrganizationId: orgId,
  }).returning();
  excludedBidId = xBid.id;

  await db.insert(aiEstimatorExcludedSources).values({
    organizationId: orgId,
    bidId: excludedBidId,
    reason: "manual_test_exclude",
  });

  // Create a sheet on each bid via the real plan-import flow so the
  // sheet inherits the bid linkage the rate-sample ingest reads from.
  const planA = await apiPost(`/api/bids/${qualityBidId}/takeoff/plans`, {
    fileUrl: `https://example.com/q-${Date.now()}.pdf`,
    fileName: "Quality Plan",
  });
  expect(planA.status).toBe(201);
  qualitySheetId = (planA.body as { sheets: { id: string }[] }).sheets[0].id;

  const planB = await apiPost(`/api/bids/${excludedBidId}/takeoff/plans`, {
    fileUrl: `https://example.com/x-${Date.now()}.pdf`,
    fileName: "Excluded Plan",
  });
  expect(planB.status).toBe(201);
  excludedSheetId = (planB.body as { sheets: { id: string }[] }).sheets[0].id;

  // Calibrate so subsequent measurements aren't auto-flagged
  // UNCALIBRATED (not strictly required for rate-sample ingest but
  // keeps the test scenario realistic).
  await apiPatch(`/api/takeoff/sheets/${qualitySheetId}/calibration`, {
    scalePxPerFoot: 10,
    units: "ft",
  });
  await apiPatch(`/api/takeoff/sheets/${excludedSheetId}/calibration`, {
    scalePxPerFoot: 10,
    units: "ft",
  });

  // A reusable assembly for the link tests.
  const [asm] = await db.insert(aiEstimatorAssemblies).values({
    organizationId: orgId,
    name: "Test Assembly — 8\" CMU Wall",
    costCode: "04-22-00",
    drivingUnit: "SF",
    drivingMeasurementType: "area",
  }).returning();
  assemblyId = asm.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function createMeasurement(sheetId: string): Promise<{ id: string; version: number }> {
  const res = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
    type: "LINEAR",
    label: "M",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    source: "USER",
    snapHitRatio: 1.0,
    unitCost: 0,
  });
  expect(res.status).toBe(201);
  const body = res.body as { id: string; version: number };
  return body;
}

describe("PATCH /api/takeoff/measurements/:id — optimistic concurrency (Task #2629)", () => {
  it("bumps `version` on a successful update", async () => {
    const m = await createMeasurement(qualitySheetId);
    expect(m.version).toBe(1);

    const res = await apiPatch(`/api/takeoff/measurements/${m.id}`, { label: "Renamed" });
    expect(res.status).toBe(200);
    expect((res.body as { version: number }).version).toBe(2);
    expect((res.body as { label: string }).label).toBe("Renamed");
  });

  it("rejects a stale expectedVersion with 409 and returns the current row", async () => {
    const m = await createMeasurement(qualitySheetId);

    // First write succeeds and bumps version → 2.
    const ok = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      label: "First",
      expectedVersion: 1,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as { version: number }).version).toBe(2);

    // Second write replays the old version → must 409.
    const stale = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      label: "Stale",
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect((stale.body as { reason: string }).reason).toBe("version_conflict");
    expect((stale.body as { currentVersion: number }).currentVersion).toBe(2);
    expect((stale.body as { current: { label: string } }).current.label).toBe("First");
  });

  it("accepts the version through the If-Match header", async () => {
    const m = await createMeasurement(qualitySheetId);
    const res = await apiPatch(
      `/api/takeoff/measurements/${m.id}`,
      { label: "Header" },
      { "If-Match": "1" },
    );
    expect(res.status).toBe(200);
    expect((res.body as { version: number }).version).toBe(2);
  });

  it("ignores client-supplied `version` in the body (server-controlled)", async () => {
    const m = await createMeasurement(qualitySheetId);
    const res = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      label: "TryToForce",
      version: 999,
    });
    expect(res.status).toBe(200);
    // Stays at the natural bump (1 → 2), not the smuggled 999.
    expect((res.body as { version: number }).version).toBe(2);
  });

  it("falls back to last-write-wins when no expectedVersion is supplied (legacy contract)", async () => {
    const m = await createMeasurement(qualitySheetId);
    // Two back-to-back writes with no version header — both succeed.
    const a = await apiPatch(`/api/takeoff/measurements/${m.id}`, { label: "A" });
    expect(a.status).toBe(200);
    const b = await apiPatch(`/api/takeoff/measurements/${m.id}`, { label: "B" });
    expect(b.status).toBe(200);
    expect((b.body as { version: number }).version).toBe(3);
  });
});

describe("PATCH /api/takeoff/measurements/bulk — per-row optimistic concurrency (Task #2653)", () => {
  it("bumps each row's `version` on a successful bulk update", async () => {
    const a = await createMeasurement(qualitySheetId);
    const b = await createMeasurement(qualitySheetId);
    expect(a.version).toBe(1);
    expect(b.version).toBe(1);

    const res = await apiPatch(`/api/takeoff/measurements/bulk`, {
      updates: [
        { id: a.id, label: "A1" },
        { id: b.id, label: "B1" },
      ],
    });
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: string; version: number; label: string }>;
    expect(rows.length).toBe(2);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    expect(byId.get(a.id)?.version).toBe(2);
    expect(byId.get(b.id)?.version).toBe(2);
  });

  it("returns 409 with per-row conflicts when any expectedVersion is stale", async () => {
    const a = await createMeasurement(qualitySheetId);
    const b = await createMeasurement(qualitySheetId);

    // Bump `a` out of band so its version is no longer 1.
    const bump = await apiPatch(`/api/takeoff/measurements/${a.id}`, { label: "Teammate" });
    expect(bump.status).toBe(200);
    expect((bump.body as { version: number }).version).toBe(2);

    const res = await apiPatch(`/api/takeoff/measurements/bulk`, {
      updates: [
        { id: a.id, label: "Replay", expectedVersion: 1 },
        { id: b.id, label: "Replay", expectedVersion: 1 },
      ],
    });
    expect(res.status).toBe(409);
    const body = res.body as {
      reason: string;
      failedMeasurementIds: string[];
      conflicts: Array<{ id: string; expectedVersion: number; currentVersion: number; current: { label: string } }>;
    };
    expect(body.reason).toBe("version_conflict");
    expect(body.failedMeasurementIds).toEqual([a.id]);
    expect(body.conflicts.length).toBe(1);
    expect(body.conflicts[0].id).toBe(a.id);
    expect(body.conflicts[0].expectedVersion).toBe(1);
    expect(body.conflicts[0].currentVersion).toBe(2);
    expect(body.conflicts[0].current.label).toBe("Teammate");

    // The whole tx must roll back — `b` should NOT have advanced.
    const after = await db.execute(
      sql`SELECT version, label FROM takeoff_measurements WHERE id = ${b.id}`,
    );
    const bRow = (after as unknown as { rows: Array<{ version: number; label: string }> }).rows[0];
    expect(bRow.version).toBe(1);
    expect(bRow.label).not.toBe("Replay");
  });

  it("falls back to last-write-wins when no expectedVersion is supplied (legacy contract)", async () => {
    const a = await createMeasurement(qualitySheetId);
    // Two back-to-back bulks with no version — both succeed.
    const r1 = await apiPatch(`/api/takeoff/measurements/bulk`, {
      updates: [{ id: a.id, label: "Bulk1" }],
    });
    expect(r1.status).toBe(200);
    const r2 = await apiPatch(`/api/takeoff/measurements/bulk`, {
      updates: [{ id: a.id, label: "Bulk2" }],
    });
    expect(r2.status).toBe(200);
    expect((r2.body as Array<{ version: number }>)[0].version).toBe(3);
  });
});

describe("POST /api/takeoff/measurements/bulk-unlock-rescale — per-row optimistic concurrency (Task #2653)", () => {
  it("returns 409 when any row's version map entry is stale", async () => {
    // Lock both rows by re-calibrating with `lockExisting: true`
    // through the regular calibration route. We do this by directly
    // setting `lockedScalePxPerFoot` on each row so the test stays
    // hermetic regardless of any future calibration-route changes.
    const a = await createMeasurement(qualitySheetId);
    const b = await createMeasurement(qualitySheetId);
    await db.execute(
      sql`UPDATE takeoff_measurements SET locked_scale_px_per_foot = 5 WHERE id IN (${a.id}, ${b.id})`,
    );

    // Bump `a` out of band so `versions[a.id] = 1` is now stale.
    const bump = await apiPatch(`/api/takeoff/measurements/${a.id}`, { label: "Teammate" });
    expect(bump.status).toBe(200);

    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: [a.id, b.id],
      versions: { [a.id]: 1, [b.id]: 1 },
    });
    expect(res.status).toBe(409);
    const body = res.body as {
      reason: string;
      failedMeasurementIds: string[];
      conflicts: Array<{ id: string; expectedVersion: number; currentVersion: number }>;
    };
    expect(body.reason).toBe("version_conflict");
    expect(body.failedMeasurementIds).toEqual([a.id]);
    expect(body.conflicts[0].id).toBe(a.id);
    expect(body.conflicts[0].currentVersion).toBe(2);

    // `b` must remain locked because the whole tx rolled back.
    const after = await db.execute(
      sql`SELECT locked_scale_px_per_foot AS l FROM takeoff_measurements WHERE id = ${b.id}`,
    );
    const bRow = (after as unknown as { rows: Array<{ l: number | null }> }).rows[0];
    expect(bRow.l).not.toBeNull();
  });
});

describe("recordMeasurementRateSample — quality-filter ingest (Task #2629)", () => {
  it("inserts a sample row when the bid is not excluded", async () => {
    // Pick any measurement on the quality sheet for the sourceRowId
    // — we only need a uuid for the audit pointer.
    const m = await createMeasurement(qualitySheetId);

    const result = await recordMeasurementRateSample(orgId, {
      measurementId: m.id,
      costCode: "04-22-00",
      unit: "SF",
      unitCost: 18.5,
      bidId: qualityBidId,
    });
    expect(result).not.toBeNull();

    const samples = await db
      .select()
      .from(aiEstimatorRateSamples)
      .where(
        and(
          eq(aiEstimatorRateSamples.organizationId, orgId),
          eq(aiEstimatorRateSamples.sourceRowId, m.id),
        ),
      );
    expect(samples.length).toBe(1);
    expect(Number(samples[0].value)).toBeCloseTo(18.5, 2);
    expect(samples[0].metric).toBe("unit_cost");
  });

  it("drops the sample when the bid is on the excluded list", async () => {
    const m = await createMeasurement(excludedSheetId);

    const result = await recordMeasurementRateSample(orgId, {
      measurementId: m.id,
      costCode: "04-22-00",
      unit: "SF",
      unitCost: 99.99,
      bidId: excludedBidId,
    });
    // The underlying recordRateSample silently no-ops for excluded
    // sources. The contract is: no sample row written.
    void result;

    const samples = await db
      .select()
      .from(aiEstimatorRateSamples)
      .where(
        and(
          eq(aiEstimatorRateSamples.organizationId, orgId),
          eq(aiEstimatorRateSamples.sourceRowId, m.id),
        ),
      );
    expect(samples.length).toBe(0);
  });

  it("returns null without writing for a missing costCode/unit", async () => {
    const m = await createMeasurement(qualitySheetId);
    const a = await recordMeasurementRateSample(orgId, {
      measurementId: m.id,
      costCode: null,
      unit: "SF",
      unitCost: 10,
      bidId: qualityBidId,
    });
    expect(a).toBeNull();
    const b = await recordMeasurementRateSample(orgId, {
      measurementId: m.id,
      costCode: "04-22-00",
      unit: null,
      unitCost: 10,
      bidId: qualityBidId,
    });
    expect(b).toBeNull();
    const c = await recordMeasurementRateSample(orgId, {
      measurementId: m.id,
      costCode: "04-22-00",
      unit: "SF",
      unitCost: 0,
      bidId: qualityBidId,
    });
    expect(c).toBeNull();
  });
});

describe("PATCH /api/takeoff/measurements/:id → assembly link triggers rate ingest (Task #2629)", () => {
  it("writes a rate sample when an unitCost edit lands on a measurement linked to an assembly", async () => {
    const m = await createMeasurement(qualitySheetId);

    // Link the measurement to the assembly + set a unit cost in a
    // single PATCH; the route resolves costCode/drivingUnit from the
    // assembly and forwards the sample into the org's rate library.
    const res = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      assemblyId,
      unitCost: 23.75,
    });
    expect(res.status).toBe(200);

    // The insert is best-effort post-update; allow a brief tick.
    await new Promise((r) => setTimeout(r, 50));

    const samples = await db
      .select()
      .from(aiEstimatorRateSamples)
      .where(
        and(
          eq(aiEstimatorRateSamples.organizationId, orgId),
          eq(aiEstimatorRateSamples.sourceRowId, m.id),
        ),
      );
    expect(samples.length).toBe(1);
    expect(Number(samples[0].value)).toBeCloseTo(23.75, 2);
    expect(samples[0].costCode).toBe("04-22-00");
    expect(samples[0].unit).toBe("SF");
  });

  it("does NOT insert a duplicate sample on a label-only edit (rate-relevant gating)", async () => {
    const m = await createMeasurement(qualitySheetId);

    // Initial link + cost — should produce exactly one sample.
    const initial = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      assemblyId,
      unitCost: 19.0,
    });
    expect(initial.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    // Subsequent label-only edits + a no-op overwrite that re-sends
    // the same assemblyId / unitCost must NOT produce additional
    // samples. Otherwise repeated edits or conflict-overwrite retries
    // would skew the learned-rate library by overweighting one row.
    const labelOnly = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      label: "Renamed slab",
    });
    expect(labelOnly.status).toBe(200);

    const noOpOverwrite = await apiPatch(`/api/takeoff/measurements/${m.id}`, {
      assemblyId,
      unitCost: 19.0,
    });
    expect(noOpOverwrite.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    const samples = await db
      .select()
      .from(aiEstimatorRateSamples)
      .where(
        and(
          eq(aiEstimatorRateSamples.organizationId, orgId),
          eq(aiEstimatorRateSamples.sourceRowId, m.id),
        ),
      );
    expect(samples.length).toBe(1);
    expect(Number(samples[0].value)).toBeCloseTo(19.0, 2);
  });
});
