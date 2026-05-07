import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, lte, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  inventoryLocations, inventoryMaterials, inventoryStockLevels,
  inventoryTransactions, inventoryCycleCounts, inventoryCycleCountLines,
  insertInventoryLocationSchema, insertInventoryMaterialSchema,
  purchaseOrders, purchaseOrderItems,
  projects,
} from "@shared/schema";

type InventoryTxnType = "RECEIPT" | "ISSUE" | "TRANSFER_OUT" | "TRANSFER_IN" | "ADJUSTMENT" | "CYCLE_COUNT";
const INVENTORY_TXN_TYPES = ["RECEIPT", "ISSUE", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "CYCLE_COUNT"] as const;
type InventoryAdjustReason = "DAMAGE" | "LOSS" | "FOUND" | "RETURN" | "CORRECTION" | "EXPIRED" | "OTHER";

// Drizzle transaction handle type — matches what `db.transaction((tx) => ...)` provides.
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";

const router = Router();

// Mirror the UI gate at /inventory: only orgs with the equipment feature
// permission may use any inventory API, even with a permitted role.
router.use("/api/inventory", requireAuth, requireFeaturePermission("canManageEquipment"));

const READ_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"] as const;
const WRITE_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT"] as const;
const APPROVE_ROLES = ["ADMIN", "MANAGER"] as const;

function requireOrg(req: AuthRequest, res: Response): string | null {
  const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess || !orgId) {
    res.status(403).json({ error: "No organization access" });
    return null;
  }
  return orgId;
}

// ─── LOCATIONS ────────────────────────────────────────────────────────────────

router.get("/api/inventory/locations", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const list = await db.select().from(inventoryLocations)
      .where(eq(inventoryLocations.organizationId, orgId))
      .orderBy(asc(inventoryLocations.name));
    res.json(list);
  } catch (err) { next(err); }
});

router.post("/api/inventory/locations", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = insertInventoryLocationSchema.safeParse({
      ...req.body,
      code: req.body.code ? sanitizeShortText(req.body.code) : undefined,
      name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
      notes: req.body.notes ? sanitizeText(req.body.notes) : null,
      address: req.body.address ? sanitizeText(req.body.address) : null,
    });
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
    const [loc] = await db.insert(inventoryLocations).values({ ...parsed.data, organizationId: orgId }).returning();
    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryLocation", entityId: loc.id, newValue: JSON.stringify({ code: loc.code }) }, req);
    res.status(201).json(loc);
  } catch (err) { next(err); }
});

