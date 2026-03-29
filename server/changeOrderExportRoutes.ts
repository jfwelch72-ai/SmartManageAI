import { Router, type Response , NextFunction } from "express";
import { db } from "./db";
import { changeOrders, users, projects, changeOrderRevisions, changeOrderApprovals, changeOrderComments, tmTickets, rfis, scheduleOfValues, sovLineItems, orgCostCodes } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logAudit } from "./auditLogger";
import { verifyOrgAccess } from "./orgFilter";
import { isValidTransition, getChangeOrderById, checkOrgAccess, notifyStatusChange, createRevision } from "./changeOrderHelpers";

const router = Router();

router.post("/:id/add-to-sov", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response, next) => {
  try {
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, req.params.id)).limit(1);
    if (!co) return res.status(404).json({ error: "Change order not found" });
    if (co.status !== "APPROVED") return res.status(400).json({ error: "Only approved change orders can be added to the SOV" });

    // Verify org ownership: load the project and check org access
    const [project] = await db.select().from(projects).where(eq(projects.id, co.projectId)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // Check if this CO is already linked to an SOV line item
    const existing = await db.select({ id: sovLineItems.id })
      .from(sovLineItems)
      .where(eq(sovLineItems.linkedChangeOrderId, co.id))
      .limit(1);
    if (existing.length > 0) return res.status(409).json({ error: "This change order is already linked to an SOV line item" });

    // Find the project's latest DRAFT SOV; if none exists, create one
    const [latestSov] = await db.select()
      .from(scheduleOfValues)
      .where(and(eq(scheduleOfValues.projectId, co.projectId), eq(scheduleOfValues.status, "DRAFT")))
      .orderBy(desc(scheduleOfValues.createdAt))
      .limit(1);

    let targetSovId: string;

    if (latestSov) {
      targetSovId = latestSov.id;
    } else {
      // No DRAFT SOV exists — create a minimal one (project already loaded above for org check)
      const sovCount = await db.select({ cnt: sql<number>`count(*)` })
        .from(scheduleOfValues)
        .where(eq(scheduleOfValues.projectId, co.projectId));
      const nextNum = (Number(sovCount[0]?.cnt || 0) + 1).toString().padStart(3, "0");

      const [newSov] = await db.insert(scheduleOfValues).values({
        organizationId: project.gcOrganizationId,
        projectId: co.projectId,
        sovNumber: `SOV-${project.code}-${nextNum}`,
        title: `${project.name} — Schedule of Values`,
        contractValue: project.contractAmount || "0",
        createdById: req.user?.id || null,
      }).returning();
      targetSovId = newSov.id;
    }

    // Determine next line number
    const lineNums = await db.select({ ln: sovLineItems.lineNumber })
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, targetSovId))
      .orderBy(desc(sovLineItems.lineNumber))
      .limit(1);
    const nextLineNumber = (lineNums[0]?.ln ?? 0) + 1;

    const [newLineItem] = await db.insert(sovLineItems).values({
      sovId: targetSovId,
      lineNumber: nextLineNumber,
      description: `CO #${co.changeOrderNumber}: ${co.description || "Change Order"}`,
      scheduledValue: co.amount || "0",
      linkedChangeOrderId: co.id,
      balanceToFinish: co.amount || "0",
    }).returning();

    // Update the SOV's totalScheduledValue
    await db.execute(sql`
      UPDATE schedule_of_values
      SET total_scheduled_value = (
        SELECT COALESCE(SUM(scheduled_value::numeric), 0)
        FROM sov_line_items
        WHERE sov_id = ${targetSovId}
      ),
      updated_at = NOW()
      WHERE id = ${targetSovId}
    `);

    await logAudit({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "sovLineItem",
      entityId: newLineItem.id,
      newValue: JSON.stringify({ changeOrderId: co.id, sovId: targetSovId }),
    }, req);

    res.json({ success: true, sovLineItemId: newLineItem.id, sovId: targetSovId });
  } catch (error) {
  next(error);
  }
});

