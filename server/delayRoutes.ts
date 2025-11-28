import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { 
  projectDelays, projects, changeOrders, users, notifications,
  insertProjectDelaySchema, type ProjectDelay
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";

const router = Router();

const DELAY_REASON_LABELS: Record<string, string> = {
  WEATHER: "Weather",
  GC_SCHEDULING: "GC Scheduling",
  OTHER_CONTRACTORS: "Other Contractors",
  MATERIAL_DELIVERY: "Material Delivery",
  PERMIT_ISSUES: "Permit Issues",
  INSPECTION_DELAY: "Inspection Delay",
  OWNER_DIRECTIVE: "Owner Directive",
  DESIGN_CHANGES: "Design Changes",
  SITE_CONDITIONS: "Site Conditions",
  LABOR_SHORTAGE: "Labor Shortage",
  OTHER: "Other"
};

const RESPONSIBILITY_LABELS: Record<string, string> = {
  OWNER: "Owner",
  GC: "General Contractor",
  SUBCONTRACTOR: "Subcontractor",
  TFR: "TFR Construction",
  FORCE_MAJEURE: "Force Majeure (Weather/Act of God)"
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["DRAFT", "ACKNOWLEDGED"],
  ACKNOWLEDGED: ["RESOLVED"],
  RESOLVED: []
};

function isValidTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

async function getDelayById(id: string) {
  const [delay] = await db
    .select()
    .from(projectDelays)
    .where(eq(projectDelays.id, id))
    .limit(1);
  return delay;
}

async function generateDelayNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectDelays)
    .innerJoin(projects, eq(projectDelays.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  
  const count = result?.count || 0;
  return `DLY-${projectCode}-${String(count + 1).padStart(3, '0')}`;
}

async function notifyDelayStatusChange(
  delay: any,
  project: any,
  newStatus: string,
  message: string,
  tx?: DbTransaction
) {
  const dbClient = tx || db;
  const notificationsToCreate: any[] = [];

  if (newStatus === "SUBMITTED") {
    const managersAndAdmins = await dbClient
      .select()
      .from(users)
      .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);

    managersAndAdmins.forEach((user: any) => {
      notificationsToCreate.push({
        userId: user.id,
        type: "DELAY_SUBMITTED" as const,
        title: "Delay Report Submitted",
        message: `Delay ${delay.delayNumber} on project ${project.name}: ${message}`,
        relatedEntityId: delay.id,
        relatedEntityType: "projectDelay",
      });
    });

    if (project.superintendentId && !managersAndAdmins.some((u: any) => u.id === project.superintendentId)) {
      notificationsToCreate.push({
        userId: project.superintendentId,
        type: "DELAY_SUBMITTED" as const,
        title: "Delay Report Submitted",
        message: `Delay ${delay.delayNumber} on project ${project.name}: ${message}`,
        relatedEntityId: delay.id,
        relatedEntityType: "projectDelay",
      });
    }
  }

  if (newStatus === "ACKNOWLEDGED") {
    notificationsToCreate.push({
      userId: delay.createdById,
      type: "DELAY_ACKNOWLEDGED" as const,
      title: "Delay Acknowledged",
      message: `Delay ${delay.delayNumber} has been acknowledged`,
      relatedEntityId: delay.id,
      relatedEntityType: "projectDelay",
    });
  }

  if (delay.changeOrderRequired && !delay.linkedChangeOrderId) {
    const managersAndAdmins = await dbClient
      .select()
      .from(users)
      .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);

    managersAndAdmins.forEach((user: any) => {
      notificationsToCreate.push({
        userId: user.id,
        type: "DELAY_CHANGE_ORDER_NEEDED" as const,
        title: "Change Order Required for Delay",
        message: `Delay ${delay.delayNumber} on ${project.name} requires a change order`,
        relatedEntityId: delay.id,
        relatedEntityType: "projectDelay",
      });
    });
  }

  if (notificationsToCreate.length > 0) {
    await dbClient.insert(notifications).values(notificationsToCreate);
  }
}

