import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  scheduleOfValues, 
  sovLineItems, 
  projects, 
  estimateLineItems,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { verifyProjectAccess, verifySOVAccess, calculateSOVTotals } from "./sovHelpers";

const router = Router();

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

    const sovsWithLineItems = await Promise.all(
      sovList.map(async (sov) => {
        const lineItems = await db
          .select()
          .from(sovLineItems)
          .where(eq(sovLineItems.sovId, sov.id))
          .orderBy(sovLineItems.lineNumber);
        return { ...sov, lineItems };
      })
    );

    res.json(sovsWithLineItems);
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

router.get("/sov/projects", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        clientName: projects.clientName,
        contractAmount: projects.contractAmount,
      })
      .from(projects);

    if (shouldFilter && orgId) {
      query = query.where(eq(projects.gcOrganizationId, orgId)) as typeof query;
    }

    const projectList = await query.orderBy(desc(projects.createdAt));

    res.json(projectList);
  } catch (error) {
    console.error("Get SOV projects error:", error);
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
  contractValue: z.string().or(z.number()).optional(),
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
    estimateLineItemId: z.string().optional(),
    organizationSowItemId: z.string().optional(),
  })).optional(),
});

router.post("/sov", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
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
        contractValue: contractValue !== undefined ? String(contractValue) : (project.contractAmount || "0"),
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
          estimateLineItemId: (item as any).estimateLineItemId || null,
          organizationSowItemId: (item as any).organizationSowItemId || null,
        };
      });

      for (const lineItem of lineItemsToInsert) {
        if (!lineItem.organizationSowItemId && lineItem.estimateLineItemId) {
          const [estItem] = await db
            .select({ organizationSowItemId: estimateLineItems.organizationSowItemId })
            .from(estimateLineItems)
            .where(eq(estimateLineItems.id, lineItem.estimateLineItemId))
            .limit(1);
          if (estItem?.organizationSowItemId) {
            lineItem.organizationSowItemId = estItem.organizationSowItemId;
          }
        }
      }

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

router.delete("/sov/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
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
