/**
 * @openapi
 * /api/rfi:
 *   get:
 *     tags: [Documents]
 *     summary: List RFIs
 *     description: Returns Requests for Information for the organization.
 *     parameters:
 *       - name: projectId
 *         in: query
 *         schema: { type: string, format: uuid }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of RFIs }
 *   post:
 *     tags: [Documents]
 *     summary: Create an RFI
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId, subject, question]
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               subject: { type: string }
 *               question: { type: string }
 *               assignedToId: { type: string, format: uuid }
 *               dueDate: { type: string, format: date }
 *     responses:
 *       201: { description: RFI created }
 * /api/rfi/stats:
 *   get:
 *     tags: [Documents]
 *     summary: Get RFI statistics
 *     responses:
 *       200: { description: RFI stats by status }
 * /api/rfi/{id}:
 *   get:
 *     tags: [Documents]
 *     summary: Get RFI details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI details with responses }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Documents]
 *     summary: Update an RFI
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
 *       200: { description: RFI updated }
 *   delete:
 *     tags: [Documents]
 *     summary: Delete an RFI
 *     description: Requires SUPER_ADMIN or ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI deleted }
 * /api/rfi/{id}/submit:
 *   post:
 *     tags: [Documents]
 *     summary: Submit an RFI
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI submitted }
 * /api/rfi/{id}/review:
 *   post:
 *     tags: [Documents]
 *     summary: Mark RFI as under review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI under review }
 * /api/rfi/{id}/forward:
 *   post:
 *     tags: [Documents]
 *     summary: Forward RFI to another party
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI forwarded }
 * /api/rfi/{id}/answer:
 *   post:
 *     tags: [Documents]
 *     summary: Answer an RFI
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
 *             required: [answer]
 *             properties:
 *               answer: { type: string }
 *     responses:
 *       200: { description: RFI answered }
 * /api/rfi/{id}/close:
 *   post:
 *     tags: [Documents]
 *     summary: Close an RFI
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI closed }
 * /api/rfi/{id}/reopen:
 *   post:
 *     tags: [Documents]
 *     summary: Reopen an RFI
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI reopened }
 * /api/rfi/{id}/link-co:
 *   post:
 *     tags: [Documents]
 *     summary: Link RFI to a change order
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI linked to change order }
 * /api/rfi/{id}/link-tm:
 *   post:
 *     tags: [Documents]
 *     summary: Link RFI to a T&M ticket
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RFI linked to T&M ticket }
 * /api/rfi/{id}/activity:
 *   get:
 *     tags: [Documents]
 *     summary: Get RFI activity log
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Activity log }
 *   post:
 *     tags: [Documents]
 *     summary: Add RFI activity entry
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Activity added }
 * /api/rfi/{id}/files:
 *   get:
 *     tags: [Documents]
 *     summary: List RFI files
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of files }
 *   post:
 *     tags: [Documents]
 *     summary: Upload file to RFI
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: File uploaded }
 * /api/rfi/{id}/files/{fileId}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete RFI file
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: fileId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: File deleted }
 * /api/rfi/{id}/attachments:
 *   get:
 *     tags: [Documents]
 *     summary: List RFI attachments
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of attachments }
 *   post:
 *     tags: [Documents]
 *     summary: Add attachment to RFI
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201: { description: Attachment added }
 * /api/rfi/{id}/attachments/{attachmentId}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete RFI attachment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: attachmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Attachment deleted }
 */
import {logError, logWarn } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import { db } from "./db";
import {
  insertRfiSchema,
  insertRfiActivitySchema,
  rfis,
  rfiActivity,
  rfiAttachments,
  projects,
  users,
  crmOrganisations,
  subcontractorContracts,
  changeOrders,
  tmTickets,
  submittals,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { validateBody } from "./utils/validation";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyDocumentEvent } from "./services/documentNotificationService";
import { assertStorageKeyBelongsToOrg } from "./services/documentRevisionService";

const rfiPatchSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  question: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  category: z.string().max(200).optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  dateRequired: z.string().optional().nullable(),
  drawingReference: z.string().max(500).optional().nullable(),
  specReference: z.string().max(500).optional().nullable(),
  impactDescription: z.string().max(5000).optional().nullable(),
  costImpact: z.string().max(200).optional().nullable(),
  scheduleImpact: z.string().max(200).optional().nullable(),
  linkedSubmittalId: z.string().uuid().optional().nullable(),
});

const rfiForwardSchema = z.object({
  forwardedToId: z.string().uuid("forwardedToId must be a valid UUID"),
});

const rfiAnswerSchema = z.object({
  answer: z.string().min(1, "Answer is required").max(10000),
  answerAttachmentsJson: z.any().optional().nullable(),
});

const router = Router();

async function getRfiWithOrgCheck(rfiId: string, req: AuthRequest) {
  const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req as AuthRequest);

  if (mustDenyAccess) {
    return { rfi: null, project: null, denied: true };
  }

  const [result] = await db
    .select({
      rfi: rfis,
      project: {
        id: projects.id,
        name: projects.name,
        code: projects.code,
        gcOrganizationId: projects.gcOrganizationId,
      },
    })
    .from(rfis)
    .leftJoin(projects, eq(rfis.projectId, projects.id))
    .where(eq(rfis.id, rfiId))
    .limit(1);

  if (!result?.rfi) {
    return { rfi: null, project: null, denied: false };
  }

  if (shouldFilter && orgId && result.project?.gcOrganizationId !== orgId) {
    return { rfi: null, project: null, denied: true };
  }

  return { rfi: result.rfi, project: result.project, denied: false };
}

async function createActivityEntry(rfiId: string, userId: string, userName: string, action: string, comment?: string | null, attachmentsJson?: string | null) {
  await db.insert(rfiActivity).values({
    rfiId,
    userId,
    userName,
    action,
    comment: comment || null,
    attachmentsJson: attachmentsJson || null,
  });
}

router.get("/rfi", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { projectId, status } = req.query;

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(rfis.projectId, projectId));
    }
    if (status && typeof status === "string") {
      if (status === "OVERDUE") {
        conditions.push(inArray(rfis.status, ["SUBMITTED", "UNDER_REVIEW", "FORWARDED"]));
        conditions.push(sql`${rfis.dateRequired} < NOW()`);
      } else {
        conditions.push(eq(rfis.status, status as any));
      }
    }

    const results = await db
      .select({
        rfi: rfis,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
        submittedBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(rfis)
      .leftJoin(projects, eq(rfis.projectId, projects.id))
      .leftJoin(users, eq(rfis.submittedById, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rfis.createdAt));

    const mapped = results.map((r) => ({
      ...r.rfi,
      project: r.project,
      submittedBy: r.submittedBy,
      submittedByName: r.submittedBy ? `${r.submittedBy.firstName} ${r.submittedBy.lastName}` : r.rfi.submittedByName,
    }));

    res.json(mapped);
  } catch (error) {
    next(error);
  }
});

router.get("/rfi/stats", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    const { projectId } = req.query;
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(rfis.projectId, projectId));
    }

    const allRfis = await db
      .select({ status: rfis.status, dateRequired: rfis.dateRequired })
      .from(rfis)
      .leftJoin(projects, eq(rfis.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const now = new Date();
    const total = allRfis.length;
    const open = allRfis.filter((r) => ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FORWARDED"].includes(r.status)).length;
    const answered = allRfis.filter((r) => r.status === "ANSWERED").length;
    const closed = allRfis.filter((r) => r.status === "CLOSED").length;
    const overdue = allRfis.filter((r) =>
      ["SUBMITTED", "UNDER_REVIEW", "FORWARDED"].includes(r.status) &&
      r.dateRequired &&
      new Date(r.dateRequired) < now
    ).length;

    res.json({ total, open, answered, closed, overdue });
  } catch (error) {
    next(error);
  }
});