router.get("/projects/:projectId/delays", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status, reason } = req.query;

    const conditions = [eq(projectDelays.projectId, projectId)];
    
    if (status && typeof status === 'string') {
      conditions.push(eq(projectDelays.status, status as any));
    }
    if (reason && typeof reason === 'string') {
      conditions.push(eq(projectDelays.reason, reason as any));
    }

    const delays = await db
      .select()
      .from(projectDelays)
      .where(and(...conditions))
      .orderBy(desc(projectDelays.createdAt));

    const enrichedDelays = delays.map(delay => ({
      ...delay,
      reasonLabel: DELAY_REASON_LABELS[delay.reason] || delay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible
    }));

    res.json(enrichedDelays);
  } catch (error) {
    console.error("Error fetching project delays:", error);
    res.status(500).json({ error: "Failed to fetch delays" });
  }
});

router.post("/projects/:projectId/delays", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const delayNumber = await generateDelayNumber(project.code);

    const sanitizedBody = {
      ...req.body,
      projectId,
      delayNumber,
      createdById: userId,
      reasonNotes: req.body.reasonNotes ? sanitizeText(req.body.reasonNotes) : null,
      proceedToWorkNotes: req.body.proceedToWorkNotes ? sanitizeText(req.body.proceedToWorkNotes) : null,
      ownerRepName: req.body.ownerRepName ? sanitizeShortText(req.body.ownerRepName) : null,
      gcRepName: req.body.gcRepName ? sanitizeShortText(req.body.gcRepName) : null,
      startDateTime: req.body.startDateTime ? new Date(req.body.startDateTime) : undefined,
      endDateTime: req.body.endDateTime ? new Date(req.body.endDateTime) : null,
      proceedToWorkDate: req.body.proceedToWorkDate ? new Date(req.body.proceedToWorkDate) : null,
    };

    const validationResult = insertProjectDelaySchema.safeParse(sanitizedBody);

    if (!validationResult.success) {
      res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.format() 
      });
      return;
    }

    const [newDelay] = await db
      .insert(projectDelays)
      .values(validationResult.data)
      .returning();

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "projectDelay",
      entityId: newDelay.id,
      newValue: JSON.stringify({ delayNumber, reason: newDelay.reason, projectId }),
    }, req);

    res.status(201).json({
      ...newDelay,
      reasonLabel: DELAY_REASON_LABELS[newDelay.reason] || newDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[newDelay.financiallyResponsible] || newDelay.financiallyResponsible
    });
  } catch (error) {
    console.error("Error creating delay:", error);
    res.status(500).json({ error: "Failed to create delay" });
  }
});

router.get("/delays/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    let linkedChangeOrder = null;
    if (delay.linkedChangeOrderId) {
      [linkedChangeOrder] = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.id, delay.linkedChangeOrderId))
        .limit(1);
    }

    res.json({
      ...delay,
      reasonLabel: DELAY_REASON_LABELS[delay.reason] || delay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible,
      linkedChangeOrder
    });
  } catch (error) {
    console.error("Error fetching delay:", error);
    res.status(500).json({ error: "Failed to fetch delay" });
  }
});