router.post("/bulk-submit", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids array is required" });
      return;
    }

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        const result = await getChangeOrderById(id);
        if (!result?.order) {
          results.push({ id, success: false, error: "Not found" });
          continue;
        }
        const { order, project } = result;
        const { allowed } = checkOrgAccess(req, project?.gcOrganizationId);
        if (!allowed) {
          results.push({ id, success: false, error: "Access denied" });
          continue;
        }
        if (!isValidTransition(order.status, "SUBMITTED")) {
          results.push({ id, success: false, error: `Cannot submit from ${order.status}` });
          continue;
        }

        const now = new Date();
        const [updatedOrder] = await db
          .update(changeOrders)
          .set({ status: "SUBMITTED", submittedAt: now, updatedAt: now })
          .where(eq(changeOrders.id, id))
          .returning();

        if (updatedOrder) {
          await createRevision(order.id, order.status, "SUBMITTED", req.user!.id, "Bulk submitted to client", order.amount);
          await logAudit({
            userId: req.user!.id,
            action: "SUBMIT",
            entityType: "changeOrder",
            entityId: order.id,
            oldValue: JSON.stringify({ status: order.status }),
            newValue: JSON.stringify({ status: "SUBMITTED" }),
          }, req);
          results.push({ id, success: true });
        } else {
          results.push({ id, success: false, error: "Update failed" });
        }
      } catch (err) {
        results.push({ id, success: false, error: "Internal error" });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    res.json({ results, summary: { total: ids.length, succeeded, failed: ids.length - succeeded } });
  } catch (error) {
  next(error);
  }
});

// ====================
// PDF Export Routes
// ====================

