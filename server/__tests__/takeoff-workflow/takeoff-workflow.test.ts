import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../../db";
import {
  users,
  organizations,
  projects,
  bids,
} from "@shared/schema";
import { generateToken } from "../../auth";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__takeoff_e2e__";

interface OrgData {
  org: typeof organizations.$inferSelect;
  admin: typeof users.$inferSelect;
  token: string;
}

interface OrgAData extends OrgData {
  project: typeof projects.$inferSelect;
  bid: typeof bids.$inferSelect;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  bidId: string | null;
  projectId: string | null;
  scalePxPerFoot: number | null;
  units: string;
  rotation: number;
  sheetIndex: number;
}

interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  computedLengthFt: number | null;
  computedAreaFt2: number | null;
  computedVolumeCy: number | null;
  count: number | null;
}

interface CategoryResponse {
  id: string;
  name: string;
  color: string;
}

interface GroupResponse {
  id: string;
  name: string;
  sheetId: string;
  color: string;
}

interface VersionResponse {
  id: string;
  versionNumber: number;
  status: string;
  label: string | null;
  measurements?: MeasurementResponse[];
}

interface ComparisonSummary {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
}

interface ComparisonResponse {
  versionA: VersionResponse;
  versionB: VersionResponse;
  summary: ComparisonSummary;
  added: MeasurementResponse[];
  removed: MeasurementResponse[];
  changed: Array<{ older: MeasurementResponse; newer: MeasurementResponse; deltas: Record<string, number> }>;
  unchanged: MeasurementResponse[];
}

interface DuplicateResponse {
  sheet: SheetResponse;
  measurementsCopied: number;
}

let app: Express;
let server: Server;
let orgA: OrgAData;
let orgB: OrgData;

function apiGet(path: string, token: string) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}

