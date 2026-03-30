/**
 * @openapi
 * /api/projects/{code}/sov:
 *   get:
 *     tags: [Financials]
 *     summary: Get schedule of values for a project
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Schedule of values with line items }
 *       404: { description: Project not found }
 *   post:
 *     tags: [Financials]
 *     summary: Create schedule of values
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               contractAmount: { type: string }
 *     responses:
 *       201: { description: SOV created }
 * /api/projects/{code}/sov/{sovId}/line-items:
 *   get:
 *     tags: [Financials]
 *     summary: Get SOV line items
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: sovId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of SOV line items }
 *   post:
 *     tags: [Financials]
 *     summary: Add SOV line item
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: sovId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description, scheduledValue]
 *             properties:
 *               description: { type: string }
 *               scheduledValue: { type: string }
 *               itemNumber: { type: string }
 *     responses:
 *       201: { description: Line item added }
 * /api/projects/{code}/sov/{sovId}/pay-app:
 *   post:
 *     tags: [Financials]
 *     summary: Generate AIA pay application
 *     description: Generates a G702/G703 pay application from the schedule of values.
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: sovId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pay application generated }
 */
import { logError } from "./utils/logger";
import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { scheduleOfValues, sovLineItems, projects, estimateLineItems, organizations, changeOrders, users, notifications, lienWaivers, sovPayments } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole, requireFeaturePermission } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { verifyProjectAccess, verifySOVAccess, calculateSOVTotals } from "./sovHelpers";
import { createApprovalRequest } from "./services/approvalService";
import { isFeatureEnabled } from "./services/featureFlagService";
import { generateSOVPDF } from "./sov-pdf-service";
import { insertNotifications } from "./services/notificationService";
import * as workflowEngine from "./services/workflowEngine";

const router = Router();

// ========================================
// Routes from sovRoutes.ts
// ========================================

router.use("/sov", requireAuth, requireFeaturePermission('canAccessFinancials'));

