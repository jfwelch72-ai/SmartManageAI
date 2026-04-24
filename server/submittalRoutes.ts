/**
 * @openapi
 * /api/submittals:
 *   get:
 *     tags: [Documents]
 *     summary: List submittals
 *     description: Returns submittals for the organization.
 *     parameters:
 *       - name: projectId
 *         in: query
 *         schema: { type: string, format: uuid }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of submittals }
 *   post:
 *     tags: [Documents]
 *     summary: Create a submittal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId, title, specSection]
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               title: { type: string }
 *               specSection: { type: string }
 *               description: { type: string }
 *               assignedToId: { type: string, format: uuid }
 *               dueDate: { type: string, format: date }
 *     responses:
 *       201: { description: Submittal created }
 * /api/submittals/stats:
 *   get:
 *     tags: [Documents]
 *     summary: Get submittal statistics
 *     responses:
 *       200: { description: Submittal stats by status }
 * /api/submittals/{id}:
 *   get:
 *     tags: [Documents]
 *     summary: Get submittal details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal details }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Documents]
 *     summary: Update a submittal
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
 *       200: { description: Submittal updated }
 *   delete:
 *     tags: [Documents]
 *     summary: Delete a submittal
 *     description: Requires SUPER_ADMIN or ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal deleted }
 * /api/submittals/{id}/link-rfi:
 *   post:
 *     tags: [Documents]
 *     summary: Link submittal to an RFI
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Linked to RFI }
 * /api/submittals/{id}/activity:
 *   get:
 *     tags: [Documents]
 *     summary: Get submittal activity log
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Activity log }
 *   post:
 *     tags: [Documents]
 *     summary: Add submittal activity entry
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Activity added }
 * /api/submittals/{id}/files:
 *   get:
 *     tags: [Documents]
 *     summary: List submittal files
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of files }
 *   post:
 *     tags: [Documents]
 *     summary: Upload file to submittal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: File uploaded }
 * /api/submittals/{id}/files/{fileId}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete submittal file
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
 * /api/submittals/{id}/items:
 *   get:
 *     tags: [Documents]
 *     summary: List submittal items
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal items }
 *   post:
 *     tags: [Documents]
 *     summary: Add submittal item
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
 *       201: { description: Item added }
 * /api/submittals/{id}/items/{itemId}:
 *   patch:
 *     tags: [Documents]
 *     summary: Update submittal item
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: itemId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Item updated }
 *   delete:
 *     tags: [Documents]
 *     summary: Delete submittal item
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: itemId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Item deleted }
 * /api/submittals/{id}/reviews:
 *   get:
 *     tags: [Documents]
 *     summary: List submittal reviews
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of reviews }
 *   post:
 *     tags: [Documents]
 *     summary: Create submittal review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Review created }
 * /api/submittals/{id}/reviews/{reviewId}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete submittal review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: reviewId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Review deleted }
 * /api/submittals/{id}/reviews/{reviewId}/start:
 *   post:
 *     tags: [Documents]
 *     summary: Start a submittal review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: reviewId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Review started }
 * /api/submittals/{id}/reviews/{reviewId}/stamp:
 *   post:
 *     tags: [Documents]
 *     summary: Stamp a submittal review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: reviewId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Review stamped }
 * /api/submittals/{id}/attachments:
 *   get:
 *     tags: [Documents]
 *     summary: List submittal attachments
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of attachments }
 *   post:
 *     tags: [Documents]
 *     summary: Add attachment to submittal
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
 * /api/submittals/{id}/attachments/{attachmentId}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete submittal attachment
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
 * /api/submittals/{id}/attachments/{attachmentId}/download:
 *   get:
 *     tags: [Documents]
 *     summary: Download submittal attachment
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
 *       200: { description: Attachment file content }
 * /api/submittals/{id}/submit:
 *   post:
 *     tags: [Documents]
 *     summary: Submit a submittal for review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal submitted }
 * /api/submittals/{id}/review:
 *   post:
 *     tags: [Documents]
 *     summary: Mark submittal as under review
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Under review }
 * /api/submittals/{id}/approve:
 *   post:
 *     tags: [Documents]
 *     summary: Approve a submittal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal approved }
 * /api/submittals/{id}/approve-as-noted:
 *   post:
 *     tags: [Documents]
 *     summary: Approve submittal as noted
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal approved as noted }
 * /api/submittals/{id}/reject:
 *   post:
 *     tags: [Documents]
 *     summary: Reject a submittal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal rejected }
 * /api/submittals/{id}/revise:
 *   post:
 *     tags: [Documents]
 *     summary: Revise a submittal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Revision created }
 * /api/submittals/{id}/resubmit:
 *   post:
 *     tags: [Documents]
 *     summary: Resubmit a submittal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Submittal resubmitted }
 */
import {logError, logWarn } from "./utils/logger";
import { safeJsonParse } from "./responseHelper";
import { Router, Response, NextFunction } from "express";
import { db } from "./db";
import {
  insertSubmittalSchema,
  insertSubmittalItemSchema,
  insertSubmittalReviewSchema,
  submittals,
  submittalActivity,
  submittalItems,
  submittalReviews,
  submittalAttachments,
  projects,
  users,
  crmOrganisations,
  rfis,
} from "@shared/schema";
import { eq, and, desc, sql, asc, max, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireRole, requireRoleOrFeature, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyDocumentEvent } from "./services/documentNotificationService";
import { generateSubmittalLogPdf } from "./services/logPdfService";
import { fetchProjectBranding, fetchProjectSubmittalLogRows } from "./services/projectLogService";
import { assertStorageKeyBelongsToOrg } from "./services/documentRevisionService";
import { ObjectPermission } from "./objectAcl";
import { notifyApprovers, notifySubmitter, notifyUsers } from "./services/approvalNotificationService";