router.patch("/api/inventory/locations/:id", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const [existing] = await db.select().from(inventoryLocations)
      .where(and(eq(inventoryLocations.id, req.params.id), eq(inventoryLocations.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Location not found" });
    const schema = z.object({
      name: z.string().min(1).optional(),
      type: z.string().optional(),
      address: z.string().nullish(),
      notes: z.string().nullish(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const [updated] = await db.update(inventoryLocations)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(inventoryLocations.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── MATERIALS / SKUS ─────────────────────────────────────────────────────────

router.get("/api/inventory/materials", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const conds = [eq(inventoryMaterials.organizationId, orgId)];
    if (search) {
      conds.push(or(
        ilike(inventoryMaterials.name, `%${search}%`),
        ilike(inventoryMaterials.sku, `%${search}%`),
        ilike(inventoryMaterials.barcode, `%${search}%`),
      )!);
    }
    const list = await db.select().from(inventoryMaterials).where(and(...conds)).orderBy(asc(inventoryMaterials.name));
    res.json(list);
  } catch (err) { next(err); }
});

router.post("/api/inventory/materials", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = insertInventoryMaterialSchema.safeParse({
      ...req.body,
      sku: req.body.sku ? sanitizeShortText(req.body.sku) : undefined,
      barcode: req.body.barcode ? sanitizeShortText(req.body.barcode) : null,
      name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : null,
    });
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
    const [mat] = await db.insert(inventoryMaterials).values({ ...parsed.data, organizationId: orgId }).returning();
    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryMaterial", entityId: mat.id, newValue: JSON.stringify({ sku: mat.sku }) }, req);
    res.status(201).json(mat);
  } catch (err) { next(err); }
});

router.patch("/api/inventory/materials/:id", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const [existing] = await db.select().from(inventoryMaterials)
      .where(and(eq(inventoryMaterials.id, req.params.id), eq(inventoryMaterials.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Material not found" });
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().nullish(),
      category: z.string().nullish(),
      uom: z.string().optional(),
      barcode: z.string().nullish(),
      defaultCostCode: z.string().nullish(),
      unitCost: z.string().nullish(),
      reorderPoint: z.string().nullish(),
      reorderQty: z.string().nullish(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const [updated] = await db.update(inventoryMaterials)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(inventoryMaterials.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err) { next(err); }
});

// Barcode/QR scan lookup — used by mobile app
router.get("/api/inventory/materials/by-barcode/:code", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const code = req.params.code;
    const [mat] = await db.select().from(inventoryMaterials)
      .where(and(
        eq(inventoryMaterials.organizationId, orgId),
        or(eq(inventoryMaterials.barcode, code), eq(inventoryMaterials.sku, code))!,
      ))
      .limit(1);
    if (!mat) return res.status(404).json({ error: "No material matched that barcode/SKU" });
    const stock = await db.select().from(inventoryStockLevels)
      .where(and(eq(inventoryStockLevels.organizationId, orgId), eq(inventoryStockLevels.materialId, mat.id)));
    res.json({ material: mat, stock });
  } catch (err) { next(err); }
});

// ─── STOCK LEVELS ─────────────────────────────────────────────────────────────

router.get("/api/inventory/stock", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
    const conds = [eq(inventoryStockLevels.organizationId, orgId)];
    if (locationId) conds.push(eq(inventoryStockLevels.locationId, locationId));
    const rows = await db
      .select({
        id: inventoryStockLevels.id,
        materialId: inventoryStockLevels.materialId,
        locationId: inventoryStockLevels.locationId,
        onHand: inventoryStockLevels.onHand,
        averageCost: inventoryStockLevels.averageCost,
        lastCountedAt: inventoryStockLevels.lastCountedAt,
        sku: inventoryMaterials.sku,
        materialName: inventoryMaterials.name,
        uom: inventoryMaterials.uom,
        reorderPoint: inventoryMaterials.reorderPoint,
        locationCode: inventoryLocations.code,
        locationName: inventoryLocations.name,
      })
      .from(inventoryStockLevels)
      .innerJoin(inventoryMaterials, eq(inventoryStockLevels.materialId, inventoryMaterials.id))
      .innerJoin(inventoryLocations, eq(inventoryStockLevels.locationId, inventoryLocations.id))
      .where(and(...conds))
      .orderBy(asc(inventoryMaterials.name));
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── TRANSACTIONAL HELPERS ────────────────────────────────────────────────────

async function adjustStock(
  tx: DbTx,
  orgId: string,
  materialId: string,
  locationId: string,
  signedDelta: number,
  unitCost?: number | null,
) {
  const [existing] = await tx.select().from(inventoryStockLevels)
    .where(and(
      eq(inventoryStockLevels.organizationId, orgId),
      eq(inventoryStockLevels.materialId, materialId),
      eq(inventoryStockLevels.locationId, locationId),
    ));

  if (!existing) {
    if (signedDelta < 0) {
      throw new Error("Insufficient stock: location has no record of this material");
    }
    await tx.insert(inventoryStockLevels).values({
      organizationId: orgId,
      materialId, locationId,
      onHand: String(signedDelta),
      averageCost: unitCost != null ? String(unitCost) : null,
    });
    return;
  }

  const currentQty = Number(existing.onHand);
  const newQty = currentQty + signedDelta;
  if (newQty < 0) {
    throw new Error(`Insufficient stock: have ${currentQty}, need ${-signedDelta}`);
  }

  // Weighted-average cost on receipts
  let newAvgCost = existing.averageCost;
  if (signedDelta > 0 && unitCost != null) {
    const oldAvg = existing.averageCost ? Number(existing.averageCost) : 0;
    const totalValue = oldAvg * currentQty + unitCost * signedDelta;
    newAvgCost = String(newQty > 0 ? totalValue / newQty : unitCost);
  }

  await tx.update(inventoryStockLevels)
    .set({ onHand: String(newQty), averageCost: newAvgCost, updatedAt: new Date() })
    .where(eq(inventoryStockLevels.id, existing.id));
}

// ─── RECEIVING (against PO or blind) ─────────────────────────────────────────

const receiveSchema = z.object({
  materialId: z.string().min(1),
  locationId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative().optional(),
  poId: z.string().optional(),
  poItemId: z.string().optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/api/inventory/receive", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    // Cross-org safety: confirm material + location belong to caller
    const [mat] = await db.select().from(inventoryMaterials)
      .where(and(eq(inventoryMaterials.id, data.materialId), eq(inventoryMaterials.organizationId, orgId)));
    if (!mat) return res.status(404).json({ error: "Material not found" });
    const [loc] = await db.select().from(inventoryLocations)
      .where(and(eq(inventoryLocations.id, data.locationId), eq(inventoryLocations.organizationId, orgId)));
    if (!loc) return res.status(404).json({ error: "Location not found" });

    // PO link safety check + cross-tenant validation for the PO line item
    let validatedPoId: string | null = data.poId ?? null;
    if (data.poId) {
      const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, data.poId));
      if (!po || po.orgId !== orgId) return res.status(404).json({ error: "Purchase order not found" });
    }
    if (data.poItemId) {
      // Join PO item to its parent PO and require same org. If poId was also passed, it must match.
      const [item] = await db
        .select({ id: purchaseOrderItems.id, poId: purchaseOrderItems.poId, orgId: purchaseOrders.orgId })
        .from(purchaseOrderItems)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.poId))
        .where(eq(purchaseOrderItems.id, data.poItemId));
      if (!item || item.orgId !== orgId) {
        return res.status(404).json({ error: "Purchase order item not found" });
      }
      if (data.poId && data.poId !== item.poId) {
        return res.status(400).json({ error: "Purchase order item does not belong to the supplied PO" });
      }
      validatedPoId = item.poId;
    }

    const totalCost = data.unitCost != null ? data.quantity * data.unitCost : null;
    const txn = await db.transaction(async (tx) => {
      await adjustStock(tx, orgId, data.materialId, data.locationId, data.quantity, data.unitCost ?? null);
      const [created] = await tx.insert(inventoryTransactions).values({
        organizationId: orgId,
        type: "RECEIPT",
        materialId: data.materialId,
        locationId: data.locationId,
        poId: validatedPoId,
        poItemId: data.poItemId ?? null,
        quantity: String(data.quantity),
        unitCost: data.unitCost != null ? String(data.unitCost) : null,
        totalCost: totalCost != null ? String(totalCost) : null,
        referenceNumber: data.referenceNumber ?? null,
        notes: data.notes ?? null,
        performedById: req.user!.id,
      }).returning();
      if (data.poItemId) {
        await tx.update(purchaseOrderItems)
          .set({ quantityReceived: sql`COALESCE(${purchaseOrderItems.quantityReceived}, 0) + ${String(data.quantity)}` })
          .where(eq(purchaseOrderItems.id, data.poItemId));
      }
      return created;
    });

    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryTransaction", entityId: txn.id, newValue: JSON.stringify({ type: "RECEIPT", qty: data.quantity }) }, req);
    res.status(201).json(txn);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Insufficient stock")) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── ISSUE TO PROJECT ─────────────────────────────────────────────────────────

const issueSchema = z.object({
  materialId: z.string().min(1),
  locationId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  projectId: z.string().min(1),
  costCode: z.string().optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/api/inventory/issue", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const [mat] = await db.select().from(inventoryMaterials)
      .where(and(eq(inventoryMaterials.id, data.materialId), eq(inventoryMaterials.organizationId, orgId)));
    if (!mat) return res.status(404).json({ error: "Material not found" });
    const [loc] = await db.select().from(inventoryLocations)
      .where(and(eq(inventoryLocations.id, data.locationId), eq(inventoryLocations.organizationId, orgId)));
    if (!loc) return res.status(404).json({ error: "Location not found" });

    // Cross-tenant guard: project must belong to caller's org (gcOrganizationId)
    const [proj] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects).where(eq(projects.id, data.projectId));
    if (!proj || proj.gcOrganizationId !== orgId) {
      return res.status(404).json({ error: "Project not found" });
    }

    const txn = await db.transaction(async (tx) => {
      // Capture average cost for cost burden snapshot (inside txn for consistency)
      const [stock] = await tx.select().from(inventoryStockLevels)
        .where(and(
          eq(inventoryStockLevels.organizationId, orgId),
          eq(inventoryStockLevels.materialId, data.materialId),
          eq(inventoryStockLevels.locationId, data.locationId),
        ));
      const unitCost = stock?.averageCost ? Number(stock.averageCost) : (mat.unitCost ? Number(mat.unitCost) : null);
      await adjustStock(tx, orgId, data.materialId, data.locationId, -data.quantity);
      const totalCost = unitCost != null ? unitCost * data.quantity : null;
      const [created] = await tx.insert(inventoryTransactions).values({
        organizationId: orgId,
        type: "ISSUE",
        materialId: data.materialId,
        locationId: data.locationId,
        projectId: data.projectId,
        costCode: data.costCode ?? mat.defaultCostCode ?? null,
        quantity: String(-data.quantity),
        unitCost: unitCost != null ? String(unitCost) : null,
        totalCost: totalCost != null ? String(-totalCost) : null,
        referenceNumber: data.referenceNumber ?? null,
        notes: data.notes ?? null,
        performedById: req.user!.id,
      }).returning();
      return created;
    });

    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryTransaction", entityId: txn.id, newValue: JSON.stringify({ type: "ISSUE", qty: data.quantity, projectId: data.projectId }) }, req);
    res.status(201).json(txn);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Insufficient stock")) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── TRANSFER BETWEEN LOCATIONS ───────────────────────────────────────────────

const transferSchema = z.object({
  materialId: z.string().min(1),
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/api/inventory/transfer", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    if (data.fromLocationId === data.toLocationId) {
      return res.status(400).json({ error: "Source and destination must differ" });
    }

    const [mat] = await db.select().from(inventoryMaterials)
      .where(and(eq(inventoryMaterials.id, data.materialId), eq(inventoryMaterials.organizationId, orgId)));
    if (!mat) return res.status(404).json({ error: "Material not found" });
    const locs = await db.select().from(inventoryLocations)
      .where(and(eq(inventoryLocations.organizationId, orgId), or(
        eq(inventoryLocations.id, data.fromLocationId),
        eq(inventoryLocations.id, data.toLocationId),
      )!));
    if (locs.length !== 2) return res.status(404).json({ error: "Location(s) not found" });

    const pairId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const [fromStock] = await tx.select().from(inventoryStockLevels)
        .where(and(
          eq(inventoryStockLevels.organizationId, orgId),
          eq(inventoryStockLevels.materialId, data.materialId),
          eq(inventoryStockLevels.locationId, data.fromLocationId),
        ));
      const unitCost = fromStock?.averageCost ? Number(fromStock.averageCost) : null;
      await adjustStock(tx, orgId, data.materialId, data.fromLocationId, -data.quantity);
      await adjustStock(tx, orgId, data.materialId, data.toLocationId, data.quantity, unitCost);
      const totalCost = unitCost != null ? unitCost * data.quantity : null;
      await tx.insert(inventoryTransactions).values([
        {
          organizationId: orgId,
          type: "TRANSFER_OUT",
          materialId: data.materialId,
          locationId: data.fromLocationId,
          counterpartyLocationId: data.toLocationId,
          quantity: String(-data.quantity),
          unitCost: unitCost != null ? String(unitCost) : null,
          totalCost: totalCost != null ? String(-totalCost) : null,
          referenceNumber: data.referenceNumber ?? null,
          notes: data.notes ?? null,
          performedById: req.user!.id,
          pairId,
        },
        {
          organizationId: orgId,
          type: "TRANSFER_IN",
          materialId: data.materialId,
          locationId: data.toLocationId,
          counterpartyLocationId: data.fromLocationId,
          quantity: String(data.quantity),
          unitCost: unitCost != null ? String(unitCost) : null,
          totalCost: totalCost != null ? String(totalCost) : null,
          referenceNumber: data.referenceNumber ?? null,
          notes: data.notes ?? null,
          performedById: req.user!.id,
          pairId,
        },
      ]);
    });

    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryTransaction", entityId: pairId, newValue: JSON.stringify({ type: "TRANSFER", qty: data.quantity }) }, req);
    res.status(201).json({ ok: true, pairId });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Insufficient stock")) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── ADJUSTMENT (with reason code) ────────────────────────────────────────────

const adjustSchema = z.object({
  materialId: z.string().min(1),
  locationId: z.string().min(1),
  quantity: z.coerce.number(), // signed: positive = add, negative = remove
  adjustReason: z.enum(["DAMAGE", "LOSS", "FOUND", "RETURN", "CORRECTION", "EXPIRED", "OTHER"]),
  notes: z.string().min(1, "Reason note is required for audit trail"),
});

router.post("/api/inventory/adjust", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    if (data.quantity === 0) return res.status(400).json({ error: "Adjustment quantity cannot be zero" });

    const [mat] = await db.select().from(inventoryMaterials)
      .where(and(eq(inventoryMaterials.id, data.materialId), eq(inventoryMaterials.organizationId, orgId)));
    if (!mat) return res.status(404).json({ error: "Material not found" });
    const [loc] = await db.select().from(inventoryLocations)
      .where(and(eq(inventoryLocations.id, data.locationId), eq(inventoryLocations.organizationId, orgId)));
    if (!loc) return res.status(404).json({ error: "Location not found" });

    const txn = await db.transaction(async (tx) => {
      await adjustStock(tx, orgId, data.materialId, data.locationId, data.quantity);
      const [created] = await tx.insert(inventoryTransactions).values({
        organizationId: orgId,
        type: "ADJUSTMENT",
        materialId: data.materialId,
        locationId: data.locationId,
        adjustReason: data.adjustReason,
        quantity: String(data.quantity),
        notes: data.notes,
        performedById: req.user!.id,
      }).returning();
      return created;
    });

    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryTransaction", entityId: txn.id, newValue: JSON.stringify({ type: "ADJUSTMENT", qty: data.quantity, reason: data.adjustReason }) }, req);
    res.status(201).json(txn);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Insufficient stock")) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── TRANSACTION HISTORY ──────────────────────────────────────────────────────

router.get("/api/inventory/transactions", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const { materialId, locationId, type, projectId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;
    const conds = [eq(inventoryTransactions.organizationId, orgId)];
    if (materialId) conds.push(eq(inventoryTransactions.materialId, materialId));
    if (locationId) conds.push(eq(inventoryTransactions.locationId, locationId));
    if (projectId) conds.push(eq(inventoryTransactions.projectId, projectId));
    if (type && (INVENTORY_TXN_TYPES as readonly string[]).includes(type)) {
      conds.push(eq(inventoryTransactions.type, type as InventoryTxnType));
    }
    if (dateFrom) conds.push(gte(inventoryTransactions.performedAt, new Date(dateFrom)));
    if (dateTo) conds.push(lte(inventoryTransactions.performedAt, new Date(dateTo)));
    const rows = await db.select().from(inventoryTransactions)
      .where(and(...conds))
      .orderBy(desc(inventoryTransactions.performedAt))
      .limit(500);
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── CYCLE COUNTS ─────────────────────────────────────────────────────────────

router.get("/api/inventory/cycle-counts", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const rows = await db.select().from(inventoryCycleCounts)
      .where(eq(inventoryCycleCounts.organizationId, orgId))
      .orderBy(desc(inventoryCycleCounts.createdAt));
    res.json(rows);
  } catch (err) { next(err); }
});

const startCycleCountSchema = z.object({
  locationId: z.string().min(1),
  scheduledDate: z.string().optional(),
  notes: z.string().optional(),
  materialIds: z.array(z.string()).optional(), // optional whitelist
});

router.post("/api/inventory/cycle-counts", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = startCycleCountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    const [loc] = await db.select().from(inventoryLocations)
      .where(and(eq(inventoryLocations.id, data.locationId), eq(inventoryLocations.organizationId, orgId)));
    if (!loc) return res.status(404).json({ error: "Location not found" });

    // Snapshot current stock at this location
    const stockConds = [
      eq(inventoryStockLevels.organizationId, orgId),
      eq(inventoryStockLevels.locationId, data.locationId),
    ];
    const stock = await db.select().from(inventoryStockLevels).where(and(...stockConds));
    const filtered = data.materialIds && data.materialIds.length > 0
      ? stock.filter(s => data.materialIds!.includes(s.materialId))
      : stock;

    const countNumber = `CC-${Date.now().toString(36).toUpperCase()}`;
    const [cc] = await db.insert(inventoryCycleCounts).values({
      organizationId: orgId,
      locationId: data.locationId,
      countNumber,
      status: "OPEN",
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
      notes: data.notes ?? null,
      createdById: req.user!.id,
    }).returning();

    if (filtered.length > 0) {
      await db.insert(inventoryCycleCountLines).values(
        filtered.map(s => ({
          cycleCountId: cc.id,
          materialId: s.materialId,
          expectedQty: s.onHand,
        })),
      );
    }

    await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryCycleCount", entityId: cc.id, newValue: JSON.stringify({ countNumber }) }, req);
    res.status(201).json(cc);
  } catch (err) { next(err); }
});

router.get("/api/inventory/cycle-counts/:id", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const [cc] = await db.select().from(inventoryCycleCounts)
      .where(and(eq(inventoryCycleCounts.id, req.params.id), eq(inventoryCycleCounts.organizationId, orgId)));
    if (!cc) return res.status(404).json({ error: "Cycle count not found" });
    const lines = await db
      .select({
        id: inventoryCycleCountLines.id,
        materialId: inventoryCycleCountLines.materialId,
        expectedQty: inventoryCycleCountLines.expectedQty,
        countedQty: inventoryCycleCountLines.countedQty,
        varianceQty: inventoryCycleCountLines.varianceQty,
        reason: inventoryCycleCountLines.reason,
        notes: inventoryCycleCountLines.notes,
        sku: inventoryMaterials.sku,
        materialName: inventoryMaterials.name,
        uom: inventoryMaterials.uom,
      })
      .from(inventoryCycleCountLines)
      .innerJoin(inventoryMaterials, eq(inventoryCycleCountLines.materialId, inventoryMaterials.id))
      .where(eq(inventoryCycleCountLines.cycleCountId, cc.id));
    res.json({ count: cc, lines });
  } catch (err) { next(err); }
});

const recordCountLineSchema = z.object({
  countedQty: z.coerce.number().nonnegative(),
  reason: z.enum(["DAMAGE", "LOSS", "FOUND", "RETURN", "CORRECTION", "EXPIRED", "OTHER"]).optional(),
  notes: z.string().optional(),
});

router.patch("/api/inventory/cycle-counts/:id/lines/:lineId", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const [cc] = await db.select().from(inventoryCycleCounts)
      .where(and(eq(inventoryCycleCounts.id, req.params.id), eq(inventoryCycleCounts.organizationId, orgId)));
    if (!cc) return res.status(404).json({ error: "Cycle count not found" });
    if (cc.status === "APPROVED" || cc.status === "CANCELLED") {
      return res.status(400).json({ error: `Cannot edit a ${cc.status} cycle count` });
    }
    const parsed = recordCountLineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const [existingLine] = await db.select().from(inventoryCycleCountLines)
      .where(and(eq(inventoryCycleCountLines.id, req.params.lineId), eq(inventoryCycleCountLines.cycleCountId, cc.id)));
    if (!existingLine) return res.status(404).json({ error: "Line not found" });

    const variance = parsed.data.countedQty - Number(existingLine.expectedQty);
    const [updated] = await db.update(inventoryCycleCountLines).set({
      countedQty: String(parsed.data.countedQty),
      varianceQty: String(variance),
      reason: parsed.data.reason ?? null,
      notes: parsed.data.notes ?? null,
      countedById: req.user!.id,
      countedAt: new Date(),
    }).where(eq(inventoryCycleCountLines.id, req.params.lineId)).returning();

    if (cc.status === "OPEN") {
      await db.update(inventoryCycleCounts)
        .set({ status: "IN_PROGRESS", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(inventoryCycleCounts.id, cc.id));
    }
    res.json(updated);
  } catch (err) { next(err); }
});