router.get("/:id/pdf", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    const { order, project } = result;
    const { allowed, mustDenyAccess } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      res.status(mustDenyAccess ? 403 : 403).json({ error: "Access denied" });
      return;
    }

    const draftStatuses = ["DRAFT", "PENDING_APPROVAL"];
    if (draftStatuses.includes(order.status)) {
      res.status(400).json({ error: "PDF is not available for draft change orders" });
      return;
    }

    const [projectData] = await db.select({
      name: projects.name,
      code: projects.code,
      clientName: projects.clientName,
      locationAddress: projects.locationAddress,
    }).from(projects).where(eq(projects.id, order.projectId)).limit(1);

    const [requestedBy] = await db.select({
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(users).where(eq(users.id, order.requestedById)).limit(1);

    let approvedByName: string | undefined;
    if (order.approvedById) {
      const [approver] = await db.select({
        firstName: users.firstName,
        lastName: users.lastName,
      }).from(users).where(eq(users.id, order.approvedById)).limit(1);
      if (approver) approvedByName = `${approver.firstName} ${approver.lastName}`;
    }

    let costBreakdownData = null;
    try {
      if (order.costBreakdownJson) {
        costBreakdownData = typeof order.costBreakdownJson === 'string' ? JSON.parse(order.costBreakdownJson) : order.costBreakdownJson;
      }
    } catch (e) {}

    let contractNumber: string | null = null;
    if (order.contractId) {
      const { contracts } = await import("@shared/schema");
      const [contract] = await db.select({ contractNumber: contracts.contractNumber }).from(contracts).where(eq(contracts.id, order.contractId)).limit(1);
      if (contract) contractNumber = contract.contractNumber;
    }

    const approvalRows = await db.select({
      approval: {
        approverRole: changeOrderApprovals.approverRole,
        status: changeOrderApprovals.status,
        stepOrder: changeOrderApprovals.stepOrder,
        comments: changeOrderApprovals.comments,
        decidedAt: changeOrderApprovals.decidedAt,
      },
    }).from(changeOrderApprovals).where(eq(changeOrderApprovals.changeOrderId, order.id)).orderBy(changeOrderApprovals.stepOrder);

    const revisionRows = await db.select({
      revision: {
        revisionNumber: changeOrderRevisions.revisionNumber,
        previousStatus: changeOrderRevisions.previousStatus,
        newStatus: changeOrderRevisions.newStatus,
        description: changeOrderRevisions.description,
        createdAt: changeOrderRevisions.createdAt,
      },
    }).from(changeOrderRevisions).where(eq(changeOrderRevisions.changeOrderId, order.id)).orderBy(changeOrderRevisions.revisionNumber);

    let costCodeLabel: string | null = null;
    if (order.costCodeId) {
      const [cc] = await db.select({ code: orgCostCodes.code, description: orgCostCodes.description }).from(orgCostCodes).where(eq(orgCostCodes.id, order.costCodeId)).limit(1);
      if (cc) costCodeLabel = `${cc.code} — ${cc.description}`;
    }

    let linkedRfiNumber: string | null = null;
    if (order.linkedRfiId) {
      const [rfi] = await db.select({ rfiNumber: rfis.rfiNumber }).from(rfis).where(eq(rfis.id, order.linkedRfiId)).limit(1);
      if (rfi) linkedRfiNumber = rfi.rfiNumber;
    }

    let linkedTmTicketNumber: string | null = null;
    if (order.linkedTmTicketId) {
      const [tm] = await db.select({ ticketNumber: tmTickets.ticketNumber }).from(tmTickets).where(eq(tmTickets.id, order.linkedTmTicketId)).limit(1);
      if (tm) linkedTmTicketNumber = tm.ticketNumber;
    }

    let orgBranding: { organizationName: string; primaryColor?: string } | undefined;
    if (project?.gcOrganizationId) {
      const { organizations } = await import("@shared/schema");
      const [org] = await db.select({ name: organizations.name, primaryColor: organizations.primaryColor }).from(organizations).where(eq(organizations.id, project.gcOrganizationId)).limit(1);
      if (org) orgBranding = { organizationName: org.name, primaryColor: org.primaryColor || undefined };
    }

    const { generateChangeOrderPDF } = await import("./co-pdf-service");

    const stream = generateChangeOrderPDF({
      changeOrder: {
        ...order,
        costCodeLabel,
        linkedTmTicketNumber,
        linkedRfiNumber,
        contractNumber,
        requestedByName: requestedBy ? `${requestedBy.firstName} ${requestedBy.lastName}` : undefined,
        approvedByName,
      },
      project: projectData || { name: 'Unknown', code: '' },
      lineItems: costBreakdownData,
      approvals: approvalRows.map(a => ({ ...a.approval, decidedAt: a.approval.decidedAt ? String(a.approval.decidedAt) : null })),
      revisions: revisionRows.map(r => ({ ...r.revision, createdAt: String(r.revision.createdAt) })),
      branding: orgBranding,
    });

    const safeNumber = order.changeOrderNumber.replace(/[^a-zA-Z0-9-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ChangeOrder_${safeNumber}.pdf"`);
    stream.pipe(res);
  } catch (error) {
    console.error("PDF generation error:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.get("/project/:projectId/bulk-pdf", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next) => {
  try {
    const projectId = req.params.projectId;

    const [projectData] = await db.select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      clientName: projects.clientName,
      locationAddress: projects.locationAddress,
      gcOrganizationId: projects.gcOrganizationId,
    }).from(projects).where(eq(projects.id, projectId)).limit(1);

    if (!projectData) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { allowed, mustDenyAccess } = checkOrgAccess(req, projectData.gcOrganizationId);
    if (!allowed) {
      res.status(mustDenyAccess ? 403 : 403).json({ error: "Access denied" });
      return;
    }

    const selectedIdsParam = req.query.ids as string | undefined;
    let coQuery = db.select().from(changeOrders).where(eq(changeOrders.projectId, projectId));
    const allCOs = await coQuery;

    const draftStatuses = ["DRAFT", "PENDING_APPROVAL"];
    let eligibleCOs = allCOs.filter(co => !draftStatuses.includes(co.status));

    if (selectedIdsParam) {
      const selectedIds = new Set(selectedIdsParam.split(','));
      eligibleCOs = eligibleCOs.filter(co => selectedIds.has(co.id));
    }

    if (eligibleCOs.length === 0) {
      res.status(400).json({ error: "No eligible change orders to export" });
      return;
    }

    let orgBranding: { organizationName: string; primaryColor?: string } | undefined;
    if (projectData.gcOrganizationId) {
      const { organizations } = await import("@shared/schema");
      const [org] = await db.select({ name: organizations.name, primaryColor: organizations.primaryColor }).from(organizations).where(eq(organizations.id, projectData.gcOrganizationId)).limit(1);
      if (org) orgBranding = { organizationName: org.name, primaryColor: org.primaryColor || undefined };
    }

    const { generateChangeOrderPDF } = await import("./co-pdf-service");
    const archiver = (await import("archiver")).default;

    const archive = archiver('zip', { zlib: { level: 5 } });
    const safeProjectCode = projectData.code.replace(/[^a-zA-Z0-9-]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ChangeOrders_${safeProjectCode}.zip"`);
    archive.pipe(res);

    for (const co of eligibleCOs) {
      try {
        let costBreakdownData = null;
        try {
          if (co.costBreakdownJson) {
            costBreakdownData = typeof co.costBreakdownJson === 'string' ? JSON.parse(co.costBreakdownJson) : co.costBreakdownJson;
          }
        } catch (parseErr) {
          console.warn(`Skipping malformed costBreakdownJson for CO ${co.changeOrderNumber}`);
        }

        let costCodeLabel: string | null = null;
        if (co.costCodeId) {
          const [cc] = await db.select({ code: orgCostCodes.code, description: orgCostCodes.description }).from(orgCostCodes).where(eq(orgCostCodes.id, co.costCodeId)).limit(1);
          if (cc) costCodeLabel = `${cc.code} — ${cc.description}`;
        }

        const [requestedBy] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, co.requestedById)).limit(1);
        let approvedByName: string | undefined;
        if (co.approvedById) {
          const [approver] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, co.approvedById)).limit(1);
          if (approver) approvedByName = `${approver.firstName} ${approver.lastName}`;
        }

        let linkedRfiNumber: string | null = null;
        if (co.linkedRfiId) {
          const [rfi] = await db.select({ rfiNumber: rfis.rfiNumber }).from(rfis).where(eq(rfis.id, co.linkedRfiId)).limit(1);
          if (rfi) linkedRfiNumber = rfi.rfiNumber;
        }

        let linkedTmTicketNumber: string | null = null;
        if (co.linkedTmTicketId) {
          const [tm] = await db.select({ ticketNumber: tmTickets.ticketNumber }).from(tmTickets).where(eq(tmTickets.id, co.linkedTmTicketId)).limit(1);
          if (tm) linkedTmTicketNumber = tm.ticketNumber;
        }

        let contractNumber: string | null = null;
        if (co.contractId) {
          const { contracts } = await import("@shared/schema");
          const [contract] = await db.select({ contractNumber: contracts.contractNumber }).from(contracts).where(eq(contracts.id, co.contractId)).limit(1);
          if (contract) contractNumber = contract.contractNumber;
        }

        const approvalRows = await db.select({
          approval: {
            approverRole: changeOrderApprovals.approverRole,
            status: changeOrderApprovals.status,
            stepOrder: changeOrderApprovals.stepOrder,
            comments: changeOrderApprovals.comments,
            decidedAt: changeOrderApprovals.decidedAt,
          },
        }).from(changeOrderApprovals).where(eq(changeOrderApprovals.changeOrderId, co.id)).orderBy(changeOrderApprovals.stepOrder);

        const revisionRows = await db.select({
          revision: {
            revisionNumber: changeOrderRevisions.revisionNumber,
            previousStatus: changeOrderRevisions.previousStatus,
            newStatus: changeOrderRevisions.newStatus,
            description: changeOrderRevisions.description,
            createdAt: changeOrderRevisions.createdAt,
          },
        }).from(changeOrderRevisions).where(eq(changeOrderRevisions.changeOrderId, co.id)).orderBy(changeOrderRevisions.revisionNumber);

        const stream = generateChangeOrderPDF({
          changeOrder: {
            ...co,
            costCodeLabel,
            linkedTmTicketNumber,
            linkedRfiNumber,
            contractNumber,
            requestedByName: requestedBy ? `${requestedBy.firstName} ${requestedBy.lastName}` : undefined,
            approvedByName,
          },
          project: { name: projectData.name, code: projectData.code, clientName: projectData.clientName || undefined, locationAddress: projectData.locationAddress },
          lineItems: costBreakdownData,
          approvals: approvalRows.map(a => ({ ...a.approval, decidedAt: a.approval.decidedAt ? String(a.approval.decidedAt) : null })),
          revisions: revisionRows.map(r => ({ ...r.revision, createdAt: String(r.revision.createdAt) })),
          branding: orgBranding,
        });

        const safeNumber = co.changeOrderNumber.replace(/[^a-zA-Z0-9-]/g, '_');
        archive.append(stream, { name: `${safeNumber}.pdf` });
      } catch (coErr) {
        console.error(`Failed to generate PDF for CO ${co.changeOrderNumber}:`, coErr);
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error("Bulk PDF export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate bulk PDF export" });
    }
  }
});

