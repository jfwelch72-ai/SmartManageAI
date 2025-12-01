import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  scheduleOfValues, 
  sovLineItems, 
  projects, 
  organizations,
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { generateSOVPDF } from "./sov-pdf-service";
import Decimal from "decimal.js";

const router = Router();

async function verifyProjectAccess(projectId: string, orgId: string | null, shouldFilter: boolean): Promise<{ project: any | null; hasAccess: boolean }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return { project: null, hasAccess: false };
  }

  if (!project.gcOrganizationId) {
    return { project, hasAccess: false };
  }

  if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
    return { project, hasAccess: false };
  }

  return { project, hasAccess: true };
}

async function verifySOVAccess(sovId: string, orgId: string | null, shouldFilter: boolean): Promise<{ sov: any | null; hasAccess: boolean }> {
  const [sov] = await db
    .select()
    .from(scheduleOfValues)
    .where(eq(scheduleOfValues.id, sovId))
    .limit(1);

  if (!sov) {
    return { sov: null, hasAccess: false };
  }

  if (shouldFilter && orgId && sov.organizationId !== orgId) {
    return { sov, hasAccess: false };
  }

  return { sov, hasAccess: true };
}

function calculateSOVTotals(lineItems: any[], retainagePct: number) {
  let totalScheduledValue = new Decimal(0);
  let totalPreviouslyCompleted = new Decimal(0);
  let totalThisPeriod = new Decimal(0);
  let totalMaterialsStored = new Decimal(0);

  lineItems.forEach((item) => {
    const scheduled = new Decimal(item.scheduledValue || 0);
    const previous = new Decimal(item.previouslyCompleted || 0);
    const current = new Decimal(item.thisPeriodCompleted || 0);
    const stored = new Decimal(item.materialsStored || 0);
    
    totalScheduledValue = totalScheduledValue.plus(Decimal.max(0, scheduled));
    totalPreviouslyCompleted = totalPreviouslyCompleted.plus(Decimal.max(0, previous));
    totalThisPeriod = totalThisPeriod.plus(Decimal.max(0, current));
    totalMaterialsStored = totalMaterialsStored.plus(Decimal.max(0, stored));
  });

  const totalCompletedToDate = totalPreviouslyCompleted.plus(totalThisPeriod).plus(totalMaterialsStored);
  const retainageFactor = new Decimal(retainagePct);
  const totalRetainage = totalCompletedToDate.times(retainageFactor);
  const totalEarnedLessRetainage = totalCompletedToDate.minus(totalRetainage);

  return {
    totalScheduledValue: totalScheduledValue.toFixed(2),
    totalPreviouslyCompleted: totalPreviouslyCompleted.toFixed(2),
    totalThisPeriod: totalThisPeriod.toFixed(2),
    totalCompletedToDate: totalCompletedToDate.toFixed(2),
    totalMaterialsStored: totalMaterialsStored.toFixed(2),
    totalRetainage: totalRetainage.toFixed(2),
    totalEarnedLessRetainage: totalEarnedLessRetainage.toFixed(2),
  };
}