router.get("/rfi/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, project, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const activity = await db
      .select()
      .from(rfiActivity)
      .where(eq(rfiActivity.rfiId, rfi.id))
      .orderBy(desc(rfiActivity.createdAt));

    let subcontractor = null;
    if (rfi.subcontractorId) {
      const [sub] = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, rfi.subcontractorId))
        .limit(1);
      subcontractor = sub ? { companyName: sub.name } : null;
    }

    let linkedChangeOrder = null;
    if (rfi.linkedChangeOrderId) {
      const [co] = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.id, rfi.linkedChangeOrderId))
        .limit(1);
      linkedChangeOrder = co || null;
    }

    let linkedTmTicket = null;
    if (rfi.linkedTmTicketId) {
      const [tm] = await db
        .select()
        .from(tmTickets)
        .where(eq(tmTickets.id, rfi.linkedTmTicketId))
        .limit(1);
      linkedTmTicket = tm || null;
    }

    let answeredByName: string | null = rfi.answeredById ? null : null;
    if (rfi.answeredById) {
      const [answeredBy] = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, rfi.answeredById))
        .limit(1);
      if (answeredBy) answeredByName = `${answeredBy.firstName} ${answeredBy.lastName}`;
    }

    let closedByName: string | null = null;
    if (rfi.closedById) {
      const [closedBy] = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, rfi.closedById))
        .limit(1);
      if (closedBy) closedByName = `${closedBy.firstName} ${closedBy.lastName}`;
    }

    let linkedSubmittalNumber: string | null = null;
    let linkedSubmittalSubject: string | null = null;
    if (rfi.linkedSubmittalId) {
      const [submittal] = await db
        .select({ submittalNumber: submittals.submittalNumber, subject: submittals.subject })
        .from(submittals)
        .where(eq(submittals.id, rfi.linkedSubmittalId))
        .limit(1);
      if (submittal) {
        linkedSubmittalNumber = submittal.submittalNumber;
        linkedSubmittalSubject = submittal.subject;
      }
    }

    res.json({
      ...rfi,
      project,
      subcontractor,
      linkedChangeOrder,
      linkedTmTicket,
      answeredByName,
      closedByName,
      linkedSubmittalNumber,
      linkedSubmittalSubject,
      activity,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/rfi", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId;
    if (!organizationId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "No organization assigned" });
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rfis)
      .where(eq(rfis.projectId, req.body.projectId));

    const rfiNumber = `RFI-${String(countResult.count + 1).padStart(3, "0")}`;

    const rfiData = {
      ...req.body,
      organizationId: organizationId || req.body.organizationId,
      rfiNumber,
      submittedById: user.id,
      submittedByName: `${user.firstName} ${user.lastName}`,
      status: req.body.status || "DRAFT",
    };

    if (rfiData.dateRequired && typeof rfiData.dateRequired === 'string') {
      rfiData.dateRequired = new Date(rfiData.dateRequired);
    }

    const validated = insertRfiSchema.parse(rfiData);

    const [newRfi] = await db.insert(rfis).values(validated).returning();

    await createActivityEntry(
      newRfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "RFI Created"
    );

    res.status(201).json(newRfi);
  } catch (error) {
    next(error);
  }
});