router.post("/api/inventory/cycle-counts/:id/approve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const [cc] = await db.select().from(inventoryCycleCounts)
      .where(and(eq(inventoryCycleCounts.id, req.params.id), eq(inventoryCycleCounts.organizationId, orgId)));
    if (!cc) return res.status(404).json({ error: "Cycle count not found" });
    if (cc.status === "APPROVED") return res.status(400).json({ error: "Already approved" });

    const updated = await db.transaction(async (tx) => {
      const lines = await tx.select().from(inventoryCycleCountLines)
        .where(eq(inventoryCycleCountLines.cycleCountId, cc.id));

      // Post adjustment txns for any non-zero variance
      for (const line of lines) {
        if (line.countedQty == null) continue;
        const variance = Number(line.varianceQty ?? 0);
        if (variance === 0) continue;
        await adjustStock(tx, orgId, line.materialId, cc.locationId, variance);
        const [createdTxn] = await tx.insert(inventoryTransactions).values({
          organizationId: orgId,
          type: "CYCLE_COUNT",
          materialId: line.materialId,
          locationId: cc.locationId,
          adjustReason: (line.reason ?? "CORRECTION") as InventoryAdjustReason,
          quantity: String(variance),
          notes: `Cycle count ${cc.countNumber} variance${line.notes ? `: ${line.notes}` : ""}`,
          performedById: req.user!.id,
          cycleCountId: cc.id,
        }).returning();
        await tx.update(inventoryCycleCountLines)
          .set({ adjustmentTxnId: createdTxn.id })
          .where(eq(inventoryCycleCountLines.id, line.id));
      }

      // Stamp last-counted on stock levels
      await tx.update(inventoryStockLevels)
        .set({ lastCountedAt: new Date() })
        .where(and(
          eq(inventoryStockLevels.organizationId, orgId),
          eq(inventoryStockLevels.locationId, cc.locationId),
        ));

      const [row] = await tx.update(inventoryCycleCounts).set({
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: req.user!.id,
        completedAt: cc.completedAt ?? new Date(),
        updatedAt: new Date(),
      }).where(eq(inventoryCycleCounts.id, cc.id)).returning();
      return row;
    });

    await logAudit({ userId: req.user!.id, action: "UPDATE", entityType: "inventoryCycleCount", entityId: cc.id, newValue: JSON.stringify({ approved: true }) }, req);
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── REPORTS / ALERTS ─────────────────────────────────────────────────────────

router.get("/api/inventory/reports/low-stock", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    // Aggregate on-hand per material across all locations, compare with reorderPoint
    const rows = await db
      .select({
        materialId: inventoryMaterials.id,
        sku: inventoryMaterials.sku,
        name: inventoryMaterials.name,
        uom: inventoryMaterials.uom,
        reorderPoint: inventoryMaterials.reorderPoint,
        reorderQty: inventoryMaterials.reorderQty,
        totalOnHand: sql<string>`COALESCE(SUM(${inventoryStockLevels.onHand}::numeric), 0)`.as("total_on_hand"),
      })
      .from(inventoryMaterials)
      .leftJoin(inventoryStockLevels, eq(inventoryStockLevels.materialId, inventoryMaterials.id))
      .where(and(
        eq(inventoryMaterials.organizationId, orgId),
        eq(inventoryMaterials.isActive, true),
        sql`${inventoryMaterials.reorderPoint} IS NOT NULL`,
      ))
      .groupBy(inventoryMaterials.id);

    const lowStock = rows
      .filter(r => Number(r.totalOnHand) <= Number(r.reorderPoint ?? 0))
      .sort((a, b) => Number(a.totalOnHand) - Number(b.totalOnHand));
    res.json(lowStock);
  } catch (err) { next(err); }
});