const router = Router();

// ========================================
// Routes from submittalRoutes.ts
// ========================================

router.get("/submittals", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { projectId, status, phase, submittalType, category } = req.query;

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    if (projectId) {
      conditions.push(eq(submittals.projectId, projectId as string));
    }
    if (status) {
      conditions.push(eq(submittals.status, status as string));
    }
    if (phase) {
      conditions.push(eq(submittals.phase, phase as string));
    }
    if (submittalType) {
      conditions.push(eq(submittals.submittalType, submittalType as string));
    }
    if (category) {
      conditions.push(eq(submittals.submittalCategory, category as string));
    }

    const filtered = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(submittals.createdAt));

    const result = filtered.map(s => ({
      ...s.submittal,
      project: s.project,
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/submittals/stats", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    const { projectId } = req.query;
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(submittals.projectId, projectId));
    }

    const allSubmittals = await db
      .select({
        status: submittals.status,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const filtered = allSubmittals;

    const stats = {
      total: filtered.length,
      submitted: filtered.filter(s => s.status === "SUBMITTED").length,
      under_review: filtered.filter(s => s.status === "UNDER_REVIEW").length,
      approved: filtered.filter(s => s.status === "APPROVED" || s.status === "APPROVED_AS_NOTED").length,
      rejected: filtered.filter(s => s.status === "REJECTED").length,
      revise: filtered.filter(s => s.status === "REVISE_AND_RESUBMIT").length,
      pendingReview: filtered.filter(s => s.status === "SUBMITTED" || s.status === "UNDER_REVIEW").length,
      needsAction: filtered.filter(s => s.status === "REJECTED" || s.status === "REVISE_AND_RESUBMIT").length,
    };

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

router.get("/submittals/:id", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [result] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!result) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && result.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    let subcontractor = null;
    if (result.submittal.subcontractorId) {
      const [sub] = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, result.submittal.subcontractorId))
        .limit(1);
      subcontractor = sub || null;
    }

    let reviewer = null;
    if (result.submittal.reviewerId) {
      const [rev] = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, result.submittal.reviewerId))
        .limit(1);
      reviewer = rev || null;
    }

    let linkedRfi = null;
    if (result.submittal.linkedRfiId) {
      const [rfi] = await db
        .select()
        .from(rfis)
        .where(eq(rfis.id, result.submittal.linkedRfiId))
        .limit(1);
      linkedRfi = rfi || null;
    }

    const activityLog = await db
      .select()
      .from(submittalActivity)
      .where(eq(submittalActivity.submittalId, id))
      .orderBy(desc(submittalActivity.createdAt));

    res.json({
      ...result.submittal,
      project: result.project,
      subcontractor,
      reviewer,
      linkedRfi,
      activity: activityLog,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/submittals", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = user.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: "User must belong to an organization" });
    }

    const body = {
      ...req.body,
      organizationId,
      submittedById: user.id,
      submittedByName: `${user.firstName} ${user.lastName}`,
    };

    if (body.dateRequired && typeof body.dateRequired === 'string') {
      body.dateRequired = new Date(body.dateRequired);
    }

    const createSubmittalSchema = insertSubmittalSchema.omit({ submittalNumber: true });
    const validationResult = createSubmittalSchema.safeParse(body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Validation failed", details: validationResult.error.flatten() });
    }

    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(submittals)
      .where(eq(submittals.projectId, body.projectId));

    const submittalNumber = `SUB-${String(countResult.count + 1).padStart(3, "0")}`;

    const [newSubmittal] = await db
      .insert(submittals)
      .values({
        ...validationResult.data,
        submittalNumber,
        status: "DRAFT",
      })
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: newSubmittal.id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Created",
    });

    res.status(201).json(newSubmittal);
  } catch (error) {
    next(error);
  }
});

