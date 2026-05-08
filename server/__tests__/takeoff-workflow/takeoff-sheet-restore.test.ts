/**
 * Task #1902 — integration coverage for the takeoff sheet RESTORE
 * endpoint that powers the "Undo" toast after a sheet delete in the
 * takeoff workspace. Mirrors the bulk-markup restore suite (#1882) so
 * the contract the client relies on is locked in:
 *
 *  - happy path: a delete returns a snapshot { sheet, measurements,
 *    markups } and the restore endpoint re-creates every row with the
 *    original ids preserved (so cached client references resolve)
 *  - undo round-trip: delete -> restore -> re-fetch lists the sheet,
 *    its measurements, and its markups under their original ids
 *  - auth: an unauthenticated restore is rejected
 *  - cross-org isolation: a user from another org cannot restore a
 *    sheet whose parent project / bid lives in another tenant
 *  - role gating: a VIEWER (read-only) cannot restore even within
 *    their own org
 *  - conflict: if the sheet id is still live the restore 409s and
 *    nothing partial commits
 *  - validation: malformed payloads come back as 400; mismatched id
 *    in URL vs body is rejected
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq } from "drizzle-orm";

import { db } from "../../db";
import { users, organizations, bids, takeoffSheets, takeoffMeasurements, takeoffMarkups } from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__takeoff_sheet_restore__";

let app: Express;
let server: Server;
let adminToken: string;
let adminId: string;
let orgId: string;
let fieldWorkerToken: string;
let otherOrgToken: string;
let otherAdminId: string;
let otherOrgId: string;
let bidId: string;
let otherBidId: string;

function apiGet(path: string, token: string | null = adminToken) {
  const r = request(app).get(path);
  if (token) r.set("Cookie", `auth_token=${token}`);
  return r;
}
function apiPost(path: string, body?: Record<string, unknown>, token: string | null = adminToken) {
  const r = request(app).post(path);
  if (token) r.set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, token: string | null = adminToken) {
  // Sheets DELETE requires ?confirm=true when the sheet still has
  // measurements; appending it unconditionally is harmless for empty
  // sheets and matches what the takeoff client hook actually sends.
  const sep = path.includes("?") ? "&" : "?";
  const r = request(app).delete(`${path}${sep}confirm=true`);
  if (token) r.set("Cookie", `auth_token=${token}`);
  return r;
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgIdsResult.rows;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;

  for (const id of ids) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${id})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_markups WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
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
    name: "Sheet Restore Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Sheet",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);
  adminId = admin.id;

  const [fieldWorker] = await db.insert(users).values({
    email: `${slug}-field@test.local`,
    passwordHash,
    firstName: "Field",
    lastName: "Worker",
    role: "FIELD_WORKER",
    organizationId: org.id,
    isActive: true,
  }).returning();
  fieldWorkerToken = generateToken(fieldWorker.id, fieldWorker.tokenVersion ?? 0);

  const otherSlug = `${slug}-other`;
  const [otherOrg] = await db.insert(organizations).values({
    name: "Other Sheet Restore Org",
    slug: otherSlug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  otherOrgId = otherOrg.id;

  const [otherAdmin] = await db.insert(users).values({
    email: `${otherSlug}@test.local`,
    passwordHash,
    firstName: "Other",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: otherOrg.id,
    isActive: true,
  }).returning();
  otherOrgToken = generateToken(otherAdmin.id, otherAdmin.tokenVersion ?? 0);
  otherAdminId = otherAdmin.id;

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Sheet Restore Bid",
    clientName: "Sheet Restore Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  const [otherBid] = await db.insert(bids).values({
    code: `${otherSlug}-BID`,
    name: "Other Org Bid",
    clientName: "Other Org Client",
    gcOrganizationId: otherOrg.id,
  }).returning();
  otherBidId = otherBid.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function createSheet(targetBidId = bidId, token = adminToken): Promise<string> {
  const planRes = await apiPost(
    `/api/bids/${targetBidId}/takeoff/plans`,
    {
      fileUrl: `https://example.com/restore-sheet-${Date.now()}-${Math.random()}.pdf`,
      fileName: `Restore Plan ${Date.now()}`,
    },
    token,
  );
  expect(planRes.status).toBe(201);
  return (planRes.body as { sheets: { id: string }[] }).sheets[0].id;
}

async function createMeasurement(sheetId: string, token = adminToken): Promise<{ id: string }> {
  const res = await apiPost(
    `/api/takeoff/sheets/${sheetId}/measurements`,
    {
      type: "LINEAR",
      label: "Test linear",
      points: [{ x: 10, y: 10 }, { x: 100, y: 10 }],
      color: "#3b82f6",
    },
    token,
  );
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function createMarkup(sheetId: string, token = adminToken): Promise<{ id: string }> {
  const res = await apiPost(
    "/api/takeoff/markups",
    {
      sheetId,
      tool: "RECTANGLE",
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
      color: "#ff0000",
      thickness: 2,
    },
    token,
  );
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe("DELETE /api/takeoff/sheets/:id snapshot response", () => {
  it("returns a snapshot of the deleted sheet plus its measurements and markups", async () => {
    const sheetId = await createSheet();
    const m1 = await createMeasurement(sheetId);
    const mk1 = await createMarkup(sheetId);

    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
    expect(delRes.body.snapshot?.sheet?.id).toBe(sheetId);
    expect(Array.isArray(delRes.body.snapshot.measurements)).toBe(true);
    expect(Array.isArray(delRes.body.snapshot.markups)).toBe(true);
    expect(delRes.body.measurementsDeleted).toBe(1);
    expect(delRes.body.markupsDeleted).toBe(1);
    const measurementIds: string[] = delRes.body.snapshot.measurements.map((m: any) => m.id);
    const markupIds: string[] = delRes.body.snapshot.markups.map((m: any) => m.id);
    expect(measurementIds).toContain(m1.id);
    expect(markupIds).toContain(mk1.id);

    // The rows really were deleted from the DB.
    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(0);
  });
});

describe("POST /api/takeoff/sheets/:id/restore", () => {
  it("restores the sheet, measurements, and markups under their original ids", async () => {
    const sheetId = await createSheet();
    const m1 = await createMeasurement(sheetId);
    const m2 = await createMeasurement(sheetId);
    const mk1 = await createMarkup(sheetId);

    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);
    const snapshot = delRes.body.snapshot;

    const restoreRes = await apiPost(`/api/takeoff/sheets/${sheetId}/restore`, snapshot);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.ok).toBe(true);
    expect(restoreRes.body.sheet?.id).toBe(sheetId);
    expect(restoreRes.body.measurementsRestored).toBe(2);
    expect(restoreRes.body.markupsRestored).toBe(1);

    // Re-read confirms the rows live again under the same ids.
    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(1);
    const measurementRows = await db.select().from(takeoffMeasurements).where(eq(takeoffMeasurements.sheetId, sheetId));
    const measurementIds = measurementRows.map((r) => r.id).sort();
    expect(measurementIds).toEqual([m1.id, m2.id].sort());
    const markupRows = await db.select().from(takeoffMarkups).where(eq(takeoffMarkups.sheetId, sheetId));
    expect(markupRows.map((r) => r.id)).toEqual([mk1.id]);
  });

  it("supports a sheet with no measurements or markups", async () => {
    const sheetId = await createSheet();

    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.measurementsDeleted).toBe(0);
    expect(delRes.body.markupsDeleted).toBe(0);

    const restoreRes = await apiPost(`/api/takeoff/sheets/${sheetId}/restore`, {
      sheet: delRes.body.snapshot.sheet,
      measurements: [],
      markups: [],
    });
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.measurementsRestored).toBe(0);
    expect(restoreRes.body.markupsRestored).toBe(0);

    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(1);
  });

  it("rejects unauthenticated requests", async () => {
    const sheetId = await createSheet();
    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);

    const res = await apiPost(
      `/api/takeoff/sheets/${sheetId}/restore`,
      delRes.body.snapshot,
      null,
    );
    expect(res.status).toBe(401);

    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(0);
  });

  it("rejects a field worker (insufficient role) and inserts no rows", async () => {
    const sheetId = await createSheet();
    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);

    const res = await apiPost(
      `/api/takeoff/sheets/${sheetId}/restore`,
      delRes.body.snapshot,
      fieldWorkerToken,
    );
    expect(res.status).toBe(403);

    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(0);
  });

  it("rejects a cross-org request (parent bid belongs to another tenant)", async () => {
    const sheetId = await createSheet();
    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);

    const res = await apiPost(
      `/api/takeoff/sheets/${sheetId}/restore`,
      delRes.body.snapshot,
      otherOrgToken,
    );
    expect(res.status).toBe(403);

    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(0);
  });

  it("returns 409 conflict when the sheet id is still live (no partial commit)", async () => {
    const sheetId = await createSheet();
    const m1 = await createMeasurement(sheetId);

    // Build a forged snapshot referencing the LIVE sheet id, without
    // deleting it first. The restore must refuse and leave the live
    // measurement untouched (no second copy inserted).
    const snapshot = {
      sheet: {
        id: sheetId,
        bidId,
        imageUrl: "https://example.com/forged.pdf",
        sheetIndex: 0,
        sheetName: "Forged",
        units: "ft",
        folderGroup: "Plans",
        isActive: true,
        rotation: 0,
        completionStatus: "not_started",
      },
      measurements: [],
      markups: [],
    };

    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/restore`, snapshot);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("conflict");

    // Live sheet and its measurement are still intact and unique.
    const sheetRows = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRows).toHaveLength(1);
    const mRows = await db.select().from(takeoffMeasurements).where(eq(takeoffMeasurements.id, m1.id));
    expect(mRows).toHaveLength(1);
  });

  it("rejects a body whose sheet.id does not match the URL", async () => {
    const sheetId = await createSheet();
    const otherSheetId = await createSheet();

    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);

    const res = await apiPost(`/api/takeoff/sheets/${otherSheetId}/restore`, delRes.body.snapshot);
    expect(res.status).toBe(400);

    // Cleanup the live other sheet so the afterAll is tidy.
    await apiDelete(`/api/takeoff/sheets/${otherSheetId}`);
  });

  it("rejects malformed payloads with 400", async () => {
    const sheetId = await createSheet();
    const delRes = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes.status).toBe(200);

    const noBody = await apiPost(`/api/takeoff/sheets/${sheetId}/restore`, {});
    expect(noBody.status).toBe(400);

    const wrongShape = await apiPost(`/api/takeoff/sheets/${sheetId}/restore`, {
      sheet: { id: sheetId },
    });
    expect(wrongShape.status).toBe(400);
  });

  it("supports a delete -> restore -> delete redo cycle on the same sheet id", async () => {
    const sheetId = await createSheet();
    const m1 = await createMeasurement(sheetId);

    const delRes1 = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes1.status).toBe(200);

    const snapshot = delRes1.body.snapshot;
    const restoreRes = await apiPost(`/api/takeoff/sheets/${sheetId}/restore`, snapshot);
    expect(restoreRes.status).toBe(200);

    // Redo the delete: the same sheet id should still resolve.
    const delRes2 = await apiDelete(`/api/takeoff/sheets/${sheetId}`);
    expect(delRes2.status).toBe(200);
    expect(delRes2.body.measurementsDeleted).toBe(1);
    const sheetRow = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId));
    expect(sheetRow).toHaveLength(0);
    const mRow = await db.select().from(takeoffMeasurements).where(eq(takeoffMeasurements.id, m1.id));
    expect(mRow).toHaveLength(0);
  });
});