router.patch("/rfi/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const validated = validateBody(rfiPatchSchema, req.body, res);
    if (!validated) return;

    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const [field, value] of Object.entries(validated)) {
      if (value !== undefined) {
        if (field === "dateRequired" && value) {
          updates[field] = new Date(value as string);
        } else {
          updates[field] = value;
        }
      }
    }

    const forceOverwrite = req.headers['x-force-overwrite'] === 'true';
    const useOptimisticLock = !forceOverwrite && !!req.body.lastKnownUpdatedAt;

    const whereClause = useOptimisticLock
      ? and(eq(rfis.id, req.params.id), eq(rfis.updatedAt, new Date(req.body.lastKnownUpdatedAt)))
      : eq(rfis.id, req.params.id);

    const [updated] = await db
      .update(rfis)
      .set(updates)
      .where(whereClause)
      .returning();

    if (!updated) {
      if (useOptimisticLock) {
        const [current] = await db.select().from(rfis).where(eq(rfis.id, req.params.id));
        if (current) {
          return res.status(409).json({
            error: "Conflict: server version is newer",
            serverUpdatedAt: current.updatedAt,
            serverData: current,
          });
        }
      }
      return res.status(404).json({ error: "RFI not found" });
    }

    const user = req.user!;
    await createActivityEntry(
      rfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "RFI Updated"
    );

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/submit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "DRAFT") {
      return res.status(400).json({ error: `Cannot submit from ${rfi.status} status` });
    }

    const [updated] = await db
      .update(rfis)
      .set({ status: "SUBMITTED", dateSubmitted: new Date(), updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Submitted");

    const recipientIds: string[] = [];
    if (rfi.assignedToId) recipientIds.push(rfi.assignedToId);
    if (recipientIds.length > 0) {
      notifyDocumentEvent("RFI", rfi.id, rfi.organizationId, rfi.projectId, user.id, recipientIds, `RFI Submitted: ${rfi.subject}`, rfi.rfiNumber);
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/review", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "SUBMITTED") {
      return res.status(400).json({ error: `Cannot move to review from ${rfi.status} status` });
    }

    const [updated] = await db
      .update(rfis)
      .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Under Review");

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/forward", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: `Cannot forward from ${rfi.status} status` });
    }

    const validated = validateBody(rfiForwardSchema, req.body, res);
    if (!validated) return;
    const { forwardedToId } = validated;

    const [forwardedToUser] = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, forwardedToId))
      .limit(1);

    if (!forwardedToUser) {
      return res.status(404).json({ error: "Forwarded-to user not found" });
    }

    const user = req.user!;
    const [updated] = await db
      .update(rfis)
      .set({
        status: "FORWARDED",
        forwardedToId,
        forwardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const forwardedToName = `${forwardedToUser.firstName} ${forwardedToUser.lastName}`;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, `RFI Forwarded to ${forwardedToName}`);

    notifyDocumentEvent("RFI", rfi.id, rfi.organizationId, rfi.projectId, user.id, [forwardedToId], `RFI Forwarded to you: ${rfi.subject}`, rfi.rfiNumber);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/answer", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "UNDER_REVIEW" && rfi.status !== "SUBMITTED" && rfi.status !== "FORWARDED") {
      return res.status(400).json({ error: `Cannot answer from ${rfi.status} status` });
    }

    const validated = validateBody(rfiAnswerSchema, req.body, res);
    if (!validated) return;
    const { answer, answerAttachmentsJson } = validated;

    const user = req.user!;
    const [updated] = await db
      .update(rfis)
      .set({
        status: "ANSWERED",
        answer,
        answerAttachmentsJson: answerAttachmentsJson || null,
        dateAnswered: new Date(),
        answeredById: user.id,
        answeredByName: `${user.firstName} ${user.lastName}`,
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Answered", answer);

    notifyDocumentEvent("RFI", rfi.id, rfi.organizationId, rfi.projectId, user.id, [rfi.submittedById], `RFI Answered: ${rfi.subject}`, rfi.rfiNumber);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/close", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const user = req.user!;
    const [updated] = await db
      .update(rfis)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        closedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Closed");

    const closeRecipients: string[] = [rfi.submittedById];
    if (rfi.assignedToId) closeRecipients.push(rfi.assignedToId);
    notifyDocumentEvent("RFI", rfi.id, rfi.organizationId, rfi.projectId, user.id, closeRecipients, `RFI Closed: ${rfi.subject}`, rfi.rfiNumber);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/reopen", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "CLOSED" && rfi.status !== "ANSWERED") {
      return res.status(400).json({ error: `Cannot reopen from ${rfi.status} status` });
    }

    const [updated] = await db
      .update(rfis)
      .set({
        status: "UNDER_REVIEW",
        closedAt: null,
        closedById: null,
        updatedAt: new Date(),
      })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(rfi.id, user.id, `${user.firstName} ${user.lastName}`, "RFI Reopened");

    const reopenRecipients: string[] = [rfi.submittedById];
    if (rfi.assignedToId) reopenRecipients.push(rfi.assignedToId);
    notifyDocumentEvent("RFI", rfi.id, rfi.organizationId, rfi.projectId, user.id, reopenRecipients, `RFI Reopened: ${rfi.subject}`, rfi.rfiNumber);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/link-co", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { changeOrderId } = req.body;
    if (!changeOrderId) {
      return res.status(400).json({ error: "changeOrderId is required" });
    }

    const [co] = await db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.id, changeOrderId))
      .limit(1);

    if (!co) {
      return res.status(404).json({ error: "Change order not found" });
    }

    const [updated] = await db
      .update(rfis)
      .set({ linkedChangeOrderId: changeOrderId, updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(
      rfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "Linked Change Order",
      `Linked to change order ${co.changeOrderNumber || changeOrderId}`
    );

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/link-tm", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { tmTicketId } = req.body;
    if (!tmTicketId) {
      return res.status(400).json({ error: "tmTicketId is required" });
    }

    const [tm] = await db
      .select()
      .from(tmTickets)
      .where(eq(tmTickets.id, tmTicketId))
      .limit(1);

    if (!tm) {
      return res.status(404).json({ error: "T&M ticket not found" });
    }

    const [updated] = await db
      .update(rfis)
      .set({ linkedTmTicketId: tmTicketId, updatedAt: new Date() })
      .where(eq(rfis.id, req.params.id))
      .returning();

    const user = req.user!;
    await createActivityEntry(
      rfi.id,
      user.id,
      `${user.firstName} ${user.lastName}`,
      "Linked T&M Ticket",
      `Linked to T&M ticket ${tm.ticketNumber || tmTicketId}`
    );

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { comment, attachmentsJson } = req.body;
    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const user = req.user!;
    const [entry] = await db
      .insert(rfiActivity)
      .values({
        rfiId: rfi.id,
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        action: "Comment",
        comment,
        attachmentsJson: attachmentsJson || null,
      })
      .returning();

    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
});