router.patch("/submittals/:id", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT submittals can be updated" });
    }

    const allowedFields = ["subject", "description", "specSection", "category", "submittalCategory", "phase", "dateRequired", "attachmentsJson"];
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === "dateRequired" && req.body[field]) {
          updates[field] = new Date(req.body[field]);
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    const [updated] = await db
      .update(submittals)
      .set(updates)
      .where(eq(submittals.id, id))
      .returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Updated",
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/submittals/:id/link-rfi", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const { rfiId } = req.body;
    if (!rfiId) {
      return res.status(400).json({ error: "rfiId is required" });
    }

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [rfi] = await db
      .select()
      .from(rfis)
      .where(eq(rfis.id, rfiId))
      .limit(1);

    if (!rfi) {
      return res.status(404).json({ error: "RFI not found" });
    }

    const [updated] = await db
      .update(submittals)
      .set({
        linkedRfiId: rfiId,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Linked to RFI ${rfi.rfiNumber}`,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/submittals/:id/activity", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const user = req.user!;
    const { comment, attachmentsJson } = req.body;

    if (!comment) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const [entry] = await db
      .insert(submittalActivity)
      .values({
        submittalId: id,
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

router.get("/submittals/:id/activity", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activityLog = await db
      .select()
      .from(submittalActivity)
      .where(eq(submittalActivity.submittalId, id))
      .orderBy(desc(submittalActivity.createdAt));

    res.json(activityLog);
  } catch (error) {
    next(error);
  }
});

router.delete("/submittals/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT submittals can be deleted" });
    }

    await db
      .delete(submittalActivity)
      .where(eq(submittalActivity.submittalId, id));

    await db
      .delete(submittals)
      .where(eq(submittals.id, id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/submittals/:id/files", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const fileSchema = z.object({
      fileUrl: z.string(),
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string(),
      description: z.string().optional(),
    });

    const validationResult = fileSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid file metadata", details: validationResult.error.errors });
    }

    const { fileUrl, fileName, fileSize, mimeType, description } = validationResult.data;

    // Verify the supplied fileUrl actually points at an object owned by the
    // caller's org. Without this check a tenant could clobber another
    // tenant's ACL by aiming this endpoint at someone else's storage key.
    if (!req.user!.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }
    try {
      await assertStorageKeyBelongsToOrg(fileUrl, req.user!.organizationId, req.user!.id, req.user!.role);
    } catch (err: any) {
      return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(fileUrl, {
      owner: req.user!.id,
      organizationId: req.user!.organizationId,
      visibility: "private",
    });

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);

    const currentAttachments = existing.submittal.attachmentsJson
      ? safeJsonParse(existing.submittal.attachmentsJson, [])
      : [];

    const newAttachment = {
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fileUrl,
      fileName,
      fileSize,
      mimeType,
      description: description || "",
      uploadedById: req.user!.id,
      uploadedByName: `${user.firstName} ${user.lastName}`,
      uploadedAt: new Date().toISOString(),
      objectKey,
    };

    const updatedAttachments = [...currentAttachments, newAttachment];

    await db.update(submittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(submittals.id, id));

    res.status(201).json(newAttachment);
  } catch (error) {
    next(error);
  }
});

router.get("/submittals/:id/files", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const attachments = existing.submittal.attachmentsJson
      ? safeJsonParse(existing.submittal.attachmentsJson, [])
      : [];

    res.json(attachments);
  } catch (error) {
    next(error);
  }
});

router.delete("/submittals/:id/files/:fileId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        project: {
          id: projects.id,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.project?.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const currentAttachments = existing.submittal.attachmentsJson
      ? safeJsonParse(existing.submittal.attachmentsJson, [])
      : [];

    const fileIndex = currentAttachments.findIndex((f: any) => f.id === req.params.fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = currentAttachments[fileIndex];
    const userRole = req.user!.role;
    if (file.uploadedById !== req.user!.id && !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(userRole)) {
      return res.status(403).json({ error: "You don't have permission to delete this file" });
    }

    // Defense in depth: ensure the stored objectKey/fileUrl actually belongs
    // to the caller's org. Even though the parent submittal is org-scoped,
    // historical rows could reference another tenant's storage key.
    const storageRef: string | undefined = file.objectKey || file.fileUrl;
    if (storageRef && req.user!.organizationId) {
      try {
        await assertStorageKeyBelongsToOrg(storageRef, req.user!.organizationId, req.user!.id, userRole);
      } catch (err: any) {
        return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
      }
    }

    const updatedAttachments = currentAttachments.filter((_: any, i: number) => i !== fileIndex);

    await db.update(submittals).set({
      attachmentsJson: JSON.stringify(updatedAttachments),
      updatedAt: new Date(),
    }).where(eq(submittals.id, id));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Submittal Items ====================

router.get("/submittals/:id/items", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const items = await db
      .select()
      .from(submittalItems)
      .where(eq(submittalItems.submittalId, id))
      .orderBy(asc(submittalItems.itemNumber));

    res.json(items);
  } catch (error) {
    next(error);
  }
});

router.post("/submittals/:id/items", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Can only add items to DRAFT submittals" });

    const user = req.user!;
    const organizationId = existing.submittal.organizationId;

    const [maxResult] = await db
      .select({ maxNum: max(submittalItems.itemNumber) })
      .from(submittalItems)
      .where(eq(submittalItems.submittalId, id));

    const itemNumber = (maxResult?.maxNum ?? 0) + 1;

    const body = { ...req.body, submittalId: id, organizationId, itemNumber };
    const validation = insertSubmittalItemSchema.safeParse(body);
    if (!validation.success) return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });

    const [newItem] = await db.insert(submittalItems).values(validation.data).returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Item ${itemNumber} added`,
    });

    res.status(201).json(newItem);
  } catch (error) {
    next(error);
  }
});