router.get("/api/inventory/reports/slow-moving", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const days = Math.max(1, Math.min(365, Number(req.query.days ?? 90)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Materials with stock > 0 that have had no ISSUE/TRANSFER_OUT since cutoff
    const rows = await db
      .select({
        materialId: inventoryMaterials.id,
        sku: inventoryMaterials.sku,
        name: inventoryMaterials.name,
        uom: inventoryMaterials.uom,
        totalOnHand: sql<string>`COALESCE(SUM(${inventoryStockLevels.onHand}::numeric), 0)`.as("total_on_hand"),
        lastMovementAt: sql<Date | null>`(SELECT MAX(t.performed_at) FROM inventory_transactions t WHERE t.material_id = ${inventoryMaterials.id} AND t.type IN ('ISSUE','TRANSFER_OUT'))`.as("last_movement_at"),
      })
      .from(inventoryMaterials)
      .leftJoin(inventoryStockLevels, eq(inventoryStockLevels.materialId, inventoryMaterials.id))
      .where(and(
        eq(inventoryMaterials.organizationId, orgId),
        eq(inventoryMaterials.isActive, true),
      ))
      .groupBy(inventoryMaterials.id);

    const toDate = (v: Date | string | null): Date | null => {
      if (v == null) return null;
      return v instanceof Date ? v : new Date(v);
    };
    const slow = rows
      .filter(r => {
        const last = toDate(r.lastMovementAt);
        return Number(r.totalOnHand) > 0 && (!last || last < cutoff);
      })
      .sort((a, b) => {
        const at = toDate(a.lastMovementAt)?.getTime() ?? 0;
        const bt = toDate(b.lastMovementAt)?.getTime() ?? 0;
        return at - bt;
      });
    res.json({ days, items: slow });
  } catch (err) { next(err); }
});

export default router;