router.get("/:id/comments", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const { order, project } = result;
    const { allowed, mustDenyAccess } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      return res.status(mustDenyAccess ? 403 : 403).json({ error: "Access denied" });
    }

    const comments = await db
      .select()
      .from(changeOrderComments)
      .where(eq(changeOrderComments.changeOrderId, req.params.id))
      .orderBy(changeOrderComments.createdAt);

    res.json(comments);
  } catch (error) {
  next(error);
  }
});

router.post("/:id/comments", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const result = await getChangeOrderById(req.params.id);
    if (!result?.order) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const { order, project } = result;
    const { allowed, mustDenyAccess } = checkOrgAccess(req, project?.gcOrganizationId);
    if (!allowed) {
      return res.status(mustDenyAccess ? 403 : 403).json({ error: "Access denied" });
    }

    const { message } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    const userName = req.user!.firstName && req.user!.lastName
      ? `${req.user!.firstName} ${req.user!.lastName}`
      : req.user!.email || "Team Member";

    const [comment] = await db
      .insert(changeOrderComments)
      .values({
        changeOrderId: req.params.id,
        authorName: userName,
        authorEmail: req.user!.email || null,
        authorType: "INTERNAL",
        message: message.trim().substring(0, 2000),
        isInternal: false,
      })
      .returning();

    res.json(comment);
  } catch (error) {
  next(error);
  }
});

export default router;