router.patch("/submittals/:id/items/:itemId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, itemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Can only edit items on DRAFT submittals" });

    const [item] = await db.select().from(submittalItems).where(and(eq(submittalItems.id, itemId), eq(submittalItems.submittalId, id))).limit(1);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const patchSchema = z.object({
      description: z.string().optional(),
      specSection: z.string().nullable().optional(),
      submittalCategory: z.enum(["SHOP_DRAWING", "PRODUCT_DATA", "MATERIAL_APPROVAL", "ENGINEERING_APPROVAL", "SAMPLE", "OPERATION_AND_MAINTENANCE", "OTHER"]).nullable().optional(),
      quantity: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
      manufacturer: z.string().nullable().optional(),
      modelNumber: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      status: z.string().optional(),
    });

    const patchResult = patchSchema.safeParse(req.body);
    if (!patchResult.success) return res.status(400).json({ error: "Validation failed", details: patchResult.error.flatten() });

    const patchData = patchResult.data;
    const updates: Partial<typeof submittalItems.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (patchData.description !== undefined) updates.description = patchData.description;
    if (patchData.specSection !== undefined) updates.specSection = patchData.specSection;
    if (patchData.submittalCategory !== undefined) updates.submittalCategory = patchData.submittalCategory;
    if (patchData.quantity !== undefined) updates.quantity = patchData.quantity;
    if (patchData.unit !== undefined) updates.unit = patchData.unit;
    if (patchData.manufacturer !== undefined) updates.manufacturer = patchData.manufacturer;
    if (patchData.modelNumber !== undefined) updates.modelNumber = patchData.modelNumber;
    if (patchData.notes !== undefined) updates.notes = patchData.notes;
    if (patchData.status !== undefined) updates.status = patchData.status;

    const [updated] = await db.update(submittalItems).set(updates).where(eq(submittalItems.id, itemId)).returning();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/submittals/:id/items/:itemId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, itemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Items can only be deleted from DRAFT submittals" });

    const [item] = await db.select().from(submittalItems).where(and(eq(submittalItems.id, itemId), eq(submittalItems.submittalId, id))).limit(1);
    if (!item) return res.status(404).json({ error: "Item not found" });

    await db.delete(submittalItems).where(eq(submittalItems.id, itemId));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Submittal Reviews ====================

router.get("/submittals/:id/reviews", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const reviews = await db
      .select()
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .orderBy(asc(submittalReviews.sequenceOrder));

    res.json(reviews);
  } catch (error) {
    next(error);
  }
});