router.get("/rfi/:id/activity", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const activity = await db
      .select()
      .from(rfiActivity)
      .where(eq(rfiActivity.rfiId, rfi.id))
      .orderBy(desc(rfiActivity.createdAt));

    res.json(activity);
  } catch (error) {
    next(error);
  }
});

router.delete("/rfi/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    if (rfi.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT RFIs can be deleted" });
    }

    await db.delete(rfiActivity).where(eq(rfiActivity.rfiId, rfi.id));
    await db.delete(rfis).where(eq(rfis.id, rfi.id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Legacy /files endpoints — kept for backward compatibility with sub-portal; return empty arrays / no-ops
router.post("/rfi/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
  if (denied) return res.status(403).json({ error: "Access denied" });
  if (!rfi) return res.status(404).json({ error: "RFI not found" });
  res.status(200).json([]);
});

router.get("/rfi/:id/files", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
  if (denied) return res.status(403).json({ error: "Access denied" });
  if (!rfi) return res.status(404).json({ error: "RFI not found" });
  res.json([]);
});

router.delete("/rfi/:id/files/:fileId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
  if (denied) return res.status(403).json({ error: "Access denied" });
  if (!rfi) return res.status(404).json({ error: "RFI not found" });
  res.status(204).send();
});

// ==================== Normalized RFI Attachments ====================

router.get("/rfi/:id/attachments", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const attachments = await db
      .select()
      .from(rfiAttachments)
      .where(eq(rfiAttachments.rfiId, rfi.id))
      .orderBy(desc(rfiAttachments.createdAt));

    res.json(attachments);
  } catch (error) {
    next(error);
  }
});

