import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { 
  projectDelays, projects, changeOrders, users, notifications, delayNotifications,
  insertProjectDelaySchema, insertDelayNotificationSchema, type ProjectDelay
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { generateDelayNotificationPDF } from "./pdf-service";
import { getOrgIdForFilter } from "./orgFilter";

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
  TFR: "Contractor (Self)",
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
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const { projectId } = req.params;
    const { status, reason } = req.query;

    // Verify project exists and check org access
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.json([]);
    }

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

// ==================== DELAY NOTIFICATION ROUTES ====================

function generateNotificationEmailContent(
  delay: any,
  project: any,
  recipientType: "OWNER_REP" | "GC_REP" | "OTHER"
): { subject: string; body: string } {
  const reasonLabel = DELAY_REASON_LABELS[delay.reason] || delay.reason;
  const responsibilityLabel = RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible;
  const startDate = new Date(delay.startDateTime).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const endDate = delay.endDateTime 
    ? new Date(delay.endDateTime).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : null;

  const subject = `Project Delay Notification - ${project.name} (${delay.delayNumber})`;

  const recipientRole = recipientType === "OWNER_REP" ? "Owner's Representative" 
    : recipientType === "GC_REP" ? "General Contractor" 
    : "Responsible Party";

  let body = `Dear ${recipientRole},

This letter serves as formal notification of a project delay affecting the ${project.name} project (Project Code: ${project.code}).

DELAY SUMMARY:
Reference Number: ${delay.delayNumber}
Reason for Delay: ${reasonLabel}
Start Date: ${startDate}${endDate ? `\nEnd Date: ${endDate}` : '\nStatus: Ongoing'}
Financially Responsible Party: ${responsibilityLabel}${delay.changeOrderRequired ? '\n\nIMPORTANT: This delay will require a Change Order for associated costs.' : ''}

${delay.reasonNotes ? `DETAILS:\n${delay.reasonNotes}\n` : ''}
PROJECT INFORMATION:
Project Name: ${project.name}
Project Code: ${project.code}
Location: ${[project.locationAddress, project.city, project.state].filter(Boolean).join(', ') || 'N/A'}
Client: ${project.clientName}

We are documenting this delay in accordance with contract requirements and industry best practices. This notification is intended to preserve all parties' rights and to maintain clear communication regarding project timeline impacts.

Please acknowledge receipt of this notification at your earliest convenience. Should you have any questions or require additional information regarding this delay, please do not hesitate to contact our office.

We appreciate your understanding and cooperation in addressing this matter. We remain committed to minimizing the impact of this delay and completing the project to the highest standards.`;

  return { subject, body };
}

router.post("/delays/:id/notifications/generate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { recipientType, recipientName, recipientCompany, recipientEmail } = req.body;

    if (!recipientType || !["OWNER_REP", "GC_REP", "OTHER"].includes(recipientType)) {
      res.status(400).json({ error: "Invalid recipient type" });
      return;
    }

    if (!recipientName || typeof recipientName !== "string" || recipientName.trim().length === 0) {
      res.status(400).json({ error: "Recipient name is required" });
      return;
    }

    const delay = await getDelayById(id);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
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

    const { subject, body } = generateNotificationEmailContent(delay, project, recipientType);
    
    const sanitizedRecipientName = sanitizeShortText(recipientName);
    if (!sanitizedRecipientName) {
      res.status(400).json({ error: "Recipient name is required" });
      return;
    }

    const [notification] = await db
      .insert(delayNotifications)
      .values({
        delayId: id as string,
        recipientType: recipientType as "OWNER_REP" | "GC_REP" | "OTHER",
        recipientName: sanitizedRecipientName,
        recipientCompany: recipientCompany ? sanitizeShortText(recipientCompany) : null,
        recipientEmail: recipientEmail ? sanitizeShortText(recipientEmail) : null,
        subject,
        body,
        status: "DRAFT" as const,
        createdById: userId,
      })
      .returning();

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "delayNotification",
      entityId: notification.id,
      newValue: JSON.stringify({ delayId: id, recipientType, recipientName }),
    }, req);

    res.status(201).json(notification);
  } catch (error) {
    console.error("Error generating delay notification:", error);
    res.status(500).json({ error: "Failed to generate notification" });
  }
});