router.post("/submittals/:id/reviews", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Reviewers can only be added to DRAFT submittals" });

    const organizationId = existing.submittal.organizationId;
    const body = { ...req.body, submittalId: id, organizationId };
    const validation = insertSubmittalReviewSchema.safeParse(body);
    if (!validation.success) return res.status(400).json({ error: "Validation failed", details: validation.error.flatten() });

    const [newReview] = await db.insert(submittalReviews).values(validation.data).returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Reviewer added: ${newReview.reviewerName} (${newReview.reviewerRole})`,
    });

    res.status(201).json(newReview);
  } catch (error) {
    next(error);
  }
});

router.delete("/submittals/:id/reviews/:reviewId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, reviewId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });
    if (existing.submittal.status !== "DRAFT") return res.status(400).json({ error: "Reviewers can only be removed from DRAFT submittals" });

    const [review] = await db.select().from(submittalReviews).where(and(eq(submittalReviews.id, reviewId), eq(submittalReviews.submittalId, id))).limit(1);
    if (!review) return res.status(404).json({ error: "Review not found" });

    await db.delete(submittalReviews).where(eq(submittalReviews.id, reviewId));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Submittal Attachments ====================


router.get("/submittals/:id/attachments", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const attachments = await db
      .select()
      .from(submittalAttachments)
      .where(eq(submittalAttachments.submittalId, id))
      .orderBy(desc(submittalAttachments.createdAt));

    res.json(attachments);
  } catch (error) {
    next(error);
  }
});

router.get("/submittals/:id/attachments/:attachmentId/download", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canAccessProjects"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, attachmentId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const [attachment] = await db
      .select()
      .from(submittalAttachments)
      .where(and(eq(submittalAttachments.id, attachmentId), eq(submittalAttachments.submittalId, id)))
      .limit(1);

    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    if (!attachment.storageKey) return res.status(404).json({ error: "No file stored for this attachment" });

    try {
      const user = req.user!;
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const normalized = objectStorageService.normalizeObjectEntityPath(attachment.storageKey);
      const objectFile = await objectStorageService.getObjectEntityFile(normalized);

      // Defense-in-depth: enforce ACL on the underlying object before issuing
      // a signed URL so a forged/cross-tenant attachment row cannot leak
      // another org's bytes.
      const allowed = await objectStorageService.canAccessObjectEntity({
        userId: user.id,
        userOrganizationId: user.organizationId!,
        objectFile,
        requestedPermission: ObjectPermission.READ,
        userRole: (user as any).effectiveRole || user.role,
      });
      if (!allowed) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const signedUrl = await objectStorageService.getSignedDownloadUrl(objectFile, 3600);
      res.json({ url: signedUrl });
    } catch (innerErr) {
      logWarn("Non-critical operation failed");
      next(innerErr);
    }
  } catch (error) {
    next(error);
  }
});

router.post("/submittals/:id/attachments", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const user = req.user!;
    const organizationId = existing.submittal.organizationId;

    const uploadSchema = z.object({
      fileName: z.string(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      fileUrl: z.string(),
      submittalItemId: z.string().optional(),
      submittalReviewId: z.string().optional(),
      description: z.string().optional(),
    });

    const parseResult = uploadSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten() });

    const { fileName, fileSize, mimeType, fileUrl, submittalItemId, submittalReviewId, description } = parseResult.data;

    // Validate cross-tenant FK references
    if (submittalItemId) {
      const [itemRef] = await db
        .select({ id: submittalItems.id })
        .from(submittalItems)
        .where(and(eq(submittalItems.id, submittalItemId), eq(submittalItems.submittalId, id), eq(submittalItems.organizationId, organizationId)))
        .limit(1);
      if (!itemRef) return res.status(400).json({ error: "submittalItemId does not belong to this submittal" });
    }

    if (submittalReviewId) {
      const [reviewRef] = await db
        .select({ id: submittalReviews.id })
        .from(submittalReviews)
        .where(and(eq(submittalReviews.id, submittalReviewId), eq(submittalReviews.submittalId, id), eq(submittalReviews.organizationId, organizationId)))
        .limit(1);
      if (!reviewRef) return res.status(400).json({ error: "submittalReviewId does not belong to this submittal" });
    }

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
      // Caller supplied a storage path directly. Verify the object belongs to
      // their org so a tenant cannot attach another tenant's file.
      try {
        await assertStorageKeyBelongsToOrg(fileUrl, organizationId, user.id, user.role);
      } catch (err: any) {
        return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
      }
      storageKey = fileUrl;
    } else {
      const objectUUID = randomUUID();
      const objectPath = `${organizationId}/submittals/${id}/${objectUUID}/${fileName}`;
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

    const [newAttachment] = await db.insert(submittalAttachments).values({
      submittalId: id,
      organizationId,
      submittalItemId: submittalItemId ?? null,
      submittalReviewId: submittalReviewId ?? null,
      fileName,
      fileSize: fileSize ?? null,
      mimeType: mimeType ?? null,
      storageKey,
      uploadedById: user.id,
      uploadedByName,
      description: description ?? null,
    }).returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: uploadedByName,
      action: `Attachment uploaded: ${fileName}`,
    });


    res.status(201).json(newAttachment);
  } catch (error) {
    next(error);
  }
});

router.delete("/submittals/:id/attachments/:attachmentId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, attachmentId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({ submittal: submittals, gcOrganizationId: projects.gcOrganizationId })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    const [attachment] = await db
      .select()
      .from(submittalAttachments)
      .where(and(eq(submittalAttachments.id, attachmentId), eq(submittalAttachments.submittalId, id)))
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

    await db.delete(submittalAttachments).where(eq(submittalAttachments.id, attachmentId));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from submittalWorkflowRoutes.ts
// ========================================

// ==================== Chain Advancement Service ====================

export async function advanceChain(submittalId: string, actorUserId: string, organizationId?: string): Promise<void> {
  const [submittal] = await db
    .select()
    .from(submittals)
    .where(eq(submittals.id, submittalId))
    .limit(1);
  if (!submittal) return;

  const chain = await db
    .select()
    .from(submittalReviews)
    .where(eq(submittalReviews.submittalId, submittalId))
    .orderBy(asc(submittalReviews.sequenceOrder));

  if (chain.length === 0) return;

  const stampedRows = chain.filter(r =>
    r.status === "APPROVED" || r.status === "APPROVED_AS_NOTED" ||
    r.status === "REJECTED" || r.status === "REVISE_AND_RESUBMIT"
  );

  const lastStamped = stampedRows.reduce<typeof chain[0] | null>((latest, r) => {
    if (!latest) return r;
    return (r.dateReviewed && latest.dateReviewed && r.dateReviewed > latest.dateReviewed) ? r : latest;
  }, null);

  if (!lastStamped) return;

  const stoppingAction = lastStamped.status === "REJECTED" || lastStamped.status === "REVISE_AND_RESUBMIT";

  if (stoppingAction) {
    const stopStatus = lastStamped.status as "REJECTED" | "REVISE_AND_RESUBMIT";
    await db
      .update(submittals)
      .set({
        status: stopStatus,
        dateReviewed: lastStamped.dateReviewed,
        stampAction: lastStamped.stampAction,
        reviewComments: lastStamped.comments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, submittalId));

    await db.insert(submittalActivity).values({
      submittalId,
      userId: actorUserId,
      userName: lastStamped.reviewerName,
      action: `Review chain stopped: ${lastStamped.reviewerName} (${lastStamped.reviewerRole}) — ${lastStamped.status}`,
      comment: lastStamped.comments || null,
    });

    if (submittal.submittedById) {
      await notifySubmitter(submittal.submittedById, {
        type: "SUBMITTAL_REJECTED",
        title: `Submittal ${lastStamped.status === "REJECTED" ? "Rejected" : "Requires Revision"}`,
        message: `Submittal ${submittal.submittalNumber} "${submittal.subject}" was ${lastStamped.status === "REJECTED" ? "rejected" : "marked for revision"} by ${lastStamped.reviewerName}`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      }, organizationId);
    }
    return;
  }

  const allStamped = chain.every(r =>
    r.status === "APPROVED" || r.status === "APPROVED_AS_NOTED" ||
    r.status === "REJECTED" || r.status === "REVISE_AND_RESUBMIT"
  );

  if (allStamped) {
    const hasApprovedAsNoted = chain.some(r => r.status === "APPROVED_AS_NOTED");
    const finalStatus = hasApprovedAsNoted ? "APPROVED_AS_NOTED" : "APPROVED";

    await db
      .update(submittals)
      .set({
        status: finalStatus,
        dateReviewed: new Date(),
        stampAction: finalStatus,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, submittalId));

    await db.insert(submittalActivity).values({
      submittalId,
      userId: actorUserId,
      userName: "System",
      action: `All reviews complete — submittal ${finalStatus === "APPROVED_AS_NOTED" ? "approved as noted" : "approved"}`,
    });

    if (submittal.submittedById) {
      await notifySubmitter(submittal.submittedById, {
        type: "SUBMITTAL_APPROVED",
        title: `Submittal ${finalStatus === "APPROVED_AS_NOTED" ? "Approved As Noted" : "Approved"}`,
        message: `Submittal ${submittal.submittalNumber} "${submittal.subject}" has been fully approved`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      }, organizationId);
    }
    return;
  }

  const nextPending = chain.find(r => r.status === "PENDING");
  if (nextPending) {
    await db
      .update(submittalReviews)
      .set({
        status: "IN_REVIEW",
        dateAssigned: new Date(),
      })
      .where(eq(submittalReviews.id, nextPending.id));

    // Bump submittals.updatedAt so mobile sync picks up the parent
    // row alongside the activated review (mobile delta filters on
    // submittals.updatedAt, not just on submittal_reviews).
    await db
      .update(submittals)
      .set({ updatedAt: new Date() })
      .where(eq(submittals.id, submittalId));

    await db.insert(submittalActivity).values({
      submittalId,
      userId: actorUserId,
      userName: "System",
      action: `Review advanced to ${nextPending.reviewerName} (${nextPending.reviewerRole})`,
    });

    // Internal in-app/native push when the next reviewer is a user.
    if (nextPending.reviewerId) {
      await notifyUsers([nextPending.reviewerId], {
        type: "GENERAL",
        title: "Your Review Is Required",
        message: `Submittal ${submittal.submittalNumber} "${submittal.subject}" is awaiting your review`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      }, organizationId);
    }

    // External portal-link email when the next review row is an
    // email-only A/E reviewer (no reviewerId). Mirrors the manual
    // /start route — both paths now activate external reviewers.
    if (!nextPending.reviewerId && nextPending.reviewerEmail) {
      try {
        const itemCountRow = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(submittalItems)
          .where(eq(submittalItems.submittalId, submittalId));
        const itemCount = itemCountRow[0]?.count ?? 0;

        await notifyDocumentEvent(
          "SUBMITTAL",
          submittalId,
          submittal.organizationId,
          submittal.projectId,
          actorUserId,
          [],
          `Submittal ${submittal.submittalNumber} "${submittal.subject}" is awaiting your review`,
          submittal.submittalNumber,
          {
            email: nextPending.reviewerEmail,
            documentNumber: submittal.submittalNumber,
            documentSubject: submittal.subject,
            kind: "SUBMITTAL_REVIEW",
            inviterName: nextPending.reviewerName ?? "Project team",
            dueDate: submittal.dateRequired ?? null,
            itemCount,
          },
        );
      } catch (err) {
        // Email/notification failure must not block chain advancement.
        // notifyDocumentEvent already logs internally.
      }
    }

    if (submittal.submittedById) {
      await notifySubmitter(submittal.submittedById, {
        type: "GENERAL",
        title: "Review Chain Advanced",
        message: `${lastStamped.reviewerName} reviewed — now awaiting ${nextPending.reviewerName} (${nextPending.reviewerRole})`,
        relatedEntityId: submittalId,
        relatedEntityType: "submittal",
      }, organizationId);
    }
  }
}

// ==================== Submit ====================

router.post("/submittals/:id/submit", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "DRAFT") {
      return res.status(400).json({ error: "Only DRAFT submittals can be submitted" });
    }

    const [updated] = await db
      .update(submittals)
      .set({
        status: "SUBMITTED",
        dateSubmitted: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Submitted",
    });

    const submitRecipients: string[] = [];
    if (existing.submittal.reviewerId) submitRecipients.push(existing.submittal.reviewerId);
    if (submitRecipients.length > 0) {
      notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, submitRecipients, `Submittal Submitted: ${existing.submittal.subject}`, existing.submittal.submittalNumber);
    }

    await notifyApprovers(
      existing.submittal.organizationId,
      user.id,
      {
        type: "SUBMITTAL_SUBMITTED",
        title: "Submittal Submitted",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been submitted for review`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      }
    );

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==================== Review (legacy — start review without chain) ====================

