/**
 * @openapi
 * /api/procurement-module/requests:
 *   get:
 *     tags: [Procurement]
 *     summary: List purchase requests
 *     description: Returns purchase requests for the authenticated user's organization.
 *     parameters:
 *       - name: projectId
 *         in: query
 *         schema: { type: string, format: uuid }
 *       - name: status
 *         in: query
 *         schema: { type: string, enum: [DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, CONVERTED_TO_PO] }
 *     responses:
 *       200: { description: List of purchase requests }
 *   post:
 *     tags: [Procurement]
 *     summary: Create a purchase request
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId, title]
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               title: { type: string }
 *               neededByDate: { type: string, format: date }
 *               notes: { type: string }
 *               items: { type: array, items: { type: object } }
 *     responses:
 *       201: { description: Purchase request created }
 * /api/procurement-module/requests/{id}:
 *   patch:
 *     tags: [Procurement]
 *     summary: Update a purchase request
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Purchase request updated }
 *   delete:
 *     tags: [Procurement]
 *     summary: Delete a purchase request
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase request deleted }
 * /api/procurement-module/requests/{id}/submit:
 *   post:
 *     tags: [Procurement]
 *     summary: Submit purchase request for approval
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submitted for approval }
 * /api/procurement-module/requests/{id}/approve:
 *   post:
 *     tags: [Procurement]
 *     summary: Approve a purchase request
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase request approved }
 * /api/procurement-module/requests/{id}/reject:
 *   post:
 *     tags: [Procurement]
 *     summary: Reject a purchase request
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase request rejected }
 * /api/procurement-module/requests/{id}/convert-to-po:
 *   post:
 *     tags: [Procurement]
 *     summary: Convert purchase request to purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Purchase order created from request }
 * /api/procurement-module/orders:
 *   get:
 *     tags: [Procurement]
 *     summary: List purchase orders
 *     parameters:
 *       - name: projectId
 *         in: query
 *         schema: { type: string, format: uuid }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of purchase orders }
 *   post:
 *     tags: [Procurement]
 *     summary: Create a purchase order
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId]
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               vendorId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Purchase order created }
 * /api/procurement-module/orders/{id}:
 *   get:
 *     tags: [Procurement]
 *     summary: Get purchase order details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase order with items }
 *   patch:
 *     tags: [Procurement]
 *     summary: Update a purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Purchase order updated }
 *   delete:
 *     tags: [Procurement]
 *     summary: Delete a purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase order deleted }
 * /api/procurement-module/orders/{id}/submit:
 *   post:
 *     tags: [Procurement]
 *     summary: Submit purchase order for approval
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submitted for approval }
 * /api/procurement-module/orders/{id}/approve:
 *   post:
 *     tags: [Procurement]
 *     summary: Approve a purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase order approved }
 * /api/procurement-module/orders/{id}/reject:
 *   post:
 *     tags: [Procurement]
 *     summary: Reject a purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase order rejected }
 * /api/procurement-module/orders/{id}/send:
 *   post:
 *     tags: [Procurement]
 *     summary: Send purchase order to vendor
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Purchase order sent }
 * /api/procurement-module/orders/bulk-approve:
 *   post:
 *     tags: [Procurement]
 *     summary: Bulk approve purchase orders
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Orders approved }
 * /api/procurement-module/summary:
 *   get:
 *     tags: [Procurement]
 *     summary: Get procurement summary dashboard
 *     responses:
 *       200: { description: Procurement summary with stats }
 * /api/procurement-module/delivery-schedule:
 *   get:
 *     tags: [Procurement]
 *     summary: Get delivery schedule
 *     responses:
 *       200: { description: Delivery schedule }
 * /api/procurement-module/orders/{id}/receipts:
 *   get:
 *     tags: [Procurement]
 *     summary: Get receipts for a purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Receipts }
 *   post:
 *     tags: [Procurement]
 *     summary: Record receipt against a purchase order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Receipt recorded }
 * /api/procurement-module/receipts:
 *   get:
 *     tags: [Procurement]
 *     summary: List all receipts
 *     responses:
 *       200: { description: All receipts }
 * /api/procurement-module/invoices:
 *   get:
 *     tags: [Procurement]
 *     summary: List vendor invoices
 *     responses:
 *       200: { description: Vendor invoices }
 *   post:
 *     tags: [Procurement]
 *     summary: Create vendor invoice
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Invoice created }
 * /api/procurement-module/invoices/{id}:
 *   patch:
 *     tags: [Procurement]
 *     summary: Update vendor invoice
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Invoice updated }
 * /api/procurement-module/invoices/{id}/file-url:
 *   get:
 *     tags: [Procurement]
 *     summary: Get invoice file URL
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: File download URL }
 * /api/procurement-module/invoices/{id}/match:
 *   get:
 *     tags: [Procurement]
 *     summary: Get invoice three-way match
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Match results }
 *   post:
 *     tags: [Procurement]
 *     summary: Perform invoice three-way match
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Match performed }
 * /api/procurement-module/invoices/{id}/match/resolve:
 *   post:
 *     tags: [Procurement]
 *     summary: Resolve invoice match discrepancy
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Discrepancy resolved }
 * /api/procurement-module/invoices/{id}/payments:
 *   get:
 *     tags: [Procurement]
 *     summary: Get invoice payments
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Payment history }
 *   post:
 *     tags: [Procurement]
 *     summary: Record invoice payment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Payment recorded }
 */
import {logError, logWarn } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrders, purchaseOrderItems,
  poReceipts, poReceiptItems,
  vendorInvoices, vendorInvoiceItems, invoiceMatches,
  invoicePayments, organizations,
  projects, users,
} from "@shared/schema";
import { crmOrganisations } from "@shared/schema";
import { eq, and, desc, asc, sql, ilike, or, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { validateBody } from "./utils/validation";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import { eventBus } from "./events";
import { getOrgId } from "./utils/routeHelpers";
import type { Response } from "express";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"] as const;
const APPROVE_ROLES = ["ADMIN", "MANAGER"] as const;

const prUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  neededByDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    category: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    estimatedUnitCost: z.string().nullable().optional(),
    costCode: z.string().nullable().optional(),
  })).optional(),
});

const poUpdateSchema = z.object({
  vendorId: z.string().uuid().nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  deliveryAddress: z.string().max(500).nullable().optional(),
  neededByDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    unitCost: z.string().nullable().optional(),
    costCode: z.string().nullable().optional(),
    expectedDeliveryDate: z.string().nullable().optional(),
  })).optional(),
});

const invoiceUpdateSchema = z.object({
  invoiceNumber: z.string().min(1).max(100).optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  totalAmount: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  fileUrl: z.string().nullable().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.string().nullable().optional(),
    unitCost: z.string().nullable().optional(),
    poItemId: z.string().uuid().nullable().optional(),
  })).optional(),
});

async function verifyProjectAssignment(req: AuthRequest, res: Response, projectId: string): Promise<boolean> {
  if (req.user!.role === "ADMIN" || req.user!.role === "MANAGER") return true;

  const [project] = await db.select({
    superintendentId: projects.superintendentId,
    estimatorId: projects.estimatorId,
    projectManagerId: projects.projectManagerId,
  }).from(projects).where(eq(projects.id, projectId)).limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }

  if (
    project.superintendentId === req.user!.id ||
    project.estimatorId === req.user!.id ||
    project.projectManagerId === req.user!.id
  ) {
    return true;
  }

  res.status(403).json({ error: "You are not assigned to this project" });
  return false;
}

async function ensureProcurementSequences() {
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS pr_number_seq`);
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS po_number_seq`);
  const [{ prMax }] = await db.select({
    prMax: sql<number>`COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(pr_number, '[^0-9]', '', 'g'), '') AS INTEGER)), 0)`,
  }).from(purchaseRequests);
  const [{ prCur }] = await db.select({
    prCur: sql<number>`last_value`,
  }).from(sql`pr_number_seq`);
  if (prMax > prCur) {
    await db.execute(sql`SELECT setval('pr_number_seq', ${prMax}, true)`);
  }
  const [{ poMax }] = await db.select({
    poMax: sql<number>`COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(po_number, '[^0-9]', '', 'g'), '') AS INTEGER)), 0)`,
  }).from(purchaseOrders);
  const [{ poCur }] = await db.select({
    poCur: sql<number>`last_value`,
  }).from(sql`po_number_seq`);
  if (poMax > poCur) {
    await db.execute(sql`SELECT setval('po_number_seq', ${poMax}, true)`);
  }
}
const sequencesReady = ensureProcurementSequences().catch(err => logError("Failed to init procurement sequences:", {}, err instanceof Error ? err : new Error(String(err))));