router.patch("/delays/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (delay.status !== "DRAFT") {
      res.status(400).json({ error: "Can only edit delays in DRAFT status" });
      return;
    }

    const updateData: any = {
      updatedAt: new Date()
    };

    if (req.body.reason !== undefined) updateData.reason = req.body.reason;
    if (req.body.reasonNotes !== undefined) updateData.reasonNotes = sanitizeText(req.body.reasonNotes);
    if (req.body.startDateTime !== undefined) updateData.startDateTime = new Date(req.body.startDateTime);
    if (req.body.endDateTime !== undefined) updateData.endDateTime = req.body.endDateTime ? new Date(req.body.endDateTime) : null;
    if (req.body.estimatedDuration !== undefined) updateData.estimatedDuration = req.body.estimatedDuration;
    if (req.body.ownerRepContactId !== undefined) updateData.ownerRepContactId = req.body.ownerRepContactId;
    if (req.body.gcRepContactId !== undefined) updateData.gcRepContactId = req.body.gcRepContactId;
    if (req.body.ownerRepName !== undefined) updateData.ownerRepName = sanitizeShortText(req.body.ownerRepName);
    if (req.body.gcRepName !== undefined) updateData.gcRepName = sanitizeShortText(req.body.gcRepName);
    if (req.body.financiallyResponsible !== undefined) updateData.financiallyResponsible = req.body.financiallyResponsible;
    if (req.body.changeOrderRequired !== undefined) updateData.changeOrderRequired = req.body.changeOrderRequired;
    if (req.body.proceedToWorkDate !== undefined) updateData.proceedToWorkDate = req.body.proceedToWorkDate ? new Date(req.body.proceedToWorkDate) : null;
    if (req.body.proceedToWorkNotes !== undefined) updateData.proceedToWorkNotes = sanitizeText(req.body.proceedToWorkNotes);
    if (req.body.proofFileId !== undefined) updateData.proofFileId = req.body.proofFileId;
    if (req.body.proofFileName !== undefined) updateData.proofFileName = req.body.proofFileName;
    if (req.body.proofFileUrl !== undefined) updateData.proofFileUrl = req.body.proofFileUrl;
    if (req.body.proceedToWorkFileUrl !== undefined) updateData.proceedToWorkFileUrl = req.body.proceedToWorkFileUrl;

    const [updatedDelay] = await db
      .update(projectDelays)
      .set(updateData)
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      newValue: JSON.stringify({ changes: Object.keys(updateData) }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    console.error("Error updating delay:", error);
    res.status(500).json({ error: "Failed to update delay" });
  }
});

router.post("/delays/:id/submit", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "SUBMITTED")) {
      res.status(400).json({ 
        error: `Cannot submit delay from ${delay.status} status` 
      });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    const now = new Date();
    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now
      })
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await notifyDelayStatusChange(
      updatedDelay,
      project,
      "SUBMITTED",
      `${DELAY_REASON_LABELS[updatedDelay.reason]} - ${updatedDelay.reasonNotes || 'No details'}`
    );

    await logAudit({
      userId,
      action: "SUBMIT",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "SUBMITTED" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    console.error("Error submitting delay:", error);
    res.status(500).json({ error: "Failed to submit delay" });
  }
});

router.post("/delays/:id/acknowledge", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "ACKNOWLEDGED")) {
      res.status(400).json({ 
        error: `Cannot acknowledge delay from ${delay.status} status` 
      });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    const now = new Date();
    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        status: "ACKNOWLEDGED",
        acknowledgedById: userId,
        acknowledgedAt: now,
        updatedAt: now
      })
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await notifyDelayStatusChange(
      updatedDelay,
      project,
      "ACKNOWLEDGED",
      "Delay has been acknowledged by management"
    );

    await logAudit({
      userId,
      action: "APPROVE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "ACKNOWLEDGED" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    console.error("Error acknowledging delay:", error);
    res.status(500).json({ error: "Failed to acknowledge delay" });
  }
});

router.post("/delays/:id/resolve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "RESOLVED")) {
      res.status(400).json({ 
        error: `Cannot resolve delay from ${delay.status} status. Must be acknowledged first.` 
      });
      return;
    }

    const now = new Date();
    const updateData: any = {
      status: "RESOLVED",
      resolvedAt: now,
      updatedAt: now
    };

    if (!delay.endDateTime) {
      updateData.endDateTime = now;
    }

    if (req.body.proceedToWorkDate) {
      updateData.proceedToWorkDate = new Date(req.body.proceedToWorkDate);
    }
    if (req.body.proceedToWorkNotes) {
      updateData.proceedToWorkNotes = sanitizeText(req.body.proceedToWorkNotes);
    }
    if (req.body.proceedToWorkFileUrl) {
      updateData.proceedToWorkFileUrl = req.body.proceedToWorkFileUrl;
    }

    const [updatedDelay] = await db
      .update(projectDelays)
      .set(updateData)
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "RESOLVED" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    console.error("Error resolving delay:", error);
    res.status(500).json({ error: "Failed to resolve delay" });
  }
});

