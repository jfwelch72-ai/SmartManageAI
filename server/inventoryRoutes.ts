import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, lte, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  inventoryLocations, inventoryMaterials, inventoryStockLevels,
  inventoryTransactions, inventoryCycleCounts, inventoryCycleCountLines,
  insertInventoryLocationSchema, insertInventoryMaterialSchema,
  purchaseOrders, purchaseOrderItems,
  projects, organizations,
  mobileDevices, users,
  userSettings,
  DEFAULT_LABEL_SHEET_TEMPLATE,
  LABEL_SHEET_TEMPLATE_IDS,
  getLabelSheetTemplate,
} from "@shared/schema";

type InventoryTxnType = "RECEIPT" | "ISSUE" | "TRANSFER_OUT" | "TRANSFER_IN" | "ADJUSTMENT" | "CYCLE_COUNT";
const INVENTORY_TXN_TYPES = ["RECEIPT", "ISSUE", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "CYCLE_COUNT"] as const;
type InventoryAdjustReason = "DAMAGE" | "LOSS" | "FOUND" | "RETURN" | "CORRECTION" | "EXPIRED" | "OTHER";

// Drizzle transaction handle type — matches what `db.transaction((tx) => ...)` provides.
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";
import { isFeatureEnabled } from "./services/featureFlagService";
import { createApprovalRequest } from "./services/approvalService";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js/node";
import * as QRCode from "qrcode";

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

// ─── BARCODE / QR LABEL PRINTING ──────────────────────────────────────────────
// Generates a printable PDF of barcode/QR labels laid out on a 3×10 Avery 5160
// sheet (1" × 2.625" labels, Letter page). For any selected material that has
// no `barcode` value, this endpoint auto-assigns one (URL-safe, derived from
// the SKU + a short random suffix to avoid collisions) and persists it on
// `inventoryMaterials.barcode` before printing.

const labelsSchema = z.object({
  materialIds: z.array(z.string().min(1)).min(1, "Select at least one material").max(500),
  symbology: z.enum(["code128", "qr"]).default("code128"),
  copies: z.coerce.number().int().min(1).max(30).default(1),
  // Cell-offset is interpreted modulo the active template's cells-per-page,
  // so this upper bound just guards obvious garbage; per-template clamping
  // happens once the template has been resolved.
  startOffset: z.coerce.number().int().min(0).max(999).default(0),
  // Task #2570 — preferred label sheet template id. When omitted, the
  // server falls back to the user's saved preference, then to the
  // default (Avery 5160).
  template: z.enum(LABEL_SHEET_TEMPLATE_IDS).optional(),
});