const PR_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CONVERTED_TO_PO"] as const;
const PO_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL", "FULFILLED", "CANCELLED"] as const;
const RECEIPT_STATUSES = ["PARTIAL", "COMPLETE"] as const;
const INVOICE_STATUSES = ["PENDING", "MATCHED", "APPROVED", "PAID", "DISPUTED"] as const;

// ─── PURCHASE REQUESTS ─────────────────────────────────────────────────────

const prCreateSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  neededByDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    category: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    estimatedUnitCost: z.string().nullable().optional(),
    costCode: z.string().nullable().optional(),
  })).optional(),
});

router.get("/api/procurement-module/requests", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const conditions: SQL[] = [eq(purchaseRequests.orgId, orgId)];
    if (req.query.mine === "true" || req.query.mine === "1") {
      const uid = req.user?.id;
      if (!uid) { res.status(401).json({ error: "Not authenticated" }); return; }
      conditions.push(eq(purchaseRequests.requestedById, uid));
    }
    if (req.query.projectId) conditions.push(eq(purchaseRequests.projectId, String(req.query.projectId)));
    if (req.query.status) {
      const s = String(req.query.status);
      if (!(PR_STATUSES as readonly string[]).includes(s)) { res.status(400).json({ error: `Invalid status. Allowed: ${PR_STATUSES.join(", ")}` }); return; }
      conditions.push(sql`${purchaseRequests.status} = ${s}`);
    }
    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      const searchOr = or(
        ilike(purchaseRequests.title, term),
        ilike(purchaseRequests.prNumber, term),
        sql`EXISTS (SELECT 1 FROM projects p WHERE p.id = ${purchaseRequests.projectId} AND p.name ILIKE ${term})`,
      );
      if (searchOr) conditions.push(searchOr);
    }

    const requesterAlias = db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).as("requester");
    const projectAlias = db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).as("proj");

    const prs = await db.select({
      pr: purchaseRequests,
      projectName: projectAlias.name,
      projectCode: projectAlias.code,
      requesterFirst: requesterAlias.firstName,
      requesterLast: requesterAlias.lastName,
    })
      .from(purchaseRequests)
      .leftJoin(projectAlias, eq(purchaseRequests.projectId, projectAlias.id))
      .leftJoin(requesterAlias, eq(purchaseRequests.requestedById, requesterAlias.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseRequests.createdAt));

    const prIds = prs.map(r => r.pr.id);
    let itemsByPr: Record<string, any[]> = {};
    if (prIds.length > 0) {
      const allItems = await db.select().from(purchaseRequestItems)
        .where(sql`${purchaseRequestItems.prId} IN (${sql.join(prIds.map(id => sql`${id}`), sql`, `)})`);
      for (const item of allItems) {
        if (!itemsByPr[item.prId]) itemsByPr[item.prId] = [];
        itemsByPr[item.prId].push(item);
      }
    }

    const result = prs.map(r => ({
      ...r.pr,
      project: r.projectName ? { name: r.projectName, code: r.projectCode } : null,
      requestedBy: r.requesterFirst ? { firstName: r.requesterFirst, lastName: r.requesterLast } : null,
      items: itemsByPr[r.pr.id] || [],
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/requests", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    await sequencesReady;
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const parsed = prCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const { items, ...prData } = parsed.data;

    const [projOwner] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, prData.projectId), eq(projects.gcOrganizationId, orgId))).limit(1);
    if (!projOwner) { res.status(400).json({ error: "Project not found in your organization" }); return; }

    if (!(await verifyProjectAssignment(req, res, prData.projectId))) return;

    const pr = await db.transaction(async (tx) => {
      const [{ nextNum }] = await tx.select({
        nextNum: sql<number>`nextval('pr_number_seq')`,
      }).from(sql`(SELECT 1) AS _`);
      const prNumber = `PR-${String(nextNum).padStart(4, "0")}`;

      const [newPr] = await tx.insert(purchaseRequests).values({
        orgId,
        projectId: prData.projectId,
        requestedById: req.user!.id,
        prNumber,
        title: prData.title,
        neededByDate: prData.neededByDate ? new Date(prData.neededByDate) : null,
        notes: prData.notes || null,
      }).returning();

      if (items && items.length > 0) {
        let totalCost = 0;
        for (const item of items) {
          await tx.insert(purchaseRequestItems).values({
            prId: newPr.id,
            description: item.description,
            category: item.category || null,
            quantity: item.quantity || null,
            unit: item.unit || null,
            estimatedUnitCost: item.estimatedUnitCost || null,
            costCode: item.costCode || null,
          });
          const q = parseFloat(item.quantity || "0");
          const u = parseFloat(item.estimatedUnitCost || "0");
          if (!isNaN(q) && !isNaN(u)) totalCost += q * u;
        }
        if (totalCost > 0) {
          await tx.update(purchaseRequests).set({ totalEstimatedCost: String(totalCost) }).where(eq(purchaseRequests.id, newPr.id));
        }
      }
      return newPr;
    });

    res.status(201).json(pr);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/procurement-module/requests/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Purchase request not found" }); return; }

    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT requests can be edited" }); return; }

    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;

    const parsed = prUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" }); return; }

    const { items } = parsed.data;
    const setData: Record<string, unknown> = {};
    setData.updatedAt = new Date();
    if (parsed.data.title !== undefined) setData.title = parsed.data.title;
    if (parsed.data.neededByDate !== undefined) setData.neededByDate = parsed.data.neededByDate ? new Date(parsed.data.neededByDate) : null;
    if (parsed.data.notes !== undefined) setData.notes = parsed.data.notes;

    const updated = await db.transaction(async (tx) => {
      const [updatedPr] = await tx.update(purchaseRequests).set(setData)
        .where(eq(purchaseRequests.id, req.params.id)).returning();

      if (items && Array.isArray(items)) {
        await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.prId, req.params.id));
        let totalCost = 0;
        for (const item of items) {
          await tx.insert(purchaseRequestItems).values({
            prId: req.params.id,
            description: item.description,
            category: item.category || null,
            quantity: item.quantity || null,
            unit: item.unit || null,
            estimatedUnitCost: item.estimatedUnitCost || null,
            costCode: item.costCode || null,
          });
          const q = parseFloat(item.quantity || "0");
          const u = parseFloat(item.estimatedUnitCost || "0");
          if (!isNaN(q) && !isNaN(u)) totalCost += q * u;
        }
        await tx.update(purchaseRequests).set({ totalEstimatedCost: String(totalCost) })
          .where(eq(purchaseRequests.id, req.params.id));
      }

      return updatedPr;
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/procurement-module/requests/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT requests can be deleted" }); return; }

    await db.delete(purchaseRequests).where(eq(purchaseRequests.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/requests/:id/submit", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT requests can be submitted" }); return; }

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "PENDING_APPROVAL", updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    await notifyApprovers(orgId, req.user!.id, {
      type: "PROCUREMENT_PR_SUBMITTED",
      title: "Purchase Request Submitted",
      message: `Purchase request ${existing.prNumber} "${existing.title}" requires your approval.`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_REQUEST",
    }, ROLES).catch((err: unknown) => logError("Procurement PR submit notification failed", { error: String(err) }));

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/requests/:id/approve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending requests can be approved" }); return; }

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    await notifySubmitter(existing.requestedById, {
      type: "PROCUREMENT_PR_APPROVED",
      title: "Purchase Request Approved",
      message: `Your purchase request ${existing.prNumber} "${existing.title}" has been approved.`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_REQUEST",
    }, orgId).catch((err: unknown) => logError("Procurement PR approve notification failed", { error: String(err) }));

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/requests/:id/reject", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending requests can be rejected" }); return; }

    const rejectSchema = z.object({
      rejectionNotes: z.string().min(1, "Rejection notes are required").max(2000).optional(),
      notes: z.string().min(1).max(2000).optional(),
    }).refine(d => (d.rejectionNotes || d.notes || "").trim().length > 0, {
      message: "Rejection notes are required",
    });
    const parsed = validateBody(rejectSchema, req.body || {}, res);
    if (!parsed) return;
    const rejectionNotes = (parsed.rejectionNotes || parsed.notes || "").trim();

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "REJECTED", rejectionNotes, updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    await notifySubmitter(existing.requestedById, {
      type: "PROCUREMENT_PR_REJECTED",
      title: "Purchase Request Rejected",
      message: `Your purchase request ${existing.prNumber} "${existing.title}" has been rejected.${rejectionNotes ? ` Reason: ${rejectionNotes}` : ""}`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_REQUEST",
    }, orgId).catch((err: unknown) => logError("Procurement PR reject notification failed", { error: String(err) }));

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/requests/:id/convert-to-po", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    await sequencesReady;
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [pr] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!pr) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, pr.projectId))) return;
    if (pr.status !== "APPROVED") { res.status(400).json({ error: "Only approved requests can be converted" }); return; }

    const prItems = await db.select().from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.prId, pr.id));

    const convertSchema = z.object({
      vendorId: z.string().uuid().nullable().optional(),
    });
    const parsed = validateBody(convertSchema, req.body || {}, res);
    if (!parsed) return;
    const vendorId = parsed.vendorId || null;

    if (vendorId) {
      const [vendorOwner] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, vendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
      if (!vendorOwner) { res.status(400).json({ error: "Vendor not found in your organization" }); return; }
    }

    const po = await db.transaction(async (tx) => {
      const [{ nextNum: poSeqNum }] = await tx.select({
        nextNum: sql<number>`nextval('po_number_seq')`,
      }).from(sql`(SELECT 1) AS _`);
      const poNumber = `PO-${String(poSeqNum).padStart(4, "0")}`;

      const [newPo] = await tx.insert(purchaseOrders).values({
        orgId,
        projectId: pr.projectId,
        prId: pr.id,
        vendorId,
        poNumber,
        neededByDate: pr.neededByDate,
        notes: pr.notes,
        totalCost: pr.totalEstimatedCost,
      }).returning();

      for (const item of prItems) {
        await tx.insert(purchaseOrderItems).values({
          poId: newPo.id,
          prItemId: item.id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.estimatedUnitCost,
          costCode: item.costCode || null,
        });
      }

      await tx.update(purchaseRequests)
        .set({ status: "CONVERTED_TO_PO", updatedAt: new Date() })
        .where(eq(purchaseRequests.id, pr.id));

      return newPo;
    });

    try {
      await eventBus.emit({
        version: 1,
        orgId,
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "purchase_order.issued" as const,
        payload: {
          poId: po.id,
          poNumber: po.poNumber,
          projectId: po.projectId || "",
          vendorId: po.vendorId || null,
          totalCost: po.totalCost?.toString() || null,
        },
      });
    } catch (emitErr) {
      logError("Failed to emit purchase_order.issued event", {}, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
    }

    res.status(201).json(po);
  } catch (error) {
    next(error);
  }
});