router.get("/sov", async (req: AuthRequest, res: Response) => {
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
    logError("Get SOVs error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get project SOVs error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get SOV projects error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get SOV error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create SOV error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Delete SOV error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from sovBillingRoutes.ts
// ========================================

router.get("/sov/co-tieout", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json({ changeOrders: [], sovSummary: [] });

    const coConditions: any[] = [eq(changeOrders.status, "APPROVED")];
    const sovConditions: any[] = [];

    if (shouldFilter && orgId) {
      sovConditions.push(eq(scheduleOfValues.organizationId, orgId));
    }

    const approvedCOs = await db.select({
      id: changeOrders.id,
      projectId: changeOrders.projectId,
      changeOrderNumber: changeOrders.changeOrderNumber,
      description: changeOrders.description,
      amount: changeOrders.amount,
      status: changeOrders.status,
      approvedAt: changeOrders.approvedAt,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(changeOrders)
    .innerJoin(projects, eq(changeOrders.projectId, projects.id))
    .where(coConditions.length > 0 ? and(...coConditions) : undefined)
    .orderBy(desc(changeOrders.approvedAt));

    const filteredCOs = shouldFilter && orgId
      ? approvedCOs.filter(co => {
          return true;
        })
      : approvedCOs;

    const sovSummary = await db.select({
      id: scheduleOfValues.id,
      projectId: scheduleOfValues.projectId,
      sovNumber: scheduleOfValues.sovNumber,
      title: scheduleOfValues.title,
      contractValue: scheduleOfValues.contractValue,
      totalScheduledValue: scheduleOfValues.totalScheduledValue,
      status: scheduleOfValues.status,
      projectName: projects.name,
      projectCode: projects.code,
    })
    .from(scheduleOfValues)
    .innerJoin(projects, eq(scheduleOfValues.projectId, projects.id))
    .where(sovConditions.length > 0 ? and(...sovConditions) : undefined)
    .orderBy(desc(scheduleOfValues.updatedAt));

    const projectMap: Record<string, { coTotal: number; sovTotal: number; contractValue: number; cos: any[]; sovs: any[] }> = {};

    for (const co of filteredCOs) {
      if (!projectMap[co.projectId]) {
        projectMap[co.projectId] = { coTotal: 0, sovTotal: 0, contractValue: 0, cos: [], sovs: [] };
      }
      projectMap[co.projectId].coTotal += parseFloat(co.amount || "0");
      projectMap[co.projectId].cos.push(co);
    }

    for (const sov of sovSummary) {
      if (!projectMap[sov.projectId]) {
        projectMap[sov.projectId] = { coTotal: 0, sovTotal: 0, contractValue: 0, cos: [], sovs: [] };
      }
      projectMap[sov.projectId].sovTotal += parseFloat(sov.totalScheduledValue || "0");
      projectMap[sov.projectId].contractValue = parseFloat(sov.contractValue || "0");
      projectMap[sov.projectId].sovs.push(sov);
    }

    const reconciliation = Object.entries(projectMap).map(([projectId, data]) => {
      const expectedSovTotal = data.contractValue + data.coTotal;
      const variance = data.sovTotal - expectedSovTotal;
      return {
        projectId,
        projectName: data.cos[0]?.projectName || data.sovs[0]?.projectName || "Unknown",
        projectCode: data.cos[0]?.projectCode || data.sovs[0]?.projectCode || "",
        contractValue: data.contractValue,
        approvedCOTotal: data.coTotal,
        expectedSovTotal,
        actualSovTotal: data.sovTotal,
        variance,
        isReconciled: Math.abs(variance) < 0.01,
        changeOrderCount: data.cos.length,
        sovCount: data.sovs.length,
        changeOrders: data.cos,
        sovs: data.sovs,
      };
    });

    res.json(reconciliation);
  } catch (error) {
    logError("CO tie-out error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch CO tie-out data" });
  }
});

const validStatusTransitions: Record<string, { nextStates: string[]; allowedRoles: string[] }> = {
  DRAFT: { 
    nextStates: ["PENDING", "SUBMITTED"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"]
  },
  PENDING: { 
    nextStates: ["APPROVED", "DRAFT", "UNDER_REVIEW"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  UNDER_REVIEW: {
    nextStates: ["APPROVED", "REJECTED", "PENDING"],
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  APPROVED: { 
    nextStates: ["SUBMITTED", "PENDING"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] 
  },
  SUBMITTED: { 
    nextStates: ["PAID", "APPROVED", "UNDER_REVIEW"], 
    allowedRoles: ["SUPER_ADMIN", "ADMIN"] 
  },
  REJECTED: {
    nextStates: ["DRAFT", "PENDING"],
    allowedRoles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "OFFICE_MANAGER"]
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
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "SUBMITTED", "PAID", "ARCHIVED", "UNDER_REVIEW", "REJECTED"]),
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

    if (req.user?.organizationId && (newStatus === "APPROVED" || newStatus === "REJECTED")) {
      const delegation = await workflowEngine.delegateEntityTransition(
        req.user.organizationId,
        "SOV_PAY_APP",
        id,
        req.user.id,
        req.user.role || "WORKER",
        newStatus,
        `SOV status changed to ${newStatus}`
      );
      if (delegation.delegated) {
        if (delegation.needsMoreApprovals) {
          return res.status(202).json({ message: delegation.error, needsMoreApprovals: true });
        }
        if (!delegation.success) {
          return res.status(400).json({ error: delegation.error || "Workflow transition failed" });
        }
      }
    }

    const updateData: Record<string, unknown> = {
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

    if (newStatus === "SUBMITTED" && req.user?.organizationId) {
      try {
        const approvalsEnabled = await isFeatureEnabled(req.user.organizationId, "APPROVALS_FRAMEWORK");
        if (approvalsEnabled) {
          await createApprovalRequest(
            req.user.organizationId,
            "SOV_PAY_APP",
            id,
            req.user.id,
            `SOV/Pay App submitted for approval`
          );
        }
      } catch (e) { /* non-blocking */ }

      try {
        await workflowEngine.startWorkflow(
          req.user.organizationId,
          "SOV_PAY_APP",
          id,
          req.user.id
        );
      } catch (e) { /* non-blocking */ }
    }

    res.json(updated);
  } catch (error) {
    logError("Update SOV status error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/sov/:id/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const billingMode = (req.query.billingMode as string) || 'all';
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

    const modeLabel = billingMode !== 'all' ? `-${billingMode}` : '';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sov.sovNumber}${modeLabel}.pdf"`);
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
      billingMode: billingMode as any,
    });

    pdfStream.on('error', (err) => {
      logError("PDF stream error:", {}, err instanceof Error ? err : new Error(String(err)));
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate PDF" });
      }
    });

    pdfStream.pipe(res);
  } catch (error) {
    logError("Generate SOV PDF error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.post("/sov/:id/send", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { email, billingMode = 'all' } = req.body;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: "Recipient email is required" });
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

    const pdfStream = generateSOVPDF({
      sov,
      lineItems,
      project: project || { name: "Unknown Project", code: "N/A" },
      branding: org ? {
        organizationName: org.name,
        primaryColor: org.primaryColor || undefined,
        accentColor: org.accentColor || undefined,
      } : undefined,
      billingMode: billingMode as any,
    });

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      pdfStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfStream.on('end', resolve);
      pdfStream.on('error', reject);
    });
    const pdfBuffer = Buffer.concat(chunks);

    const billingLabels: Record<string, string> = {
      all: 'All Categories',
      material: 'Material Only',
      labor: 'Labor Only',
      material_labor: 'Material + Labor',
    };
    const billingLabel = billingLabels[billingMode] || 'All Categories';
    const orgName = org?.name || 'SmartManageAI';
    const projectName = project?.name || 'Unknown Project';

    const { sendEmail: sendEmailFn } = await import('./email');

    const modeLabel = billingMode !== 'all' ? `-${billingMode}` : '';
    const pdfFilename = `${sov.sovNumber}${modeLabel}.pdf`;

    const sent = await sendEmailFn({
      to: email,
      subject: `${orgName} - Schedule of Values: ${sov.sovNumber} (${billingLabel})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a365d;">Schedule of Values - Billing Breakdown</h2>
          <p>Please find the attached Schedule of Values billing breakdown.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">SOV Number</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${sov.sovNumber}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Project</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${projectName}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Billing Type</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${billingLabel}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Status</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${sov.status}</td></tr>
          </table>
          <p style="color: #6b7280; font-size: 12px;">This email was sent from ${orgName} via SmartManageAI.</p>
        </div>
      `,
      text: `Schedule of Values ${sov.sovNumber} - ${billingLabel}\nProject: ${projectName}\nStatus: ${sov.status}`,
      attachments: [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    if (!sent) {
      return res.status(500).json({ error: "Failed to send email. Please try downloading the PDF instead." });
    }

    res.json({ success: true, message: `PDF sent to ${email}` });
  } catch (error) {
    logError("Send SOV PDF error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from sovLineItemRoutes.ts
// ========================================

const addLineItemSchema = z.object({
  description: z.string(),
  scheduledValue: z.string().or(z.number()),
  itemCode: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
  estimateLineItemId: z.string().optional(),
  organizationSowItemId: z.string().optional(),
});

router.post("/sov/:id/items", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id: sovId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const validationResult = addLineItemSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { description, scheduledValue, itemCode, category, notes, estimateLineItemId, organizationSowItemId } = validationResult.data;

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only add line items to DRAFT SOVs" });
    }

    const existingItems = await db
      .select({ maxLine: sql<number>`COALESCE(MAX(line_number), 0)` })
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, sovId));

    const nextLineNumber = (existingItems[0]?.maxLine || 0) + 1;
    const scheduled = Math.max(0, Number(scheduledValue) || 0);
    const retainagePct = Math.max(0, Math.min(100, Number(sov.retainagePercent || 10))) / 100;

    let resolvedSowItemId = organizationSowItemId || null;
    if (!resolvedSowItemId && estimateLineItemId) {
      const [estItem] = await db
        .select({ organizationSowItemId: estimateLineItems.organizationSowItemId })
        .from(estimateLineItems)
        .where(eq(estimateLineItems.id, estimateLineItemId))
        .limit(1);
      if (estItem?.organizationSowItemId) {
        resolvedSowItemId = estItem.organizationSowItemId;
      }
    }

    const [newItem] = await db
      .insert(sovLineItems)
      .values({
        sovId,
        lineNumber: nextLineNumber,
        itemCode: itemCode || null,
        description,
        category: category || null,
        scheduledValue: String(scheduled),
        previouslyCompleted: "0",
        thisPeriodCompleted: "0",
        materialsStored: "0",
        totalCompletedAndStored: "0",
        percentComplete: "0",
        balanceToFinish: String(scheduled),
        retainageAmount: "0",
        notes: notes || null,
        estimateLineItemId: estimateLineItemId || null,
        organizationSowItemId: resolvedSowItemId,
      })
      .returning();

    const allLineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, sovId));

    const totals = calculateSOVTotals(allLineItems, retainagePct);

    await db
      .update(scheduleOfValues)
      .set({
        ...totals,
        updatedAt: new Date(),
      })
      .where(eq(scheduleOfValues.id, sovId));

    res.status(201).json(newItem);
  } catch (error) {
    logError("Add SOV line item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/sov/:sovId/items/:itemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { sovId, itemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only delete line items from DRAFT SOVs" });
    }

    const [deletedItem] = await db
      .delete(sovLineItems)
      .where(
        and(
          eq(sovLineItems.id, itemId),
          eq(sovLineItems.sovId, sovId)
        )
      )
      .returning();

    if (!deletedItem) {
      return res.status(404).json({ error: "Line item not found" });
    }

    const allLineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, sovId));

    const retainagePct = Math.max(0, Math.min(100, Number(sov.retainagePercent || 10))) / 100;
    const totals = calculateSOVTotals(allLineItems, retainagePct);

    await db
      .update(scheduleOfValues)
      .set({
        ...totals,
        updatedAt: new Date(),
      })
      .where(eq(scheduleOfValues.id, sovId));

    res.json({ success: true });
  } catch (error) {
    logError("Delete SOV line item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateLineItemSchema = z.object({
  previouslyCompleted: z.string().or(z.number()).optional(),
  thisPeriodCompleted: z.string().or(z.number()).optional(),
  materialsStored: z.string().or(z.number()).optional(),
  notes: z.string().optional(),
});

