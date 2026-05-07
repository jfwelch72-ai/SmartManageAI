/**
 * Task #2498 — Unit tests for inventory ledger correctness.
 *
 * Pins down the four ledger-level invariants of the inventory module
 * (`server/inventoryRoutes.ts`):
 *   (a) RECEIVE bumps purchase_order_items.quantity_received and updates
 *       weighted-average cost on the stock level.
 *   (b) ISSUE applies an avg-cost burden, decrements stock, and writes a
 *       single signed-negative ISSUE row to the ledger.
 *   (c) TRANSFER is atomic and balanced — both legs share a pairId, sum to
 *       zero, and the destination inherits the source's avg cost.
 *   (d) CYCLE_COUNT approval posts ONE adjustment per non-zero variance and
 *       skips lines whose counted quantity matches the snapshot.
 *   (e) Negative on-hand is rejected for ISSUE / TRANSFER / ADJUST flows
 *       (the only signed path is an ADJUSTMENT with `quantity > 0`).
 *
 * Strategy: the tests run against the real test database (`heliumdb_test`,
 * provisioned by `npm run test:setup` and rebuilt by `globalSetup.ts`). The
 * inventory router is mounted on a bare Express app; `requireAuth`,
 * `requireRole`, and `requireFeaturePermission` are stubbed so the suite can
 * focus on the ledger math instead of session plumbing. Audit logging and
 * the structured logger are no-op'd to keep test output clean.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";

type TestUser = {
  id: string;
  organizationId: string;
  role: string;
  effectiveRole?: string;
};

let testUser: TestUser;

vi.mock("../auth", () => {
  const passthrough = (
    req: Request & { user?: TestUser },
    _res: Response,
    next: NextFunction,
  ) => {
    req.user = testUser;
    next();
  };
  return {
    requireAuth: passthrough,
    requireRole: () => passthrough,
    requireFeaturePermission: () => passthrough,
    requireAnyFeaturePermission: () => passthrough,
    requireRoleOrFeature: () => passthrough,
  };
});

vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
  logApprove: vi.fn(),
  logRoleChange: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// Pulled in after the mocks above have been registered so the router picks
// up the stubbed auth helpers.
const { default: inventoryRoutes } = await import("../inventoryRoutes");
const { db } = await import("../db");
const {
  organizations,
  users,
  projects,
  purchaseOrders,
  purchaseOrderItems,
  inventoryLocations,
  inventoryMaterials,
  inventoryStockLevels,
  inventoryTransactions,
  inventoryCycleCounts,
  inventoryCycleCountLines,
} = await import("@shared/schema");

let app: Express;
let orgId: string;
let userId: string;
let projectId: string;

async function seedOrgUserProject() {
  const oId = randomUUID();
  await db.insert(organizations).values({
    id: oId,
    name: `Inv Test Org ${oId.slice(0, 8)}`,
    slug: `inv-test-${oId.slice(0, 8)}`,
  });
  const uId = randomUUID();
  await db.insert(users).values({
    id: uId,
    organizationId: oId,
    firstName: "Inv",
    lastName: "Tester",
    email: `inv-tester-${uId}@example.test`,
    role: "ADMIN",
  });
  const pId = randomUUID();
  await db.insert(projects).values({
    id: pId,
    name: `Inv Project ${pId.slice(0, 8)}`,
    code: `INV-${pId.slice(0, 8)}`,
    clientName: "Test Client",
    gcOrganizationId: oId,
  });
  return { orgId: oId, userId: uId, projectId: pId };
}

async function seedMaterial(overrides: Partial<{ unitCost: string; defaultCostCode: string }> = {}) {
  const id = randomUUID();
  const [mat] = await db.insert(inventoryMaterials).values({
    organizationId: orgId,
    sku: `SKU-${id.slice(0, 8)}`,
    name: `Material ${id.slice(0, 8)}`,
    uom: "EA",
    unitCost: overrides.unitCost ?? null,
    defaultCostCode: overrides.defaultCostCode ?? null,
  }).returning();
  return mat;
}

async function seedLocation(prefix = "LOC") {
  const id = randomUUID();
  const [loc] = await db.insert(inventoryLocations).values({
    organizationId: orgId,
    code: `${prefix}-${id.slice(0, 8)}`,
    name: `Location ${id.slice(0, 8)}`,
    type: "WAREHOUSE",
  }).returning();
  return loc;
}

async function seedPoWithItem(opts: { quantity: string; unitCost?: string }) {
  const [po] = await db.insert(purchaseOrders).values({
    orgId,
    projectId,
    poNumber: `PO-${randomUUID().slice(0, 8)}`,
    status: "APPROVED",
  }).returning();
  const [item] = await db.insert(purchaseOrderItems).values({
    poId: po.id,
    description: "PO line",
    quantity: opts.quantity,
    unitCost: opts.unitCost ?? null,
  }).returning();
  return { po, item };
}

async function getStock(materialId: string, locationId: string) {
  const [row] = await db.select().from(inventoryStockLevels).where(and(
    eq(inventoryStockLevels.organizationId, orgId),
    eq(inventoryStockLevels.materialId, materialId),
    eq(inventoryStockLevels.locationId, locationId),
  ));
  return row;
}

async function getTxnsForMaterial(materialId: string) {
  return db.select().from(inventoryTransactions).where(and(
    eq(inventoryTransactions.organizationId, orgId),
    eq(inventoryTransactions.materialId, materialId),
  ));
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(inventoryRoutes);
  // Centralized error handler so any unhandled throw surfaces as 500 instead
  // of dangling the supertest request.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const seeded = await seedOrgUserProject();
  orgId = seeded.orgId;
  userId = seeded.userId;
  projectId = seeded.projectId;
});

beforeEach(() => {
  testUser = { id: userId, organizationId: orgId, role: "ADMIN", effectiveRole: "ADMIN" };
});

describe("RECEIVE — bumps PO quantityReceived and weighted-avg cost", () => {
  it("creates the stock row, RECEIPT txn, and bumps PO line quantity_received", async () => {
    const mat = await seedMaterial();
    const loc = await seedLocation("WH");
    const { po, item } = await seedPoWithItem({ quantity: "200", unitCost: "5" });

    const res = await request(app).post("/api/inventory/receive").send({
      materialId: mat.id,
      locationId: loc.id,
      quantity: 100,
      unitCost: 5,
      poId: po.id,
      poItemId: item.id,
      referenceNumber: "PSL-001",
    });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("RECEIPT");

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(100);
    expect(Number(stock.averageCost)).toBe(5);

    const [refreshedItem] = await db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, item.id));
    expect(Number(refreshedItem.quantityReceived)).toBe(100);

    const txns = await getTxnsForMaterial(mat.id);
    expect(txns).toHaveLength(1);
    const txn = txns[0];
    expect(txn.type).toBe("RECEIPT");
    expect(Number(txn.quantity)).toBe(100);
    expect(Number(txn.unitCost)).toBe(5);
    expect(Number(txn.totalCost)).toBe(500);
    expect(txn.poId).toBe(po.id);
    expect(txn.poItemId).toBe(item.id);
  });

  it("re-receiving against the same PO line cumulatively bumps quantity_received and recomputes weighted avg cost", async () => {
    const mat = await seedMaterial();
    const loc = await seedLocation("WH");
    const { po, item } = await seedPoWithItem({ quantity: "200", unitCost: "5" });

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: loc.id, quantity: 100, unitCost: 5,
      poId: po.id, poItemId: item.id,
    }).expect(201);
    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: loc.id, quantity: 50, unitCost: 7,
      poId: po.id, poItemId: item.id,
    }).expect(201);

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(150);
    // Weighted average: (5*100 + 7*50) / 150 = 850/150 = 5.6667
    expect(Number(stock.averageCost)).toBeCloseTo(5.6667, 4);

    const [refreshedItem] = await db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, item.id));
    expect(Number(refreshedItem.quantityReceived)).toBe(150);

    const txns = await getTxnsForMaterial(mat.id);
    expect(txns).toHaveLength(2);
    expect(txns.every(t => t.type === "RECEIPT")).toBe(true);
  });

  it("blind receive (no PO) only writes the RECEIPT row; no PO line is touched", async () => {
    const mat = await seedMaterial();
    const loc = await seedLocation("YARD");

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: loc.id, quantity: 25, unitCost: 4,
    }).expect(201);

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(25);

    const txns = await getTxnsForMaterial(mat.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].poId).toBeNull();
    expect(txns[0].poItemId).toBeNull();
  });
});

describe("ISSUE — applies avg-cost burden and decrements stock", () => {
  it("writes a signed-negative ISSUE txn carrying the snapshot avg cost", async () => {
    const mat = await seedMaterial({ defaultCostCode: "01-100" });
    const loc = await seedLocation("WH");

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: loc.id, quantity: 100, unitCost: 6,
    }).expect(201);

    const issueRes = await request(app).post("/api/inventory/issue").send({
      materialId: mat.id, locationId: loc.id, quantity: 30,
      projectId,
    });
    expect(issueRes.status).toBe(201);

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(70);
    expect(Number(stock.averageCost)).toBe(6);

    const txns = await getTxnsForMaterial(mat.id);
    const issue = txns.find(t => t.type === "ISSUE")!;
    expect(Number(issue.quantity)).toBe(-30);
    expect(Number(issue.unitCost)).toBe(6);
    // Cost burden is the negated cost of issued material (a debit on stock).
    expect(Number(issue.totalCost)).toBe(-180);
    expect(issue.projectId).toBe(projectId);
    // Default cost code from the material applies when the request omits it.
    expect(issue.costCode).toBe("01-100");
  });

  it("rejects an issue that would push on-hand below zero and leaves stock + ledger untouched", async () => {
    const mat = await seedMaterial();
    const loc = await seedLocation("WH");

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: loc.id, quantity: 10, unitCost: 1,
    }).expect(201);

    const res = await request(app).post("/api/inventory/issue").send({
      materialId: mat.id, locationId: loc.id, quantity: 25, projectId,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Insufficient stock/);

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(10);

    const issues = (await getTxnsForMaterial(mat.id)).filter(t => t.type === "ISSUE");
    expect(issues).toHaveLength(0);
  });
});

describe("TRANSFER — atomic, balanced, paired", () => {
  it("writes paired TRANSFER_OUT/_IN rows that net to zero and shifts stock between locations", async () => {
    const mat = await seedMaterial();
    const fromLoc = await seedLocation("WH");
    const toLoc = await seedLocation("TRUCK");

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: fromLoc.id, quantity: 100, unitCost: 5,
    }).expect(201);

    await request(app).post("/api/inventory/transfer").send({
      materialId: mat.id,
      fromLocationId: fromLoc.id,
      toLocationId: toLoc.id,
      quantity: 40,
    }).expect(201);

    const fromStock = await getStock(mat.id, fromLoc.id);
    const toStock = await getStock(mat.id, toLoc.id);
    expect(Number(fromStock.onHand)).toBe(60);
    expect(Number(toStock.onHand)).toBe(40);
    // Avg cost carries over to the destination.
    expect(Number(toStock.averageCost)).toBe(5);

    const txns = await getTxnsForMaterial(mat.id);
    const transferLegs = txns.filter(t => t.type === "TRANSFER_OUT" || t.type === "TRANSFER_IN");
    expect(transferLegs).toHaveLength(2);
    const [outLeg] = transferLegs.filter(t => t.type === "TRANSFER_OUT");
    const [inLeg] = transferLegs.filter(t => t.type === "TRANSFER_IN");
    expect(outLeg.pairId).toBeTruthy();
    expect(outLeg.pairId).toBe(inLeg.pairId);
    expect(Number(outLeg.quantity) + Number(inLeg.quantity)).toBe(0);
    expect(outLeg.locationId).toBe(fromLoc.id);
    expect(outLeg.counterpartyLocationId).toBe(toLoc.id);
    expect(inLeg.locationId).toBe(toLoc.id);
    expect(inLeg.counterpartyLocationId).toBe(fromLoc.id);
  });

  it("rejects a transfer larger than source stock and leaves both legs/stocks unchanged", async () => {
    const mat = await seedMaterial();
    const fromLoc = await seedLocation("WH");
    const toLoc = await seedLocation("TRUCK");

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: fromLoc.id, quantity: 5, unitCost: 1,
    }).expect(201);

    const res = await request(app).post("/api/inventory/transfer").send({
      materialId: mat.id,
      fromLocationId: fromLoc.id,
      toLocationId: toLoc.id,
      quantity: 10,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Insufficient stock/);

    const fromStock = await getStock(mat.id, fromLoc.id);
    const toStock = await getStock(mat.id, toLoc.id);
    expect(Number(fromStock.onHand)).toBe(5);
    // No row inserted on the destination because the txn rolled back.
    expect(toStock).toBeUndefined();

    const transferLegs = (await getTxnsForMaterial(mat.id))
      .filter(t => t.type === "TRANSFER_OUT" || t.type === "TRANSFER_IN");
    expect(transferLegs).toHaveLength(0);
  });
});

describe("CYCLE COUNT — approval posts only the variance", () => {
  it("posts a CYCLE_COUNT adjustment for non-zero variance lines and skips zero-variance ones", async () => {
    const matA = await seedMaterial();
    const matB = await seedMaterial();
    const matC = await seedMaterial();
    const loc = await seedLocation("WH");

    // Seed three stock rows at the same location so they all land on the
    // count snapshot.
    for (const m of [matA, matB, matC]) {
      await request(app).post("/api/inventory/receive").send({
        materialId: m.id, locationId: loc.id, quantity: 100, unitCost: 2,
      }).expect(201);
    }

    const startRes = await request(app).post("/api/inventory/cycle-counts").send({
      locationId: loc.id,
    });
    expect(startRes.status).toBe(201);
    const cycleId = startRes.body.id;

    const detailRes = await request(app).get(`/api/inventory/cycle-counts/${cycleId}`);
    expect(detailRes.status).toBe(200);
    const lines = detailRes.body.lines as Array<{ id: string; materialId: string }>;
    const lineByMat = new Map(lines.map(l => [l.materialId, l]));

    // matA: counted 95 (variance -5)
    await request(app)
      .patch(`/api/inventory/cycle-counts/${cycleId}/lines/${lineByMat.get(matA.id)!.id}`)
      .send({ countedQty: 95, reason: "LOSS" })
      .expect(200);
    // matB: counted 100 (zero variance — should NOT post a txn)
    await request(app)
      .patch(`/api/inventory/cycle-counts/${cycleId}/lines/${lineByMat.get(matB.id)!.id}`)
      .send({ countedQty: 100 })
      .expect(200);
    // matC: deliberately not counted (countedQty stays NULL — should be skipped)

    const approveRes = await request(app)
      .post(`/api/inventory/cycle-counts/${cycleId}/approve`).send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");

    // matA: stock decremented to 95, single CYCLE_COUNT txn with qty=-5
    const stockA = await getStock(matA.id, loc.id);
    expect(Number(stockA.onHand)).toBe(95);
    const cycleTxnsA = (await getTxnsForMaterial(matA.id))
      .filter(t => t.type === "CYCLE_COUNT");
    expect(cycleTxnsA).toHaveLength(1);
    expect(Number(cycleTxnsA[0].quantity)).toBe(-5);
    expect(cycleTxnsA[0].cycleCountId).toBe(cycleId);
    expect(cycleTxnsA[0].adjustReason).toBe("LOSS");

    // matB: untouched stock, NO cycle-count txn (zero variance)
    const stockB = await getStock(matB.id, loc.id);
    expect(Number(stockB.onHand)).toBe(100);
    const cycleTxnsB = (await getTxnsForMaterial(matB.id))
      .filter(t => t.type === "CYCLE_COUNT");
    expect(cycleTxnsB).toHaveLength(0);

    // matC: not counted at all, NO cycle-count txn
    const stockC = await getStock(matC.id, loc.id);
    expect(Number(stockC.onHand)).toBe(100);
    const cycleTxnsC = (await getTxnsForMaterial(matC.id))
      .filter(t => t.type === "CYCLE_COUNT");
    expect(cycleTxnsC).toHaveLength(0);

    // Variance line is back-stamped with the adjustment txn id.
    const allLines = await db.select().from(inventoryCycleCountLines)
      .where(eq(inventoryCycleCountLines.cycleCountId, cycleId));
    const lineA = allLines.find(l => l.materialId === matA.id)!;
    expect(lineA.adjustmentTxnId).toBe(cycleTxnsA[0].id);
    const lineB = allLines.find(l => l.materialId === matB.id)!;
    expect(lineB.adjustmentTxnId).toBeNull();

    // The cycle-count header is marked APPROVED with metadata stamped.
    const [cc] = await db.select().from(inventoryCycleCounts)
      .where(eq(inventoryCycleCounts.id, cycleId));
    expect(cc.status).toBe("APPROVED");
    expect(cc.approvedById).toBe(userId);
    expect(cc.approvedAt).toBeTruthy();
  });
});

describe("Negative-on-hand prevention", () => {
  it("ADJUSTMENT downward beyond on-hand is rejected with insufficient-stock error", async () => {
    const mat = await seedMaterial();
    const loc = await seedLocation("WH");

    await request(app).post("/api/inventory/receive").send({
      materialId: mat.id, locationId: loc.id, quantity: 5, unitCost: 1,
    }).expect(201);

    const res = await request(app).post("/api/inventory/adjust").send({
      materialId: mat.id,
      locationId: loc.id,
      quantity: -10,
      adjustReason: "DAMAGE",
      notes: "Forklift incident — 10 units written off",
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Insufficient stock/);

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(5);

    const adjustments = (await getTxnsForMaterial(mat.id))
      .filter(t => t.type === "ADJUSTMENT");
    expect(adjustments).toHaveLength(0);
  });

  it("ADJUSTMENT upward (signed positive) IS allowed and writes a single ADJUSTMENT txn", async () => {
    const mat = await seedMaterial();
    const loc = await seedLocation("WH");

    const res = await request(app).post("/api/inventory/adjust").send({
      materialId: mat.id,
      locationId: loc.id,
      quantity: 7,
      adjustReason: "FOUND",
      notes: "Found 7 units in back of truck",
    });
    expect(res.status).toBe(201);

    const stock = await getStock(mat.id, loc.id);
    expect(Number(stock.onHand)).toBe(7);

    const adjustments = (await getTxnsForMaterial(mat.id))
      .filter(t => t.type === "ADJUSTMENT");
    expect(adjustments).toHaveLength(1);
    expect(Number(adjustments[0].quantity)).toBe(7);
    expect(adjustments[0].adjustReason).toBe("FOUND");
  });
});