router.get("/sov", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select()
      .from(scheduleOfValues)
      .orderBy(desc(scheduleOfValues.createdAt))
      .limit(100);

    if (shouldFilter && orgId) {
      query = query.where(eq(scheduleOfValues.organizationId, orgId)) as typeof query;
    }

    const sovList = await query;
    res.json(sovList);
  } catch (error) {
    console.error("Get SOVs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sov/project/:projectId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const { project, hasAccess } = await verifyProjectAccess(projectId, orgId, shouldFilter);
    
    if (!project || !hasAccess) {
      return res.json([]);
    }

    const sovList = await db
      .select()
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, projectId))
      .orderBy(desc(scheduleOfValues.periodNumber));

    res.json(sovList);
  } catch (error) {
    console.error("Get project SOVs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sov/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const lineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, id))
      .orderBy(sovLineItems.lineNumber);

    res.json({ ...sov, lineItems });
  } catch (error) {
    console.error("Get SOV error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const createSOVSchema = z.object({
  projectId: z.string(),
  organizationId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  contractValue: z.string().or(z.number()),
  retainagePercent: z.string().or(z.number()).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  lineItems: z.array(z.object({
    lineNumber: z.number(),
    itemCode: z.string().optional(),
    description: z.string(),
    category: z.string().optional(),
    scheduledValue: z.string().or(z.number()),
    previouslyCompleted: z.string().or(z.number()).optional(),
    thisPeriodCompleted: z.string().or(z.number()).optional(),
    materialsStored: z.string().or(z.number()).optional(),
    notes: z.string().optional(),
  })).optional(),
});

router.post("/sov", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"]), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = createSOVSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { projectId, title, description, contractValue, retainagePercent, periodStart, periodEnd, lineItems, organizationId: requestedOrgId } = validationResult.data;

    const targetOrgId = shouldFilter ? orgId! : (requestedOrgId || orgId);
    
    if (!targetOrgId) {
      return res.status(400).json({ error: "Organization ID is required" });
    }

    const { project, hasAccess } = await verifyProjectAccess(projectId, targetOrgId, true);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!hasAccess || project.gcOrganizationId !== targetOrgId) {
      return res.status(403).json({ error: "Cannot create SOV for another organization's project" });
    }

    const existingSOVs = await db
      .select({ periodNumber: scheduleOfValues.periodNumber })
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, projectId))
      .orderBy(desc(scheduleOfValues.periodNumber))
      .limit(1);

    const nextPeriod = existingSOVs.length > 0 ? (existingSOVs[0].periodNumber || 0) + 1 : 1;
    const sovNumber = `SOV-${project.code}-${String(nextPeriod).padStart(3, '0')}`;

    const [newSOV] = await db
      .insert(scheduleOfValues)
      .values({
        organizationId: targetOrgId,
        projectId,
        sovNumber,
        title,
        description: description || null,
        contractValue: String(contractValue),
        retainagePercent: retainagePercent ? String(retainagePercent) : "10",
        periodNumber: nextPeriod,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        status: "DRAFT",
        createdById: req.user?.id,
      })
      .returning();

    if (lineItems && lineItems.length > 0) {
      const retainagePct = Math.max(0, Math.min(100, Number(retainagePercent || 10))) / 100;
      
      const lineItemsToInsert = lineItems.map((item) => {
        const scheduled = Math.max(0, Number(item.scheduledValue) || 0);
        const previous = Math.max(0, Number(item.previouslyCompleted || 0));
        const current = Math.max(0, Number(item.thisPeriodCompleted || 0));
        const stored = Math.max(0, Number(item.materialsStored || 0));
        const totalCompleted = previous + current + stored;
        const percentComplete = scheduled > 0 ? Math.min(100, (totalCompleted / scheduled) * 100) : 0;
        const balance = Math.max(0, scheduled - totalCompleted);
        const retainageAmt = totalCompleted * retainagePct;

        return {
          sovId: newSOV.id,
          lineNumber: item.lineNumber,
          itemCode: item.itemCode || null,
          description: item.description,
          category: item.category || null,
          scheduledValue: String(scheduled),
          previouslyCompleted: String(previous),
          thisPeriodCompleted: String(current),
          materialsStored: String(stored),
          totalCompletedAndStored: String(totalCompleted),
          percentComplete: String(percentComplete.toFixed(2)),
          balanceToFinish: String(balance),
          retainageAmount: String(retainageAmt.toFixed(2)),
          notes: item.notes || null,
        };
      });

      await db.insert(sovLineItems).values(lineItemsToInsert);

      const allLineItems = await db
        .select()
        .from(sovLineItems)
        .where(eq(sovLineItems.sovId, newSOV.id));

      const totals = calculateSOVTotals(allLineItems, retainagePct);
      await db
        .update(scheduleOfValues)
        .set({
          ...totals,
          updatedAt: new Date(),
        })
        .where(eq(scheduleOfValues.id, newSOV.id));
    }

    const [createdSOV] = await db
      .select()
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.id, newSOV.id))
      .limit(1);

    const createdLineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, newSOV.id))
      .orderBy(sovLineItems.lineNumber);

    res.status(201).json({ ...createdSOV, lineItems: createdLineItems });
  } catch (error) {
    console.error("Create SOV error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateLineItemSchema = z.object({
  previouslyCompleted: z.string().or(z.number()).optional(),
  thisPeriodCompleted: z.string().or(z.number()).optional(),
  materialsStored: z.string().or(z.number()).optional(),
  notes: z.string().optional(),
});