// ─── PURCHASE ORDERS ────────────────────────────────────────────────────────

router.get("/api/procurement-module/orders", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const conditions: SQL[] = [eq(purchaseOrders.orgId, orgId)];
    if (req.query.projectId) conditions.push(eq(purchaseOrders.projectId, String(req.query.projectId)));
    if (req.query.status) {
      const s = String(req.query.status);
      if (!(PO_STATUSES as readonly string[]).includes(s)) { res.status(400).json({ error: `Invalid status. Allowed: ${PO_STATUSES.join(", ")}` }); return; }
      conditions.push(sql`${purchaseOrders.status} = ${s}`);
    }
    const projectAlias = db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).as("proj");
    const vendorAlias = db.select({ id: crmOrganisations.id, name: crmOrganisations.name }).from(crmOrganisations).as("vendor");

    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      const searchOr = or(
        ilike(purchaseOrders.poNumber, term),
        ilike(purchaseOrders.notes, term),
        sql`EXISTS (SELECT 1 FROM projects p WHERE p.id = ${purchaseOrders.projectId} AND p.name ILIKE ${term})`,
        sql`EXISTS (SELECT 1 FROM crm_organisations v WHERE v.id = ${purchaseOrders.vendorId} AND v.name ILIKE ${term})`,
      );
      if (searchOr) conditions.push(searchOr);
    }

    const pos = await db.select({
      po: purchaseOrders,
      projectName: projectAlias.name,
      projectCode: projectAlias.code,
      vendorName: vendorAlias.name,
      vendorId: vendorAlias.id,
    })
      .from(purchaseOrders)
      .leftJoin(projectAlias, eq(purchaseOrders.projectId, projectAlias.id))
      .leftJoin(vendorAlias, eq(purchaseOrders.vendorId, vendorAlias.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseOrders.createdAt));

    const poIds = pos.map(r => r.po.id);
    let itemsByPo: Record<string, any[]> = {};
    if (poIds.length > 0) {
      const allItems = await db.select().from(purchaseOrderItems)
        .where(sql`${purchaseOrderItems.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`);
      for (const item of allItems) {
        if (!itemsByPo[item.poId]) itemsByPo[item.poId] = [];
        itemsByPo[item.poId].push(item);
      }
    }

    res.json(pos.map(r => ({
      ...r.po,
      project: r.projectName ? { name: r.projectName, code: r.projectCode } : null,
      vendor: r.vendorName ? { id: r.vendorId, name: r.vendorName } : null,
      items: itemsByPo[r.po.id] || [],
    })));
  } catch (error) {
    next(error);
  }
});

