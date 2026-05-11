/**
 * Task #2786 — Unit-level coverage for the calibration zone CRUD endpoints.
 *
 * Verifies:
 *   GET  /api/takeoff/sheets/:sheetId/calibration-zones  — lists zones, guards auth
 *   POST /api/takeoff/sheets/:sheetId/calibration-zones  — creates zone, validates polygon_points shape
 *   PATCH /api/takeoff/calibration-zones/:zoneId         — partial-update name/pxPerFoot/polygon
 *   DELETE /api/takeoff/calibration-zones/:zoneId        — removes zone
 *
 * The polygon_points shape (array of {x, y}) is the key data contract between the
 * server and the Konva canvas overlay (CanvasStage.tsx). These tests pin that
 * shape round-trips through JSON/JSONB correctly and that the validation layer
 * enforces the minimum-3-point constraint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { users, organizations, bids } from "@shared/schema";
import { generateToken } from "../auth";

const PREFIX = "__calzone_routes__";

interface ZoneRow {
  id: string;
  sheet_id: string;
  name: string;
  polygon_points: Array<{ x: number; y: number }>;
  px_per_foot: number;
  created_at: string;
}

let app: Express;
let server: Server;
let adminToken: string;
let otherOrgToken: string;
let bidId: string;

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  );
  const orgIds = orgIdsResult.rows.map((r) => r.id);
  if (orgIds.length === 0) return;

  for (const orgId of orgIds) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${orgId})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_sheet_calibration_zones WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
}

function apiGet(path: string, token = adminToken) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}
function apiPost(path: string, body: Record<string, unknown>, token = adminToken) {
  return request(app)
    .post(path)
    .set("Cookie", `auth_token=${token}`)
    .set("Content-Type", "application/json")
    .send(body);
}
function apiPatch(path: string, body: Record<string, unknown>, token = adminToken) {
  return request(app)
    .patch(path)
    .set("Cookie", `auth_token=${token}`)
    .set("Content-Type", "application/json")
    .send(body);
}
function apiDelete(path: string, token = adminToken) {
  return request(app).delete(path).set("Cookie", `auth_token=${token}`);
}

async function freshSheet(): Promise<string> {
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/calzone-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Calibration Zone Test Plan",
  });
  expect(planRes.status).toBe(201);
  return (planRes.body as { sheets: { id: string }[] }).sheets[0].id;
}

const TRIANGLE = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 200, y: 300 },
];

const QUAD = [
  { x: 50, y: 50 },
  { x: 250, y: 50 },
  { x: 250, y: 250 },
  { x: 50, y: 250 },
];

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");
  const { ensureCalibrationZonesTable } = await import("../utils/ensureCalibrationZonesTable");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  // `runStartupMigrations` is called from server/index.ts, NOT from
  // registerRoutes — so runtime-only tables like takeoff_sheet_calibration_zones
  // (created via ensureCalibrationZonesTable rather than drizzle-kit) must be
  // explicitly bootstrapped here in the test harness.
  await ensureCalibrationZonesTable();

  const slug = `${PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Calzone Routes Org",
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Admin",
      lastName: "Tester",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db
    .insert(bids)
    .values({
      code: `${slug}-BID`,
      name: "Calzone Test Bid",
      clientName: "Calzone Client",
      gcOrganizationId: org.id,
    })
    .returning();
  bidId = bid.id;

  const otherSlug = `${PREFIX}other-${Date.now()}`;
  const [otherOrg] = await db
    .insert(organizations)
    .values({
      name: "Other Org",
      slug: otherSlug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  const [otherUser] = await db
    .insert(users)
    .values({
      email: `${otherSlug}@test.local`,
      passwordHash,
      firstName: "Other",
      lastName: "User",
      role: "ADMIN",
      organizationId: otherOrg.id,
      isActive: true,
    })
    .returning();
  otherOrgToken = generateToken(otherUser.id, otherUser.tokenVersion ?? 0);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("GET /api/takeoff/sheets/:sheetId/calibration-zones", () => {
  it("returns an empty array when the sheet has no zones", async () => {
    const sheetId = await freshSheet();
    const res = await apiGet(`/api/takeoff/sheets/${sheetId}/calibration-zones`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const sheetId = await freshSheet();
    const res = await request(app).get(
      `/api/takeoff/sheets/${sheetId}/calibration-zones`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when a user from another org tries to access the sheet", async () => {
    const sheetId = await freshSheet();
    const res = await apiGet(
      `/api/takeoff/sheets/${sheetId}/calibration-zones`,
      otherOrgToken,
    );
    expect(res.status).toBe(404);
  });

  it("lists zones in ascending creation order", async () => {
    const sheetId = await freshSheet();

    await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Zone A",
      polygonPoints: TRIANGLE,
      pxPerFoot: 10,
    });
    await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Zone B",
      polygonPoints: QUAD,
      pxPerFoot: 20,
    });

    const res = await apiGet(`/api/takeoff/sheets/${sheetId}/calibration-zones`);
    expect(res.status).toBe(200);
    const zones = res.body as ZoneRow[];
    expect(zones).toHaveLength(2);
    expect(zones[0].name).toBe("Zone A");
    expect(zones[1].name).toBe("Zone B");
  });
});

describe("POST /api/takeoff/sheets/:sheetId/calibration-zones", () => {
  it("creates a zone and returns the correct polygon_points shape", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Foundation Zone",
      polygonPoints: TRIANGLE,
      pxPerFoot: 12,
    });

    expect(res.status).toBe(201);
    const zone = res.body as ZoneRow;
    expect(zone.id).toBeTruthy();
    expect(zone.sheet_id).toBe(sheetId);
    expect(zone.name).toBe("Foundation Zone");
    expect(Number(zone.px_per_foot)).toBeCloseTo(12, 4);

    expect(Array.isArray(zone.polygon_points)).toBe(true);
    expect(zone.polygon_points).toHaveLength(3);
    expect(zone.polygon_points[0]).toMatchObject({ x: 100, y: 100 });
    expect(zone.polygon_points[1]).toMatchObject({ x: 300, y: 100 });
    expect(zone.polygon_points[2]).toMatchObject({ x: 200, y: 300 });
  });

  it("round-trips a 4-point quad polygon_points shape correctly", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Quad Zone",
      polygonPoints: QUAD,
      pxPerFoot: 8.5,
    });

    expect(res.status).toBe(201);
    const zone = res.body as ZoneRow;
    expect(zone.polygon_points).toHaveLength(4);
    for (let i = 0; i < QUAD.length; i++) {
      expect(zone.polygon_points[i]).toMatchObject(QUAD[i]);
    }
    expect(Number(zone.px_per_foot)).toBeCloseTo(8.5, 4);
  });

  it("rejects a polygon with fewer than 3 points (400)", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Too Few Points",
      polygonPoints: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      pxPerFoot: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatch(/invalid/i);
  });

  it("rejects a non-positive pxPerFoot (400)", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Bad Scale",
      polygonPoints: TRIANGLE,
      pxPerFoot: 0,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty name (400)", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "",
      polygonPoints: TRIANGLE,
      pxPerFoot: 10,
    });
    expect(res.status).toBe(400);
  });

  it("rejects a name longer than 200 characters (400)", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "x".repeat(201),
      polygonPoints: TRIANGLE,
      pxPerFoot: 10,
    });
    expect(res.status).toBe(400);
  });

  it("trims leading/trailing whitespace from the name", async () => {
    const sheetId = await freshSheet();
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "  Trimmed Name  ",
      polygonPoints: TRIANGLE,
      pxPerFoot: 10,
    });
    expect(res.status).toBe(201);
    expect((res.body as ZoneRow).name).toBe("Trimmed Name");
  });

  it("returns 401 for unauthenticated requests", async () => {
    const sheetId = await freshSheet();
    const res = await request(app)
      .post(`/api/takeoff/sheets/${sheetId}/calibration-zones`)
      .set("Content-Type", "application/json")
      .send({ name: "Anon Zone", polygonPoints: TRIANGLE, pxPerFoot: 10 });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/takeoff/calibration-zones/:zoneId", () => {
  async function createZone(sheetId: string, overrides: Partial<{ name: string; pxPerFoot: number; polygonPoints: typeof TRIANGLE }> = {}): Promise<ZoneRow> {
    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: overrides.name ?? "Patch Test Zone",
      polygonPoints: overrides.polygonPoints ?? TRIANGLE,
      pxPerFoot: overrides.pxPerFoot ?? 10,
    });
    expect(res.status).toBe(201);
    return res.body as ZoneRow;
  }

  it("updates the name only when only name is supplied", async () => {
    const sheetId = await freshSheet();
    const zone = await createZone(sheetId);

    const res = await apiPatch(`/api/takeoff/calibration-zones/${zone.id}`, {
      name: "Renamed Zone",
    });
    expect(res.status).toBe(200);
    const updated = res.body as ZoneRow;
    expect(updated.name).toBe("Renamed Zone");
    expect(Number(updated.px_per_foot)).toBeCloseTo(10, 4);
    expect(updated.polygon_points).toHaveLength(TRIANGLE.length);
  });

  it("updates pxPerFoot only when only pxPerFoot is supplied", async () => {
    const sheetId = await freshSheet();
    const zone = await createZone(sheetId);

    const res = await apiPatch(`/api/takeoff/calibration-zones/${zone.id}`, {
      pxPerFoot: 24.5,
    });
    expect(res.status).toBe(200);
    const updated = res.body as ZoneRow;
    expect(Number(updated.px_per_foot)).toBeCloseTo(24.5, 4);
    expect(updated.name).toBe("Patch Test Zone");
  });

  it("replaces polygon_points with a new shape and round-trips the {x,y} pairs", async () => {
    const sheetId = await freshSheet();
    const zone = await createZone(sheetId);

    const newPolygon = [
      { x: 10, y: 20 },
      { x: 200, y: 20 },
      { x: 200, y: 150 },
      { x: 10, y: 150 },
    ];

    const res = await apiPatch(`/api/takeoff/calibration-zones/${zone.id}`, {
      polygonPoints: newPolygon,
    });
    expect(res.status).toBe(200);
    const updated = res.body as ZoneRow;
    expect(updated.polygon_points).toHaveLength(4);
    for (let i = 0; i < newPolygon.length; i++) {
      expect(updated.polygon_points[i]).toMatchObject(newPolygon[i]);
    }
  });

  it("returns 404 for a non-existent zone id", async () => {
    const res = await apiPatch(
      "/api/takeoff/calibration-zones/00000000-0000-0000-0000-000000000000",
      { name: "Ghost" },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an invalid pxPerFoot during patch (400)", async () => {
    const sheetId = await freshSheet();
    const zone = await createZone(sheetId);
    const res = await apiPatch(`/api/takeoff/calibration-zones/${zone.id}`, {
      pxPerFoot: -5,
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/takeoff/calibration-zones/:zoneId", () => {
  it("removes the zone and subsequent GET returns an empty list", async () => {
    const sheetId = await freshSheet();
    const createRes = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Delete Me",
      polygonPoints: TRIANGLE,
      pxPerFoot: 10,
    });
    expect(createRes.status).toBe(201);
    const zone = createRes.body as ZoneRow;

    const delRes = await apiDelete(`/api/takeoff/calibration-zones/${zone.id}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body?.success).toBe(true);

    const listRes = await apiGet(`/api/takeoff/sheets/${sheetId}/calibration-zones`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(0);
  });

  it("returns 404 for a non-existent zone id", async () => {
    const res = await apiDelete(
      "/api/takeoff/calibration-zones/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const sheetId = await freshSheet();
    const createRes = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Auth Delete Zone",
      polygonPoints: TRIANGLE,
      pxPerFoot: 10,
    });
    expect(createRes.status).toBe(201);
    const zone = createRes.body as ZoneRow;

    const delRes = await request(app).delete(
      `/api/takeoff/calibration-zones/${zone.id}`,
    );
    expect(delRes.status).toBe(401);
  });
});

describe("Zone polygon_points JSONB integrity", () => {
  it("persists floating-point coordinates without precision loss", async () => {
    const sheetId = await freshSheet();
    const floatPts = [
      { x: 100.125, y: 200.5625 },
      { x: 300.0001, y: 200.5625 },
      { x: 200.0625, y: 400.875 },
    ];

    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "Float Zone",
      polygonPoints: floatPts,
      pxPerFoot: 9.999,
    });
    expect(res.status).toBe(201);
    const zone = res.body as ZoneRow;
    expect(zone.polygon_points[0].x).toBeCloseTo(100.125, 5);
    expect(zone.polygon_points[0].y).toBeCloseTo(200.5625, 5);
    expect(zone.polygon_points[2].x).toBeCloseTo(200.0625, 5);
    expect(zone.polygon_points[2].y).toBeCloseTo(400.875, 5);
  });

  it("GET round-trips polygon_points from DB with the same {x, y} structure", async () => {
    const sheetId = await freshSheet();
    await apiPost(`/api/takeoff/sheets/${sheetId}/calibration-zones`, {
      name: "DB Round-trip Zone",
      polygonPoints: QUAD,
      pxPerFoot: 15,
    });

    const listRes = await apiGet(`/api/takeoff/sheets/${sheetId}/calibration-zones`);
    expect(listRes.status).toBe(200);
    const zones = listRes.body as ZoneRow[];
    const zone = zones.find((z) => z.name === "DB Round-trip Zone")!;
    expect(zone).toBeTruthy();
    expect(Array.isArray(zone.polygon_points)).toBe(true);
    expect(zone.polygon_points).toHaveLength(QUAD.length);
    for (const pt of zone.polygon_points) {
      expect(typeof pt.x).toBe("number");
      expect(typeof pt.y).toBe("number");
    }
  });
});