router.post("/rfi/:id/attachments", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const user = req.user!;
    const organizationId = rfi.organizationId;

    const uploadSchema = z.object({
      fileName: z.string(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      fileUrl: z.string(),
      description: z.string().optional(),
      isAnswerAttachment: z.boolean().optional(),
    });

    const parseResult = uploadSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten() });

    const { fileName, fileSize, mimeType, fileUrl, description, isAnswerAttachment } = parseResult.data;

    let storageKey: string;
    let isObjectPath = false;
    try {
      const parsedUrl = new URL(fileUrl);
      if (parsedUrl.protocol !== "https:") {
        return res.status(400).json({ error: "fileUrl must use https" });
      }
      const blockedHosts = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|0\.0\.0\.0|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i;
      if (blockedHosts.test(parsedUrl.hostname)) {
        return res.status(400).json({ error: "fileUrl must not point to an internal/private address" });
      }
    } catch {
      logWarn("Non-critical operation failed");
      isObjectPath = true;
    }

    if (isObjectPath) {
      // Caller supplied a storage path directly (not an https:// URL). Verify
      // the object actually belongs to their org before recording it as an
      // attachment, otherwise a tenant could attach another tenant's file.
      try {
        await assertStorageKeyBelongsToOrg(fileUrl, organizationId, user.id, user.role);
      } catch (err: any) {
        return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
      }
      storageKey = fileUrl;
    } else {
      const objectUUID = randomUUID();
      const objectPath = `${organizationId}/rfis/${rfi.id}/${objectUUID}/${fileName}`;
      try {
        const response = await fetch(`http://127.0.0.1:1106/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl, objectPath }),
        });
        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          logError(`GCS sidecar upload failed (${response.status}): ${errBody}`);
          return res.status(502).json({ error: "File storage upload failed" });
        }
        const data = await response.json() as { storageKey?: string };
        storageKey = data.storageKey || objectPath;
      } catch (sidecarErr) {
        logError("GCS sidecar unreachable:", {}, sidecarErr instanceof Error ? sidecarErr : new Error(String(sidecarErr)));
        return res.status(502).json({ error: "File storage service unavailable" });
      }
    }

    const [dbUser] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const uploadedByName = dbUser ? `${dbUser.firstName} ${dbUser.lastName}` : user.id;

    const [newAttachment] = await db.insert(rfiAttachments).values({
      rfiId: rfi.id,
      organizationId,
      fileName,
      fileSize: fileSize ?? null,
      mimeType: mimeType ?? null,
      storageKey,
      uploadedById: user.id,
      uploadedByName,
      description: description ?? null,
      isAnswerAttachment: isAnswerAttachment ?? false,
    }).returning();

    await createActivityEntry(rfi.id, user.id, uploadedByName, `Attachment uploaded: ${fileName}`);

    res.status(201).json(newAttachment);
  } catch (error) {
    next(error);
  }
});

router.delete("/rfi/:id/attachments/:attachmentId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rfi, denied } = await getRfiWithOrgCheck(req.params.id, req);
    if (denied) return res.status(403).json({ error: "Access denied" });
    if (!rfi) return res.status(404).json({ error: "RFI not found" });

    const { attachmentId } = req.params;

    const [attachment] = await db
      .select()
      .from(rfiAttachments)
      .where(and(eq(rfiAttachments.id, attachmentId), eq(rfiAttachments.rfiId, rfi.id)))
      .limit(1);

    if (!attachment) return res.status(404).json({ error: "Attachment not found" });

    const user = req.user!;
    if (attachment.uploadedById !== user.id && !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "You don't have permission to delete this attachment" });
    }

    if (attachment.storageKey) {
      try {
        const delResponse = await fetch(`http://127.0.0.1:1106/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey: attachment.storageKey }),
        });
        if (!delResponse.ok) {
          const errBody = await delResponse.text().catch(() => "");
          logError(`GCS sidecar delete failed (${delResponse.status}): ${errBody}`);
          return res.status(502).json({ error: "File storage deletion failed; attachment record not removed" });
        }
      } catch (sidecarErr) {
        logError("GCS sidecar unreachable during delete:", {}, sidecarErr instanceof Error ? sidecarErr : new Error(String(sidecarErr)));
        return res.status(502).json({ error: "File storage service unavailable; attachment record not removed" });
      }
    }

    await db.delete(rfiAttachments).where(eq(rfiAttachments.id, attachmentId));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