function makeBarcodeValue(sku: string): string {
  const cleaned = (sku || "ITEM").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16) || "ITEM";
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${cleaned}-${suffix}`;
}

async function ensureBarcodes(orgId: string, materialIds: string[]) {
  const mats = await db.select().from(inventoryMaterials)
    .where(and(
      eq(inventoryMaterials.organizationId, orgId),
      inArray(inventoryMaterials.id, materialIds),
    ));

  const updates: Array<{ id: string; barcode: string }> = [];
  for (const m of mats) {
    if (m.barcode && m.barcode.trim().length > 0) continue;
    // Pick a unique barcode within the org (retry up to a few times)
    let candidate = makeBarcodeValue(m.sku);
    for (let i = 0; i < 5; i++) {
      const [conflict] = await db.select({ id: inventoryMaterials.id })
        .from(inventoryMaterials)
        .where(and(
          eq(inventoryMaterials.organizationId, orgId),
          eq(inventoryMaterials.barcode, candidate),
        ))
        .limit(1);
      if (!conflict) break;
      candidate = makeBarcodeValue(m.sku);
    }
    await db.update(inventoryMaterials)
      .set({ barcode: candidate, updatedAt: new Date() })
      .where(eq(inventoryMaterials.id, m.id));
    updates.push({ id: m.id, barcode: candidate });
  }

  if (updates.length === 0) return mats;
  // Re-fetch with updated barcodes (preserve original ordering by materialIds)
  const refreshed = await db.select().from(inventoryMaterials)
    .where(and(
      eq(inventoryMaterials.organizationId, orgId),
      inArray(inventoryMaterials.id, materialIds),
    ));
  return refreshed;
}

async function renderBarcodePng(value: string, symbology: "code128" | "qr"): Promise<Buffer> {
  if (symbology === "qr") {
    return await QRCode.toBuffer(value, { type: "png", margin: 1, scale: 6, errorCorrectionLevel: "M" });
  }
  return await bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: 3,
    height: 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
    paddingwidth: 4,
    paddingheight: 2,
  });
}

router.post("/api/inventory/labels", requireAuth, requireRole(...WRITE_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const parsed = labelsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { materialIds, symbology, copies, startOffset } = parsed.data;

    // Task #2570 — resolve the active label sheet template. Precedence:
    //   1) explicit `template` from the request body
    //   2) the user's saved `userSettings.labelSheetTemplate`
    //   3) DEFAULT_LABEL_SHEET_TEMPLATE (Avery 5160)
    // When the request supplies a template that differs from the saved
    // preference, we persist it so the next visit defaults correctly.
    let resolvedTemplateId = parsed.data.template ?? null;
    let savedTemplateId: string | null = null;
    try {
      const [row] = await db
        .select({ labelSheetTemplate: userSettings.labelSheetTemplate })
        .from(userSettings)
        .where(eq(userSettings.userId, req.user!.id))
        .limit(1);
      savedTemplateId = row?.labelSheetTemplate ?? null;
    } catch {
      savedTemplateId = null;
    }
    if (!resolvedTemplateId) {
      resolvedTemplateId = savedTemplateId ?? DEFAULT_LABEL_SHEET_TEMPLATE;
    }
    const template = getLabelSheetTemplate(resolvedTemplateId);

    if (parsed.data.template && parsed.data.template !== savedTemplateId) {
      try {
        const orgIdForUpsert = req.user!.organizationId;
        if (savedTemplateId !== null) {
          await db
            .update(userSettings)
            .set({ labelSheetTemplate: parsed.data.template, updatedAt: new Date() })
            .where(eq(userSettings.userId, req.user!.id));
        } else if (orgIdForUpsert) {
          await db
            .insert(userSettings)
            .values({
              userId: req.user!.id,
              organizationId: orgIdForUpsert,
              labelSheetTemplate: parsed.data.template,
            })
            .onConflictDoUpdate({
              target: userSettings.userId,
              set: { labelSheetTemplate: parsed.data.template, updatedAt: new Date() },
            });
        }
      } catch {
        // Persistence is best-effort — never fail the print because of it.
      }
    }

    const materials = await ensureBarcodes(orgId, materialIds);
    if (materials.length === 0) return res.status(404).json({ error: "No materials found" });

    // Preserve caller-supplied ordering
    const orderIndex = new Map(materialIds.map((id, i) => [id, i]));
    materials.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    // Render each material's barcode once, then place `copies` times.
    const pngs = new Map<string, Buffer>();
    for (const m of materials) {
      const value = (m.barcode ?? m.sku) as string;
      pngs.set(m.id, await renderBarcodePng(value, symbology));
    }

    // Task #2570 — Layout dimensions are pulled from the resolved template
    // (Avery 5160 / 5163 / 5167 / 5267 / 4×6 thermal). All inches × 72 to
    // get PDF points.
    const COLS = template.cols;
    const ROWS = template.rows;
    const LABEL_W = template.labelWidthIn * 72;
    const LABEL_H = template.labelHeightIn * 72;
    const HORIZ_PITCH = template.horizontalPitchIn * 72;
    const VERT_PITCH = template.verticalPitchIn * 72;
    const TOP = template.marginTopIn * 72;
    const LEFT = template.marginLeftIn * 72;
    const PAD = Math.max(2, Math.min(8, Math.round(Math.min(LABEL_W, LABEL_H) * 0.06)));
    const CELLS_PER_PAGE = COLS * ROWS;

    const pdfPageOpts: { size: "LETTER" | "A4" | [number, number]; margin: number } =
      template.pageSize === "LETTER" || template.pageSize === "A4"
        ? { size: template.pageSize, margin: 0 }
        : { size: [template.pageSize.widthIn * 72, template.pageSize.heightIn * 72], margin: 0 };

    const doc = new PDFDocument({ ...pdfPageOpts, autoFirstPage: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="inventory-labels-${Date.now()}.pdf"`);
    doc.pipe(res);

    // Clamp the requested start-offset to the active template's grid.
    let cell = Math.max(0, Math.min(CELLS_PER_PAGE - 1, startOffset));
    let firstPage = true;

    const placeLabel = (m: (typeof materials)[number]) => {
      if (cell >= CELLS_PER_PAGE) {
        doc.addPage(pdfPageOpts);
        cell = 0;
      } else if (firstPage) {
        firstPage = false;
      }
      const row = Math.floor(cell / COLS);
      const col = cell % COLS;
      const x = LEFT + col * HORIZ_PITCH;
      const y = TOP + row * VERT_PITCH;

      const png = pngs.get(m.id)!;
      const value = (m.barcode ?? m.sku) as string;

      if (symbology === "qr") {
        // Task #2570 — Pick a side-by-side or stacked QR layout based on
        // the active template's aspect ratio so portrait labels (4×6
        // thermal) and tiny return-address labels (5167/5267) both render
        // without overflow. Side-by-side is preferred when the label is
        // at least ~1.6× wider than the QR; otherwise stack the text
        // beneath the QR.
        const innerW = Math.max(0, LABEL_W - PAD * 2);
        const innerH = Math.max(0, LABEL_H - PAD * 2);
        const stacked = innerW < innerH * 1.6;
        if (stacked) {
          const qrSize = Math.max(8, Math.min(innerW, innerH * 0.65));
          const qrX = x + PAD + Math.max(0, (innerW - qrSize) / 2);
          doc.image(png, qrX, y + PAD, { width: qrSize, height: qrSize });
          const ty = y + PAD + qrSize + 4;
          const tw = innerW;
          doc.fontSize(10).fillColor("#000")
            .text(m.name ?? "", x + PAD, ty, { width: tw, ellipsis: true, lineBreak: false });
          doc.fontSize(8).fillColor("#444")
            .text(`SKU ${m.sku}${m.uom ? `   UOM ${m.uom}` : ""}`, x + PAD, ty + 12, { width: tw, ellipsis: true, lineBreak: false });
          doc.fontSize(8).fillColor("#444").font("Courier")
            .text(value, x + PAD, ty + 22, { width: tw, ellipsis: true, lineBreak: false });
          doc.font("Helvetica");
        } else {
          // Side-by-side: QR sized to the smaller dimension so it never
          // exceeds the label width.
          const qrSize = Math.max(8, Math.min(innerH, innerW * 0.45));
          doc.image(png, x + PAD, y + PAD, { width: qrSize, height: qrSize });
          const tx = x + PAD * 2 + qrSize;
          const tw = Math.max(0, LABEL_W - (tx - x) - PAD);
          if (tw > 8) {
            doc.fontSize(9).fillColor("#000")
              .text(m.name ?? "", tx, y + PAD, { width: tw, ellipsis: true, lineBreak: false });
            doc.fontSize(7).fillColor("#444")
              .text(`SKU ${m.sku}`, tx, y + PAD + 12, { width: tw, ellipsis: true, lineBreak: false });
            doc.fontSize(7).fillColor("#444")
              .text(value, tx, y + PAD + 22, { width: tw, ellipsis: true, lineBreak: false });
            if (m.uom) {
              doc.fontSize(7).fillColor("#444")
                .text(`UOM ${m.uom}`, tx, y + PAD + 32, { width: tw, ellipsis: true, lineBreak: false });
            }
          }
        }
      } else {
        // Code-128 across the top, text below. Scale the barcode height
        // to the active template's label height so small (5167/5267) and
        // large (thermal 4×6) sheets both render legibly.
        const bcW = LABEL_W - PAD * 2;
        const bcH = Math.max(16, Math.min(LABEL_H * 0.55, LABEL_H - PAD * 2 - 24));
        doc.image(png, x + PAD, y + PAD, { width: bcW, height: bcH });
        const ty = y + PAD + bcH + 2;
        const tw = LABEL_W - PAD * 2;
        doc.fontSize(8).fillColor("#000")
          .text(m.name ?? "", x + PAD, ty, { width: tw, ellipsis: true, lineBreak: false });
        doc.fontSize(7).fillColor("#444")
          .text(`SKU ${m.sku}${m.uom ? `   UOM ${m.uom}` : ""}`, x + PAD, ty + 10, { width: tw, ellipsis: true, lineBreak: false });
        doc.fontSize(7).fillColor("#444").font("Courier")
          .text(value, x + PAD, ty + 20, { width: tw, ellipsis: true, lineBreak: false });
        doc.font("Helvetica");
      }
      cell++;
    };

    for (const m of materials) {
      for (let c = 0; c < copies; c++) placeLabel(m);
    }

    doc.end();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "inventoryMaterialLabels",
      entityId: materials.map(m => m.id).join(",").slice(0, 200),
      newValue: JSON.stringify({ symbology, copies, count: materials.length, template: template.id, op: "label_print" }),
    }, req);
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

    // Task #2833: gate large adjustments behind an approval workflow when
    // INVENTORY_ADJUSTMENT_APPROVAL feature flag is on.
    // Threshold is DOLLAR-BASED: |qty| × unit_cost >= per-org VALUE_THRESHOLD
    // (stored in organizations.inventoryAdjustmentApprovalThreshold, default $500).
    const requiresApproval = await isFeatureEnabled(orgId, "INVENTORY_ADJUSTMENT_APPROVAL");
    let needsApproval = false;
    if (requiresApproval) {
      const [orgRow] = await db.select({ thresh: organizations.inventoryAdjustmentApprovalThreshold })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      const VALUE_THRESHOLD = orgRow?.thresh ? Number(orgRow.thresh) : 500;
      // Look up current average cost from stock levels; fall back to the material's listed unit cost.
      const [stockRow] = await db.select({ averageCost: inventoryStockLevels.averageCost })
        .from(inventoryStockLevels)
        .where(and(
          eq(inventoryStockLevels.organizationId, orgId),
          eq(inventoryStockLevels.materialId, data.materialId),
          eq(inventoryStockLevels.locationId, data.locationId),
        ))
        .limit(1);
      const unitCostNum = stockRow?.averageCost
        ? Number(stockRow.averageCost)
        : mat.unitCost ? Number(mat.unitCost) : 0;
      const adjustmentValue = Math.abs(data.quantity) * unitCostNum;
      needsApproval = adjustmentValue >= VALUE_THRESHOLD;
    }

    if (needsApproval) {
      // Persist a PENDING transaction first so the approval request entityId
      // points to a unique, auditable record (not the materialId which is
      // ambiguous across multiple in-flight adjustments).
      const [pendingTxn] = await db.insert(inventoryTransactions).values({
        organizationId: orgId,
        type: "ADJUSTMENT",
        materialId: data.materialId,
        locationId: data.locationId,
        adjustReason: data.adjustReason,
        quantity: String(data.quantity),
        notes: data.notes,
        performedById: req.user!.id,
        approvalStatus: "PENDING_APPROVAL",
      }).returning();

      const approvalNotes = `qty=${data.quantity} reason=${data.adjustReason} notes=${data.notes}`;
      // INVENTORY_ADJUSTMENT approvals are restricted to ADMIN/MANAGER only
      // (not SUPERINTENDENT) per task #2833 requirement.
      const approvalRequest = await createApprovalRequest(orgId, "INVENTORY_ADJUSTMENT", pendingTxn.id, req.user!.id, approvalNotes, ["ADMIN", "MANAGER"]);

      // Back-fill the approvalRequestId on the pending transaction.
      await db.update(inventoryTransactions)
        .set({ approvalRequestId: approvalRequest.id })
        .where(eq(inventoryTransactions.id, pendingTxn.id));

      await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "inventoryTransaction", entityId: pendingTxn.id, newValue: JSON.stringify({ type: "ADJUSTMENT_PENDING_APPROVAL", qty: data.quantity, reason: data.adjustReason }) }, req);
      return res.status(202).json({ status: "pending_approval", transactionId: pendingTxn.id, approvalRequestId: approvalRequest.id, message: "Adjustment queued for approval" });
    }

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