router.post("/submittals/:id/review", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "SUBMITTED") {
      return res.status(400).json({ error: "Only SUBMITTED submittals can be reviewed" });
    }

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the review chain start route instead." });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "UNDER_REVIEW",
        reviewerId: user.id,
        reviewerName: `${user.firstName} ${user.lastName}`,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Under Review",
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==================== Review Chain — Start ====================

router.post("/submittals/:id/reviews/:reviewId/start", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, reviewId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    if (existing.submittal.status !== "SUBMITTED") {
      return res.status(400).json({ error: "Only SUBMITTED submittals can start a review chain" });
    }

    const chain = await db
      .select()
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .orderBy(asc(submittalReviews.sequenceOrder));

    if (chain.length === 0) {
      return res.status(400).json({ error: "No review chain configured" });
    }

    const targetReview = chain.find(r => r.id === reviewId);
    if (!targetReview) return res.status(404).json({ error: "Review not found" });

    const lowestPending = chain.find(r => r.status === "PENDING");
    if (!lowestPending || lowestPending.id !== reviewId) {
      return res.status(400).json({ error: "Can only start the lowest-sequence PENDING review" });
    }

    const [updatedReview] = await db
      .update(submittalReviews)
      .set({ status: "IN_REVIEW", dateAssigned: new Date() })
      .where(eq(submittalReviews.id, reviewId))
      .returning();

    await db
      .update(submittals)
      .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
      .where(eq(submittals.id, id));

    const user = req.user!;
    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Review started — ${targetReview.reviewerName} (${targetReview.reviewerRole})`,
    });

    // Task #1599 — single fanout call. Routes (a) the in-app + native
    // push notification to the internal reviewer (when present) AND
    // (b) the external portal-link email to an A/E reviewer recorded
    // by email-only on the review row. Both paths flow through
    // notifyDocumentEvent so audit + EXTERNAL_DOC_EMAIL gating stay
    // unified, mirroring the RFI forward branch.
    // Item count for the email body — gives the external reviewer a
    // quick scope hint before they open the portal.
    const [itemCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(submittalItems)
      .where(eq(submittalItems.submittalId, id));
    const itemCount = itemCountRow?.count ?? 0;

    notifyDocumentEvent(
      "SUBMITTAL",
      id,
      existing.submittal.organizationId,
      existing.submittal.projectId,
      user.id,
      targetReview.reviewerId ? [targetReview.reviewerId] : [],
      `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" is awaiting your review`,
      existing.submittal.submittalNumber,
      targetReview.reviewerEmail
        ? {
            email: targetReview.reviewerEmail,
            documentNumber: existing.submittal.submittalNumber,
            documentSubject: existing.submittal.subject,
            kind: "SUBMITTAL_REVIEW",
            inviterName: `${user.firstName} ${user.lastName}`,
            dueDate: existing.submittal.dateRequired ?? null,
            itemCount,
          }
        : null,
    );

    res.json(updatedReview);
  } catch (error) {
    next(error);
  }
});

