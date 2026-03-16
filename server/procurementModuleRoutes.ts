import { Router } from "express";
import { db } from "./db";
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrders, purchaseOrderItems,
  poReceipts, poReceiptItems,
  vendorInvoices, invoiceMatches,
  projects, users,
} from "@shared/schema";
import { crmOrganisations } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
import { verifyOrgAccess } from "./orgFilter";
import type { Response } from "express";

const router = Router();
const ROLES = ["ADMIN", "MANAGER", "PROCUREMENT_MANAGER"] as const;

function getOrgId(req: AuthRequest, res: Response): string | null {
  const orgId = req.user?.organizationId || null;
  if (!orgId) return null;
  const hasAccess = verifyOrgAccess(req, res, orgId);
  if (!hasAccess) return null;
  return orgId;
}

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
  })).optional(),
});

router.get("/api/procurement-module/requests", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const projectIdFilter = req.query.projectId ? String(req.query.projectId) : null;
    const prConditions = [eq(purchaseRequests.orgId, orgId)];
    if (projectIdFilter) prConditions.push(eq(purchaseRequests.projectId, projectIdFilter));

    const prs = await db.select().from(purchaseRequests)
      .where(and(...prConditions))
      .orderBy(desc(purchaseRequests.createdAt));

    const result = await Promise.all(prs.map(async (pr) => {
      const items = await db.select().from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.prId, pr.id));
      const [proj] = await db.select({ name: projects.name, code: projects.code })
        .from(projects).where(eq(projects.id, pr.projectId)).limit(1);
      const [requester] = await db.select({ firstName: users.firstName, lastName: users.lastName })
        .from(users).where(eq(users.id, pr.requestedById)).limit(1);
      return { ...pr, items, project: proj || null, requestedBy: requester || null };
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

router.post("/api/procurement-module/requests/:id/approve", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
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

router.post("/api/procurement-module/requests/:id/reject", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, req.params.id), eq(purchaseRequests.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending requests can be rejected" }); return; }

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "REJECTED", updatedAt: new Date() })
      .where(eq(purchaseRequests.id, req.params.id)).returning();

    notifySubmitter(existing.requestedById, {
      type: "PROCUREMENT_PR_REJECTED",
      title: "Purchase Request Rejected",
      message: `Your purchase request ${existing.prNumber} "${existing.title}" has been rejected.`,
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

router.get("/api/procurement-module/orders", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const poProjectFilter = req.query.projectId ? String(req.query.projectId) : null;
    const poConditions = [eq(purchaseOrders.orgId, orgId)];
    if (poProjectFilter) poConditions.push(eq(purchaseOrders.projectId, poProjectFilter));

    const pos = await db.select().from(purchaseOrders)
      .where(and(...poConditions))
      .orderBy(desc(purchaseOrders.createdAt));

    const result = await Promise.all(pos.map(async (po) => {
      const items = await db.select().from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.poId, po.id));
      const [proj] = await db.select({ name: projects.name, code: projects.code })
        .from(projects).where(eq(projects.id, po.projectId)).limit(1);
      let vendor = null;
      if (po.vendorId) {
        const [v] = await db.select({ id: crmOrganisations.id, name: crmOrganisations.name })
          .from(crmOrganisations).where(eq(crmOrganisations.id, po.vendorId)).limit(1);
        vendor = v || null;
      }
      return { ...po, items, project: proj || null, vendor };
    }));

    res.json(result);
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
      return { ...inv, match: match || null };
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

    if (existing.status !== "DRAFT") { res.status(400).json({ error: "Only DRAFT orders can be edited" }); return; }

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

    const [updated] = await db.update(purchaseOrders).set(setData)
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    if (items && Array.isArray(items)) {
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.poId, req.params.id));
      let totalCost = 0;
      for (const item of items) {
        await db.insert(purchaseOrderItems).values({
          poId: req.params.id,
          description: item.description,
          quantity: item.quantity || null,
          unit: item.unit || null,
          unitCost: item.unitCost || null,
        });
        const q = parseFloat(item.quantity || "0");
        const u = parseFloat(item.unitCost || "0");
        if (!isNaN(q) && !isNaN(u)) totalCost += q * u;
      }
      await db.update(purchaseOrders).set({ totalCost: String(totalCost) })
        .where(eq(purchaseOrders.id, req.params.id));
    }

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

router.post("/api/procurement-module/orders/:id/approve", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
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

router.post("/api/procurement-module/orders/:id/reject", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const [existing] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.orgId, orgId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "PENDING_APPROVAL") { res.status(400).json({ error: "Only pending orders can be rejected" }); return; }

    const [updated] = await db.update(purchaseOrders)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id)).returning();

    const [prLink] = existing.prId ? await db.select({ requestedById: purchaseRequests.requestedById })
      .from(purchaseRequests).where(eq(purchaseRequests.id, existing.prId)).limit(1) : [null];
    if (prLink) {
      notifySubmitter(prLink.requestedById, {
        type: "PROCUREMENT_PO_REJECTED",
        title: "Purchase Order Rejected",
        message: `Purchase order ${existing.poNumber} has been rejected.`,
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

router.get("/api/procurement-module/invoices", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const invProjectFilter = req.query.projectId ? String(req.query.projectId) : null;

    let invoiceQuery;
    if (invProjectFilter) {
      const projectPOIds = (await db.select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, invProjectFilter)))).map(p => p.id);
      if (projectPOIds.length === 0) { res.json([]); return; }
      invoiceQuery = await db.select().from(vendorInvoices)
        .where(and(eq(vendorInvoices.orgId, orgId), sql`${vendorInvoices.poId} IN (${sql.join(projectPOIds.map(id => sql`${id}`), sql`, `)})`))
        .orderBy(desc(vendorInvoices.createdAt));
    } else {
      invoiceQuery = await db.select().from(vendorInvoices)
        .where(eq(vendorInvoices.orgId, orgId))
        .orderBy(desc(vendorInvoices.createdAt));
    }
    const invoices = invoiceQuery;

    const result = await Promise.all(invoices.map(async (inv) => {
      const [po] = await db.select({ poNumber: purchaseOrders.poNumber })
        .from(purchaseOrders).where(eq(purchaseOrders.id, inv.poId)).limit(1);
      let vendor = null;
      if (inv.vendorId) {
        const [v] = await db.select({ id: crmOrganisations.id, name: crmOrganisations.name })
          .from(crmOrganisations).where(eq(crmOrganisations.id, inv.vendorId)).limit(1);
        vendor = v || null;
      }
      const [match] = await db.select().from(invoiceMatches)
        .where(eq(invoiceMatches.invoiceId, inv.id)).limit(1);
      return { ...inv, po: po || null, vendor, match: match || null };
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

    const poItems = await db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));

    const poAmount = parseFloat(po.totalCost?.toString() || "0");
    const invoiceAmount = parseFloat(invoice.totalAmount?.toString() || "0");
    let totalOrdered = 0;
    let totalReceived = 0;
    for (const item of poItems) {
      totalOrdered += parseFloat(item.quantity?.toString() || "0");
      totalReceived += parseFloat(item.quantityReceived?.toString() || "0");
    }
    const receivedQtyMatchPct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;
    const amountTolerance = poAmount * 0.05;
    const amountMatch = Math.abs(poAmount - invoiceAmount) <= amountTolerance;
    const qtyMatch = receivedQtyMatchPct >= 100;

    res.json({
      computed: true,
      matchStatus: amountMatch && qtyMatch ? "MATCHED" : "DISCREPANCY",
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

    const poItems = await db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));

    const poAmount = parseFloat(po.totalCost?.toString() || "0");
    const invoiceAmount = parseFloat(invoice.totalAmount?.toString() || "0");

    let totalOrdered = 0;
    let totalReceived = 0;
    for (const item of poItems) {
      totalOrdered += parseFloat(item.quantity?.toString() || "0");
      totalReceived += parseFloat(item.quantityReceived?.toString() || "0");
    }
    const receivedQtyMatchPct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

    const amountTolerance = poAmount * 0.05;
    const amountMatch = Math.abs(poAmount - invoiceAmount) <= amountTolerance;
    const qtyMatch = receivedQtyMatchPct >= 100;

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

router.get("/api/procurement-module/receipts", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) { res.status(403).json({ error: "No organization" }); return; }

    const rcptProjectFilter = req.query.projectId ? String(req.query.projectId) : null;
    const rcptPoConditions = [eq(purchaseOrders.orgId, orgId)];
    if (rcptProjectFilter) rcptPoConditions.push(eq(purchaseOrders.projectId, rcptProjectFilter));

    const orgPOs = await db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, vendorId: purchaseOrders.vendorId, projectId: purchaseOrders.projectId })
      .from(purchaseOrders).where(and(...rcptPoConditions));

    if (orgPOs.length === 0) { res.json([]); return; }

    const poIds = orgPOs.map(po => po.id);
    const allReceipts = await db.select().from(poReceipts)
      .where(sql`${poReceipts.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(poReceipts.receivedAt));

    const result = await Promise.all(allReceipts.map(async (r) => {
      const rawItems = await db.select().from(poReceiptItems).where(eq(poReceiptItems.receiptId, r.id));
      const items = await Promise.all(rawItems.map(async (item) => {
        let itemDescription = null;
        if (item.poItemId) {
          const [poItem] = await db.select({ description: purchaseOrderItems.description, unit: purchaseOrderItems.unit })
            .from(purchaseOrderItems).where(eq(purchaseOrderItems.id, item.poItemId)).limit(1);
          itemDescription = poItem?.description || null;
        }
        return { ...item, itemDescription };
      }));
      const po = orgPOs.find(p => p.id === r.poId);
      const [receiver] = await db.select({ firstName: users.firstName, lastName: users.lastName })
        .from(users).where(eq(users.id, r.receivedById)).limit(1);
      let vendor = null;
      if (po?.vendorId) {
        const [v] = await db.select({ id: crmOrganisations.id, name: crmOrganisations.name })
          .from(crmOrganisations).where(eq(crmOrganisations.id, po.vendorId)).limit(1);
        vendor = v || null;
      }
      let project = null;
      if (po?.projectId) {
        const [p] = await db.select({ name: projects.name, code: projects.code })
          .from(projects).where(eq(projects.id, po.projectId)).limit(1);
        project = p || null;
      }
      return {
        ...r,
        items,
        poNumber: po?.poNumber || null,
        receivedBy: receiver || null,
        vendor,
        project,
      };
    }));

    res.json(result);
  } catch (error) {
    console.error("Get all receipts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
