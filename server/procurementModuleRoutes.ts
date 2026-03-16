import { Router } from "express";
import { db } from "./db";
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrders, purchaseOrderItems,
  poReceipts, poReceiptItems,
  vendorInvoices, invoiceMatches,
  invoicePayments, organizations,
  projects, users,
} from "@shared/schema";
import { crmOrganisations } from "@shared/schema";
import { eq, and, desc, sql, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import { verifyOrgAccess } from "./orgFilter";
import type { Response } from "express";

const router = Router();
const ROLES = ["ADMIN", "MANAGER", "PROCUREMENT_MANAGER"] as const;
const APPROVE_ROLES = ["ADMIN", "MANAGER"] as const;

function getOrgId(req: AuthRequest, res: Response): string | null {
  const orgId = req.user?.organizationId || null;
  if (!orgId) return null;
  const hasAccess = verifyOrgAccess(req, res, orgId);
  if (!hasAccess) return null;
  return orgId;
}

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

router.get("/api/procurement-module/requests", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const conditions: any[] = [eq(purchaseRequests.orgId, orgId)];
    if (req.query.projectId) conditions.push(eq(purchaseRequests.projectId, String(req.query.projectId)));
    if (req.query.status) conditions.push(eq(purchaseRequests.status, String(req.query.status) as any));
    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      conditions.push(or(
        ilike(purchaseRequests.title, term),
        ilike(purchaseRequests.prNumber, term),
        sql`EXISTS (SELECT 1 FROM projects p WHERE p.id = ${purchaseRequests.projectId} AND p.name ILIKE ${term})`,
      ));
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
    console.error("Get purchase requests error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/requests", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const parsed = prCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const { items, ...prData } = parsed.data;

    const count = await db.select({ count: sql<number>`count(*)` })
      .from(purchaseRequests).where(eq(purchaseRequests.orgId, orgId));
    const prNumber = `PR-${String(Number(count[0]?.count || 0) + 1).padStart(4, "0")}`;

    const [projOwner] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, prData.projectId), eq(projects.gcOrganizationId, orgId))).limit(1);
    if (!projOwner) { res.status(400).json({ error: "Project not found in your organization" }); return; }

    const pr = await db.transaction(async (tx) => {
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
    console.error("Create purchase request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/procurement-module/requests/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Purchase request not found" }); return; }

    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT requests can be edited" }); return; }

    const { items } = req.body;
    const setData: Record<string, unknown> = {};
    setData.updatedAt = new Date();
    if (req.body.title !== undefined) setData.title = req.body.title;
    if (req.body.neededByDate !== undefined) setData.neededByDate = req.body.neededByDate ? new Date(req.body.neededByDate) : null;
    if (req.body.notes !== undefined) setData.notes = req.body.notes;

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
    console.error("Update purchase request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/procurement-module/requests/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT requests can be deleted" }); return; }

    await db.delete(purchaseRequests).where(eq(purchaseRequests.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete purchase request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/requests/:id/submit", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT requests can be submitted" }); return; }

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "PENDING_APPROVAL", updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    notifyApprovers(orgId, req.user!.id, {
      type: "PROCUREMENT_PR_SUBMITTED",
      title: "Purchase Request Submitted",
      message: `Purchase request ${existing.prNumber} "${existing.title}" requires your approval.`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_REQUEST",
    }, ROLES).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("Submit purchase request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/requests/:id/approve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending requests can be approved" }); return; }

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    notifySubmitter(existing.requestedById, {
      type: "PROCUREMENT_PR_APPROVED",
      title: "Purchase Request Approved",
      message: `Your purchase request ${existing.prNumber} "${existing.title}" has been approved.`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_REQUEST",
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("Approve purchase request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/requests/:id/reject", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending requests can be rejected" }); return; }

    const rejectionNotes = (req.body.rejectionNotes || req.body.notes || "").trim();
    if (!rejectionNotes) { res.status(400).json({ error: "Rejection notes are required" }); return; }

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "REJECTED", rejectionNotes, updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    notifySubmitter(existing.requestedById, {
      type: "PROCUREMENT_PR_REJECTED",
      title: "Purchase Request Rejected",
      message: `Your purchase request ${existing.prNumber} "${existing.title}" has been rejected.${rejectionNotes ? ` Reason: ${rejectionNotes}` : ""}`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_REQUEST",
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("Reject purchase request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/requests/:id/convert-to-po", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [pr] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!pr) { res.status(404).json({ error: "Not found" }); return; }
    if (pr.status !== "APPROVED") { res.status(400).json({ error: "Only approved requests can be converted" }); return; }

    const prItems = await db.select().from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.prId, pr.id));

    const poCount = await db.select({ count: sql<number>`count(*)` })
      .from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId));
    const poNumber = `PO-${String(Number(poCount[0]?.count || 0) + 1).padStart(4, "0")}`;

    const vendorId = req.body.vendorId || null;

    if (vendorId) {
      const [vendorOwner] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, vendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
      if (!vendorOwner) { res.status(400).json({ error: "Vendor not found in your organization" }); return; }
    }

    const po = await db.transaction(async (tx) => {
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

    res.status(201).json(po);
  } catch (error) {
    console.error("Convert PR to PO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PURCHASE ORDERS ────────────────────────────────────────────────────────

router.get("/api/procurement-module/orders", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const conditions: any[] = [eq(purchaseOrders.orgId, orgId)];
    if (req.query.projectId) conditions.push(eq(purchaseOrders.projectId, String(req.query.projectId)));
    if (req.query.status) conditions.push(eq(purchaseOrders.status, String(req.query.status) as any));
    const projectAlias = db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).as("proj");
    const vendorAlias = db.select({ id: crmOrganisations.id, name: crmOrganisations.name }).from(crmOrganisations).as("vendor");

    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      conditions.push(or(
        ilike(purchaseOrders.poNumber, term),
        ilike(purchaseOrders.notes, term),
        sql`EXISTS (SELECT 1 FROM projects p WHERE p.id = ${purchaseOrders.projectId} AND p.name ILIKE ${term})`,
        sql`EXISTS (SELECT 1 FROM crm_organisations v WHERE v.id = ${purchaseOrders.vendorId} AND v.name ILIKE ${term})`,
      ));
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
    console.error("Get purchase orders error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/procurement-module/orders/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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
    const receiptsWithItems = await Promise.all(receipts.map(async (r) => {
      const rItems = await db.select().from(poReceiptItems).where(eq(poReceiptItems.receiptId, r.id));
      const [receiver] = await db.select({ firstName: users.firstName, lastName: users.lastName })
        .from(users).where(eq(users.id, r.receivedById)).limit(1);
      return { ...r, items: rItems, receivedBy: receiver || null };
    }));

    const invoices = await db.select().from(vendorInvoices).where(eq(vendorInvoices.poId, po.id))
      .orderBy(desc(vendorInvoices.createdAt));
    const invoicesWithMatch = await Promise.all(invoices.map(async (inv) => {
      const [match] = await db.select().from(invoiceMatches)
        .where(eq(invoiceMatches.invoiceId, inv.id)).limit(1);
      const payments = await db.select().from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, inv.id));
      const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount?.toString() || "0"), 0);
      return { ...inv, match: match || null, totalPaid: String(totalPaid), payments };
    }));

    res.json({ ...po, items, project: proj || null, vendor, receipts: receiptsWithItems, invoices: invoicesWithMatch });
  } catch (error) {
    console.error("Get PO detail error:", error);
    res.status(500).json({ error: "Internal server error" });
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
  })).optional(),
});

