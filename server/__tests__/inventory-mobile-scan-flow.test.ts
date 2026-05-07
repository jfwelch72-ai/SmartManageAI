/**
 * Task #2555 — Automated test for the mobile inventory scan-and-post flow.
 *
 * Simulates `pushInventory()` in mobile/src/sync/coordinator.ts which POSTs
 * the InventoryAction.tsx payload shape directly to:
 *   - GET  /api/inventory/materials/by-barcode/:code  (scan lookup)
 *   - POST /api/inventory/receive                     (RECEIVE)
 *   - POST /api/inventory/issue                       (ISSUE → project)
 *   - POST /api/inventory/transfer                    (TRANSFER between locations)
 *
 * Verifies the end-to-end scan → receive → issue → transfer flow for a
 * single SKU and that cross-tenant material/location/project IDs return 404.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  inventoryLocations,
  inventoryMaterials,
  inventoryStockLevels,
  inventoryTransactions,
} from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SLUG_A = `__inv_mobile_test_a__${SUFFIX}`;
const SLUG_B = `__inv_mobile_test_b__${SUFFIX}`;

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  locA: string;
  locB: string;
  materialId: string;
  barcode: string;
}

let app: Express;
let server: Server;
let orgA: SeededOrg;
let orgB: SeededOrg;

async function seedOrg(slug: string, label: string): Promise<SeededOrg> {
  const passwordHash = await bcrypt.hash("MobileTest123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Inv Mobile ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "Inv",
      lastName: `Admin-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `Inv Project ${label}`,
      code: `INVP-${label}-${SUFFIX}`,
      clientName: `Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [locA] = await db
    .insert(inventoryLocations)
    .values({
      organizationId: org.id,
      code: `WH-${label}-${SUFFIX}`,
      name: `Warehouse ${label}`,
      type: "WAREHOUSE",
    })
    .returning();

  const [locB] = await db
    .insert(inventoryLocations)
    .values({
      organizationId: org.id,
      code: `TR-${label}-${SUFFIX}`,
      name: `Truck ${label}`,
      type: "TRUCK",
    })
    .returning();

  const barcode = `BC-${label}-${SUFFIX}`;
  const [mat] = await db
    .insert(inventoryMaterials)
    .values({
      organizationId: org.id,
      sku: `SKU-${label}-${SUFFIX}`,
      barcode,
      name: `Conduit 3/4" ${label}`,
      uom: "EA",
      unitCost: "1.00",
      defaultCostCode: "16-100",
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);

  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    locA: locA.id,
    locB: locB.id,
    materialId: mat.id,
    barcode,
  };
}

async function cleanupOrg(orgId: string): Promise<void> {
  await db.execute(sql`DELETE FROM inventory_transactions WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM inventory_stock_levels WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM inventory_materials WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM inventory_locations WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  [orgA, orgB] = await Promise.all([seedOrg(SLUG_A, "A"), seedOrg(SLUG_B, "B")]);
}, 180_000);

afterAll(async () => {
  if (orgA?.orgId) await cleanupOrg(orgA.orgId);
  if (orgB?.orgId) await cleanupOrg(orgB.orgId);
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 60_000);

function withAuth(req: request.Test, token: string): request.Test {
  return req.set("Cookie", `auth_token=${token}`);
}

async function getStock(orgId: string, materialId: string, locationId: string): Promise<number> {
  const [row] = await db
    .select()
    .from(inventoryStockLevels)
    .where(and(
      eq(inventoryStockLevels.organizationId, orgId),
      eq(inventoryStockLevels.materialId, materialId),
      eq(inventoryStockLevels.locationId, locationId),
    ));
  return row ? Number(row.onHand) : 0;
}

describe("Mobile inventory scan-and-post flow", () => {
  it("scan → receive → issue → transfer for a single SKU updates stock and txns", async () => {
    // 1. LOOKUP via barcode (mobile InventoryScan flow)
    const lookup = await withAuth(
      request(app).get(`/api/inventory/materials/by-barcode/${orgA.barcode}`),
      orgA.token,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.body.material.id).toBe(orgA.materialId);
    expect(lookup.body.material.barcode).toBe(orgA.barcode);
    expect(Array.isArray(lookup.body.stock)).toBe(true);
    expect(lookup.body.stock.length).toBe(0); // nothing on hand yet

    // 2. RECEIVE 10 units @ $5 into Warehouse — payload shape mirrors
    //    InventoryAction's RECEIVE branch.
    const receive = await withAuth(
      request(app).post("/api/inventory/receive"),
      orgA.token,
    ).send({
      materialId: orgA.materialId,
      locationId: orgA.locA,
      quantity: 10,
      unitCost: 5,
      referenceNumber: "PS-1001",
      notes: "received via mobile scan",
    });
    expect(receive.status).toBe(201);
    expect(receive.body.type).toBe("RECEIPT");
    expect(Number(receive.body.quantity)).toBe(10);

    expect(await getStock(orgA.orgId, orgA.materialId, orgA.locA)).toBe(10);

    // 3. ISSUE 4 units to project — InventoryAction ISSUE branch.
    const issue = await withAuth(
      request(app).post("/api/inventory/issue"),
      orgA.token,
    ).send({
      materialId: orgA.materialId,
      locationId: orgA.locA,
      quantity: 4,
      projectId: orgA.projectId,
      costCode: "16-100",
      referenceNumber: "MR-7",
    });
    expect(issue.status).toBe(201);
    expect(issue.body.type).toBe("ISSUE");
    expect(Number(issue.body.quantity)).toBe(-4);
    expect(Number(issue.body.unitCost)).toBe(5); // weighted avg from receipt
    expect(issue.body.projectId).toBe(orgA.projectId);

    expect(await getStock(orgA.orgId, orgA.materialId, orgA.locA)).toBe(6);

    // 4. TRANSFER 2 units Warehouse → Truck — InventoryAction TRANSFER branch.
    const transfer = await withAuth(
      request(app).post("/api/inventory/transfer"),
      orgA.token,
    ).send({
      materialId: orgA.materialId,
      fromLocationId: orgA.locA,
      toLocationId: orgA.locB,
      quantity: 2,
      referenceNumber: "TX-3",
    });
    expect(transfer.status).toBe(201);
    expect(transfer.body.ok).toBe(true);
    expect(typeof transfer.body.pairId).toBe("string");

    expect(await getStock(orgA.orgId, orgA.materialId, orgA.locA)).toBe(4);
    expect(await getStock(orgA.orgId, orgA.materialId, orgA.locB)).toBe(2);

    // 5. Verify the txn ledger contains the expected rows for this SKU:
    //    1 RECEIPT, 1 ISSUE, 1 TRANSFER_OUT, 1 TRANSFER_IN — paired.
    const txns = await db
      .select()
      .from(inventoryTransactions)
      .where(and(
        eq(inventoryTransactions.organizationId, orgA.orgId),
        eq(inventoryTransactions.materialId, orgA.materialId),
      ));
    const byType = new Map<string, typeof txns>();
    for (const t of txns) {
      const list = byType.get(t.type) ?? [];
      list.push(t);
      byType.set(t.type, list);
    }
    expect(byType.get("RECEIPT")?.length).toBe(1);
    expect(byType.get("ISSUE")?.length).toBe(1);
    expect(byType.get("TRANSFER_OUT")?.length).toBe(1);
    expect(byType.get("TRANSFER_IN")?.length).toBe(1);
    const tOut = byType.get("TRANSFER_OUT")![0];
    const tIn = byType.get("TRANSFER_IN")![0];
    expect(tOut.pairId).toBeTruthy();
    expect(tOut.pairId).toBe(tIn.pairId);
    expect(Number(tOut.quantity)).toBe(-2);
    expect(Number(tIn.quantity)).toBe(2);
  }, 60_000);

  it("rejects cross-tenant material / location / project with 404", async () => {
    // Lookup OrgB's barcode while authed as OrgA
    const lookup = await withAuth(
      request(app).get(`/api/inventory/materials/by-barcode/${orgB.barcode}`),
      orgA.token,
    );
    expect(lookup.status).toBe(404);

    // RECEIVE OrgB material → 404
    const recBadMat = await withAuth(
      request(app).post("/api/inventory/receive"),
      orgA.token,
    ).send({
      materialId: orgB.materialId,
      locationId: orgA.locA,
      quantity: 1,
    });
    expect(recBadMat.status).toBe(404);
    expect(recBadMat.body.error).toMatch(/Material not found/i);

    // RECEIVE into OrgB location → 404
    const recBadLoc = await withAuth(
      request(app).post("/api/inventory/receive"),
      orgA.token,
    ).send({
      materialId: orgA.materialId,
      locationId: orgB.locA,
      quantity: 1,
    });
    expect(recBadLoc.status).toBe(404);
    expect(recBadLoc.body.error).toMatch(/Location not found/i);

    // ISSUE against OrgB project → 404
    const issBadProj = await withAuth(
      request(app).post("/api/inventory/issue"),
      orgA.token,
    ).send({
      materialId: orgA.materialId,
      locationId: orgA.locA,
      quantity: 1,
      projectId: orgB.projectId,
    });
    expect(issBadProj.status).toBe(404);
    expect(issBadProj.body.error).toMatch(/Project not found/i);

    // TRANSFER from OrgA to OrgB location → 404 ("Location(s) not found")
    const xferBadDest = await withAuth(
      request(app).post("/api/inventory/transfer"),
      orgA.token,
    ).send({
      materialId: orgA.materialId,
      fromLocationId: orgA.locA,
      toLocationId: orgB.locA,
      quantity: 1,
    });
    expect(xferBadDest.status).toBe(404);

    // TRANSFER of OrgB material → 404 (material guard fires before locations)
    const xferBadMat = await withAuth(
      request(app).post("/api/inventory/transfer"),
      orgA.token,
    ).send({
      materialId: orgB.materialId,
      fromLocationId: orgA.locA,
      toLocationId: orgA.locB,
      quantity: 1,
    });
    expect(xferBadMat.status).toBe(404);

    // OrgA stock must remain untouched by the rejected calls.
    expect(await getStock(orgA.orgId, orgA.materialId, orgA.locA)).toBe(4);
    expect(await getStock(orgA.orgId, orgA.materialId, orgA.locB)).toBe(2);

    // No transactions leaked into OrgB.
    const orgBTxns = await db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.organizationId, orgB.orgId));
    expect(orgBTxns.length).toBe(0);
  }, 30_000);
});