router.get("/api/procurement-module/orders/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!po) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, po.id));
    const [proj] = await db.select({ name: projects.name, code: projects.code })
      .from(projects).where(eq(projects.id, po.projectId)).limit(1);
    let vendor = null;
    if (po.vendorId) {
      const [v] = await db.select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations).where(eq(crmOrganisations.id, po.vendorId)).limit(1);
      vendor = v || null;
    }

    const receipts = await db.select().from(poReceipts).where(eq(poReceipts.poId, po.id))
      .orderBy(desc(poReceipts.receivedAt));

    const receiptIds = receipts.map(r => r.id);
    let receiptItemsByReceipt: Record<string, any[]> = {};
    if (receiptIds.length > 0) {
      const allReceiptItems = await db.select().from(poReceiptItems)
        .where(sql`${poReceiptItems.receiptId} IN (${sql.join(receiptIds.map(id => sql`${id}`), sql`, `)})`);
      for (const ri of allReceiptItems) {
        if (!receiptItemsByReceipt[ri.receiptId]) receiptItemsByReceipt[ri.receiptId] = [];
        receiptItemsByReceipt[ri.receiptId].push(ri);
      }
    }

    const receiverIds = [...new Set(receipts.map(r => r.receivedById))];
    let receiversMap: Record<string, { firstName: string | null; lastName: string | null }> = {};
    if (receiverIds.length > 0) {
      const receivers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(receiverIds.map(id => sql`${id}`), sql`, `)})`);
      for (const r of receivers) receiversMap[r.id] = { firstName: r.firstName, lastName: r.lastName };
    }

    const receiptsWithItems = receipts.map(r => ({
      ...r,
      items: receiptItemsByReceipt[r.id] || [],
      receivedBy: receiversMap[r.receivedById] || null,
    }));

    const invoices = await db.select().from(vendorInvoices).where(eq(vendorInvoices.poId, po.id))
      .orderBy(desc(vendorInvoices.createdAt));

    const invIds = invoices.map(inv => inv.id);
    let matchByInvoice: Record<string, any> = {};
    let paymentsByInvoice: Record<string, any[]> = {};
    if (invIds.length > 0) {
      const allMatches = await db.select().from(invoiceMatches)
        .where(sql`${invoiceMatches.invoiceId} IN (${sql.join(invIds.map(id => sql`${id}`), sql`, `)})`);
      for (const m of allMatches) matchByInvoice[m.invoiceId] = m;

      const allPayments = await db.select().from(invoicePayments)
        .where(sql`${invoicePayments.invoiceId} IN (${sql.join(invIds.map(id => sql`${id}`), sql`, `)})`);
      for (const p of allPayments) {
        if (!paymentsByInvoice[p.invoiceId]) paymentsByInvoice[p.invoiceId] = [];
        paymentsByInvoice[p.invoiceId].push(p);
      }
    }

    const invoicesWithMatch = invoices.map(inv => {
      const payments = paymentsByInvoice[inv.id] || [];
      const totalPaid = payments.reduce((sum: number, p: any) => sum + parseFloat(p.amount?.toString() || "0"), 0);
      return { ...inv, match: matchByInvoice[inv.id] || null, totalPaid: String(totalPaid), payments };
    });

    res.json({ ...po, items, project: proj || null, vendor, receipts: receiptsWithItems, invoices: invoicesWithMatch });
  } catch (error) {
    next(error);
  }
});

const poCreateSchema = z.object({
  projectId: z.string(),
  vendorId: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  deliveryAddress: z.string().nullable().optional(),
  neededByDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    unitCost: z.string().nullable().optional(),
    costCode: z.string().nullable().optional(),
    expectedDeliveryDate: z.string().nullable().optional(),
  })).optional(),
});

router.post("/api/procurement-module/orders", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    await sequencesReady;
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const parsed = poCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const { items, ...poData } = parsed.data;

    const [projOwner] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, poData.projectId), eq(projects.gcOrganizationId, orgId))).limit(1);
    if (!projOwner) { res.status(400).json({ error: "Project not found in your organization" }); return; }

    if (!(await verifyProjectAssignment(req, res, poData.projectId))) return;

    if (poData.vendorId) {
      const [vendorOwner] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, poData.vendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
      if (!vendorOwner) { res.status(400).json({ error: "Vendor not found in your organization" }); return; }
    }

    let totalCost = 0;
    if (items) {
      for (const item of items) {
        const q = parseFloat(item.quantity || "0");
        const u = parseFloat(item.unitCost || "0");
        if (!isNaN(q) && !isNaN(u)) totalCost += q * u;
      }
    }

    const po = await db.transaction(async (tx) => {
      const [{ nextNum: poSeqNum2 }] = await tx.select({
        nextNum: sql<number>`nextval('po_number_seq')`,
      }).from(sql`(SELECT 1) AS _`);
      const poNumber = `PO-${String(poSeqNum2).padStart(4, "0")}`;

      const [newPo] = await tx.insert(purchaseOrders).values({
        orgId,
        projectId: poData.projectId,
        vendorId: poData.vendorId || null,
        poNumber,
        terms: poData.terms || null,
        deliveryAddress: poData.deliveryAddress || null,
        neededByDate: poData.neededByDate ? new Date(poData.neededByDate) : null,
        notes: poData.notes || null,
        totalCost: totalCost > 0 ? String(totalCost) : null,
      }).returning();

      if (items && items.length > 0) {
        for (const item of items) {
          await tx.insert(purchaseOrderItems).values({
            poId: newPo.id,
            description: item.description,
            quantity: item.quantity || null,
            unit: item.unit || null,
            unitCost: item.unitCost || null,
            costCode: item.costCode || null,
            expectedDeliveryDate: item.expectedDeliveryDate ? new Date(item.expectedDeliveryDate) : null,
          });
        }
      }

      return newPo;
    });

    res.status(201).json(po);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/procurement-module/orders/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;

    if (existing.status !== "DRAFT" && existing.status !== "PENDING_APPROVAL") {
      res.status(400).json({ error: "Only DRAFT or PENDING_APPROVAL orders can be edited" }); return;
    }

    const parsed = poUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" }); return; }

    const { items } = parsed.data;
    const setData: Record<string, unknown> = {};
    setData.updatedAt = new Date();
    if (parsed.data.vendorId !== undefined) {
      if (parsed.data.vendorId) {
        const [vendorOwner] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
          .where(and(eq(crmOrganisations.id, parsed.data.vendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
        if (!vendorOwner) { res.status(400).json({ error: "Vendor not found in your organization" }); return; }
      }
      setData.vendorId = parsed.data.vendorId || null;
    }
    if (parsed.data.terms !== undefined) setData.terms = parsed.data.terms;
    if (parsed.data.deliveryAddress !== undefined) setData.deliveryAddress = parsed.data.deliveryAddress;
    if (parsed.data.neededByDate !== undefined) setData.neededByDate = parsed.data.neededByDate ? new Date(parsed.data.neededByDate) : null;
    if (parsed.data.notes !== undefined) setData.notes = parsed.data.notes;

    const updated = await db.transaction(async (tx) => {
      const [updatedPo] = await tx.update(purchaseOrders).set(setData)
        .where(eq(purchaseOrders.id, req.params.id)).returning();

      if (items && Array.isArray(items)) {
        await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.poId, req.params.id));
        let totalCost = 0;
        for (const item of items) {
          await tx.insert(purchaseOrderItems).values({
            poId: req.params.id,
            description: item.description,
            quantity: item.quantity || null,
            unit: item.unit || null,
            unitCost: item.unitCost || null,
            costCode: item.costCode || null,
            expectedDeliveryDate: item.expectedDeliveryDate ? new Date(item.expectedDeliveryDate) : null,
          });
          const q = parseFloat(item.quantity || "0");
          const u = parseFloat(item.unitCost || "0");
          if (!isNaN(q) && !isNaN(u)) totalCost += q * u;
        }
        await tx.update(purchaseOrders).set({ totalCost: String(totalCost) })
          .where(eq(purchaseOrders.id, req.params.id));
      }

      return updatedPo;
    });

    try {
      await eventBus.emit({
        version: 1,
        orgId,
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "purchase_order.revised" as const,
        payload: {
          poId: updated.id,
          poNumber: updated.poNumber,
          projectId: updated.projectId ?? null,
          vendorId: updated.vendorId ?? null,
          revisionNote: (parsed.data as { notes?: string | null }).notes ?? null,
        },
      });
    } catch (emitErr) {
      logError("[procurement] failed to emit purchase_order.revised", { poId: updated.id }, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/procurement-module/orders/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT orders can be deleted" }); return; }

    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/orders/:id/submit", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT orders can be submitted" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "PENDING_APPROVAL", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    await notifyApprovers(orgId, req.user!.id, {
      type: "PROCUREMENT_PO_SUBMITTED",
      title: "Purchase Order Submitted",
      message: `Purchase order ${existing.poNumber} requires your approval.`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_ORDER",
    }, ROLES).catch((err: unknown) => logError("Procurement PO submit notification failed", { error: String(err) }));

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/orders/:id/approve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending orders can be approved" }); return; }

    // Task #2484 — COI compliance gating (FAIL-CLOSED). Refuse PO
    // approval when the vendor (or any project party) is non-compliant
    // unless an audited override is on file for this PO.
    if (existing.projectId) {
      const { isReleaseBlocked } = await import("./services/coiGating");
      const { hasActiveOverride } = await import("./coiRoutes");
      let extra: { partyType: "CRM_ORG"; partyId: string; partyName: string } | undefined;
      if (existing.vendorId) {
        const [v] = await db.select({ name: crmOrganisations.name }).from(crmOrganisations)
          .where(eq(crmOrganisations.id, existing.vendorId)).limit(1);
        extra = { partyType: "CRM_ORG", partyId: existing.vendorId, partyName: v?.name || "Vendor" };
      }
      const decision = await isReleaseBlocked(orgId, existing.projectId, extra);
      if (decision.block) {
        const overridden = await hasActiveOverride(orgId, "PURCHASE_ORDER", existing.id);
        if (!overridden) {
          res.status(409).json({
            error: "COI_COMPLIANCE_HOLD",
            message: `Project insurance compliance: ${decision.status}`,
            decision,
          });
          return;
        }
      }
    }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    const [prLink] = existing.prId ? await db.select({ requestedById: purchaseRequests.requestedById })
      .from(purchaseRequests).where(eq(purchaseRequests.id, existing.prId)).limit(1) : [null];
    if (prLink) {
      await notifySubmitter(prLink.requestedById, {
        type: "PROCUREMENT_PO_APPROVED",
        title: "Purchase Order Approved",
        message: `Purchase order ${existing.poNumber} has been approved.`,
        relatedEntityId: existing.id,
        relatedEntityType: "PURCHASE_ORDER",
      }, orgId).catch((err: unknown) => logError("Procurement PO approve notification failed", { error: String(err) }));
    }

    if (existing.projectId) {
      import("./costLedgerRoutes").then(m => m.evaluateBudgetAlerts(existing.projectId!)).catch(e => logError("Budget alert eval after PO approval:", {}, e instanceof Error ? e : new Error(String(e))));
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/orders/:id/reject", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending orders can be rejected" }); return; }

    const poRejectSchema = z.object({
      rejectionNotes: z.string().min(1, "Rejection notes are required").max(2000).optional(),
      notes: z.string().min(1).max(2000).optional(),
    }).refine(d => (d.rejectionNotes || d.notes || "").trim().length > 0, {
      message: "Rejection notes are required",
    });
    const parsed = validateBody(poRejectSchema, req.body || {}, res);
    if (!parsed) return;
    const rejectionNotes = (parsed.rejectionNotes || parsed.notes || "").trim();

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "CANCELLED", rejectionNotes, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    const [prLink] = existing.prId ? await db.select({ requestedById: purchaseRequests.requestedById })
      .from(purchaseRequests).where(eq(purchaseRequests.id, existing.prId)).limit(1) : [null];
    if (prLink) {
      await notifySubmitter(prLink.requestedById, {
        type: "PROCUREMENT_PO_REJECTED",
        title: "Purchase Order Rejected",
        message: `Purchase order ${existing.poNumber} has been rejected.${rejectionNotes ? ` Reason: ${rejectionNotes}` : ""}`,
        relatedEntityId: existing.id,
        relatedEntityType: "PURCHASE_ORDER",
      }, orgId).catch((err: unknown) => logError("Procurement PO reject notification failed", { error: String(err) }));
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/orders/:id/send", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, existing.projectId))) return;
    if (existing.status !== "APPROVED") { res.status(400).json({ error: "Only approved orders can be sent" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "SENT", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    // Notify vendor to confirm delivery when PO is sent to them
    try {
      await eventBus.emit({
        version: 1,
        orgId,
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "delivery_confirmation.requested" as const,
        payload: {
          poId: updated.id,
          poNumber: updated.poNumber,
          projectId: updated.projectId ?? null,
          vendorId: updated.vendorId ?? null,
          expectedDeliveryDate: null,
        },
      });
    } catch (emitErr) {
      logError("[procurement] failed to emit delivery_confirmation.requested", { poId: updated.id }, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ─── BULK APPROVE ────────────────────────────────────────────────────────────

router.post("/api/procurement-module/orders/bulk-approve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const schema = z.object({ ids: z.array(z.string()).min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input: ids array required" }); return; }

    const { ids } = parsed.data;

    const posToApprove = await db.select().from(purchaseOrders)
      .where(and(
        eq(purchaseOrders.orgId, orgId),
        sql`${purchaseOrders.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`
      ));

    if (posToApprove.length !== ids.length) {
      res.status(400).json({ error: "Some PO IDs were not found in your organization" }); return;
    }

    const nonPending = posToApprove.filter(po => po.status !== "PENDING_APPROVAL");
    if (nonPending.length > 0) {
      res.status(400).json({ error: `${nonPending.length} PO(s) are not in PENDING_APPROVAL status: ${nonPending.map(po => po.poNumber).join(", ")}` }); return;
    }

    const approved = await db.transaction(async (tx) => {
      const results = [];
      for (const po of posToApprove) {
        const [updated] = await tx.update(purchaseOrders)
          .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(eq(purchaseOrders.id, po.id)).returning();
        results.push(updated);
      }
      return results;
    });

    for (const po of posToApprove) {
      const [prLink] = po.prId ? await db.select({ requestedById: purchaseRequests.requestedById })
        .from(purchaseRequests).where(eq(purchaseRequests.id, po.prId)).limit(1) : [null];
      if (prLink) {
        await notifySubmitter(prLink.requestedById, {
          type: "PROCUREMENT_PO_APPROVED",
          title: "Purchase Order Approved",
          message: `Purchase order ${po.poNumber} has been approved.`,
          relatedEntityId: po.id,
          relatedEntityType: "PURCHASE_ORDER",
        }, orgId).catch((err: unknown) => logError("Procurement PO bulk approve notification failed", { error: String(err) }));
      }

      if (po.projectId) {
        import("./costLedgerRoutes").then(m => m.evaluateBudgetAlerts(po.projectId!)).catch(e => logError("Budget alert eval after bulk PO approval:", {}, e instanceof Error ? e : new Error(String(e))));
      }
    }

    res.json({ approved: approved.length, orders: approved });
  } catch (error) {
    next(error);
  }
});

// ─── PROCUREMENT SUMMARY ─────────────────────────────────────────────────────

router.get("/api/procurement-module/summary", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const conditions: SQL[] = [eq(purchaseOrders.orgId, orgId)];
    if (req.query.projectId) conditions.push(eq(purchaseOrders.projectId, String(req.query.projectId)));

    const allPOs = await db.select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    }).from(purchaseOrders).where(and(...conditions));

    const poIds = allPOs.map(po => po.id);
    let totalCommitted = 0;
    let totalValue = 0;

    if (poIds.length > 0) {
      const allItems = await db.select({
        poId: purchaseOrderItems.poId,
        quantity: purchaseOrderItems.quantity,
        unitCost: purchaseOrderItems.unitCost,
      }).from(purchaseOrderItems)
        .where(sql`${purchaseOrderItems.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`);

      const committedStatuses = ["APPROVED", "SENT", "PARTIAL", "FULFILLED"];
      const committedPOIdSet = new Set(allPOs.filter(po => committedStatuses.includes(po.status)).map(po => po.id));

      for (const item of allItems) {
        const q = parseFloat(String(item.quantity || "0"));
        const u = parseFloat(String(item.unitCost || "0"));
        if (!isNaN(q) && !isNaN(u)) {
          const itemTotal = q * u;
          totalValue += itemTotal;
          if (committedPOIdSet.has(item.poId)) totalCommitted += itemTotal;
        }
      }
    }

    let totalInvoiced = 0;
    let totalPaid = 0;

    if (poIds.length > 0) {
      const [invoiceSumResult] = await db.select({
        totalInvoicedSum: sql<string>`COALESCE(SUM(${vendorInvoices.totalAmount}::numeric), 0)::text`,
      }).from(vendorInvoices)
        .where(sql`${vendorInvoices.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`);
      totalInvoiced = parseFloat(invoiceSumResult?.totalInvoicedSum || "0");

      const [paymentSumResult] = await db.select({
        totalPaidSum: sql<string>`COALESCE(SUM(${invoicePayments.amount}::numeric), 0)::text`,
      }).from(invoicePayments)
        .innerJoin(vendorInvoices, eq(invoicePayments.invoiceId, vendorInvoices.id))
        .where(sql`${vendorInvoices.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`);
      totalPaid = parseFloat(paymentSumResult?.totalPaidSum || "0");
    }

    const totalPOs = allPOs.length;
    const pendingApproval = allPOs.filter(po => po.status === "PENDING_APPROVAL").length;

    res.json({
      totalPOs,
      totalValue: totalValue.toFixed(2),
      committedCost: totalCommitted.toFixed(2),
      pendingApproval,
      totalCommitted: totalCommitted.toFixed(2),
      totalInvoiced: totalInvoiced.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
    });
  } catch (error) {
    next(error);
  }
});

// ─── DELIVERY SCHEDULE ────────────────────────────────────────────────────────

router.get("/api/procurement-module/delivery-schedule", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const conditions: SQL[] = [eq(purchaseOrders.orgId, orgId)];
    if (req.query.projectId) conditions.push(eq(purchaseOrders.projectId, String(req.query.projectId)));

    const effectiveDate = sql<Date>`COALESCE(${purchaseOrderItems.expectedDeliveryDate}, ${purchaseOrders.neededByDate})`;
    const itemConditions: SQL[] = [sql`${effectiveDate} IS NOT NULL`];
    if (req.query.from) {
      itemConditions.push(sql`${effectiveDate} >= ${new Date(String(req.query.from))}`);
    }
    if (req.query.to) {
      itemConditions.push(sql`${effectiveDate} <= ${new Date(String(req.query.to))}`);
    }

    const projectAlias = db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).as("proj");
    const vendorAlias = db.select({ id: crmOrganisations.id, name: crmOrganisations.name }).from(crmOrganisations).as("vendor");

    const deliveries = await db.select({
      itemId: purchaseOrderItems.id,
      description: purchaseOrderItems.description,
      quantity: purchaseOrderItems.quantity,
      unit: purchaseOrderItems.unit,
      unitCost: purchaseOrderItems.unitCost,
      quantityReceived: purchaseOrderItems.quantityReceived,
      expectedDeliveryDate: sql<string>`${effectiveDate}`,
      poId: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      poStatus: purchaseOrders.status,
      projectId: purchaseOrders.projectId,
      projectName: projectAlias.name,
      projectCode: projectAlias.code,
      vendorName: vendorAlias.name,
      vendorId: vendorAlias.id,
    })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.poId, purchaseOrders.id))
      .leftJoin(projectAlias, eq(purchaseOrders.projectId, projectAlias.id))
      .leftJoin(vendorAlias, eq(purchaseOrders.vendorId, vendorAlias.id))
      .where(and(...conditions, ...itemConditions))
      .orderBy(asc(effectiveDate))
      .limit(500);

    res.json(deliveries);
  } catch (error) {
    next(error);
  }
});

// ─── RECEIPTS ───────────────────────────────────────────────────────────────

router.get("/api/procurement-module/orders/:id/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }

    const receipts = await db.select().from(poReceipts).where(eq(poReceipts.poId, po.id))
      .orderBy(desc(poReceipts.receivedAt));
    const result = await Promise.all(receipts.map(async (r) => {
      const items = await db.select().from(poReceiptItems).where(eq(poReceiptItems.receiptId, r.id));
      return { ...r, items };
    }));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

const receiptCreateSchema = z.object({
  deliveryNote: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(z.object({
    poItemId: z.string(),
    quantityReceived: z.string(),
    condition: z.enum(["GOOD", "DAMAGED", "REJECTED"]).optional(),
    notes: z.string().nullable().optional(),
  })),
});

router.post("/api/procurement-module/orders/:id/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, po.projectId))) return;

    const receivableStatuses = ["APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL"];
    if (!receivableStatuses.includes(po.status)) {
      res.status(400).json({ error: `Receipts can only be recorded for POs in ${receivableStatuses.join(", ")} status (currently ${po.status})` }); return;
    }

    const parsed = receiptCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const validPoItemIds = (await db.select({ id: purchaseOrderItems.id })
      .from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, po.id))).map(i => i.id);

    for (const item of parsed.data.items) {
      if (!validPoItemIds.includes(item.poItemId)) {
        res.status(400).json({ error: `Invalid PO item ID: ${item.poItemId}` });
        return;
      }
    }

    const receipt = await db.transaction(async (tx) => {
      const [newReceipt] = await tx.insert(poReceipts).values({
        poId: po.id,
        receivedById: req.user!.id,
        deliveryNote: parsed.data.deliveryNote || null,
        notes: parsed.data.notes || null,
      }).returning();

      for (const item of parsed.data.items) {
        await tx.insert(poReceiptItems).values({
          receiptId: newReceipt.id,
          poItemId: item.poItemId,
          quantityReceived: item.quantityReceived,
          condition: item.condition || "GOOD",
          notes: item.notes || null,
        });

        const qtyReceived = parseFloat(item.quantityReceived);
        if (!isNaN(qtyReceived) && qtyReceived > 0) {
          await tx.execute(sql`
            UPDATE purchase_order_items 
            SET quantity_received = COALESCE(quantity_received, 0) + ${qtyReceived}
            WHERE id = ${item.poItemId} AND po_id = ${po.id}
          `);
        }
      }

      const poItems = await tx.select().from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.poId, po.id));

      const allFulfilled = poItems.every(item => {
        const ordered = parseFloat(item.quantity?.toString() || "0");
        const received = parseFloat(item.quantityReceived?.toString() || "0");
        return ordered > 0 && received >= ordered;
      });

      const anyReceived = poItems.some(item => {
        const received = parseFloat(item.quantityReceived?.toString() || "0");
        return received > 0;
      });

      if (allFulfilled) {
        await tx.update(purchaseOrders).set({ status: "FULFILLED", updatedAt: new Date() })
          .where(eq(purchaseOrders.id, po.id));
        await tx.update(poReceipts).set({ status: "COMPLETE" }).where(eq(poReceipts.id, newReceipt.id));
      } else if (anyReceived && (po.status === "SENT" || po.status === "ACKNOWLEDGED" || po.status === "APPROVED")) {
        await tx.update(purchaseOrders).set({ status: "PARTIAL", updatedAt: new Date() })
          .where(eq(purchaseOrders.id, po.id));
      }

      return newReceipt;
    });

    try {
      const poItems = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, po.id));
      const receiptLineItems = parsed.data.items.map(item => {
        const poItem = poItems.find(pi => pi.id === item.poItemId);
        const unitCost = parseFloat(poItem?.unitCost?.toString() || "0");
        const qty = parseFloat(item.quantityReceived);
        return {
          costCode: poItem?.costCode || null,
          amount: unitCost * qty,
          description: poItem?.description || `PO item ${item.poItemId}`,
        };
      });

      await eventBus.emit({
        version: 1,
        orgId: po.orgId || "",
        actorId: req.user!.id,
        timestamp: new Date(),
        type: "po.receipt_recorded" as const,
        payload: {
          receiptId: receipt.id,
          poId: po.id,
          projectId: po.projectId || "",
          items: receiptLineItems,
        },
      });
    } catch (emitErr) {
      logError("Failed to emit po.receipt_recorded event:", {}, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
    }

    res.status(201).json(receipt);
  } catch (error) {
    next(error);
  }
});

router.get("/api/procurement-module/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const poConditions: any[] = [eq(purchaseOrders.orgId, orgId)];
    if (req.query.projectId) poConditions.push(eq(purchaseOrders.projectId, String(req.query.projectId)));

    const orgPOs = await db.select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      vendorId: purchaseOrders.vendorId,
      projectId: purchaseOrders.projectId,
    }).from(purchaseOrders).where(and(...poConditions));

    if (orgPOs.length === 0) { res.json([]); return; }

    const poIds = orgPOs.map(po => po.id);
    const receiptConditions: any[] = [sql`${poReceipts.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`];
    if (req.query.status) {
      const s = String(req.query.status);
      if (!(RECEIPT_STATUSES as readonly string[]).includes(s)) { res.status(400).json({ error: `Invalid status. Allowed: ${RECEIPT_STATUSES.join(", ")}` }); return; }
      receiptConditions.push(eq(poReceipts.status, s as typeof poReceipts.$inferSelect.status));
    }
    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      receiptConditions.push(or(
        ilike(poReceipts.deliveryNote, term),
        ilike(poReceipts.notes, term),
        sql`EXISTS (SELECT 1 FROM purchase_orders po2 WHERE po2.id = ${poReceipts.poId} AND po2.po_number ILIKE ${term})`,
        sql`EXISTS (SELECT 1 FROM purchase_orders po2 LEFT JOIN crm_organisations v ON v.id = po2.vendor_id WHERE po2.id = ${poReceipts.poId} AND v.name ILIKE ${term})`,
        sql`EXISTS (SELECT 1 FROM purchase_orders po2 LEFT JOIN projects p ON p.id = po2.project_id WHERE po2.id = ${poReceipts.poId} AND p.name ILIKE ${term})`,
      ));
    }

    const allReceipts = await db.select().from(poReceipts)
      .where(and(...receiptConditions))
      .orderBy(desc(poReceipts.receivedAt));

    const allReceiptIds = allReceipts.map(r => r.id);
    let itemsByReceipt: Record<string, any[]> = {};
    if (allReceiptIds.length > 0) {
      const rawItems = await db.select({
        ri: poReceiptItems,
        itemDescription: purchaseOrderItems.description,
        itemUnit: purchaseOrderItems.unit,
      })
        .from(poReceiptItems)
        .leftJoin(purchaseOrderItems, eq(poReceiptItems.poItemId, purchaseOrderItems.id))
        .where(sql`${poReceiptItems.receiptId} IN (${sql.join(allReceiptIds.map(id => sql`${id}`), sql`, `)})`);
      for (const row of rawItems) {
        const receiptId = row.ri.receiptId;
        if (!itemsByReceipt[receiptId]) itemsByReceipt[receiptId] = [];
        itemsByReceipt[receiptId].push({ ...row.ri, itemDescription: row.itemDescription, itemUnit: row.itemUnit });
      }
    }

    const receiverIds = [...new Set(allReceipts.map(r => r.receivedById))];
    let receiversMap: Record<string, { firstName: string; lastName: string }> = {};
    if (receiverIds.length > 0) {
      const receivers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(receiverIds.map(id => sql`${id}`), sql`, `)})`);
      for (const r of receivers) receiversMap[r.id] = { firstName: r.firstName, lastName: r.lastName };
    }

    const vendorIds = [...new Set(orgPOs.filter(p => p.vendorId).map(p => p.vendorId!))];
    let vendorMap: Record<string, { id: string; name: string }> = {};
    if (vendorIds.length > 0) {
      const vendors = await db.select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(sql`${crmOrganisations.id} IN (${sql.join(vendorIds.map(id => sql`${id}`), sql`, `)})`);
      for (const v of vendors) vendorMap[v.id] = v;
    }

    const projectIds = [...new Set(orgPOs.map(p => p.projectId))];
    let projectMap: Record<string, { name: string; code: string | null }> = {};
    if (projectIds.length > 0) {
      const projs = await db.select({ id: projects.id, name: projects.name, code: projects.code })
        .from(projects)
        .where(sql`${projects.id} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`);
      for (const p of projs) projectMap[p.id] = { name: p.name, code: p.code };
    }

    const result = allReceipts.map(r => {
      const po = orgPOs.find(p => p.id === r.poId);
      return {
        ...r,
        items: itemsByReceipt[r.id] || [],
        poNumber: po?.poNumber || null,
        receivedBy: receiversMap[r.receivedById] || null,
        vendor: po?.vendorId ? vendorMap[po.vendorId] || null : null,
        project: po?.projectId ? projectMap[po.projectId] || null : null,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── INVOICES ───────────────────────────────────────────────────────────────

router.get("/api/procurement-module/invoices", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const conditions: SQL[] = [eq(vendorInvoices.orgId, orgId)];
    if (req.query.status) {
      const s = String(req.query.status);
      if (!(INVOICE_STATUSES as readonly string[]).includes(s)) { res.status(400).json({ error: `Invalid status. Allowed: ${INVOICE_STATUSES.join(", ")}` }); return; }
      conditions.push(sql`${vendorInvoices.status} = ${s}`);
    }

    if (req.query.projectId) {
      const projectPOIds = (await db.select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, String(req.query.projectId))))).map(p => p.id);
      if (projectPOIds.length === 0) { res.json([]); return; }
      conditions.push(sql`${vendorInvoices.poId} IN (${sql.join(projectPOIds.map(id => sql`${id}`), sql`, `)})`);
    }

    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      const searchOr = or(
        ilike(vendorInvoices.invoiceNumber, term),
        sql`EXISTS (SELECT 1 FROM crm_organisations v WHERE v.id = COALESCE(${vendorInvoices.vendorId}, (SELECT vendor_id FROM purchase_orders po WHERE po.id = ${vendorInvoices.poId})) AND v.name ILIKE ${term})`,
        sql`EXISTS (SELECT 1 FROM purchase_orders po2 LEFT JOIN projects p ON p.id = po2.project_id WHERE po2.id = ${vendorInvoices.poId} AND p.name ILIKE ${term})`,
      );
      if (searchOr) conditions.push(searchOr);
    }

    const poAlias = db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, vendorId: purchaseOrders.vendorId }).from(purchaseOrders).as("po_alias");
    const vendorAlias = db.select({ id: crmOrganisations.id, name: crmOrganisations.name }).from(crmOrganisations).as("vendor_alias");

    const invoices = await db.select({
      inv: vendorInvoices,
      poNumber: poAlias.poNumber,
      vendorName: vendorAlias.name,
      vendorId2: vendorAlias.id,
    })
      .from(vendorInvoices)
      .leftJoin(poAlias, eq(vendorInvoices.poId, poAlias.id))
      .leftJoin(vendorAlias, sql`COALESCE(${vendorInvoices.vendorId}, ${poAlias.vendorId}) = ${vendorAlias.id}`)
      .where(and(...conditions))
      .orderBy(desc(vendorInvoices.createdAt));

    const invIds = invoices.map(r => r.inv.id);
    let matchMap: Record<string, any> = {};
    if (invIds.length > 0) {
      const matches = await db.select().from(invoiceMatches)
        .where(sql`${invoiceMatches.invoiceId} IN (${sql.join(invIds.map(id => sql`${id}`), sql`, `)})`);
      for (const m of matches) matchMap[m.invoiceId] = m;
    }

    let paymentsMap: Record<string, number> = {};
    if (invIds.length > 0) {
      const payments = await db.select().from(invoicePayments)
        .where(sql`${invoicePayments.invoiceId} IN (${sql.join(invIds.map(id => sql`${id}`), sql`, `)})`);
      for (const p of payments) {
        paymentsMap[p.invoiceId] = (paymentsMap[p.invoiceId] || 0) + parseFloat(p.amount?.toString() || "0");
      }
    }

    const result = invoices.map(r => ({
      ...r.inv,
      po: r.poNumber ? { poNumber: r.poNumber } : null,
      vendor: r.vendorName ? { id: r.vendorId2, name: r.vendorName } : null,
      match: matchMap[r.inv.id] || null,
      totalPaid: String(paymentsMap[r.inv.id] || 0),
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

const invoiceCreateSchema = z.object({
  poId: z.string(),
  vendorId: z.string().nullable().optional(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string(),
  dueDate: z.string().nullable().optional(),
  totalAmount: z.string(),
  notes: z.string().nullable().optional(),
  fileUrl: z.string().nullable().optional(),
});

router.post("/api/procurement-module/invoices", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const parsed = invoiceCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, parsed.data.poId), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, po.projectId))) return;

    const resolvedVendorId = parsed.data.vendorId || po.vendorId || null;
    if (resolvedVendorId) {
      const [vendor] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, resolvedVendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
      if (!vendor) { res.status(403).json({ error: "Vendor does not belong to your organization" }); return; }
    }

    const { items } = req.body;
    const validPoItemIds = new Set(
      (await db.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.poId, parsed.data.poId))).map(r => r.id)
    );
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(vendorInvoices).values({
        orgId,
        poId: parsed.data.poId,
        vendorId: resolvedVendorId,
        invoiceNumber: parsed.data.invoiceNumber,
        invoiceDate: new Date(parsed.data.invoiceDate),
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        totalAmount: parsed.data.totalAmount,
        notes: parsed.data.notes || null,
        fileUrl: parsed.data.fileUrl || null,
      }).returning();

      if (items && Array.isArray(items)) {
        for (const item of items) {
          if (!item.description || typeof item.description !== "string") continue;
          const poItemId = item.poItemId && validPoItemIds.has(item.poItemId) ? item.poItemId : null;
          const qty = parseFloat(item.quantity) || 0;
          const cost = parseFloat(item.unitCost) || 0;
          if (qty < 0 || cost < 0) continue;
          await tx.insert(vendorInvoiceItems).values({
            invoiceId: invoice.id,
            poItemId,
            description: item.description.trim(),
            quantity: String(qty),
            unitCost: String(cost),
            amount: item.amount || String(Math.round(qty * cost * 100) / 100),
          });
        }
      }
      return invoice;
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/procurement-module/invoices/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [existing] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [invPo] = await db.select({ projectId: purchaseOrders.projectId }).from(purchaseOrders)
      .where(eq(purchaseOrders.id, existing.poId)).limit(1);
    if (invPo && !(await verifyProjectAssignment(req, res, invPo.projectId))) return;

    if (existing.status !== "PENDING") { res.status(400).json({ error: "Only PENDING invoices can be edited" }); return; }

    const parsed = invoiceUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" }); return; }

    const { items } = parsed.data;
    const setData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.invoiceNumber !== undefined) setData.invoiceNumber = parsed.data.invoiceNumber;
    if (parsed.data.invoiceDate !== undefined) setData.invoiceDate = new Date(parsed.data.invoiceDate);
    if (parsed.data.dueDate !== undefined) setData.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
    if (parsed.data.totalAmount !== undefined) setData.totalAmount = parsed.data.totalAmount;
    if (parsed.data.notes !== undefined) setData.notes = parsed.data.notes;
    if (parsed.data.fileUrl !== undefined) setData.fileUrl = parsed.data.fileUrl;

    const validPoItemIds = new Set(
      (await db.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.poId, existing.poId))).map(r => r.id)
    );
    const updated = await db.transaction(async (tx) => {
      const [updatedInv] = await tx.update(vendorInvoices).set(setData)
        .where(eq(vendorInvoices.id, req.params.id)).returning();

      if (items && Array.isArray(items)) {
        await tx.delete(vendorInvoiceItems).where(eq(vendorInvoiceItems.invoiceId, req.params.id));
        for (const item of items) {
          if (!item.description || typeof item.description !== "string") continue;
          const poItemId = item.poItemId && validPoItemIds.has(item.poItemId) ? item.poItemId : null;
          const qty = parseFloat(item.quantity ?? "0") || 0;
          const cost = parseFloat(item.unitCost ?? "0") || 0;
          if (qty < 0 || cost < 0) continue;
          await tx.insert(vendorInvoiceItems).values({
            invoiceId: req.params.id,
            poItemId,
            description: item.description.trim(),
            quantity: String(qty),
            unitCost: String(cost),
            amount: (item as { amount?: string }).amount || String(Math.round(qty * cost * 100) / 100),
          });
        }
      }
      return updatedInv;
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ─── 3-WAY MATCH ────────────────────────────────────────────────────────────

async function getOrgTolerance(orgId: string): Promise<number> {
  const [org] = await db.select({ matchTolerancePct: organizations.matchTolerancePct })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return parseFloat(org?.matchTolerancePct?.toString() || "5");
}

async function computeThreeWayMatch(invoice: any, po: any, orgId: string) {
  const tolerancePct = await getOrgTolerance(orgId);
  const qtyThreshold = 100 - tolerancePct;
  const poItems = await db.select().from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.poId, po.id));
  const invoiceItems = await db.select().from(vendorInvoiceItems)
    .where(eq(vendorInvoiceItems.invoiceId, invoice.id));

  const poAmount = parseFloat(po.totalCost?.toString() || "0");
  const invoiceAmount = parseFloat(invoice.totalAmount?.toString() || "0");

  if (invoiceItems.length > 0) {
    let allItemsMatch = true;
    let totalInvoicedValue = 0;
    let totalReceivedValue = 0;
    const poItemMap = new Map(poItems.map(p => [p.id, p]));
    const invoicedPoItemIds = new Set<string>();

    for (const invItem of invoiceItems) {
      const invAmount = parseFloat(invItem.amount?.toString() || "0");
      const invQty = parseFloat(invItem.quantity?.toString() || "0");
      totalInvoicedValue += invAmount;

      if (invItem.poItemId) {
        invoicedPoItemIds.add(invItem.poItemId);
        const poItem = poItemMap.get(invItem.poItemId);
        if (poItem) {
          const receivedQty = parseFloat(poItem.quantityReceived?.toString() || "0");
          const poUnitCost = parseFloat(poItem.unitCost?.toString() || "0");
          const receivedValue = receivedQty * poUnitCost;
          totalReceivedValue += receivedValue;
          const qtyTolerance = receivedQty * (tolerancePct / 100);
          if (invQty > receivedQty + qtyTolerance) {
            allItemsMatch = false;
          }
          const valueTolerance = receivedValue * (tolerancePct / 100);
          if (invAmount > receivedValue + valueTolerance) {
            allItemsMatch = false;
          }
          if (receivedQty <= 0) {
            allItemsMatch = false;
          }
        } else {
          allItemsMatch = false;
        }
      } else {
        allItemsMatch = false;
      }
    }

    const receivedQtyMatchPct = totalInvoicedValue > 0 && totalReceivedValue > 0
      ? (totalReceivedValue / totalInvoicedValue) * 100 : 0;
    const amountMatch = allItemsMatch;
    return {
      matchStatus: amountMatch ? "MATCHED" as const : "DISCREPANCY" as const,
      poAmount: String(poAmount),
      invoiceAmount: String(invoiceAmount),
      receivedQtyMatchPct: String(Math.round(receivedQtyMatchPct * 100) / 100),
    };
  }

  let allItemsMatch = true;
  let totalOrderedValue = 0;
  let totalReceivedValue = 0;
  for (const item of poItems) {
    const ordered = parseFloat(item.quantity?.toString() || "0");
    const received = parseFloat(item.quantityReceived?.toString() || "0");
    const unitCost = parseFloat(item.unitCost?.toString() || "0");
    totalOrderedValue += ordered * unitCost;
    totalReceivedValue += received * unitCost;
    if (ordered > 0 && (received / ordered) * 100 < qtyThreshold) {
      allItemsMatch = false;
    }
  }
  const receivedQtyMatchPct = totalOrderedValue > 0 ? (totalReceivedValue / totalOrderedValue) * 100 : 0;
  const amountTolerance = totalReceivedValue * (tolerancePct / 100);
  const amountMatch = Math.abs(totalReceivedValue - invoiceAmount) <= amountTolerance;
  return {
    matchStatus: amountMatch && allItemsMatch ? "MATCHED" as const : "DISCREPANCY" as const,
    poAmount: String(poAmount),
    invoiceAmount: String(invoiceAmount),
    receivedQtyMatchPct: String(Math.round(receivedQtyMatchPct * 100) / 100),
  };
}