router.post("/api/procurement-module/orders", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const parsed = poCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const { items, ...poData } = parsed.data;

    const [projOwner] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, poData.projectId), eq(projects.gcOrganizationId, orgId))).limit(1);
    if (!projOwner) { res.status(400).json({ error: "Project not found in your organization" }); return; }

    if (poData.vendorId) {
      const [vendorOwner] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, poData.vendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
      if (!vendorOwner) { res.status(400).json({ error: "Vendor not found in your organization" }); return; }
    }

    const poCount = await db.select({ count: sql<number>`count(*)` })
      .from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId));
    const poNumber = `PO-${String(Number(poCount[0]?.count || 0) + 1).padStart(4, "0")}`;

    let totalCost = 0;
    if (items) {
      for (const item of items) {
        const q = parseFloat(item.quantity || "0");
        const u = parseFloat(item.unitCost || "0");
        if (!isNaN(q) && !isNaN(u)) totalCost += q * u;
      }
    }

    const po = await db.transaction(async (tx) => {
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
          });
        }
      }

      return newPo;
    });

    res.status(201).json(po);
  } catch (error) {
    console.error("Create purchase order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/procurement-module/orders/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (existing.status !== "DRAFT" && existing.status !== "PENDING_APPROVAL") {
      res.status(400).json({ error: "Only DRAFT or PENDING_APPROVAL orders can be edited" }); return;
    }

    const { items } = req.body;
    const setData: Record<string, unknown> = {};
    setData.updatedAt = new Date();
    if (req.body.vendorId !== undefined) {
      if (req.body.vendorId) {
        const [vendorOwner] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
          .where(and(eq(crmOrganisations.id, req.body.vendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
        if (!vendorOwner) { res.status(400).json({ error: "Vendor not found in your organization" }); return; }
      }
      setData.vendorId = req.body.vendorId || null;
    }
    if (req.body.terms !== undefined) setData.terms = req.body.terms;
    if (req.body.deliveryAddress !== undefined) setData.deliveryAddress = req.body.deliveryAddress;
    if (req.body.neededByDate !== undefined) setData.neededByDate = req.body.neededByDate ? new Date(req.body.neededByDate) : null;
    if (req.body.notes !== undefined) setData.notes = req.body.notes;

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

    res.json(updated);
  } catch (error) {
    console.error("Update purchase order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/procurement-module/orders/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT orders can be deleted" }); return; }

    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete purchase order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/orders/:id/submit", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT orders can be submitted" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "PENDING_APPROVAL", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    notifyApprovers(orgId, req.user!.id, {
      type: "PROCUREMENT_PO_SUBMITTED",
      title: "Purchase Order Submitted",
      message: `Purchase order ${existing.poNumber} requires your approval.`,
      relatedEntityId: existing.id,
      relatedEntityType: "PURCHASE_ORDER",
    }, ROLES).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error("Submit PO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/orders/:id/approve", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending orders can be approved" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    const [prLink] = existing.prId ? await db.select({ requestedById: purchaseRequests.requestedById })
      .from(purchaseRequests).where(eq(purchaseRequests.id, existing.prId)).limit(1) : [null];
    if (prLink) {
      notifySubmitter(prLink.requestedById, {
        type: "PROCUREMENT_PO_APPROVED",
        title: "Purchase Order Approved",
        message: `Purchase order ${existing.poNumber} has been approved.`,
        relatedEntityId: existing.id,
        relatedEntityType: "PURCHASE_ORDER",
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("Approve PO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/orders/:id/reject", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending orders can be rejected" }); return; }

    const rejectionNotes = (req.body.rejectionNotes || req.body.notes || "").trim();
    if (!rejectionNotes) { res.status(400).json({ error: "Rejection notes are required" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "CANCELLED", rejectionNotes, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    const [prLink] = existing.prId ? await db.select({ requestedById: purchaseRequests.requestedById })
      .from(purchaseRequests).where(eq(purchaseRequests.id, existing.prId)).limit(1) : [null];
    if (prLink) {
      notifySubmitter(prLink.requestedById, {
        type: "PROCUREMENT_PO_REJECTED",
        title: "Purchase Order Rejected",
        message: `Purchase order ${existing.poNumber} has been rejected.${rejectionNotes ? ` Reason: ${rejectionNotes}` : ""}`,
        relatedEntityId: existing.id,
        relatedEntityType: "PURCHASE_ORDER",
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("Reject PO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/orders/:id/send", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "APPROVED") { res.status(400).json({ error: "Only approved orders can be sent" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "SENT", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("Send PO error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── RECEIPTS ───────────────────────────────────────────────────────────────

router.get("/api/procurement-module/orders/:id/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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
    console.error("Get PO receipts error:", error);
    res.status(500).json({ error: "Internal server error" });
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

router.post("/api/procurement-module/orders/:id/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }

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

    res.status(201).json(receipt);
  } catch (error) {
    console.error("Create PO receipt error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/procurement-module/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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
    if (req.query.status) receiptConditions.push(eq(poReceipts.status, String(req.query.status)));
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
    console.error("Get all receipts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── INVOICES ───────────────────────────────────────────────────────────────

router.get("/api/procurement-module/invoices", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const conditions: any[] = [eq(vendorInvoices.orgId, orgId)];
    if (req.query.status) conditions.push(eq(vendorInvoices.status, String(req.query.status) as any));

    if (req.query.projectId) {
      const projectPOIds = (await db.select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, String(req.query.projectId))))).map(p => p.id);
      if (projectPOIds.length === 0) { res.json([]); return; }
      conditions.push(sql`${vendorInvoices.poId} IN (${sql.join(projectPOIds.map(id => sql`${id}`), sql`, `)})`);
    }

    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      conditions.push(or(
        ilike(vendorInvoices.invoiceNumber, term),
        sql`EXISTS (SELECT 1 FROM crm_organisations v WHERE v.id = COALESCE(${vendorInvoices.vendorId}, (SELECT vendor_id FROM purchase_orders po WHERE po.id = ${vendorInvoices.poId})) AND v.name ILIKE ${term})`,
        sql`EXISTS (SELECT 1 FROM purchase_orders po2 LEFT JOIN projects p ON p.id = po2.project_id WHERE po2.id = ${vendorInvoices.poId} AND p.name ILIKE ${term})`,
      ));
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
    console.error("Get vendor invoices error:", error);
    res.status(500).json({ error: "Internal server error" });
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

router.post("/api/procurement-module/invoices", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const parsed = invoiceCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, parsed.data.poId), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }

    const resolvedVendorId = parsed.data.vendorId || po.vendorId || null;
    if (resolvedVendorId) {
      const [vendor] = await db.select({ id: crmOrganisations.id }).from(crmOrganisations)
        .where(and(eq(crmOrganisations.id, resolvedVendorId), eq(crmOrganisations.organizationId, orgId))).limit(1);
      if (!vendor) { res.status(403).json({ error: "Vendor does not belong to your organization" }); return; }
    }

    const [invoice] = await db.insert(vendorInvoices).values({
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

    res.status(201).json(invoice);
  } catch (error) {
    console.error("Create vendor invoice error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/procurement-module/invoices/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (existing.status !== "PENDING") { res.status(400).json({ error: "Only PENDING invoices can be edited" }); return; }

    const setData: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.invoiceNumber !== undefined) setData.invoiceNumber = req.body.invoiceNumber;
    if (req.body.invoiceDate !== undefined) setData.invoiceDate = new Date(req.body.invoiceDate);
    if (req.body.dueDate !== undefined) setData.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    if (req.body.totalAmount !== undefined) setData.totalAmount = req.body.totalAmount;
    if (req.body.notes !== undefined) setData.notes = req.body.notes;
    if (req.body.fileUrl !== undefined) setData.fileUrl = req.body.fileUrl;

    const [updated] = await db.update(vendorInvoices).set(setData)
      .where(eq(vendorInvoices.id, req.params.id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("Update vendor invoice error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── 3-WAY MATCH ────────────────────────────────────────────────────────────

async function getOrgTolerance(orgId: string): Promise<number> {
  const [org] = await db.select({ matchTolerancePct: organizations.matchTolerancePct })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return parseFloat(org?.matchTolerancePct?.toString() || "5");
}

router.get("/api/procurement-module/invoices/:id/match", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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

    const tolerancePct = await getOrgTolerance(orgId);
    const qtyThreshold = 100 - tolerancePct;
    const poItems = await db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));

    const poAmount = parseFloat(po.totalCost?.toString() || "0");
    const invoiceAmount = parseFloat(invoice.totalAmount?.toString() || "0");
    let allItemsMatch = true;
    let totalOrdered = 0;
    let totalReceived = 0;
    for (const item of poItems) {
      const ordered = parseFloat(item.quantity?.toString() || "0");
      const received = parseFloat(item.quantityReceived?.toString() || "0");
      totalOrdered += ordered;
      totalReceived += received;
      if (ordered > 0 && (received / ordered) * 100 < qtyThreshold) {
        allItemsMatch = false;
      }
    }
    const receivedQtyMatchPct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;
    const amountTolerance = poAmount * (tolerancePct / 100);
    const amountMatch = Math.abs(poAmount - invoiceAmount) <= amountTolerance;

    res.json({
      computed: true,
      matchStatus: amountMatch && allItemsMatch ? "MATCHED" : "DISCREPANCY",
      poAmount: String(poAmount),
      invoiceAmount: String(invoiceAmount),
      receivedQtyMatchPct: String(Math.round(receivedQtyMatchPct * 100) / 100),
    });
  } catch (error) {
    console.error("Get invoice match error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/invoices/:id/match", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [invoice] = await db.select().from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, req.params.id), eq(vendorInvoices.orgId, orgId))).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const [po] = await db.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, invoice.poId)).limit(1);
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }

    const tolerancePct = await getOrgTolerance(orgId);
    const qtyThreshold = 100 - tolerancePct;
    const poItems = await db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));

    const poAmount = parseFloat(po.totalCost?.toString() || "0");
    const invoiceAmount = parseFloat(invoice.totalAmount?.toString() || "0");

    let allItemsMatch = true;
    let totalOrdered = 0;
    let totalReceived = 0;
    for (const item of poItems) {
      const ordered = parseFloat(item.quantity?.toString() || "0");
      const received = parseFloat(item.quantityReceived?.toString() || "0");
      totalOrdered += ordered;
      totalReceived += received;
      if (ordered > 0 && (received / ordered) * 100 < qtyThreshold) {
        allItemsMatch = false;
      }
    }
    const receivedQtyMatchPct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

    const amountTolerance = poAmount * (tolerancePct / 100);
    const amountMatch = Math.abs(poAmount - invoiceAmount) <= amountTolerance;
    const qtyMatch = allItemsMatch;

    const matchStatus = amountMatch && qtyMatch ? "MATCHED" : "DISCREPANCY";

    const receipts = await db.select().from(poReceipts).where(eq(poReceipts.poId, po.id)).limit(1);
    const receiptId = receipts[0]?.id || null;

    const [existingMatch] = await db.select().from(invoiceMatches)
      .where(eq(invoiceMatches.invoiceId, invoice.id)).limit(1);

    let result;
    if (existingMatch) {
      [result] = await db.update(invoiceMatches).set({
        matchStatus,
        poAmount: String(poAmount),
        invoiceAmount: String(invoiceAmount),
        receivedQtyMatchPct: String(Math.round(receivedQtyMatchPct * 100) / 100),
        receiptId,
      }).where(eq(invoiceMatches.id, existingMatch.id)).returning();
    } else {
      [result] = await db.insert(invoiceMatches).values({
        invoiceId: invoice.id,
        poId: po.id,
        receiptId,
        matchStatus,
        poAmount: String(poAmount),
        invoiceAmount: String(invoiceAmount),
        receivedQtyMatchPct: String(Math.round(receivedQtyMatchPct * 100) / 100),
      }).returning();
    }

    if (matchStatus === "MATCHED") {
      await db.update(vendorInvoices).set({ status: "MATCHED", updatedAt: new Date() })
        .where(eq(vendorInvoices.id, invoice.id));
    }

    res.json(result);
  } catch (error) {
    console.error("Create/update invoice match error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/invoices/:id/match/resolve", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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
    console.error("Resolve match discrepancy error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PAYMENTS ───────────────────────────────────────────────────────────────

const paymentCreateSchema = z.object({
  amount: z.string().min(1),
  paymentDate: z.string().min(1),
  method: z.string().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get("/api/procurement-module/invoices/:id/payments", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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
    console.error("Get invoice payments error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement-module/invoices/:id/payments", requireAuth, requireRole(...APPROVE_ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

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

    res.status(201).json({ payment, totalPaid: String(totalPaid) });
  } catch (error) {
    console.error("Create invoice payment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