function apiPost(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

function apiPatch(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

function apiDelete(path: string, token: string) {
  return request(app).delete(path).set("Cookie", `auth_token=${token}`);
}

async function seedOrg(label: string): Promise<OrgData> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `Takeoff Test Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "Test",
    lastName: `Admin-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const token = generateToken(admin.id, admin.tokenVersion ?? 0);
  return { org, admin, token };
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`
  );
  const rows = (orgIdsResult as { rows: Array<{ id: string }> }).rows;
  const orgIds = rows.map((r) => r.id);
  if (orgIds.length === 0) return;

  for (const orgId of orgIds) {
    const projectSubquery = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${orgId})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE project_id IN ${projectSubquery} OR bid_id IN ${bidSubquery})`;

    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_versions WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_measurement_groups WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM quantity_categories WHERE project_id IN ${projectSubquery} OR bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE project_id IN ${projectSubquery} OR bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
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

  const orgAData = await seedOrg("A");
  orgB = await seedOrg("B");

  const projectCode = `${TEST_PREFIX}P-A-${Date.now()}`;
  const [project] = await db.insert(projects).values({
    name: "Takeoff Test Project",
    code: projectCode,
    clientName: "Takeoff Test Client",
    gcOrganizationId: orgAData.org.id,
    status: "ACTIVE",
  }).returning();

  const bidCode = `${TEST_PREFIX}B-A-${Date.now()}`;
  const [bid] = await db.insert(bids).values({
    code: bidCode,
    name: "Takeoff Test Bid",
    clientName: "Takeoff Test Client",
    gcOrganizationId: orgAData.org.id,
  }).returning();

  orgA = { ...orgAData, project, bid };
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Takeoff Workflow E2E", () => {
  let sheetId: string;
  let sheet2Id: string;
  let categoryId: string;
  let linearMeasurementId: string;
  let areaMeasurementId: string;
  let volumeMeasurementId: string;
  let countMeasurementId: string;
  let groupId: string;
  let version1Id: string;
  let version2Id: string;

  describe("1. Plan Upload / Sheet Creation", () => {
    it("should create a takeoff sheet via direct plan upload (bid-based)", async () => {
      const res = await apiPost(`/api/bids/${orgA.bid.id}/takeoff/plans`, orgA.token, {
        fileUrl: "https://example.com/test-plan.pdf",
        fileName: "Test Plan Sheet 1",
      });
      expect(res.status).toBe(201);
      const body = res.body as { sheets: SheetResponse[] };
      expect(body.sheets).toHaveLength(1);
      sheetId = body.sheets[0].id;
      expect(body.sheets[0].sheetName).toBe("Test Plan Sheet 1");
      expect(body.sheets[0].bidId).toBe(orgA.bid.id);
    });

    it("should create a second sheet for reorder/copy/delete tests", async () => {
      const res = await apiPost(`/api/bids/${orgA.bid.id}/takeoff/plans`, orgA.token, {
        fileUrl: "https://example.com/test-plan-2.pdf",
        fileName: "Test Plan Sheet 2",
      });
      expect(res.status).toBe(201);
      const body = res.body as { sheets: SheetResponse[] };
      sheet2Id = body.sheets[0].id;
    });

    it("should list sheets for the bid", async () => {
      const res = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/sheets`, orgA.token);
      expect(res.status).toBe(200);
      const sheets = res.body as SheetResponse[];
      expect(sheets.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("2. Calibration", () => {
    it("should set calibration scale on a sheet", async () => {
      const scalePxPerFoot = 10.0;
      const res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, orgA.token, {
        scalePxPerFoot,
        units: "ft",
      });
      expect(res.status).toBe(200);
      const body = res.body as SheetResponse;
      expect(body.scalePxPerFoot).toBe(scalePxPerFoot);
      expect(body.units).toBe("ft");
    });

    it("should reject invalid calibration scale", async () => {
      const res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, orgA.token, {
        scalePxPerFoot: -5,
        units: "ft",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("3. Category Management", () => {
    it("should create a quantity category", async () => {
      const res = await apiPost(`/api/bids/${orgA.bid.id}/takeoff/categories`, orgA.token, {
        name: "Electrical Conduit",
        color: "#ef4444",
        lineStyle: "dashed",
        lineWidth: 4,
        wasteFactor: 0.1,
        unitCost: 5.50,
      });
      expect(res.status).toBe(201);
      const body = res.body as CategoryResponse;
      expect(body.name).toBe("Electrical Conduit");
      expect(body.color).toBe("#ef4444");
      categoryId = body.id;
    });

    it("should list categories for the bid", async () => {
      const res = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/categories`, orgA.token);
      expect(res.status).toBe(200);
      const categories = res.body as CategoryResponse[];
      expect(categories.length).toBeGreaterThanOrEqual(1);
      const found = categories.find((c) => c.id === categoryId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Electrical Conduit");
    });
  });

  describe("4. Measurement CRUD — All Types", () => {
    it("should create a LINEAR measurement and compute length", async () => {
      const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      const res = await apiPost("/api/takeoff/measurements", orgA.token, {
        sheetId,
        type: "LINEAR",
        label: "Wall Run A",
        points: JSON.stringify(points),
        categoryId,
      });
      expect(res.status).toBe(201);
      const body = res.body as MeasurementResponse;
      linearMeasurementId = body.id;
      expect(body.type).toBe("LINEAR");
      expect(body.computedLengthFt).toBeCloseTo(10.0, 1);
    });

    it("should create an AREA measurement and compute area", async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ];
      const res = await apiPost("/api/takeoff/measurements", orgA.token, {
        sheetId,
        type: "AREA",
        label: "Floor Section B",
        points: JSON.stringify(points),
      });
      expect(res.status).toBe(201);
      const body = res.body as MeasurementResponse;
      areaMeasurementId = body.id;
      expect(body.type).toBe("AREA");
      expect(body.computedAreaFt2).toBeCloseTo(50.0, 1);
    });

    it("should create a VOLUME measurement and compute volume", async () => {
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ];
      const depthFeet = 3;
      const res = await apiPost("/api/takeoff/measurements", orgA.token, {
        sheetId,
        type: "VOLUME",
        label: "Concrete Pad",
        points: JSON.stringify(points),
        depthFeet,
      });
      expect(res.status).toBe(201);
      const body = res.body as MeasurementResponse;
      volumeMeasurementId = body.id;
      expect(body.type).toBe("VOLUME");
      expect(body.computedAreaFt2).toBeCloseTo(50.0, 1);
      expect(body.computedVolumeCy).toBeCloseTo(50.0 * 3.0 / 27, 1);
    });

    it("should create a COUNT measurement", async () => {
      const res = await apiPost("/api/takeoff/measurements", orgA.token, {
        sheetId,
        type: "COUNT",
        label: "Light Fixtures",
        points: JSON.stringify([{ x: 200, y: 200 }]),
        count: 12,
      });
      expect(res.status).toBe(201);
      const body = res.body as MeasurementResponse;
      countMeasurementId = body.id;
      expect(body.type).toBe("COUNT");
      expect(body.count).toBe(12);
    });

    it("should update a measurement", async () => {
      const res = await apiPatch(`/api/takeoff/measurements/${linearMeasurementId}`, orgA.token, {
        label: "Updated Wall Run A",
      });
      expect(res.status).toBe(200);
      const body = res.body as MeasurementResponse;
      expect(body.label).toBe("Updated Wall Run A");
    });

    it("should list measurements for the sheet", async () => {
      const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`, orgA.token);
      expect(res.status).toBe(200);
      const measurements = res.body as MeasurementResponse[];
      expect(measurements.length).toBeGreaterThanOrEqual(4);
    });

    it("should delete a measurement", async () => {
      const res = await apiDelete(`/api/takeoff/measurements/${countMeasurementId}`, orgA.token);
      expect(res.status).toBe(200);

      const list = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`, orgA.token);
      const measurements = list.body as MeasurementResponse[];
      const found = measurements.find((m) => m.id === countMeasurementId);
      expect(found).toBeUndefined();
    });
  });

  describe("5. Calibration Recalculation", () => {
    it("should recalculate measurements when calibration changes", async () => {
      const newScale = 20.0;
      const calibRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, orgA.token, {
        scalePxPerFoot: newScale,
        units: "ft",
      });
      expect(calibRes.status).toBe(200);

      const listRes = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`, orgA.token);
      expect(listRes.status).toBe(200);
      const measurements = listRes.body as MeasurementResponse[];

      const linear = measurements.find((m) => m.id === linearMeasurementId);
      expect(linear).toBeDefined();
      expect(linear!.computedLengthFt).toBeCloseTo(5.0, 1);

      const area = measurements.find((m) => m.id === areaMeasurementId);
      expect(area).toBeDefined();
      expect(area!.computedAreaFt2).toBeCloseTo(12.5, 1);

      const volume = measurements.find((m) => m.id === volumeMeasurementId);
      expect(volume).toBeDefined();
      expect(volume!.computedAreaFt2).toBeCloseTo(12.5, 1);
      expect(volume!.computedVolumeCy).toBeCloseTo(12.5 * 3.0 / 27, 1);
    });
  });

  describe("6. Measurement Groups", () => {
    it("should create a measurement group", async () => {
      const res = await apiPost(`/api/takeoff/sheets/${sheetId}/groups`, orgA.token, {
        name: "Electrical Group",
        color: "#f59e0b",
        sortOrder: 0,
      });
      expect(res.status).toBe(201);
      const body = res.body as GroupResponse;
      groupId = body.id;
      expect(body.name).toBe("Electrical Group");
      expect(body.sheetId).toBe(sheetId);
    });

    it("should list groups for the sheet", async () => {
      const res = await apiGet(`/api/takeoff/sheets/${sheetId}/groups`, orgA.token);
      expect(res.status).toBe(200);
      const groups = res.body as GroupResponse[];
      expect(groups.length).toBeGreaterThanOrEqual(1);
    });

    it("should update a group", async () => {
      const res = await apiPatch(`/api/takeoff/groups/${groupId}`, orgA.token, {
        name: "Updated Electrical Group",
        color: "#10b981",
      });
      expect(res.status).toBe(200);
      const body = res.body as GroupResponse;
      expect(body.name).toBe("Updated Electrical Group");
      expect(body.color).toBe("#10b981");
    });

    it("should toggle group visibility", async () => {
      const res = await apiPatch(`/api/takeoff/groups/${groupId}/visibility`, orgA.token, {
        visible: false,
      });
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);
    });

    it("should delete a group", async () => {
      const res = await apiDelete(`/api/takeoff/groups/${groupId}`, orgA.token);
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);

      const list = await apiGet(`/api/takeoff/sheets/${sheetId}/groups`, orgA.token);
      const groups = list.body as GroupResponse[];
      const found = groups.find((g) => g.id === groupId);
      expect(found).toBeUndefined();
    });
  });

  describe("7. Versioning and Locking", () => {
    it("should create version 1 (first version, assigns existing measurements)", async () => {
      const res = await apiPost("/api/takeoff/versions", orgA.token, {
        sheetId,
        label: "Initial Takeoff",
      });
      expect(res.status).toBe(201);
      const body = res.body as VersionResponse;
      version1Id = body.id;
      expect(body.versionNumber).toBe(1);
      expect(body.status).toBe("DRAFT");
      expect(body.label).toBe("Initial Takeoff");
    });

    it("should create version 2 (locks version 1, clones measurements)", async () => {
      const res = await apiPost("/api/takeoff/versions", orgA.token, {
        sheetId,
        label: "Revised Takeoff",
      });
      expect(res.status).toBe(201);
      const body = res.body as VersionResponse;
      version2Id = body.id;
      expect(body.versionNumber).toBe(2);
      expect(body.status).toBe("DRAFT");

      const versionsRes = await apiGet(`/api/takeoff/versions?sheetId=${sheetId}`, orgA.token);
      expect(versionsRes.status).toBe(200);
      const versions = versionsRes.body as VersionResponse[];
      const v1 = versions.find((v) => v.id === version1Id);
      expect(v1).toBeDefined();
      expect(v1!.status).toBe("LOCKED");
    });

    it("should reject edits on measurements in locked version 1", async () => {
      const v1MRes = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements?versionId=${version1Id}`, orgA.token);
      expect(v1MRes.status).toBe(200);
      const v1Measurements = v1MRes.body as MeasurementResponse[];
      expect(v1Measurements.length).toBeGreaterThan(0);

      const lockedMeasurementId = v1Measurements[0].id;
      const updateRes = await apiPatch(`/api/takeoff/measurements/${lockedMeasurementId}`, orgA.token, {
        label: "Should Fail",
      });
      expect(updateRes.status).toBe(403);
      const errBody = updateRes.body as { error: string };
      expect(errBody.error).toContain("locked");
    });

    it("should reject deleting measurements in locked version 1", async () => {
      const v1MRes = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements?versionId=${version1Id}`, orgA.token);
      const v1Measurements = v1MRes.body as MeasurementResponse[];
      const lockedMeasurementId = v1Measurements[0].id;
      const deleteRes = await apiDelete(`/api/takeoff/measurements/${lockedMeasurementId}`, orgA.token);
      expect(deleteRes.status).toBe(403);
      const errBody = deleteRes.body as { error: string };
      expect(errBody.error).toContain("locked");
    });

    it("should allow edits on version 2 (DRAFT)", async () => {
      const v2MRes = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements?versionId=${version2Id}`, orgA.token);
      expect(v2MRes.status).toBe(200);
      const v2Measurements = v2MRes.body as MeasurementResponse[];
      expect(v2Measurements.length).toBeGreaterThan(0);

      const draftMeasurementId = v2Measurements[0].id;
      const updateRes = await apiPatch(`/api/takeoff/measurements/${draftMeasurementId}`, orgA.token, {
        label: "Updated in v2",
      });
      expect(updateRes.status).toBe(200);
      const body = updateRes.body as MeasurementResponse;
      expect(body.label).toBe("Updated in v2");
    });

    it("should list versions for a sheet", async () => {
      const res = await apiGet(`/api/takeoff/versions?sheetId=${sheetId}`, orgA.token);
      expect(res.status).toBe(200);
      const versions = res.body as VersionResponse[];
      expect(versions.length).toBe(2);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[1].versionNumber).toBe(2);
    });

    it("should get a single version with measurements", async () => {
      const res = await apiGet(`/api/takeoff/versions/${version2Id}`, orgA.token);
      expect(res.status).toBe(200);
      const body = res.body as VersionResponse;
      expect(body.id).toBe(version2Id);
      expect(body.measurements).toBeDefined();
      expect(body.measurements!.length).toBeGreaterThan(0);
    });
  });

  describe("8. Version Comparison", () => {
    it("should compare two versions and return correct deltas", async () => {
      const v2MRes = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements?versionId=${version2Id}`, orgA.token);
      const v2Measurements = v2MRes.body as MeasurementResponse[];
      if (v2Measurements.length > 0) {
        const mId = v2Measurements[0].id;
        await apiPatch(`/api/takeoff/measurements/${mId}`, orgA.token, {
          label: "Modified for comparison",
          points: JSON.stringify([{ x: 0, y: 0 }, { x: 200, y: 0 }]),
          type: "LINEAR",
        });
      }

      const res = await apiGet(`/api/takeoff/versions/compare?versionAId=${version1Id}&versionBId=${version2Id}`, orgA.token);
      expect(res.status).toBe(200);
      const body = res.body as ComparisonResponse;
      expect(body.versionA).toBeDefined();
      expect(body.versionB).toBeDefined();
      expect(body.summary).toBeDefined();
      expect(typeof body.summary.addedCount).toBe("number");
      expect(typeof body.summary.removedCount).toBe("number");
      expect(typeof body.summary.changedCount).toBe("number");
      expect(typeof body.summary.unchangedCount).toBe("number");
      expect(body.added).toBeDefined();
      expect(body.removed).toBeDefined();
      expect(body.changed).toBeDefined();
      expect(body.unchanged).toBeDefined();
    });

    it("should return 400 if version IDs are missing", async () => {
      const res = await apiGet("/api/takeoff/versions/compare", orgA.token);
      expect(res.status).toBe(400);
    });
  });

  describe("9. Sheet Operations", () => {
    it("should rename a sheet", async () => {
      const res = await apiPatch(`/api/takeoff/sheets/${sheet2Id}/rename`, orgA.token, {
        sheetName: "Renamed Sheet 2",
      });
      expect(res.status).toBe(200);
      const body = res.body as SheetResponse;
      expect(body.sheetName).toBe("Renamed Sheet 2");
    });

    it("should set sheet rotation", async () => {
      const res = await apiPatch(`/api/takeoff/sheets/${sheet2Id}/rotation`, orgA.token, {
        rotation: 90,
      });
      expect(res.status).toBe(200);
      const body = res.body as SheetResponse;
      expect(body.rotation).toBe(90);
    });

    it("should reject invalid rotation values", async () => {
      const res = await apiPatch(`/api/takeoff/sheets/${sheet2Id}/rotation`, orgA.token, {
        rotation: 45,
      });
      expect(res.status).toBe(400);
    });

    it("should duplicate a sheet (with measurements)", async () => {
      const res = await apiPost(`/api/takeoff/sheets/${sheet2Id}/duplicate`, orgA.token);
      expect(res.status).toBe(201);
      const body = res.body as DuplicateResponse;
      expect(body.sheet).toBeDefined();
      expect(body.sheet.sheetName).toContain("Copy");
    });

    it("should reorder sheets within a bid", async () => {
      const listRes = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/sheets`, orgA.token);
      const sheets = listRes.body as SheetResponse[];
      expect(sheets.length).toBeGreaterThanOrEqual(2);

      const order = sheets.map((s, i) => ({
        id: s.id,
        sheetIndex: sheets.length - 1 - i,
      }));

      const res = await apiPatch(`/api/bids/${orgA.bid.id}/takeoff/sheets/reorder`, orgA.token, { order });
      expect(res.status).toBe(200);
    });

    it("should delete a sheet", async () => {
      const listBefore = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/sheets`, orgA.token);
      const sheetsBefore = listBefore.body as SheetResponse[];
      const countBefore = sheetsBefore.length;

      const duplicated = sheetsBefore.find((s) => s.sheetName?.includes("Copy"));
      expect(duplicated).toBeDefined();

      const res = await apiDelete(`/api/takeoff/sheets/${duplicated!.id}`, orgA.token);
      expect(res.status).toBe(200);

      const listAfter = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/sheets`, orgA.token);
      const sheetsAfter = listAfter.body as SheetResponse[];
      expect(sheetsAfter.length).toBe(countBefore - 1);
    });
  });

  describe("10. Category Deletion", () => {
    it("should delete a quantity category", async () => {
      const res = await apiDelete(`/api/quantity-categories/${categoryId}`, orgA.token);
      expect(res.status).toBe(200);

      const listRes = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/categories`, orgA.token);
      const categories = listRes.body as CategoryResponse[];
      const found = categories.find((c) => c.id === categoryId);
      expect(found).toBeUndefined();
    });
  });

  describe("11. Authorization — Cross-Org Access Denied", () => {
    it("should deny OrgB from listing OrgA bid sheets", async () => {
      const res = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/sheets`, orgB.token);
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from creating sheets on OrgA bid", async () => {
      const res = await apiPost(`/api/bids/${orgA.bid.id}/takeoff/plans`, orgB.token, {
        fileUrl: "https://evil.com/plan.pdf",
        fileName: "Evil Plan",
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from reading OrgA sheet measurements", async () => {
      const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`, orgB.token);
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from creating measurements on OrgA sheet", async () => {
      const res = await apiPost("/api/takeoff/measurements", orgB.token, {
        sheetId,
        type: "LINEAR",
        label: "Evil Measurement",
        points: JSON.stringify([{ x: 0, y: 0 }, { x: 100, y: 0 }]),
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from updating OrgA measurements", async () => {
      const res = await apiPatch(`/api/takeoff/measurements/${linearMeasurementId}`, orgB.token, {
        label: "Hacked",
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from deleting OrgA measurements", async () => {
      const res = await apiDelete(`/api/takeoff/measurements/${linearMeasurementId}`, orgB.token);
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from calibrating OrgA sheets", async () => {
      const res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, orgB.token, {
        scalePxPerFoot: 999,
        units: "ft",
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from creating categories on OrgA bid", async () => {
      const res = await apiPost(`/api/bids/${orgA.bid.id}/takeoff/categories`, orgB.token, {
        name: "Evil Category",
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from creating groups on OrgA sheet", async () => {
      const res = await apiPost(`/api/takeoff/sheets/${sheetId}/groups`, orgB.token, {
        name: "Evil Group",
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from creating versions on OrgA sheet", async () => {
      const res = await apiPost("/api/takeoff/versions", orgB.token, {
        sheetId,
        label: "Evil Version",
      });
      expect([403, 404]).toContain(res.status);
    });

    it("should deny OrgB from listing OrgA versions", async () => {
      const res = await apiGet(`/api/takeoff/versions?sheetId=${sheetId}`, orgB.token);
      expect([403, 404]).toContain(res.status);
    });
  });

  describe("12. All-Measurements Aggregation (Bid)", () => {
    it("should return all measurements across sheets for the bid", async () => {
      const res = await apiGet(`/api/bids/${orgA.bid.id}/takeoff/all-measurements`, orgA.token);
      expect(res.status).toBe(200);
      const measurements = res.body as MeasurementResponse[];
      expect(Array.isArray(measurements)).toBe(true);
      expect(measurements.length).toBeGreaterThan(0);
    });
  });
});