router.get("/delays/:id/notifications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const delay = await getDelayById(id);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    const notificationsList = await db
      .select()
      .from(delayNotifications)
      .where(eq(delayNotifications.delayId, id))
      .orderBy(desc(delayNotifications.createdAt));

    res.json(notificationsList);
  } catch (error) {
    console.error("Error fetching delay notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.get("/delays/:delayId/notifications/:notificationId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json(notification);
  } catch (error) {
    console.error("Error fetching notification:", error);
    res.status(500).json({ error: "Failed to fetch notification" });
  }
});

router.patch("/delays/:delayId/notifications/:notificationId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;
    const userId = req.user!.id;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.status === "FINALIZED") {
      res.status(400).json({ error: "Cannot edit a finalized notification" });
      return;
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (req.body.recipientName) {
      updateData.recipientName = sanitizeShortText(req.body.recipientName);
    }
    if (req.body.recipientCompany !== undefined) {
      updateData.recipientCompany = req.body.recipientCompany ? sanitizeShortText(req.body.recipientCompany) : null;
    }
    if (req.body.recipientEmail !== undefined) {
      updateData.recipientEmail = req.body.recipientEmail ? sanitizeShortText(req.body.recipientEmail) : null;
    }
    if (req.body.subject) {
      updateData.subject = sanitizeShortText(req.body.subject);
    }
    if (req.body.body) {
      updateData.body = sanitizeText(req.body.body);
    }
    if (req.body.status === "FINALIZED") {
      updateData.status = "FINALIZED";
    }

    const [updated] = await db
      .update(delayNotifications)
      .set(updateData)
      .where(eq(delayNotifications.id, notificationId))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "delayNotification",
      entityId: notificationId,
      oldValue: JSON.stringify({ subject: notification.subject }),
      newValue: JSON.stringify(updateData),
    }, req);

    res.json(updated);
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

router.get("/delays/:delayId/notifications/:notificationId/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    const delay = await getDelayById(delayId);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
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

    const [createdByUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, notification.createdById))
      .limit(1);

    const pdfData = {
      notification: {
        subject: notification.subject,
        body: notification.body,
        recipientName: notification.recipientName,
        recipientCompany: notification.recipientCompany,
        recipientEmail: notification.recipientEmail,
        recipientType: notification.recipientType,
        createdAt: notification.createdAt,
      },
      delay: {
        delayNumber: delay.delayNumber,
        reason: delay.reason,
        reasonLabel: DELAY_REASON_LABELS[delay.reason] || delay.reason,
        reasonNotes: delay.reasonNotes,
        startDateTime: delay.startDateTime,
        endDateTime: delay.endDateTime,
        financiallyResponsible: delay.financiallyResponsible,
        responsibilityLabel: RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible,
        changeOrderRequired: delay.changeOrderRequired,
        status: delay.status,
      },
      project: {
        name: project.name,
        code: project.code,
        clientName: project.clientName,
        locationAddress: project.locationAddress,
        city: project.city,
        state: project.state,
      },
      createdBy: {
        firstName: createdByUser?.firstName || "System",
        lastName: createdByUser?.lastName || "User",
        email: createdByUser?.email || null,
        phone: createdByUser?.phone || null,
      },
    };

    const pdfStream = generateDelayNotificationPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Delay-Notification-${delay.delayNumber}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Error generating notification PDF:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.delete("/delays/:delayId/notifications/:notificationId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;
    const userId = req.user!.id;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    await db
      .delete(delayNotifications)
      .where(eq(delayNotifications.id, notificationId));

    await logAudit({
      userId,
      action: "DELETE",
      entityType: "delayNotification",
      entityId: notificationId,
      oldValue: JSON.stringify({ subject: notification.subject }),
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

export default router;
