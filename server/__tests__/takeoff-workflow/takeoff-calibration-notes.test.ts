/**
 * Task #2351 — Server coverage for the optional calibration note.
 *
 * The PATCH `/api/takeoff/sheets/:id/calibration` route now accepts an
 * optional `note: string` that the InlineCalibrationDrawer surfaces as
 * a free-text textarea ("Verified against architect's dimension on
 * A2.1"). The note is stored on the calibration audit row's newValue
 * JSON so the GET `/api/takeoff/sheets/:sheetId/scale-history`
 * endpoint can surface it inline with the structured calibration
 * timeline.
 *
 * The four assertions below pin that contract end-to-end through the
 * Express route + Drizzle storage layer (no mocks):
 *
 *   1. Calibrating WITH a note round-trips it through the
 *      scale-history endpoint on the matching entry.
 *   2. Calibrating WITHOUT a note leaves `note: null` on the entry —
 *      we don't fabricate empty strings.
 *   3. Whitespace-only notes are normalised to "no note" (trimmed +
 *      length-checked server-side) so audit rows stay clean.
 *   4. Notes longer than the 500-char cap are rejected with 400 so
 *      the audit log can't be flooded with arbitrarily large blobs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db } from "../../db";
import { users, organizations, bids } from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__takeoff_calib_notes__";

interface ScaleHistoryEntry {
  id: string;
  scalePxPerFoot: number | null;
  note: string | null;
}
interface ScaleHistoryResponse {
  sheetId: string;
  entries: ScaleHistoryEntry[];
}

let app: Express;
let server: Server;
let adminToken: string;
let bidId: string;

function apiGet(path: string) {
  return request(app).get(path).set("Cookie", `auth_token=${adminToken}`);
}
function apiPost(path: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${adminToken}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(path: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${adminToken}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgIdsResult.rows;
  const orgIds = rows.map((r) => r.id);
  if (orgIds.length === 0) return;

  for (const orgId of orgIds) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${orgId})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM audit_log WHERE entity_type = 'takeoff_sheet' AND entity_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
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

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: "Calibration Notes Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Notes",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Calibration Notes Bid",
    clientName: "Calibration Notes Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function freshSheet(): Promise<string> {
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/calib-notes-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Calibration Notes Plan",
  });
  expect(planRes.status).toBe(201);
  return (planRes.body as { sheets: { id: string }[] }).sheets[0].id;
}

describe("PATCH /api/takeoff/sheets/:id/calibration — optional note (Task #2351)", () => {
  it("persists the note onto the calibration audit row and returns it from /scale-history", async () => {
    const sheetId = await freshSheet();
    const message = "Verified against architect's dimension on A2.1";

    const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 12,
      units: "ft",
      note: message,
    });
    expect(calRes.status).toBe(200);

    const histRes = await apiGet(`/api/takeoff/sheets/${sheetId}/scale-history`);
    expect(histRes.status).toBe(200);
    const body = histRes.body as ScaleHistoryResponse;
    // Most-recent calibration entry comes first (DESC by createdAt).
    const entry = body.entries.find((e) => e.scalePxPerFoot === 12);
    expect(entry).toBeTruthy();
    expect(entry?.note).toBe(message);
  });

  it("leaves note=null on the entry when no note was supplied", async () => {
    const sheetId = await freshSheet();
    const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 8,
      units: "ft",
    });
    expect(calRes.status).toBe(200);

    const histRes = await apiGet(`/api/takeoff/sheets/${sheetId}/scale-history`);
    expect(histRes.status).toBe(200);
    const body = histRes.body as ScaleHistoryResponse;
    const entry = body.entries.find((e) => e.scalePxPerFoot === 8);
    expect(entry).toBeTruthy();
    // We don't fabricate empty strings — the API returns null so
    // the panel can skip rendering the note row entirely.
    expect(entry?.note).toBeNull();
  });

  it("normalises whitespace-only notes to 'no note' so the audit row stays clean", async () => {
    const sheetId = await freshSheet();
    const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 16,
      units: "ft",
      note: "   \n\t   ",
    });
    expect(calRes.status).toBe(200);

    const histRes = await apiGet(`/api/takeoff/sheets/${sheetId}/scale-history`);
    expect(histRes.status).toBe(200);
    const body = histRes.body as ScaleHistoryResponse;
    const entry = body.entries.find((e) => e.scalePxPerFoot === 16);
    expect(entry).toBeTruthy();
    expect(entry?.note).toBeNull();
  });

  it("rejects a note longer than the 500-character cap with 400", async () => {
    const sheetId = await freshSheet();
    const oversized = "x".repeat(501);
    const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 24,
      units: "ft",
      note: oversized,
    });
    expect(calRes.status).toBe(400);
    expect(calRes.body?.error).toMatch(/500/);
  });

  it("rejects a non-string note with 400", async () => {
    const sheetId = await freshSheet();
    const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 32,
      units: "ft",
      note: { not: "a string" },
    });
    expect(calRes.status).toBe(400);
  });
});