router.get("/api/procurement-module/invoices/:id/file-url", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (!invoice.fileUrl) { res.status(404).json({ error: "No file attached to this invoice" }); return; }

    try {
      const parsed = new URL(invoice.fileUrl);
      if (parsed.protocol === "https:") {
        res.json({ url: invoice.fileUrl });
        return;
      }
    } catch { logWarn("Non-critical operation failed"); }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(invoice.fileUrl);
    const signedUrl = await objectStorageService.getSignedDownloadUrl(objectFile, 3600);
    res.json({ url: signedUrl });
  } catch (error) {
    next(error);
  }
});

router.get("/api/procurement-module/invoices/:id/match", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const [existingMatch] = await db.select().from(invoiceMatches)
      .where(eq(invoiceMatches.invoiceId, invoice.id)).limit(1);

    if (existingMatch) {
      res.json(existingMatch);
      return;
    }

    const [po] = await db.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, invoice.poId)).limit(1);
    if (!po) { res.json(null); return; }

    const matchResult = await computeThreeWayMatch(invoice, po, orgId);

    res.json({
      computed: true,
      ...matchResult,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/invoices/:id/match", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const [po] = await db.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, invoice.poId)).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }
    if (!(await verifyProjectAssignment(req, res, po.projectId))) return;

    const matchResult = await computeThreeWayMatch(invoice, po, orgId);
    const matchStatus = matchResult.matchStatus;

    const receipts = await db.select().from(poReceipts).where(eq(poReceipts.poId, po.id)).limit(1);
    const receiptId = receipts[0]?.id || null;

    const [existingMatch] = await db.select().from(invoiceMatches)
      .where(eq(invoiceMatches.invoiceId, invoice.id)).limit(1);

    let result;
    const matchData = {
      matchStatus,
      poAmount: matchResult.poAmount,
      invoiceAmount: matchResult.invoiceAmount,
      receivedQtyMatchPct: matchResult.receivedQtyMatchPct,
      receiptId,
    };
    if (existingMatch) {
      [result] = await db.update(invoiceMatches).set(matchData)
        .where(eq(invoiceMatches.id, existingMatch.id)).returning();
    } else {
      [result] = await db.insert(invoiceMatches).values({
        invoiceId: invoice.id,
        poId: po.id,
        ...matchData,
      }).returning();
    }

    if (matchStatus === "MATCHED") {
      await db.update(vendorInvoices).set({ status: "MATCHED", updatedAt: new Date() })
        .where(eq(vendorInvoices.id, invoice.id));
    } else if (matchStatus === "DISCREPANCY") {
      await db.update(vendorInvoices).set({ status: "DISPUTED", updatedAt: new Date() })
        .where(eq(vendorInvoices.id, invoice.id));
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/invoices/:id/match/resolve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const [match] = await db.select().from(invoiceMatches)
      .where(eq(invoiceMatches.invoiceId, invoice.id)).limit(1);
    if (!match) { res.status(404).json({ error: "No match record found" }); return; }

    const [updated] = await db.update(invoiceMatches).set({
      matchStatus: "MATCHED",
      discrepancyNotes: req.body.notes || null,
      resolvedById: req.user!.id,
      resolvedAt: new Date(),
    }).where(eq(invoiceMatches.id, match.id)).returning();

    await db.update(vendorInvoices).set({ status: "MATCHED", updatedAt: new Date() })
      .where(eq(vendorInvoices.id, invoice.id));

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ─── PAYMENTS ───────────────────────────────────────────────────────────────

const paymentCreateSchema = z.object({
  amount: z.string().min(1).refine(v => { const n = Number(v); return isFinite(n) && n > 0; }, { message: "Amount must be a positive number" }),
  paymentDate: z.string().min(1),
  method: z.string().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get("/api/procurement-module/invoices/:id/payments", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const payments = await db.select({
      payment: invoicePayments,
      recorderFirst: users.firstName,
      recorderLast: users.lastName,
    })
      .from(invoicePayments)
      .leftJoin(users, eq(invoicePayments.recordedById, users.id))
      .where(eq(invoicePayments.invoiceId, invoice.id))
      .orderBy(desc(invoicePayments.createdAt));

    res.json(payments.map(p => ({
      ...p.payment,
      recordedBy: p.recorderFirst ? { firstName: p.recorderFirst, lastName: p.recorderLast } : null,
    })));
  } catch (error) {
    next(error);
  }
});

router.post("/api/procurement-module/invoices/:id/payments", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    if (!["MATCHED", "APPROVED"].includes(invoice.status)) {
      res.status(400).json({ error: "Payments can only be recorded on MATCHED or APPROVED invoices" }); return;
    }

    const parsed = paymentCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [payment] = await db.insert(invoicePayments).values({
      orgId,
      invoiceId: invoice.id,
      amount: parsed.data.amount,
      paymentDate: new Date(parsed.data.paymentDate),
      method: parsed.data.method || null,
      referenceNumber: parsed.data.referenceNumber || null,
      notes: parsed.data.notes || null,
      recordedById: req.user!.id,
    }).returning();

    const existingPayments = await db.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoice.id));
    const totalPaid = existingPayments.reduce((sum, p) => sum + parseFloat(p.amount?.toString() || "0"), 0);
    const invoiceTotal = parseFloat(invoice.totalAmount?.toString() || "0");

    if (totalPaid >= invoiceTotal) {
      await db.update(vendorInvoices).set({ status: "PAID", updatedAt: new Date() })
        .where(eq(vendorInvoices.id, invoice.id));
    } else if (invoice.status === "MATCHED") {
      await db.update(vendorInvoices).set({ status: "APPROVED", updatedAt: new Date() })
        .where(eq(vendorInvoices.id, invoice.id));
    }

    // Notify the vendor that their invoice payment has been processed
    if (invoice.vendorId) {
      try {
        await eventBus.emit({
          version: 1,
          orgId,
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "payment.received" as const,
          payload: {
            paymentId: payment.id,
            projectId: null,
            invoiceType: "VENDOR_INVOICE" as const,
            invoiceId: invoice.id,
            amount: payment.amount,
            vendorCrmOrgId: invoice.vendorId,
          },
        });
      } catch (emitErr) {
        logError("[procurement] failed to emit payment.received (vendor)", { invoiceId: invoice.id }, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
      }
    }

    res.status(201).json({ payment, totalPaid: String(totalPaid) });
  } catch (error) {
    next(error);
  }
});

export default router;
