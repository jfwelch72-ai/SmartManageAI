import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  lienWaivers,
  sovPayments,
  scheduleOfValues,
  projects,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { verifyProjectAccess, verifySOVAccess } from "./sovHelpers";

const router = Router();

router.get("/sov/lien-waivers", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(lienWaivers.organizationId, orgId));
    }

    const waivers = await db.select({
      id: lienWaivers.id,
      organizationId: lienWaivers.organizationId,
      projectId: lienWaivers.projectId,
      sovId: lienWaivers.sovId,
      waiverType: lienWaivers.waiverType,
      status: lienWaivers.status,
      recipientName: lienWaivers.recipientName,
      recipientCompany: lienWaivers.recipientCompany,
      throughDate: lienWaivers.throughDate,
      amount: lienWaivers.amount,
      notes: lienWaivers.notes,
      documentUrl: lienWaivers.documentUrl,
      sentAt: lienWaivers.sentAt,
      receivedAt: lienWaivers.receivedAt,
      approvedAt: lienWaivers.approvedAt,
      createdAt: lienWaivers.createdAt,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(lienWaivers)
    .innerJoin(projects, eq(lienWaivers.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(lienWaivers.createdAt));

    res.json(waivers);
  } catch (error) {
    console.error("Get lien waivers error:", error);
    res.status(500).json({ error: "Failed to fetch lien waivers" });
  }
});

router.post("/sov/lien-waivers", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const schema = z.object({
      projectId: z.string().min(1),
      sovId: z.string().optional().nullable(),
      waiverType: z.enum(["CONDITIONAL_PARTIAL", "UNCONDITIONAL_PARTIAL", "CONDITIONAL_FINAL", "UNCONDITIONAL_FINAL"]),
      recipientName: z.string().min(1),
      recipientCompany: z.string().optional().nullable(),
      throughDate: z.string().min(1),
      amount: z.string().or(z.number()).transform(v => String(v)),
      notes: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
    }

    const { projectId, sovId, waiverType, recipientName, recipientCompany, throughDate, amount, notes } = parsed.data;

    const useOrgId = orgId || req.body.organizationId;
    if (!useOrgId) return res.status(400).json({ error: "Organization context required" });

    const { project, hasAccess } = await verifyProjectAccess(projectId, orgId, shouldFilter);
    if (!project || !hasAccess) return res.status(404).json({ error: "Project not found" });

    const [waiver] = await db.insert(lienWaivers).values({
      organizationId: useOrgId,
      projectId,
      sovId: sovId || null,
      waiverType: waiverType as any,
      recipientName,
      recipientCompany: recipientCompany || null,
      throughDate,
      amount,
      notes: notes || null,
      createdById: req.user!.id,
    }).returning();

    res.status(201).json(waiver);
  } catch (error) {
    console.error("Create lien waiver error:", error);
    res.status(500).json({ error: "Failed to create lien waiver" });
  }
});

router.patch("/sov/lien-waivers/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(lienWaivers).where(eq(lienWaivers.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Lien waiver not found" });
    if (shouldFilter && orgId && existing.organizationId !== orgId) return res.status(404).json({ error: "Lien waiver not found" });

    const updates: any = { updatedAt: new Date() };
    if (req.body.status) {
      updates.status = req.body.status;
      if (req.body.status === "SENT") updates.sentAt = new Date();
      if (req.body.status === "RECEIVED") updates.receivedAt = new Date();
      if (req.body.status === "APPROVED") {
        updates.approvedAt = new Date();
        updates.approvedById = req.user!.id;
      }
    }
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.documentUrl !== undefined) updates.documentUrl = req.body.documentUrl;

    const [updated] = await db.update(lienWaivers).set(updates).where(eq(lienWaivers.id, id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("Update lien waiver error:", error);
    res.status(500).json({ error: "Failed to update lien waiver" });
  }
});

router.get("/sov/payments", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(sovPayments.organizationId, orgId));
    }

    const payments = await db.select({
      id: sovPayments.id,
      organizationId: sovPayments.organizationId,
      sovId: sovPayments.sovId,
      paymentNumber: sovPayments.paymentNumber,
      amount: sovPayments.amount,
      paymentDate: sovPayments.paymentDate,
      paymentMethod: sovPayments.paymentMethod,
      referenceNumber: sovPayments.referenceNumber,
      notes: sovPayments.notes,
      createdAt: sovPayments.createdAt,
      sovNumber: scheduleOfValues.sovNumber,
      sovTitle: scheduleOfValues.title,
      projectName: projects.name,
      projectCode: projects.code,
      totalEarnedLessRetainage: scheduleOfValues.totalEarnedLessRetainage,
    })
    .from(sovPayments)
    .innerJoin(scheduleOfValues, eq(sovPayments.sovId, scheduleOfValues.id))
    .innerJoin(projects, eq(scheduleOfValues.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sovPayments.createdAt));

    res.json(payments);
  } catch (error) {
    console.error("Get SOV payments error:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

router.post("/sov/payments", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const schema = z.object({
      sovId: z.string().min(1),
      amount: z.string().or(z.number()).transform(v => String(v)),
      paymentDate: z.string().min(1),
      paymentMethod: z.enum(["CHECK", "ACH", "WIRE", "CREDIT_CARD", "OTHER"]).optional().default("CHECK"),
      referenceNumber: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
    }

    const { sovId, amount, paymentDate, paymentMethod, referenceNumber, notes } = parsed.data;

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);
    if (!sov || !hasAccess) return res.status(404).json({ error: "SOV not found" });

    const existingPayments = await db.select({ paymentNumber: sovPayments.paymentNumber })
      .from(sovPayments)
      .where(eq(sovPayments.sovId, sovId))
      .orderBy(desc(sovPayments.paymentNumber))
      .limit(1);

    const nextPaymentNumber = existingPayments.length > 0 ? existingPayments[0].paymentNumber + 1 : 1;

    const [payment] = await db.insert(sovPayments).values({
      organizationId: sov.organizationId,
      sovId,
      paymentNumber: nextPaymentNumber,
      amount,
      paymentDate,
      paymentMethod: paymentMethod as any,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      recordedById: req.user!.id,
    }).returning();

    res.status(201).json(payment);
  } catch (error) {
    console.error("Create SOV payment error:", error);
    res.status(500).json({ error: "Failed to create payment" });
  }
});

export default router;