// ─── FIELD ACTIVITY (mobile-originated) ───────────────────────────────────────
// Surfaces inventory transactions whose performer has a registered mobile
// device for this org, plus a stale-device list (registered but not synced
// in >24 hours). Powers the "From the field" panel on /inventory.
router.get("/api/inventory/field-activity", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrg(req, res); if (!orgId) return;
    const STALE_MS = 24 * 60 * 60 * 1000;
    const staleCutoff = new Date(Date.now() - STALE_MS);

    const txns = await db
      .select({
        id: inventoryTransactions.id,
        type: inventoryTransactions.type,
        quantity: inventoryTransactions.quantity,
        performedAt: inventoryTransactions.performedAt,
        referenceNumber: inventoryTransactions.referenceNumber,
        notes: inventoryTransactions.notes,
        materialId: inventoryTransactions.materialId,
        materialSku: inventoryMaterials.sku,
        materialName: inventoryMaterials.name,
        uom: inventoryMaterials.uom,
        locationId: inventoryTransactions.locationId,
        locationCode: inventoryLocations.code,
        locationName: inventoryLocations.name,
        projectId: inventoryTransactions.projectId,
        performedById: inventoryTransactions.performedById,
        performerFirstName: users.firstName,
        performerLastName: users.lastName,
      })
      .from(inventoryTransactions)
      .innerJoin(inventoryMaterials, eq(inventoryMaterials.id, inventoryTransactions.materialId))
      .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryTransactions.locationId))
      .innerJoin(users, eq(users.id, inventoryTransactions.performedById))
      .where(and(
        eq(inventoryTransactions.organizationId, orgId),
        sql`EXISTS (SELECT 1 FROM ${mobileDevices} md WHERE md.user_id = ${inventoryTransactions.performedById} AND md.organization_id = ${orgId})`,
      ))
      .orderBy(desc(inventoryTransactions.performedAt))
      .limit(50);

    // Latest device per performer for the rendered transactions
    const performerIds = Array.from(new Set(txns.map(t => t.performedById)));
    const deviceByUser = new Map<string, { deviceId: string; platform: string; deviceModel: string | null; lastSyncAt: Date | null }>();
    if (performerIds.length > 0) {
      const devices = await db
        .select({
          userId: mobileDevices.userId,
          deviceId: mobileDevices.deviceId,
          platform: mobileDevices.platform,
          deviceModel: mobileDevices.deviceModel,
          lastSyncAt: mobileDevices.lastSyncAt,
        })
        .from(mobileDevices)
        .where(and(
          eq(mobileDevices.organizationId, orgId),
          sql`${mobileDevices.userId} = ANY(${performerIds})`,
        ))
        .orderBy(desc(mobileDevices.lastSyncAt));
      for (const d of devices) {
        if (!deviceByUser.has(d.userId)) {
          deviceByUser.set(d.userId, {
            deviceId: d.deviceId,
            platform: d.platform,
            deviceModel: d.deviceModel,
            lastSyncAt: d.lastSyncAt,
          });
        }
      }
    }

    const transactions = txns.map(t => ({
      ...t,
      performerName: `${t.performerFirstName ?? ""} ${t.performerLastName ?? ""}`.trim() || "Unknown",
      device: deviceByUser.get(t.performedById) ?? null,
    }));

    // Stale devices: active, not synced in >24h (or never synced)
    const staleDevices = await db
      .select({
        id: mobileDevices.id,
        deviceId: mobileDevices.deviceId,
        platform: mobileDevices.platform,
        deviceModel: mobileDevices.deviceModel,
        lastSyncAt: mobileDevices.lastSyncAt,
        userId: mobileDevices.userId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(mobileDevices)
      .innerJoin(users, eq(users.id, mobileDevices.userId))
      .where(and(
        eq(mobileDevices.organizationId, orgId),
        eq(mobileDevices.isActive, true),
        or(sql`${mobileDevices.lastSyncAt} IS NULL`, lt(mobileDevices.lastSyncAt, staleCutoff)),
      ))
      .orderBy(asc(mobileDevices.lastSyncAt));

    res.json({
      transactions,
      staleDevices: staleDevices.map(d => ({
        ...d,
        userName: `${d.userFirstName ?? ""} ${d.userLastName ?? ""}`.trim() || "Unknown",
      })),
      staleThresholdHours: 24,
    });
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