router.patch("/sov/:sovId/line-items/:lineItemId", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]), async (req: AuthRequest, res: Response) => {
  try {
    const { sovId, lineItemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only update line items on DRAFT SOVs" });
    }

    const validationResult = updateLineItemSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const [lineItem] = await db
      .select()
      .from(sovLineItems)
      .where(and(
        eq(sovLineItems.id, lineItemId),
        eq(sovLineItems.sovId, sovId)
      ))
      .limit(1);

    if (!lineItem) {
      return res.status(404).json({ error: "Line item not found" });
    }

    const updates = validationResult.data;
    const scheduled = Math.max(0, Number(lineItem.scheduledValue) || 0);
    const previous = Math.max(0, Number(updates.previouslyCompleted ?? lineItem.previouslyCompleted ?? 0));
    const current = Math.max(0, Number(updates.thisPeriodCompleted ?? lineItem.thisPeriodCompleted ?? 0));
    const stored = Math.max(0, Number(updates.materialsStored ?? lineItem.materialsStored ?? 0));
    const retainagePct = Math.max(0, Math.min(100, Number(sov.retainagePercent || 10))) / 100;

    const totalCompleted = previous + current + stored;
    const percentComplete = scheduled > 0 ? Math.min(100, (totalCompleted / scheduled) * 100) : 0;
    const balance = Math.max(0, scheduled - totalCompleted);
    const retainageAmt = totalCompleted * retainagePct;

    const updated = await db.transaction(async (trx) => {
      const [updatedItem] = await trx
        .update(sovLineItems)
        .set({
          previouslyCompleted: String(previous),
          thisPeriodCompleted: String(current),
          materialsStored: String(stored),
          totalCompletedAndStored: String(totalCompleted),
          percentComplete: String(percentComplete.toFixed(2)),
          balanceToFinish: String(balance),
          retainageAmount: String(retainageAmt.toFixed(2)),
          notes: updates.notes ?? lineItem.notes,
          updatedAt: new Date(),
        })
        .where(eq(sovLineItems.id, lineItemId))
        .returning();

      const [sqlTotals] = await trx.execute(sql`
        SELECT 
          COALESCE(SUM(GREATEST(0, CAST(scheduled_value AS DECIMAL(14,2)))), 0) as total_scheduled_value,
          COALESCE(SUM(GREATEST(0, CAST(previously_completed AS DECIMAL(14,2)))), 0) as total_previously_completed,
          COALESCE(SUM(GREATEST(0, CAST(this_period_completed AS DECIMAL(14,2)))), 0) as total_this_period,
          COALESCE(SUM(GREATEST(0, CAST(materials_stored AS DECIMAL(14,2)))), 0) as total_materials_stored
        FROM sov_line_items
        WHERE sov_id = ${sovId}
        FOR UPDATE
      `);

      const totalScheduled = new Decimal(String(sqlTotals.total_scheduled_value || 0));
      const totalPrevious = new Decimal(String(sqlTotals.total_previously_completed || 0));
      const totalCurrent = new Decimal(String(sqlTotals.total_this_period || 0));
      const totalStored = new Decimal(String(sqlTotals.total_materials_stored || 0));
      
      const totalCompletedToDate = totalPrevious.plus(totalCurrent).plus(totalStored);
      const retainageFactor = new Decimal(retainagePct);
      const totalRetainage = totalCompletedToDate.times(retainageFactor);
      const totalEarnedLessRetainage = totalCompletedToDate.minus(totalRetainage);

      await trx
        .update(scheduleOfValues)
        .set({
          totalScheduledValue: totalScheduled.toFixed(2),
          totalPreviouslyCompleted: totalPrevious.toFixed(2),
          totalThisPeriod: totalCurrent.toFixed(2),
          totalMaterialsStored: totalStored.toFixed(2),
          totalCompletedToDate: totalCompletedToDate.toFixed(2),
          totalRetainage: totalRetainage.toFixed(2),
          totalEarnedLessRetainage: totalEarnedLessRetainage.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(scheduleOfValues.id, sovId));

      return updatedItem;
    });

    res.json(updated);
  } catch (error) {
    console.error("Update SOV line item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const validStatusTransitions: Record<string, { nextStates: string[]; allowedRoles: string[] }> = {
  DRAFT: { 
    nextStates: ["PENDING"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"]
  },
  PENDING: { 
    nextStates: ["APPROVED", "DRAFT"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"]
  },
  APPROVED: { 
    nextStates: ["SUBMITTED", "PENDING"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"] 
  },
  SUBMITTED: { 
    nextStates: ["PAID", "APPROVED"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"] 
  },
  PAID: { 
    nextStates: ["ARCHIVED"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"] 
  },
  ARCHIVED: { 
    nextStates: [], 
    allowedRoles: [] 
  },
};

const updateSOVStatusSchema = z.object({
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "SUBMITTED", "PAID", "ARCHIVED"]),
});

router.patch("/sov/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const validationResult = updateSOVStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { status: newStatus } = validationResult.data;
    const currentStatus = sov.status;
    const userRole = req.user?.role;

    if (!userRole) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const transition = validStatusTransitions[currentStatus];
    if (!transition) {
      return res.status(400).json({ error: `Invalid current status: ${currentStatus}` });
    }

    if (!transition.nextStates.includes(newStatus)) {
      return res.status(400).json({ 
        error: `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions: ${transition.nextStates.join(', ') || 'none'}` 
      });
    }

    if (!transition.allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: `Your role (${userRole}) cannot perform this status transition` 
      });
    }

    const updateData: any = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === "APPROVED") {
      updateData.approvedById = req.user?.id;
      updateData.approvedAt = new Date();
    } else if (newStatus === "SUBMITTED") {
      updateData.submittedAt = new Date();
    } else if (newStatus === "PAID") {
      updateData.paidAt = new Date();
    }

    const [updated] = await db
      .update(scheduleOfValues)
      .set(updateData)
      .where(eq(scheduleOfValues.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update SOV status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sov/:id/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const lineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, id))
      .orderBy(sovLineItems.lineNumber);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, sov.projectId))
      .limit(1);

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, sov.organizationId))
      .limit(1);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sov.sovNumber}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');

    const pdfStream = generateSOVPDF({
      sov,
      lineItems,
      project: project || { name: "Unknown Project", code: "N/A" },
      branding: org ? {
        organizationName: org.name,
        primaryColor: org.primaryColor || undefined,
        accentColor: org.accentColor || undefined,
      } : undefined,
    });

    pdfStream.on('error', (err) => {
      console.error("PDF stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate PDF" });
      }
    });

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Generate SOV PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/sov/:id", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(id, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only delete DRAFT SOVs. Change status to ARCHIVED instead." });
    }

    await db.delete(scheduleOfValues).where(eq(scheduleOfValues.id, id));

    res.json({ message: "SOV deleted successfully" });
  } catch (error) {
    console.error("Delete SOV error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