// ==================== Review Chain — Stamp ====================

const stampBodySchema = z.object({
  action: z.enum(["APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"]),
  comments: z.string().optional(),
});

router.post("/submittals/:id/reviews/:reviewId/stamp", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, reviewId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const parsed = stampBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { action, comments } = parsed.data;

    if ((action === "APPROVED_AS_NOTED" || action === "REJECTED" || action === "REVISE_AND_RESUBMIT") && !comments?.trim()) {
      return res.status(400).json({ error: "Comments are required for this stamp action" });
    }

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Submittal not found" });
    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) return res.status(403).json({ error: "Access denied" });

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Submittal must be UNDER_REVIEW to stamp a review" });
    }

    const [review] = await db
      .select()
      .from(submittalReviews)
      .where(and(eq(submittalReviews.id, reviewId), eq(submittalReviews.submittalId, id)))
      .limit(1);

    if (!review) return res.status(404).json({ error: "Review not found" });

    if (review.status !== "IN_REVIEW") {
      return res.status(400).json({ error: "Only IN_REVIEW rows can be stamped" });
    }

    const user = req.user!;
    const isAdminOrManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role);
    const isAssignedReviewer = !!review.reviewerId && review.reviewerId === user.id;

    if (!isAssignedReviewer && !isAdminOrManager) {
      return res.status(403).json({ error: "Only the assigned reviewer or an admin/manager can stamp this review" });
    }

    const [updatedReview] = await db
      .update(submittalReviews)
      .set({
        status: action,
        stampAction: action,
        comments: comments || null,
        dateReviewed: new Date(),
      })
      .where(eq(submittalReviews.id, reviewId))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `${review.reviewerName} (${review.reviewerRole}) stamped: ${action}`,
      comment: comments || null,
    });

    await advanceChain(id, user.id, req.user?.organizationId);

    res.json(updatedReview);
  } catch (error) {
    next(error);
  }
});

// ==================== Approve (legacy) ====================

router.post("/submittals/:id/approve", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Only UNDER_REVIEW submittals can be approved" });
    }

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "APPROVED",
        dateReviewed: new Date(),
        stampAction: "APPROVED",
        reviewComments: req.body.reviewComments || null,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Approved",
      comment: req.body.reviewComments || null,
    });

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Approved: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_APPROVED",
        title: "Submittal Approved",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been approved`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      }, req.user?.organizationId);
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==================== Approve As Noted (legacy) ====================

router.post("/submittals/:id/approve-as-noted", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!req.body.reviewComments) {
      return res.status(400).json({ error: "Review comments are required" });
    }

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Only UNDER_REVIEW submittals can be approved as noted" });
    }

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "APPROVED_AS_NOTED",
        dateReviewed: new Date(),
        stampAction: "APPROVED_AS_NOTED",
        reviewComments: req.body.reviewComments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Approved As Noted",
      comment: req.body.reviewComments,
    });

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Approved As Noted: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_APPROVED",
        title: "Submittal Approved As Noted",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been approved as noted`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      }, req.user?.organizationId);
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==================== Reject (legacy) ====================