router.post("/delays/:id/create-change-order", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (delay.linkedChangeOrderId) {
      res.status(400).json({ error: "A change order is already linked to this delay" });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(changeOrders)
      .where(eq(changeOrders.projectId, delay.projectId));
    
    const count = countResult?.count || 0;
    const changeOrderNumber = `CO-${project.code}-${String(count + 1).padStart(3, '0')}`;

    const startDate = new Date(delay.startDateTime).toLocaleDateString();
    const endDate = delay.endDateTime ? new Date(delay.endDateTime).toLocaleDateString() : 'Ongoing';
    const description = `Delay: ${DELAY_REASON_LABELS[delay.reason]}\n` +
      `Period: ${startDate} - ${endDate}\n` +
      `Financially Responsible: ${RESPONSIBILITY_LABELS[delay.financiallyResponsible]}\n` +
      `Details: ${delay.reasonNotes || 'N/A'}\n\n` +
      `Created from Delay Record: ${delay.delayNumber}`;

    const [newChangeOrder] = await db
      .insert(changeOrders)
      .values({
        projectId: delay.projectId,
        changeOrderNumber,
        description,
        amount: req.body.estimatedAmount || "0",
        status: "DRAFT",
        requestedById: userId
      })
      .returning();

    await db
      .update(projectDelays)
      .set({
        linkedChangeOrderId: newChangeOrder.id,
        updatedAt: new Date()
      })
      .where(eq(projectDelays.id, delay.id));

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "changeOrder",
      entityId: newChangeOrder.id,
      newValue: JSON.stringify({ 
        fromDelay: delay.id, 
        delayNumber: delay.delayNumber,
        changeOrderNumber 
      }),
    }, req);

    res.status(201).json(newChangeOrder);
  } catch (error) {
    console.error("Error creating change order from delay:", error);
    res.status(500).json({ error: "Failed to create change order" });
  }
});

router.post("/delays/:id/revert-to-draft", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "DRAFT")) {
      res.status(400).json({ 
        error: `Cannot revert delay from ${delay.status} status` 
      });
      return;
    }

    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        status: "DRAFT",
        submittedAt: null,
        updatedAt: new Date()
      })
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "DRAFT", action: "revert" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    console.error("Error reverting delay to draft:", error);
    res.status(500).json({ error: "Failed to revert delay" });
  }
});

router.get("/delays/dashboard/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const activeDelays = await db
      .select({
        id: projectDelays.id,
        delayNumber: projectDelays.delayNumber,
        reason: projectDelays.reason,
        status: projectDelays.status,
        startDateTime: projectDelays.startDateTime,
        changeOrderRequired: projectDelays.changeOrderRequired,
        linkedChangeOrderId: projectDelays.linkedChangeOrderId,
        projectId: projectDelays.projectId,
        projectName: projects.name,
        projectCode: projects.code
      })
      .from(projectDelays)
      .innerJoin(projects, eq(projectDelays.projectId, projects.id))
      .where(sql`${projectDelays.status} != 'RESOLVED'`)
      .orderBy(desc(projectDelays.createdAt))
      .limit(10);

    const pendingAcknowledgment = activeDelays.filter(d => d.status === "SUBMITTED");
    const needsChangeOrder = activeDelays.filter(d => d.changeOrderRequired && !d.linkedChangeOrderId);

    const [totalActiveResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectDelays)
      .where(sql`${projectDelays.status} != 'RESOLVED'`);

    res.json({
      totalActive: totalActiveResult?.count || 0,
      pendingAcknowledgment: pendingAcknowledgment.length,
      needsChangeOrder: needsChangeOrder.length,
      recentDelays: activeDelays.map(d => ({
        ...d,
        reasonLabel: DELAY_REASON_LABELS[d.reason] || d.reason
      }))
    });
  } catch (error) {
    console.error("Error fetching delay dashboard summary:", error);
    res.status(500).json({ error: "Failed to fetch delay summary" });
  }
});

export default router;