router.patch("/sov/:sovId/line-items/:lineItemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
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

    const result = await db.execute(sql`
      WITH locked_item AS (
        SELECT 
          id,
          COALESCE(CAST(previously_completed AS DECIMAL(14,2)), 0) as old_previous,
          COALESCE(CAST(this_period_completed AS DECIMAL(14,2)), 0) as old_current,
          COALESCE(CAST(materials_stored AS DECIMAL(14,2)), 0) as old_stored
        FROM sov_line_items 
        WHERE id = ${lineItemId} 
        FOR UPDATE
      ),
      deltas AS (
        SELECT
          ${previous} - old_previous as delta_previous,
          ${current} - old_current as delta_current,
          ${stored} - old_stored as delta_stored,
          (${previous} - old_previous) + (${current} - old_current) + (${stored} - old_stored) as delta_total
        FROM locked_item
      ),
      updated_line_item AS (
        UPDATE sov_line_items
        SET 
          previously_completed = ${String(previous)},
          this_period_completed = ${String(current)},
          materials_stored = ${String(stored)},
          total_completed_and_stored = ${String(totalCompleted)},
          percent_complete = ${String(percentComplete.toFixed(2))},
          balance_to_finish = ${String(balance)},
          retainage_amount = ${String(retainageAmt.toFixed(2))},
          notes = ${updates.notes ?? lineItem.notes ?? null},
          updated_at = NOW()
        WHERE id = ${lineItemId}
        RETURNING *
      ),
      updated_sov AS (
        UPDATE schedule_of_values
        SET 
          total_previously_completed = GREATEST(0, 
            COALESCE(CAST(schedule_of_values.total_previously_completed AS DECIMAL(14,2)), 0) + deltas.delta_previous
          )::text,
          total_this_period = GREATEST(0,
            COALESCE(CAST(schedule_of_values.total_this_period AS DECIMAL(14,2)), 0) + deltas.delta_current
          )::text,
          total_materials_stored = GREATEST(0,
            COALESCE(CAST(schedule_of_values.total_materials_stored AS DECIMAL(14,2)), 0) + deltas.delta_stored
          )::text,
          total_completed_to_date = GREATEST(0,
            COALESCE(CAST(schedule_of_values.total_completed_to_date AS DECIMAL(14,2)), 0) + deltas.delta_total
          )::text,
          total_retainage = ROUND(
            GREATEST(0, COALESCE(CAST(schedule_of_values.total_completed_to_date AS DECIMAL(14,2)), 0) + deltas.delta_total) * ${retainagePct}
          , 2)::text,
          total_earned_less_retainage = ROUND(
            GREATEST(0, COALESCE(CAST(schedule_of_values.total_completed_to_date AS DECIMAL(14,2)), 0) + deltas.delta_total) * (1 - ${retainagePct})
          , 2)::text,
          updated_at = NOW()
        FROM deltas
        WHERE schedule_of_values.id = ${sovId}
        RETURNING schedule_of_values.*
      )
      SELECT * FROM updated_line_item
    `);

    const rows = result.rows as Record<string, unknown>[];
    const updated = rows[0] || lineItem;

    const oldPercent = Number(lineItem.percentComplete || 0);
    if (percentComplete >= 100 && oldPercent < 100) {
      try {
        const [project] = await db
          .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
          .from(projects)
          .where(eq(projects.id, sov.projectId))
          .limit(1);

        if (project?.gcOrganizationId) {
          const officeManagers = await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.organizationId, project.gcOrganizationId),
                eq(users.role, "OFFICE_MANAGER"),
                eq(users.isActive, true)
              )
            );

          if (officeManagers.length > 0) {
            const formattedValue = `$${Number(lineItem.scheduledValue || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
            const sovNotifs = officeManagers.map((mgr) => ({
              userId: mgr.id,
              type: "SOV_ITEM_COMPLETED" as const,
              title: "SOV Line Item 100% Complete",
              message: `"${lineItem.description}" (${formattedValue}) is fully complete on ${sov.title} - project ${project.code || "Unknown"}`,
              relatedEntityId: project.id,
              relatedEntityType: "project" as const,
            }));
            await insertNotifications(sovNotifs);
          }
        }
      } catch (notifError) {
        logError("Failed to create SOV completion notification:", {}, notifError instanceof Error ? notifError : new Error(String(notifError)));
      }
    }

    res.json(updated);
  } catch (error) {
    logError("Update SOV line item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from sovPaymentRoutes.ts
// ========================================

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
    logError("Get lien waivers error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create lien waiver error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Update lien waiver error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Get SOV payments error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Create SOV payment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create payment" });
  }
});

export default router;