router.post("/submittals/:id/reject", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!req.body.reviewComments) {
      return res.status(400).json({ error: "Review comments are required" });
    }

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Only UNDER_REVIEW submittals can be rejected" });
    }

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "REJECTED",
        dateReviewed: new Date(),
        stampAction: "REJECTED",
        reviewComments: req.body.reviewComments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Submittal Rejected",
      comment: req.body.reviewComments,
    });

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Rejected: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_REJECTED",
        title: "Submittal Rejected",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" has been rejected`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      }, req.user?.organizationId);
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==================== Revise (legacy) ====================

router.post("/submittals/:id/revise", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canAccessApprovals"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    if (!req.body.reviewComments) {
      return res.status(400).json({ error: "Review comments are required" });
    }

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "UNDER_REVIEW" && existing.submittal.status !== "REJECTED") {
      return res.status(400).json({ error: "Only UNDER_REVIEW or REJECTED submittals can be marked for revision" });
    }

    const chainRows = await db
      .select({ id: submittalReviews.id })
      .from(submittalReviews)
      .where(eq(submittalReviews.submittalId, id))
      .limit(1);

    if (chainRows.length > 0) {
      return res.status(400).json({ error: "This submittal has a review chain configured. Use the stamp route instead." });
    }

    const user = req.user!;
    const [updated] = await db
      .update(submittals)
      .set({
        status: "REVISE_AND_RESUBMIT",
        dateReviewed: new Date(),
        stampAction: "REVISE_AND_RESUBMIT",
        reviewComments: req.body.reviewComments,
        updatedAt: new Date(),
      })
      .where(eq(submittals.id, id))
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: "Revise and Resubmit",
      comment: req.body.reviewComments,
    });

    notifyDocumentEvent("SUBMITTAL", id, existing.submittal.organizationId, existing.submittal.projectId, user.id, [existing.submittal.submittedById], `Submittal Requires Revision: ${existing.submittal.subject}`, existing.submittal.submittalNumber);

    if (existing.submittal.submittedById) {
      await notifySubmitter(existing.submittal.submittedById, {
        type: "SUBMITTAL_REVISION_REQUESTED",
        title: "Submittal Revision Requested",
        message: `Submittal ${existing.submittal.submittalNumber} "${existing.submittal.subject}" requires revision`,
        relatedEntityId: id,
        relatedEntityType: "submittal",
      }, req.user?.organizationId);
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ==================== Resubmit ====================

router.post("/submittals/:id/resubmit", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], "canManageProcurement"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db
      .select({
        submittal: submittals,
        gcOrganizationId: projects.gcOrganizationId,
      })
      .from(submittals)
      .leftJoin(projects, eq(submittals.projectId, projects.id))
      .where(eq(submittals.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Submittal not found" });
    }

    if (shouldFilter && orgId && existing.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (existing.submittal.status !== "REJECTED" && existing.submittal.status !== "REVISE_AND_RESUBMIT") {
      return res.status(400).json({ error: "Only REJECTED or REVISE_AND_RESUBMIT submittals can be resubmitted" });
    }

    const user = req.user!;
    const current = existing.submittal;
    const newRevisionNumber = current.revisionNumber + 1;
    const newSubmittalNumber = `${current.submittalNumber}-R${newRevisionNumber}`;

    const [newSubmittal] = await db
      .insert(submittals)
      .values({
        organizationId: current.organizationId,
        projectId: current.projectId,
        contractId: current.contractId,
        submittalNumber: newSubmittalNumber,
        subject: current.subject,
        description: current.description,
        submittalType: current.submittalType,
        phase: current.phase,
        status: "DRAFT",
        specSection: current.specSection,
        category: current.category,
        subcontractorId: current.subcontractorId,
        submittedById: user.id,
        submittedByName: `${user.firstName} ${user.lastName}`,
        dateRequired: current.dateRequired,
        revisionNumber: newRevisionNumber,
        previousSubmittalId: current.id,
      })
      .returning();

    await db.insert(submittalActivity).values({
      submittalId: id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Resubmitted as revision ${newRevisionNumber}`,
    });

    await db.insert(submittalActivity).values({
      submittalId: newSubmittal.id,
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      action: `Created as revision ${newRevisionNumber} of ${current.submittalNumber}`,
    });

    res.status(201).json(newSubmittal);
  } catch (error) {
    next(error);
  }
});

// Task #1599 — Submittal Log PDF export. Project-scoped, manager-only,
// streams a PDFKit document directly to the response (no temp file).
router.get(
  "/projects/:projectId/submittals/log.pdf",
  requireAuth,
  // Task #1599 — Field superintendents own the submittal workflow at
  // the jobsite level alongside PMs, so they get the log export too.
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req as AuthRequest);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

      const [project] = await db
        .select({
          id: projects.id,
          name: projects.name,
          gcOrganizationId: projects.gcOrganizationId,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Task #1606: shared row + branding fetch in
      // `services/projectLogService.ts` so the cron-driven scheduled
      // log email reuses identical join logic (ball-in-court via the
      // first open review, branding strip from the GC org row).
      const [rows, branding] = await Promise.all([
        fetchProjectSubmittalLogRows(projectId),
        fetchProjectBranding(project.gcOrganizationId),
      ]);

      const generatedByName = req.user
        ? `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || req.user.email || null
        : null;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="submittal-log-${project.name.replace(/[^a-z0-9]+/gi, "_")}.pdf"`,
      );
      const stream = generateSubmittalLogPdf({
        branding,
        projectName: project.name,
        meta: { generatedByName },
        rows,
      });
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
