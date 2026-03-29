import { Router } from "express";
import { db } from "./db";
import { bids, bidDocuments, takeoffSheets, quantityCategories, bimStoreyAssociations, projects, subcontractorContracts, subcontractors, subcontractorPayments, filePermissions } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, and, sql, max, inArray } from "drizzle-orm";
import { logAudit, logCreate } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { verifyOrgAccess, requireOrgOwnership } from "./orgFilter";
import { insertNotification } from "./services/notificationService";
import { createArcSegment } from "@shared/utils/geometry";
import { z } from "zod";

const router = Router();

function safeParsePoints(raw: any): any[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ========================================
// Routes from bidTakeoffRoutes.ts
// ========================================

async function getBidWithAccess(req: AuthRequest, res: any): Promise<any | null> {
  const { bidId } = req.params;
  const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
  if (!bid) { res.status(404).json({ error: "Bid not found" }); return null; }
  if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return null;
  return bid;
}

router.get("/api/bids/:bidId/takeoff/sheets", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const sheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bid.id))
      .orderBy(takeoffSheets.sheetIndex);
    res.json(sheets);
  } catch (error) {
    console.error("Get bid takeoff sheets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:bidId/takeoff/import-plan", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: "Document ID is required" });

    const [document] = await db.select().from(bidDocuments)
      .where(and(eq(bidDocuments.id, documentId), eq(bidDocuments.bidId, bid.id)))
      .limit(1);
    if (!document) return res.status(404).json({ error: "Document not found" });

    const existingSheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bid.id));
    const alreadyImported = existingSheets.some(s => s.imageUrl === document.fileUrl);
    if (alreadyImported) return res.status(400).json({ error: "This document is already imported to takeoff workspace" });

    let pageCount = 1;
    const isPdf = document.mimeType?.includes("pdf") || document.fileName?.toLowerCase().endsWith(".pdf");

    if (isPdf && document.objectKey) {
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
        const [pdfBuffer] = await objectFile.download();
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true });
        const pdfDoc = await loadingTask.promise;
        pageCount = pdfDoc.numPages;
      } catch (error: any) {
        console.error("Error processing PDF:", error);
        return res.status(400).json({ error: "Failed to process PDF file" });
      }
    }

    const baseSheetName = document.title || document.fileName.replace(/\.[^/.]+$/, '');
    const sheetValues = [];
    for (let i = 0; i < pageCount; i++) {
      sheetValues.push({
        bidId: bid.id,
        imageUrl: document.fileUrl,
        sheetIndex: existingSheets.length + i,
        sheetName: pageCount > 1 ? `${baseSheetName} - Page ${i + 1}` : baseSheetName,
      });
    }

    const sheets = await db.insert(takeoffSheets).values(sheetValues).returning();

    res.status(201).json({ sheets });
  } catch (error) {
    console.error("Import bid plan to takeoff error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:bidId/takeoff/plans", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const { fileUrl, fileName } = req.body;
    if (!fileUrl || !fileName) return res.status(400).json({ error: "File URL and name are required" });

    const existingSheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bid.id));

    const [sheet] = await db.insert(takeoffSheets).values({
      bidId: bid.id,
      imageUrl: fileUrl,
      sheetIndex: existingSheets.length,
      sheetName: fileName,
    }).returning();

    res.status(201).json({ sheets: [sheet] });
  } catch (error) {
    console.error("Upload bid plan error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bids/:bidId/takeoff/categories", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const categories = await db.select().from(quantityCategories)
      .where(eq(quantityCategories.bidId, bid.id))
      .orderBy(quantityCategories.displayOrder);
    res.json(categories);
  } catch (error) {
    console.error("Get bid quantity categories error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/takeoff/categories", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const categories = await db.select().from(quantityCategories)
      .where(eq(quantityCategories.projectId, projectId))
      .orderBy(quantityCategories.displayOrder);
    res.json(categories);
  } catch (error) {
    console.error("Get project quantity categories error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:bidId/takeoff/categories", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const name = sanitizeShortText(req.body.name);
    const color = req.body.color || "#3b82f6";
    const lineStyle = req.body.lineStyle || "solid";
    const lineWidth = req.body.lineWidth ?? 3;
    const displayOrder = req.body.displayOrder ?? 0;

    if (!name) return res.status(400).json({ error: "Category name is required" });

    const [category] = await db.insert(quantityCategories).values({
      bidId: bid.id,
      name,
      color,
      lineStyle,
      lineWidth,
      displayOrder,
    }).returning();

    res.status(201).json(category);
  } catch (error) {
    console.error("Create bid quantity category error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/bids/:bidId/takeoff/sheets/reorder", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) return res.status(400).json({ error: "Order array is required" });

    for (const item of order) {
      if (typeof item.id !== "string" || typeof item.sheetIndex !== "number") {
        return res.status(400).json({ error: "Each item must have id (string) and sheetIndex (number)" });
      }
    }

    await db.transaction(async (tx) => {
      for (const item of order) {
        await tx.update(takeoffSheets)
          .set({ sheetIndex: item.sheetIndex })
          .where(and(eq(takeoffSheets.id, item.id), eq(takeoffSheets.bidId, bid.id)));
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Reorder bid sheets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bids/:bidId/bim/storey-associations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const associations = await db.select().from(bimStoreyAssociations)
      .where(eq(bimStoreyAssociations.bidId, bid.id));

    res.json(associations);
  } catch (error) {
    console.error("Get storey associations error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:bidId/bim/storey-associations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const { sheetId, bimDocumentId, storeyExpressId, storeyName } = req.body;
    if (!sheetId || !bimDocumentId || storeyExpressId === undefined || !storeyName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedStoreyId = Number(storeyExpressId);
    if (!Number.isInteger(parsedStoreyId)) {
      return res.status(400).json({ error: "storeyExpressId must be an integer" });
    }

    const [sheet] = await db.select().from(takeoffSheets)
      .where(and(eq(takeoffSheets.id, sheetId), eq(takeoffSheets.bidId, bid.id)));
    if (!sheet) {
      return res.status(400).json({ error: "Sheet does not belong to this bid" });
    }

    const [doc] = await db.select().from(bidDocuments)
      .where(and(eq(bidDocuments.id, bimDocumentId), eq(bidDocuments.bidId, bid.id)));
    if (!doc) {
      return res.status(400).json({ error: "Document does not belong to this bid" });
    }

    const existing = await db.select().from(bimStoreyAssociations)
      .where(and(
        eq(bimStoreyAssociations.bidId, bid.id),
        eq(bimStoreyAssociations.sheetId, sheetId)
      ));

    if (existing.length > 0) {
      const [updated] = await db.update(bimStoreyAssociations)
        .set({ bimDocumentId, storeyExpressId: parsedStoreyId, storeyName })
        .where(eq(bimStoreyAssociations.id, existing[0].id))
        .returning();
      return res.json(updated);
    }

    const [association] = await db.insert(bimStoreyAssociations).values({
      bidId: bid.id,
      sheetId,
      bimDocumentId,
      storeyExpressId: parsedStoreyId,
      storeyName,
    }).returning();

    res.status(201).json(association);
  } catch (error) {
    console.error("Create storey association error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/bids/:bidId/bim/storey-associations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    await db.delete(bimStoreyAssociations)
      .where(and(
        eq(bimStoreyAssociations.id, req.params.id),
        eq(bimStoreyAssociations.bidId, bid.id)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Delete storey association error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/bim/storey-associations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const associations = await db.select().from(bimStoreyAssociations)
      .where(eq(bimStoreyAssociations.projectId, projectId));

    res.json(associations);
  } catch (error) {
    console.error("Get project storey associations error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:projectId/bim/storey-associations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { sheetId, bimDocumentId, storeyExpressId, storeyName } = req.body;
    if (!sheetId || !bimDocumentId || storeyExpressId === undefined || !storeyName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedStoreyId = Number(storeyExpressId);
    if (!Number.isInteger(parsedStoreyId)) {
      return res.status(400).json({ error: "storeyExpressId must be an integer" });
    }

    const [sheet] = await db.select().from(takeoffSheets)
      .where(and(eq(takeoffSheets.id, sheetId), eq(takeoffSheets.projectId, projectId)));
    if (!sheet) {
      return res.status(400).json({ error: "Sheet does not belong to this project" });
    }

    const { planDocuments } = await import("@shared/schema");
    const [bimDoc] = await db.select({ id: planDocuments.id }).from(planDocuments)
      .where(and(eq(planDocuments.id, bimDocumentId), eq(planDocuments.projectId, projectId)))
      .limit(1);
    if (!bimDoc) {
      return res.status(400).json({ error: "BIM document not found or does not belong to this project" });
    }

    const existing = await db.select().from(bimStoreyAssociations)
      .where(and(
        eq(bimStoreyAssociations.projectId, projectId),
        eq(bimStoreyAssociations.sheetId, sheetId)
      ));

    if (existing.length > 0) {
      const [updated] = await db.update(bimStoreyAssociations)
        .set({ bimDocumentId, storeyExpressId: parsedStoreyId, storeyName })
        .where(eq(bimStoreyAssociations.id, existing[0].id))
        .returning();
      return res.json(updated);
    }

    const [association] = await db.insert(bimStoreyAssociations).values({
      projectId,
      sheetId,
      bimDocumentId,
      storeyExpressId: parsedStoreyId,
      storeyName,
    }).returning();

    res.status(201).json(association);
  } catch (error) {
    console.error("Create project storey association error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/projects/:projectId/bim/storey-associations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    await db.delete(bimStoreyAssociations)
      .where(and(
        eq(bimStoreyAssociations.id, req.params.id),
        eq(bimStoreyAssociations.projectId, projectId)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error("Delete project storey association error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from takeoffIssueRoutes.ts
// ========================================

async function verifyIssueSheetAccess(sheetId: string, user: { id: string; organizationId: string | null; role: string }): Promise<{ allowed: boolean; sheet: any | null; reason?: string }> {
  const { takeoffSheets, projects, bids } = await import("@shared/schema");

  const [sheet] = await db
    .select({ id: takeoffSheets.id, projectId: takeoffSheets.projectId, bidId: takeoffSheets.bidId })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.id, sheetId))
    .limit(1);

  if (!sheet) return { allowed: false, sheet: null, reason: "Sheet not found" };

  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (sheet.projectId) {
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, sheet.projectId)]
      : [eq(projects.id, sheet.projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!project) return { allowed: false, sheet, reason: "Not found" };
    return { allowed: true, sheet };
  }

  if (sheet.bidId) {
    const bidConditions = isSuperAdmin
      ? [eq(bids.id, sheet.bidId)]
      : [eq(bids.id, sheet.bidId), eq(bids.gcOrganizationId, user.organizationId)];
    const [bid] = await db
      .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
      .from(bids)
      .where(and(...bidConditions))
      .limit(1);
    if (!bid) return { allowed: false, sheet, reason: "Not found" };
    return { allowed: true, sheet };
  }

  return { allowed: false, sheet, reason: "Sheet has no parent" };
}

const WRITE_ROLES = ["ADMIN", "MANAGER", "ESTIMATOR", "FOREMAN", "SUPERINTENDENT", "PROJECT_ENGINEER"];

function canWrite(role: string): boolean {
  return WRITE_ROLES.includes(role) || role === "SUPER_ADMIN";
}

router.get("/api/takeoff/sheets/:sheetId/issues", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffIssues, takeoffIssueComments, users } = await import("@shared/schema");

    const access = await verifyIssueSheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Not found" });
      return;
    }

    const issues = await db
      .select({
        id: takeoffIssues.id,
        sheetId: takeoffIssues.sheetId,
        organizationId: takeoffIssues.organizationId,
        issueNumber: takeoffIssues.issueNumber,
        category: takeoffIssues.category,
        severity: takeoffIssues.severity,
        status: takeoffIssues.status,
        assigneeId: takeoffIssues.assigneeId,
        description: takeoffIssues.description,
        position: takeoffIssues.position,
        categoryId: takeoffIssues.categoryId,
        createdById: takeoffIssues.createdById,
        createdAt: takeoffIssues.createdAt,
        updatedAt: takeoffIssues.updatedAt,
      })
      .from(takeoffIssues)
      .where(eq(takeoffIssues.sheetId, sheetId))
      .orderBy(takeoffIssues.issueNumber);

    const issueIds = issues.map(i => i.id);
    let comments: any[] = [];

    if (issueIds.length > 0) {
      const allComments = await db
        .select({
          id: takeoffIssueComments.id,
          issueId: takeoffIssueComments.issueId,
          authorId: takeoffIssueComments.authorId,
          body: takeoffIssueComments.body,
          createdAt: takeoffIssueComments.createdAt,
          authorFirstName: users.firstName,
          authorLastName: users.lastName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(takeoffIssueComments)
        .leftJoin(users, eq(takeoffIssueComments.authorId, users.id))
        .where(sql`${takeoffIssueComments.issueId} = ANY(${sql`ARRAY[${sql.join(issueIds.map(id => sql`${id}`), sql`, `)}]::varchar[]`})`)
        .orderBy(takeoffIssueComments.createdAt);
      comments = allComments;
    }

    const result = issues.map(issue => ({
      ...issue,
      comments: comments.filter(c => c.issueId === issue.id),
    }));

    res.json(result);
  } catch (error) {
    console.error("Error fetching takeoff issues:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/issues", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    if (!canWrite(user.role)) {
      res.status(403).json({ error: "Insufficient permissions to create issues" });
      return;
    }

    const { takeoffIssues } = await import("@shared/schema");
    const { sheetId, category, severity, assigneeId, description, position, categoryId } = req.body;

    if (!sheetId || !position) {
      res.status(400).json({ error: "sheetId and position are required" });
      return;
    }

    const access = await verifyIssueSheetAccess(sheetId, user);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Not found" });
      return;
    }

    const [maxNumberResult] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${takeoffIssues.issueNumber}), 0)` })
      .from(takeoffIssues)
      .where(eq(takeoffIssues.sheetId, sheetId));

    const nextNumber = (maxNumberResult?.maxNum || 0) + 1;

    const [issue] = await db.insert(takeoffIssues).values({
      sheetId,
      organizationId: user.organizationId,
      issueNumber: nextNumber,
      category: category || "QUESTION",
      severity: severity || "MEDIUM",
      status: "OPEN",
      assigneeId: assigneeId || null,
      description: sanitizeText(description || ""),
      position: typeof position === "string" ? position : JSON.stringify(position),
      categoryId: categoryId || null,
      createdById: user.id,
    }).returning();

    if (assigneeId && assigneeId !== user.id) {
      await insertNotification({
        userId: assigneeId,
        type: "TAKEOFF_ISSUE_ASSIGNED" as any,
        title: "Issue Assigned to You",
        message: `You have been assigned Issue #${nextNumber} on a takeoff sheet.`,
        relatedEntityId: issue.id,
        relatedEntityType: "takeoff_issue",
      }).catch(() => undefined);
    }

    res.status(201).json(issue);
  } catch (error) {
    console.error("Error creating takeoff issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/takeoff/issues/:issueId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { issueId } = req.params;
    const { takeoffIssues } = await import("@shared/schema");

    const [existingIssue] = await db
      .select()
      .from(takeoffIssues)
      .where(eq(takeoffIssues.id, issueId))
      .limit(1);

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!existingIssue || (!isSuperAdmin && existingIssue.organizationId !== user.organizationId)) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const access = await verifyIssueSheetAccess(existingIssue.sheetId, user);
    if (!access.allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const canResolve = canWrite(user.role);
    const { status, severity, assigneeId, description, category } = req.body;

    if ((status === "RESOLVED" || status === "IN_REVIEW") && !canResolve) {
      res.status(403).json({ error: "Insufficient permissions to change status" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (severity !== undefined) updates.severity = severity;
    if (assigneeId !== undefined) updates.assigneeId = assigneeId || null;
    if (description !== undefined) updates.description = sanitizeText(description);
    if (category !== undefined) updates.category = category;

    const updateConditions = isSuperAdmin
      ? [eq(takeoffIssues.id, issueId)]
      : [eq(takeoffIssues.id, issueId), eq(takeoffIssues.organizationId, user.organizationId!)];
    const [updated] = await db
      .update(takeoffIssues)
      .set(updates)
      .where(and(...updateConditions))
      .returning();

    if (status !== undefined && status !== existingIssue.status) {
      await insertNotification({
        userId: existingIssue.createdById,
        type: "TAKEOFF_ISSUE_STATUS_CHANGED" as any,
        title: "Issue Status Updated",
        message: `Issue #${existingIssue.issueNumber} status changed to ${status}.`,
        relatedEntityId: issueId,
        relatedEntityType: "takeoff_issue",
      }).catch(() => undefined);
    }

    if (assigneeId !== undefined && assigneeId && assigneeId !== existingIssue.assigneeId && assigneeId !== user.id) {
      await insertNotification({
        userId: assigneeId,
        type: "TAKEOFF_ISSUE_ASSIGNED" as any,
        title: "Issue Assigned to You",
        message: `You have been assigned Issue #${existingIssue.issueNumber} on a takeoff sheet.`,
        relatedEntityId: issueId,
        relatedEntityType: "takeoff_issue",
      }).catch(() => undefined);
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating takeoff issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/takeoff/issues/:issueId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { issueId } = req.params;
    const { takeoffIssues } = await import("@shared/schema");

    const [existingIssue] = await db
      .select()
      .from(takeoffIssues)
      .where(eq(takeoffIssues.id, issueId))
      .limit(1);

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!existingIssue || (!isSuperAdmin && existingIssue.organizationId !== user.organizationId)) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const isAdmin = user.role === "ADMIN" || user.role === "MANAGER" || isSuperAdmin;
    const isCreator = existingIssue.createdById === user.id;

    if (!isAdmin && !isCreator) {
      res.status(403).json({ error: "Only admins or the creator can delete this issue" });
      return;
    }

    if (isSuperAdmin) {
      await db.delete(takeoffIssues).where(eq(takeoffIssues.id, issueId));
    } else {
      await db.delete(takeoffIssues).where(and(eq(takeoffIssues.id, issueId), eq(takeoffIssues.organizationId, user.organizationId!)));
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting takeoff issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/issues/:issueId/comments", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { issueId } = req.params;
    const { takeoffIssues, takeoffIssueComments, users } = await import("@shared/schema");

    const [existingIssue] = await db
      .select()
      .from(takeoffIssues)
      .where(eq(takeoffIssues.id, issueId))
      .limit(1);

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!existingIssue || (!isSuperAdmin && existingIssue.organizationId !== user.organizationId)) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const { body } = req.body;
    if (!body || !body.trim()) {
      res.status(400).json({ error: "Comment body is required" });
      return;
    }

    const [comment] = await db.insert(takeoffIssueComments).values({
      issueId,
      authorId: user.id,
      body: sanitizeText(body),
    }).returning();

    const [userRecord] = await db
      .select({ name: users.name, profilePhotoUrl: users.profilePhotoUrl })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    res.status(201).json({
      ...comment,
      authorName: userRecord?.name,
      authorAvatarUrl: userRecord?.profilePhotoUrl,
    });
  } catch (error) {
    console.error("Error creating takeoff issue comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/takeoff/issue-comments/:commentId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { commentId } = req.params;
    const { takeoffIssueComments, takeoffIssues } = await import("@shared/schema");

    const [comment] = await db
      .select({
        id: takeoffIssueComments.id,
        authorId: takeoffIssueComments.authorId,
        issue: { organizationId: takeoffIssues.organizationId },
      })
      .from(takeoffIssueComments)
      .leftJoin(takeoffIssues, eq(takeoffIssueComments.issueId, takeoffIssues.id))
      .where(eq(takeoffIssueComments.id, commentId))
      .limit(1);

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!comment || (!isSuperAdmin && comment.issue?.organizationId !== user.organizationId)) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const isAdmin = user.role === "ADMIN" || user.role === "MANAGER" || isSuperAdmin;
    if (!isAdmin && comment.authorId !== user.id) {
      res.status(403).json({ error: "Cannot delete another user's comment" });
      return;
    }

    await db.delete(takeoffIssueComments).where(eq(takeoffIssueComments.id, commentId));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting takeoff issue comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from takeoffSubRoutes.ts
// ========================================

async function verifySheetAccess(sheetId: string, user: { id: string; organizationId: string | null; role: string }): Promise<{ allowed: boolean; sheet: any | null; reason?: string }> {
  const { takeoffSheets, projects, bids } = await import("@shared/schema");

  const [sheet] = await db
    .select({
      id: takeoffSheets.id,
      projectId: takeoffSheets.projectId,
      bidId: takeoffSheets.bidId,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.id, sheetId))
    .limit(1);

  if (!sheet) return { allowed: false, sheet: null, reason: "Sheet not found" };

  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (sheet.projectId) {
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, sheet.projectId)]
      : [eq(projects.id, sheet.projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!project) return { allowed: false, sheet, reason: "Sheet not found" };

    if (!isSuperAdmin && user.role !== "ADMIN" && user.role !== "MANAGER" && user.role !== "ESTIMATOR") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, sheet.projectId), eq(crewMembers.userId, user.id)))
        .limit(1);
      if (!assignment) return { allowed: false, sheet, reason: "Access denied" };
    }
    return { allowed: true, sheet };
  }

  if (sheet.bidId) {
    const bidConditions = isSuperAdmin
      ? [eq(bids.id, sheet.bidId)]
      : [eq(bids.id, sheet.bidId), eq(bids.gcOrganizationId, user.organizationId)];
    const [bid] = await db
      .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
      .from(bids)
      .where(and(...bidConditions))
      .limit(1);
    if (!bid) return { allowed: false, sheet, reason: "Sheet not found" };
    return { allowed: true, sheet };
  }

  return { allowed: false, sheet, reason: "Sheet has no parent" };
}

// ====================
// Subcontractor Routes
// ====================

// Get subcontractor contracts for a project
router.get("/api/projects/:code/subcontractors", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // Get contracts with subcontractor details
    const contracts = await db
      .select({
        id: subcontractorContracts.id,
        contractNumber: subcontractorContracts.contractNumber,
        scopeOfWork: subcontractorContracts.scopeOfWork,
        contractAmount: subcontractorContracts.contractAmount,
        startDate: subcontractorContracts.startDate,
        completionDate: subcontractorContracts.completionDate,
        status: subcontractorContracts.status,
        paymentTerms: subcontractorContracts.paymentTerms,
        retentionPercent: subcontractorContracts.retentionPercent,
        notes: subcontractorContracts.notes,
        createdAt: subcontractorContracts.createdAt,
        subcontractor: {
          id: subcontractors.id,
          companyName: subcontractors.companyName,
          contactName: subcontractors.contactName,
          email: subcontractors.email,
          phone: subcontractors.phone,
        },
      })
      .from(subcontractorContracts)
      .leftJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .where(eq(subcontractorContracts.projectId, project.id))
      .orderBy(desc(subcontractorContracts.createdAt));

    res.json(contracts);
  } catch (error) {
    console.error("Error fetching subcontractor contracts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get payments for a contract
router.get("/api/subcontractor-contracts/:contractId/payments", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { contractId } = req.params;

    const [contract] = await db
      .select({ id: subcontractorContracts.id, projectId: subcontractorContracts.projectId })
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.id, contractId))
      .limit(1);
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const [project] = await db
      .select({ gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, contract.projectId))
      .limit(1);
    if (!project || !verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const payments = await db
      .select()
      .from(subcontractorPayments)
      .where(eq(subcontractorPayments.contractId, contractId))
      .orderBy(subcontractorPayments.paymentNumber);

    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create payment for a contract (Admin/Manager only)
router.post("/api/subcontractor-contracts/:contractId/payments", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { contractId } = req.params;
    const { insertSubcontractorPaymentSchema } = await import("@shared/schema");

    const [contract] = await db
      .select()
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.id, contractId))
      .limit(1);

    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const [contractProject] = await db
      .select({ gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, contract.projectId))
      .limit(1);
    if (!contractProject || !verifyOrgAccess(req, res, contractProject.gcOrganizationId)) return;

    // Get next payment number
    const existingPayments = await db
      .select({ paymentNumber: subcontractorPayments.paymentNumber })
      .from(subcontractorPayments)
      .where(eq(subcontractorPayments.contractId, contractId))
      .orderBy(desc(subcontractorPayments.paymentNumber))
      .limit(1);

    const nextPaymentNumber = existingPayments.length > 0 ? existingPayments[0].paymentNumber + 1 : 1;

    // Validate input
    const validationResult = insertSubcontractorPaymentSchema.safeParse({
      ...req.body,
      contractId,
      paymentNumber: nextPaymentNumber,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    // Insert payment
    const [newPayment] = await db.insert(subcontractorPayments).values(validationResult.data).returning();

    // Audit log
    await logCreate(req.user!.id, "SUBCONTRACTOR_PAYMENT", newPayment.id, {
      contractId,
      amount: req.body.amount,
      paymentNumber: nextPaymentNumber,
    });

    res.status(201).json(newPayment);
  } catch (error: any) {
    console.error("Create subcontractor payment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Subcontractor Payables Routes
// ====================

// Get all subcontractor payables (for CFO/Office Manager dashboard)
router.get("/api/subcontractor-payables", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const orgConditions = isSuperAdmin ? [] : [eq(projects.gcOrganizationId, user.organizationId)];

    const payables = await db
      .select({
        subcontractorId: subcontractors.id,
        contractId: subcontractorContracts.id,
        projectId: subcontractorContracts.projectId,
        contractAmount: subcontractorContracts.contractAmount,
        totalPaid: sql<number>`COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("total_paid"),
        remainingBalance: sql<number>`${subcontractorContracts.contractAmount} - COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("remaining_balance"),
        projectName: projects.name,
        companyName: subcontractors.companyName,
      })
      .from(subcontractorContracts)
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(projects.id, subcontractorContracts.projectId))
      .leftJoin(subcontractorPayments, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .where(orgConditions.length > 0 ? and(...orgConditions) : undefined)
      .groupBy(subcontractorContracts.id, subcontractors.id, projects.id);

    res.json(payables);
  } catch (error) {
    console.error("Error fetching subcontractor payables:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Data Quality Routes
// ====================

// Get data quality score for a project (UI-facing endpoint with boolean flags)
router.get("/api/projects/:code/data-quality", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // Calculate data quality with boolean flags for each category
    const { 
      scopeItems, estimates, estimateLineItems, timeEntries, procurementItems,
      dailyScopeProgress, media, changeOrders, scheduleOfValues, planDocuments 
    } = await import("@shared/schema");

    // Check for scope items
    const scopeCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));
    const has_scope = Number(scopeCount[0]?.count || 0) > 0;

    // Check for estimate line items (actual pricing data via estimates linked to project)
    const lineItemsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(estimateLineItems)
      .innerJoin(estimates, eq(estimateLineItems.estimateId, estimates.id))
      .where(eq(estimates.projectId, project.id));
    const has_estimates = Number(lineItemsCount[0]?.count || 0) > 0;

    // Check for budget (project has budget amount set)
    const has_budget = project.budget !== null && Number(project.budget) > 0;

    // Check for timeline (start date and estimated completion date)
    const has_timeline = !!(project.startDate && project.estimatedCompletionDate);

    // Check for daily updates (daily scope progress entries)
    const dailyUpdatesCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.projectId, project.id));
    const has_daily_updates = Number(dailyUpdatesCount[0]?.count || 0) > 0;

    // Check for cost tracking (time entries or procurement items)
    const timeEntriesCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(timeEntries)
      .where(eq(timeEntries.projectId, project.id));
    const procurementCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(procurementItems)
      .where(eq(procurementItems.projectId, project.id));
    const has_cost_tracking = Number(timeEntriesCount[0]?.count || 0) > 0 || Number(procurementCount[0]?.count || 0) > 0;

    // Check for media uploads
    const mediaCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(media)
      .where(eq(media.projectId, project.id));
    const has_media = Number(mediaCount[0]?.count || 0) > 0;

    // Check for documentation (plan documents)
    const docsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(planDocuments)
      .where(eq(planDocuments.projectId, project.id));
    const has_documentation = Number(docsCount[0]?.count || 0) > 0;

    // Check for change orders
    const changeOrdersCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(changeOrders)
      .where(eq(changeOrders.projectId, project.id));
    const has_change_orders_managed = Number(changeOrdersCount[0]?.count || 0) > 0;

    // Check for billing setup (schedule of values)
    const sovCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, project.id));
    const has_billing_setup = Number(sovCount[0]?.count || 0) > 0;

    // Calculate overall score (each flag worth 10 points)
    const flags = [
      has_scope, has_estimates, has_budget, has_timeline, has_daily_updates,
      has_cost_tracking, has_media, has_documentation, has_change_orders_managed, has_billing_setup
    ];
    const overall_score = flags.filter(Boolean).length * 10;

    res.json({
      overall_score,
      has_scope,
      has_estimates,
      has_budget,
      has_timeline,
      has_daily_updates,
      has_cost_tracking,
      has_media,
      has_documentation,
      has_change_orders_managed,
      has_billing_setup
    });
  } catch (error) {
    console.error("Error fetching data quality score:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// TAKEOFF + ESTIMATING ROUTES
// ====================

// Get all takeoff sheets for a project
router.get("/api/projects/:projectId/takeoff/sheets", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const user = req.user!;
    const { takeoffSheets, projectPlans } = await import("@shared/schema");

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const sheets = await db
      .select({
        id: takeoffSheets.id,
        projectId: takeoffSheets.projectId,
        planId: takeoffSheets.planId,
        imageUrl: takeoffSheets.imageUrl,
        sheetIndex: takeoffSheets.sheetIndex,
        sheetName: takeoffSheets.sheetName,
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        units: takeoffSheets.units,
        revisionLabel: takeoffSheets.revisionLabel,
        isActive: takeoffSheets.isActive,
        supersededById: takeoffSheets.supersededById,
        createdAt: takeoffSheets.createdAt,
        updatedAt: takeoffSheets.updatedAt,
        documentId: projectPlans.documentId,
      })
      .from(takeoffSheets)
      .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
      .where(eq(takeoffSheets.projectId, projectId))
      .orderBy(takeoffSheets.sheetIndex);

    res.json(sheets);
  } catch (error) {
    console.error("Error fetching takeoff sheets:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Supersede a sheet: mark old sheet as superseded, new sheet as active revision
router.post("/api/takeoff/sheets/:sheetId/supersede", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { newSheetId, revisionLabel } = req.body;
    const { takeoffSheets } = await import("@shared/schema");

    if (!newSheetId) {
      res.status(400).json({ error: "newSheetId is required" });
      return;
    }

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const newAccess = await verifySheetAccess(newSheetId, req.user!);
    if (!newAccess.allowed) {
      res.status(newAccess.sheet ? 403 : 404).json({ error: newAccess.reason || "New sheet not found" });
      return;
    }

    // Mark old sheet as superseded by new sheet, and inactive
    await db.update(takeoffSheets)
      .set({ supersededById: newSheetId, isActive: false, updatedAt: new Date() })
      .where(eq(takeoffSheets.id, sheetId));

    // Optionally set revision label on the new sheet
    if (revisionLabel) {
      await db.update(takeoffSheets)
        .set({ revisionLabel: sanitizeShortText(revisionLabel), isActive: true, updatedAt: new Date() })
        .where(eq(takeoffSheets.id, newSheetId));
    } else {
      await db.update(takeoffSheets)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(takeoffSheets.id, newSheetId));
    }

    const [oldSheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId)).limit(1);
    const [newSheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, newSheetId)).limit(1);

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "takeoff_sheet",
      entityId: sheetId,
      newValue: `Sheet superseded by ${newSheetId}`,
    }, req);

    res.json({ oldSheet, newSheet });
  } catch (error: any) {
    console.error("Error superseding sheet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stream PDF directly for a takeoff sheet (with authorization)
router.get("/api/takeoff/sheets/:sheetId/pdf", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffSheets, projectPlans, planDocuments, bidDocuments, bids } = await import("@shared/schema");
    const orgId = req.user!.organizationId;
    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [sheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, sheetId)).limit(1);

    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const { ObjectStorageService, objectStorageClient } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();

    async function resolveGcsFile(objectKey: string | null | undefined, gcsUrl: string | null | undefined) {
      if (objectKey && objectKey.startsWith("/objects/")) {
        return objectStorageService.getObjectEntityFile(objectKey);
      }
      const rawUrl = objectKey || gcsUrl;
      if (!rawUrl) return null;
      if (rawUrl.startsWith("https://storage.googleapis.com/")) {
        const url = new URL(rawUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        const bucketName = parts[0];
        const objectName = parts.slice(1).join("/");
        const file = objectStorageClient.bucket(bucketName).file(objectName);
        const [exists] = await file.exists();
        return exists ? file : null;
      }
      try {
        return await objectStorageService.getObjectEntityFile(rawUrl);
      } catch {
        return null;
      }
    }

    if (sheet.bidId) {
      const bidConditions = isSuperAdmin
        ? [eq(bids.id, sheet.bidId)]
        : [eq(bids.id, sheet.bidId), eq(bids.gcOrganizationId, orgId!)];
      const [bid] = await db.select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId }).from(bids)
        .where(and(...bidConditions)).limit(1);
      if (!bid) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      // Look up the bid document whose fileUrl matches the sheet's imageUrl
      const [bidDoc] = await db.select({ objectKey: bidDocuments.objectKey, fileUrl: bidDocuments.fileUrl })
        .from(bidDocuments)
        .where(and(eq(bidDocuments.bidId, sheet.bidId), eq(bidDocuments.fileUrl, sheet.imageUrl)))
        .limit(1);
      const gcsFile = await resolveGcsFile(bidDoc?.objectKey, bidDoc?.fileUrl ?? sheet.imageUrl);
      if (!gcsFile) {
        res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
        return;
      }
      await objectStorageService.downloadObject(gcsFile, res, 3600);
    } else if (sheet.projectId) {
      const projectConditions = isSuperAdmin
        ? [eq(projects.id, sheet.projectId)]
        : [eq(projects.id, sheet.projectId), eq(projects.gcOrganizationId, orgId!)];
      const [project] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
        .from(projects).where(and(...projectConditions)).limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const [sheetWithDoc] = await db
        .select({ objectKey: planDocuments.objectKey, fileUrl: planDocuments.fileUrl })
        .from(takeoffSheets)
        .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
        .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
        .where(eq(takeoffSheets.id, sheetId))
        .limit(1);
      const gcsFile = await resolveGcsFile(sheetWithDoc?.objectKey, sheetWithDoc?.fileUrl);
      if (!gcsFile) {
        res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
        return;
      }
      await objectStorageService.downloadObject(gcsFile, res, 3600);
    } else {
      res.status(404).json({ error: "Sheet has no parent" });
    }
  } catch (error: any) {
    console.error("Stream sheet PDF error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Import a plan document to takeoff workspace
router.post("/api/projects/:projectId/takeoff/import-plan", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { documentId } = req.body;

    if (!documentId) {
      res.status(400).json({ error: "Document ID is required" });
      return;
    }

    const user = req.user!;
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [projectCheck] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!projectCheck) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { planDocuments, projectPlans, takeoffSheets } = await import("@shared/schema");

    const [document] = await db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.id, documentId))
      .limit(1);

    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (document.projectId !== projectId) {
      res.status(403).json({ error: "Document does not belong to this project" });
      return;
    }

    // Check if this document is already imported by checking if a plan exists with this documentId
    const [existingPlan] = await db
      .select()
      .from(projectPlans)
      .where(and(
        eq(projectPlans.projectId, projectId),
        eq(projectPlans.documentId, documentId)
      ))
      .limit(1);

    if (existingPlan) {
      res.status(400).json({ error: "This document is already imported to takeoff workspace" });
      return;
    }

    // Validate PDF and get page count BEFORE creating any database records
    let pageCount = 1;
    if (!document.objectKey) {
      res.status(400).json({ error: "Document has no file attached. Please re-upload the document." });
      return;
    }

    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
      
      // Download PDF to buffer using GCS File.download() method
      const [pdfBuffer] = await objectFile.download();
      
      // Load PDF with pdfjs-dist
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        useSystemFonts: true,
      });
      const pdfDoc = await loadingTask.promise;
      pageCount = pdfDoc.numPages;
    } catch (error: any) {
      console.error("Error processing PDF:", error);
      res.status(400).json({ 
        error: "Failed to process PDF file. The file may be corrupted or not a valid PDF document." 
      });
      return;
    }

    // Import plan to takeoff (sequential operations with compensating cleanup)
    // Create project plan record
    const [plan] = await db.insert(projectPlans).values({
      projectId,
      documentId: documentId,
      originalPdfUrl: document.fileUrl,
      fileName: document.fileName,
    }).returning();

    // Prepare all sheets for batch insert
    const baseSheetName = document.title || document.fileName.replace(/\.[^/.]+$/, ''); // Remove extension
    const sheetValues = [];
    
    for (let i = 0; i < pageCount; i++) {
      const sheetName = pageCount > 1 
        ? `${baseSheetName} - Page ${i + 1}`
        : baseSheetName;
      
      sheetValues.push({
        projectId,
        planId: plan.id,
        imageUrl: document.fileUrl,
        sheetIndex: i,
        sheetName,
      });
    }

    // Batch insert all sheets with compensating cleanup on failure
    let sheets;
    try {
      sheets = await db.insert(takeoffSheets).values(sheetValues).returning();
    } catch (sheetError) {
      // Compensating cleanup: delete the orphaned plan
      await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
      throw sheetError; // Re-throw to trigger outer catch
    }

    // Audit log (pass raw object, not JSON.stringify)
    await logCreate(req.user!.id, "project_plans", plan.id, {
      projectId,
      fileName: document.fileName,
      documentId,
      pageCount,
    }, req);

    res.status(201).json({ plan, sheets });
  } catch (error) {
    console.error("Error importing plan to takeoff:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Upload a plan PDF and create sheets
router.post("/api/projects/:projectId/takeoff/plans", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { fileUrl, fileName } = req.body;

    if (!fileUrl || !fileName) {
      res.status(400).json({ error: "File URL and name are required" });
      return;
    }

    const user = req.user!;
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [projectCheck] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!projectCheck) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { projectPlans, takeoffSheets, insertProjectPlanSchema, insertTakeoffSheetSchema } = await import("@shared/schema");

    // Upload plan (sequential operations with compensating cleanup)
    // Create project plan record
    const [plan] = await db.insert(projectPlans).values({
      projectId,
      originalPdfUrl: fileUrl,
      fileName,
    }).returning();

    // TODO: In a production system, you would use a PDF processing service here
    // For now, we'll create a single sheet placeholder
    // The frontend will handle PDF rendering with pdf.js
    let sheet;
    try {
      [sheet] = await db.insert(takeoffSheets).values({
        projectId,
        planId: plan.id,
        imageUrl: fileUrl, // Using PDF URL as placeholder
        sheetIndex: 0,
        sheetName: fileName,
      }).returning();
    } catch (sheetError) {
      // Compensating cleanup: delete the orphaned plan
      await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
      throw sheetError; // Re-throw to trigger outer catch
    }

    // Audit log
    await logAudit({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "project_plan",
      entityId: plan.id,
      newValue: `Uploaded plan: ${fileName}`,
    }, req);

    res.status(201).json({ plan, sheets: [sheet] });
  } catch (error) {
    console.error("Error uploading plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all measurements across all sheets for a project
router.get("/api/projects/:projectId/takeoff/all-measurements", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const user = req.user!;
    const { takeoffMeasurements, takeoffSheets, crewProjectAssignments, crewMembers } = await import("@shared/schema");

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (user.role !== "ADMIN" && user.role !== "MANAGER" && user.role !== "SUPER_ADMIN" && user.role !== "ESTIMATOR") {
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, projectId), eq(crewMembers.userId, user.id)))
        .limit(1);
      if (!assignment) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const projectSheets = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, projectId));

    const sheetIds = projectSheets.map(s => s.id);
    if (sheetIds.length === 0) {
      res.json([]);
      return;
    }

    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds))
      .orderBy(takeoffMeasurements.createdAt);

    const parsedMeasurements = measurements.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsedMeasurements);
  } catch (error) {
    console.error("Error fetching all measurements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all measurements across all sheets for a bid
router.get("/api/bids/:bidId/takeoff/all-measurements", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { bidId } = req.params;
    const user = req.user!;
    const { takeoffMeasurements, takeoffSheets, bids } = await import("@shared/schema");

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const bidConditions = isSuperAdmin
      ? [eq(bids.id, bidId)]
      : [eq(bids.id, bidId), eq(bids.gcOrganizationId, user.organizationId)];
    const [bid] = await db
      .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
      .from(bids)
      .where(and(...bidConditions))
      .limit(1);

    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    const bidSheets = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bidId));

    const sheetIds = bidSheets.map(s => s.id);
    if (sheetIds.length === 0) {
      res.json([]);
      return;
    }

    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds))
      .orderBy(takeoffMeasurements.createdAt);

    const parsedMeasurements = measurements.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsedMeasurements);
  } catch (error) {
    console.error("Error fetching all bid measurements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get measurements for a sheet
router.get("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffMeasurements } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, sheetId))
      .orderBy(takeoffMeasurements.createdAt);

    const parsedMeasurements = measurements.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsedMeasurements);
  } catch (error) {
    console.error("Error fetching measurements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new measurement
router.post("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
    };

    const validated = insertTakeoffMeasurementSchema.parse({
      ...sanitizedBody,
      sheetId,
    });

    const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();

    res.status(201).json(measurement);
  } catch (error: any) {
    console.error("Error creating measurement:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid measurement data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Update a measurement
router.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements, takeoffSheets, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    const [existingMeasurement] = await db
      .select({ sheetId: takeoffMeasurements.sheetId })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existingMeasurement) { res.status(404).json({ error: "Measurement not found" }); return; }

    const access = await verifySheetAccess(existingMeasurement.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
    };

    const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

    let finalValues = { ...validated };
    if (validated.points && validated.type === "LINEAR") {
      const sheet = await db
        .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, existingMeasurement.sheetId))
        .limit(1);

      if (sheet && sheet.length > 0 && sheet[0].scalePxPerFoot) {
        const points = safeParsePoints(validated.points);
        
        if (points && points.length === 3) {
          try {
            const [start, middle, end] = points;
            const arcSegment = createArcSegment(start, end, middle, sheet[0].scalePxPerFoot);
            
            if (arcSegment) {
              finalValues = {
                ...validated,
                computedLengthFt: arcSegment.arcLength,
              };
              console.log(`[Arc Measurement Update] Recomputed arc length: ${arcSegment.arcLength.toFixed(2)} LF`);
            }
          } catch (error) {
            console.error("Error computing arc length during update:", error);
          }
        }
      }
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({ ...finalValues, updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating measurement:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid measurement data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Create a new measurement (with sheetId in body)
router.post("/api/takeoff/measurements", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { takeoffMeasurements, takeoffSheets, projects, bids, crewProjectAssignments, crewMembers, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
    };

    // Convert points array to JSON string if it's an array
    const bodyWithStringifiedPoints = {
      ...sanitizedBody,
      points: Array.isArray(sanitizedBody.points) ? JSON.stringify(sanitizedBody.points) : sanitizedBody.points,
    };

    const validated = insertTakeoffMeasurementSchema.parse(bodyWithStringifiedPoints);

    // Validate that the sheet exists (supports both project-based and bid-based sheets)
    const sheetWithProject = await db
      .select({
        sheetId: takeoffSheets.id,
        projectId: takeoffSheets.projectId,
        bidId: takeoffSheets.bidId,
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, validated.sheetId))
      .limit(1);

    if (!sheetWithProject || sheetWithProject.length === 0) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const sheet = sheetWithProject[0];
    const orgId = req.user!.organizationId;
    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";

    if (!isSuperAdmin) {
      if (sheet.projectId) {
        const [project] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
          .from(projects).where(eq(projects.id, sheet.projectId)).limit(1);
        if (!project || project.gcOrganizationId !== orgId) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      } else if (sheet.bidId) {
        const [bid] = await db.select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
          .from(bids).where(eq(bids.id, sheet.bidId)).limit(1);
        if (!bid || bid.gcOrganizationId !== orgId) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      } else {
        res.status(404).json({ error: "Sheet has no parent project or bid" });
        return;
      }
    }

    // Additional authorization for non-admin/manager on project-based sheets
    const userRole = req.user!.role;
    if (sheet.projectId && userRole !== "ADMIN" && userRole !== "MANAGER") {
      const userAssignment = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(
          and(
            eq(crewProjectAssignments.projectId, sheet.projectId),
            eq(crewMembers.userId, req.user!.id)
          )
        )
        .limit(1);

      if (!userAssignment || userAssignment.length === 0) {
        res.status(403).json({ error: "You do not have access to this project" });
        return;
      }
    }

    let finalValues = { ...validated };
    if (sheet.scalePxPerFoot) {
      const points = safeParsePoints(validated.points);

      if (validated.type === "LINEAR" && points && points.length === 3) {
        try {
          const [start, middle, end] = points;
          const arcSegment = createArcSegment(start, end, middle, sheet.scalePxPerFoot);
          if (arcSegment) {
            finalValues.computedLengthFt = arcSegment.arcLength;
          }
        } catch (error) {
          console.error("Error computing arc length:", error);
        }
      } else if (validated.type === "LINEAR" && points && points.length >= 2 && !finalValues.computedLengthFt) {
        try {
          const { computeDistanceInFeet } = await import("@shared/utils/geometry");
          finalValues.computedLengthFt = computeDistanceInFeet(points, sheet.scalePxPerFoot);
        } catch (error) {
          console.error("Error computing linear length:", error);
        }
      }

      if ((validated.type === "AREA" || validated.type === "PITCHED_AREA" || validated.type === "SURFACE_AREA") && points && points.length >= 3 && !finalValues.computedAreaFt2) {
        try {
          const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
          finalValues.computedAreaFt2 = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
        } catch (error) {
          console.error("Error computing area:", error);
        }
      }

      if (validated.type === "VOLUME" && points && points.length >= 3 && !finalValues.computedVolumeCy) {
        try {
          const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
          const areaFt2 = finalValues.computedAreaFt2 || computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
          if (!finalValues.computedAreaFt2) finalValues.computedAreaFt2 = areaFt2;
          if (validated.depthFeet) {
            finalValues.computedVolumeCy = computeVolumeInCY(areaFt2, validated.depthFeet);
          }
        } catch (error) {
          console.error("Error computing volume:", error);
        }
      }
    }

    const [measurement] = await db.insert(takeoffMeasurements).values(finalValues).returning();

    res.status(201).json(measurement);
  } catch (error: any) {
    console.error("Error creating measurement:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid measurement data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Delete a measurement
router.delete("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements } = await import("@shared/schema");

    const [existing] = await db
      .select({ sheetId: takeoffMeasurements.sheetId })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Measurement not found" }); return; }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    await db.delete(takeoffMeasurements).where(eq(takeoffMeasurements.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting measurement:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== Measurement Groups CRUD ====================

// Helper: verify group access by looking up its sheet
async function verifyGroupAccess(groupId: string, user: { id: string; organizationId: string | null; role: string }): Promise<{ allowed: boolean; group: any | null; reason?: string }> {
  const { takeoffMeasurementGroups } = await import("@shared/schema");
  const [group] = await db.select().from(takeoffMeasurementGroups).where(eq(takeoffMeasurementGroups.id, groupId)).limit(1);
  if (!group) return { allowed: false, group: null, reason: "Group not found" };
  if (!group.sheetId) return { allowed: false, group, reason: "Group has no sheet" };
  const sheetAccess = await verifySheetAccess(group.sheetId, user);
  return { allowed: sheetAccess.allowed, group, reason: sheetAccess.reason };
}

// Get groups for a sheet
router.get("/api/takeoff/sheets/:sheetId/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups } = await import("@shared/schema");
    const groups = await db
      .select()
      .from(takeoffMeasurementGroups)
      .where(eq(takeoffMeasurementGroups.sheetId, sheetId))
      .orderBy(takeoffMeasurementGroups.sortOrder);
    res.json(groups);
  } catch (error) {
    console.error("Error fetching groups:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a group
router.post("/api/takeoff/sheets/:sheetId/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups, takeoffSheets } = await import("@shared/schema");

    const [sheet] = await db.select({ projectId: takeoffSheets.projectId, bidId: takeoffSheets.bidId }).from(takeoffSheets).where(eq(takeoffSheets.id, sheetId)).limit(1);
    if (!sheet) { res.status(404).json({ error: "Sheet not found" }); return; }

    const name = sanitizeShortText(req.body.name || "Untitled Group");
    if (!name || name.length > 200) { res.status(400).json({ error: "Invalid group name" }); return; }
    const color = typeof req.body.color === "string" ? req.body.color.slice(0, 20) : "#6b7280";
    const sortOrder = typeof req.body.sortOrder === "number" ? req.body.sortOrder : 0;

    const [group] = await db.insert(takeoffMeasurementGroups).values({
      name,
      sheetId,
      projectId: sheet.projectId,
      bidId: sheet.bidId,
      sortOrder,
      color,
    }).returning();

    res.status(201).json(group);
  } catch (error) {
    console.error("Error creating group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update a group
router.patch("/api/takeoff/groups/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const groupAccess = await verifyGroupAccess(id, req.user!);
    if (!groupAccess.allowed) { res.status(groupAccess.group ? 403 : 404).json({ error: groupAccess.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups } = await import("@shared/schema");

    const updates: any = { updatedAt: new Date() };
    if (typeof req.body.name === "string") updates.name = sanitizeShortText(req.body.name);
    if (typeof req.body.color === "string") updates.color = req.body.color.slice(0, 20);
    if (typeof req.body.sortOrder === "number") updates.sortOrder = req.body.sortOrder;

    const [updated] = await db.update(takeoffMeasurementGroups).set(updates).where(eq(takeoffMeasurementGroups.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Group not found" }); return; }

    res.json(updated);
  } catch (error) {
    console.error("Error updating group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a group (measurements get groupId set to null via FK constraint)
router.delete("/api/takeoff/groups/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const groupAccess = await verifyGroupAccess(id, req.user!);
    if (!groupAccess.allowed) { res.status(groupAccess.group ? 403 : 404).json({ error: groupAccess.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups } = await import("@shared/schema");

    const [deleted] = await db.delete(takeoffMeasurementGroups).where(eq(takeoffMeasurementGroups.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Group not found" }); return; }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reorder groups
const groupReorderItemSchema = z.object({ id: z.string().min(1), sortOrder: z.number().int().min(0) });
const groupReorderSchema = z.object({ order: z.array(groupReorderItemSchema).min(1) });
router.patch("/api/takeoff/sheets/:sheetId/groups/reorder", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const parsed = groupReorderSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "order must be a non-empty array of { id: string, sortOrder: number }" }); return; }
    const { order } = parsed.data;

    const { takeoffMeasurementGroups } = await import("@shared/schema");

    await db.transaction(async (tx) => {
      for (const item of order) {
        await tx.update(takeoffMeasurementGroups)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(and(eq(takeoffMeasurementGroups.id, item.id), eq(takeoffMeasurementGroups.sheetId, sheetId)));
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error reordering groups:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Bulk visibility toggle for a group's measurements
router.patch("/api/takeoff/groups/:id/visibility", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const groupAccess = await verifyGroupAccess(id, req.user!);
    if (!groupAccess.allowed) { res.status(groupAccess.group ? 403 : 404).json({ error: groupAccess.reason || "Access denied" }); return; }

    const { visible } = req.body;
    if (typeof visible !== "boolean") { res.status(400).json({ error: "visible must be a boolean" }); return; }
    const { takeoffMeasurements } = await import("@shared/schema");

    await db.update(takeoffMeasurements).set({ visible, updatedAt: new Date() }).where(eq(takeoffMeasurements.groupId, id));

    res.json({ success: true });
  } catch (error) {
    console.error("Error toggling group visibility:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update sheet calibration
router.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { scalePxPerFoot, units } = req.body;
    const { takeoffSheets, takeoffMeasurements, projects, crewProjectAssignments, crewMembers } = await import("@shared/schema");
    const { 
      computeDistanceInFeet, 
      computePolygonAreaInFt2, 
      computeVolumeInCY, 
      inchesToFeet 
    } = await import("@shared/utils/geometry");

    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    // Update the calibration
    const [updated] = await db
      .update(takeoffSheets)
      .set({ 
        scalePxPerFoot, 
        units: units || "ft",
        updatedAt: new Date() 
      })
      .where(eq(takeoffSheets.id, id))
      .returning();

    // Recompute all measurements for this sheet with the new scale
    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, id));

    console.log(`Recalculating ${measurements.length} measurements with new scale: ${scalePxPerFoot} px/ft`);

    for (const measurement of measurements) {
      if (!measurement.points) {
        continue;
      }

      // Parse points from JSON string (Drizzle may auto-parse or leave as string)
      let points: Array<{ x: number; y: number }>;
      try {
        points = typeof measurement.points === 'string' 
          ? JSON.parse(measurement.points) 
          : measurement.points as any;
      } catch (parseError) {
        console.error(`Error parsing points for measurement ${measurement.id}:`, parseError);
        continue;
      }

      // Skip measurements with no points
      if (!points || points.length === 0) {
        continue;
      }

      const updates: any = {};

      try {
        switch (measurement.type) {
          case "LINEAR":
            if (points.length >= 2) {
              const lengthFt = computeDistanceInFeet(points, scalePxPerFoot);
              updates.computedLengthFt = lengthFt;
            }
            break;

          case "AREA":
            if (points.length >= 3) {
              const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              updates.computedAreaFt2 = areaFt2;
            }
            break;

          case "VOLUME":
            if (points.length >= 3 && measurement.depthFeet) {
              const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              const volumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
              updates.computedAreaFt2 = areaFt2;
              updates.computedVolumeCy = volumeCy;
            }
            break;

          case "SEGMENT":
            if (points.length >= 2) {
              let totalLen = 0;
              for (let i = 0; i < points.length - 1; i++) {
                totalLen += computeDistanceInFeet([points[i], points[i + 1]], scalePxPerFoot);
              }
              updates.computedLengthFt = totalLen;
            }
            break;

          default:
            break;
        }

        if (Object.keys(updates).length > 0) {
          await db
            .update(takeoffMeasurements)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(takeoffMeasurements.id, measurement.id));
        }
      } catch (error) {
        console.error(`Error recalculating measurement ${measurement.id}:`, error);
        // Continue with other measurements even if one fails
      }
    }

    console.log(`Successfully recalculated ${measurements.length} measurements`);
    res.json(updated);
  } catch (error) {
    console.error("Error updating calibration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Batch update calibration for multiple sheets
router.patch("/api/takeoff/sheets/batch-calibration", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetIds, scalePxPerFoot, units } = req.body;
    const { takeoffSheets, takeoffMeasurements, projects } = await import("@shared/schema");
    const {
      computeDistanceInFeet,
      computePolygonAreaInFt2,
      computeVolumeInCY,
    } = await import("@shared/utils/geometry");

    if (!Array.isArray(sheetIds) || sheetIds.length === 0) {
      res.status(400).json({ error: "sheetIds array is required" });
      return;
    }
    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    const skipCalibrated = req.body.skipCalibrated !== false;

    const allowedSheetIds: string[] = [];
    for (const sheetId of sheetIds) {
      const access = await verifySheetAccess(sheetId, req.user!);
      if (access.allowed) allowedSheetIds.push(sheetId);
    }

    const results: any[] = [];
    let updatedCount = 0;
    let skippedCount = 0;

    await db.transaction(async (tx) => {
      for (const sheetId of allowedSheetIds) {
        if (skipCalibrated) {
          const [existing] = await tx
            .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
            .from(takeoffSheets)
            .where(eq(takeoffSheets.id, sheetId))
            .limit(1);
          if (existing?.scalePxPerFoot) {
            skippedCount++;
            continue;
          }
        }

        const [updated] = await tx
          .update(takeoffSheets)
          .set({
            scalePxPerFoot,
            units: units || "ft",
            updatedAt: new Date(),
          })
          .where(eq(takeoffSheets.id, sheetId))
          .returning();

        if (updated) {
          updatedCount++;
          results.push(updated);

          const measurements = await tx
            .select()
            .from(takeoffMeasurements)
            .where(eq(takeoffMeasurements.sheetId, sheetId));

          for (const measurement of measurements) {
            if (!measurement.points) continue;

            const points = safeParsePoints(measurement.points);
            if (!points || points.length === 0) continue;

            const updates: any = {};
            try {
              switch (measurement.type) {
                case "LINEAR":
                  if (points.length >= 2) {
                    updates.computedLengthFt = computeDistanceInFeet(points, scalePxPerFoot);
                  }
                  break;
                case "AREA":
                  if (points.length >= 3) {
                    updates.computedAreaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                  }
                  break;
                case "VOLUME":
                  if (points.length >= 3 && measurement.depthFeet) {
                    const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                    updates.computedAreaFt2 = areaFt2;
                    updates.computedVolumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
                  }
                  break;
                case "SEGMENT":
                  if (points.length >= 2) {
                    let totalLen = 0;
                    for (let si = 0; si < points.length - 1; si++) {
                      totalLen += computeDistanceInFeet([points[si], points[si + 1]], scalePxPerFoot);
                    }
                    updates.computedLengthFt = totalLen;
                  }
                  break;
              }
              if (Object.keys(updates).length > 0) {
                await tx
                  .update(takeoffMeasurements)
                  .set({ ...updates, updatedAt: new Date() })
                  .where(eq(takeoffMeasurements.id, measurement.id));
              }
            } catch (error) {
              console.error(`Error recalculating measurement ${measurement.id}:`, error);
            }
          }
        }
      }
    });

    console.log(`Batch calibration: updated ${updatedCount}/${sheetIds.length} sheets, skipped ${skippedCount} already calibrated`);
    res.json({ updated: updatedCount, skipped: skippedCount, sheets: results });
  } catch (error) {
    console.error("Error in batch calibration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update sheet rotation
router.patch("/api/takeoff/sheets/:id/rotation", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { rotation } = req.body;
    const { takeoffSheets } = await import("@shared/schema");

    const validRotations = [0, 90, 180, 270];
    if (!validRotations.includes(rotation)) {
      res.status(400).json({ error: "Rotation must be 0, 90, 180, or 270" });
      return;
    }

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(takeoffSheets)
      .set({ rotation, updatedAt: new Date() })
      .where(eq(takeoffSheets.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating rotation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// QUANTITY CATEGORY ROUTES
// ====================

// Get all quantity categories for a project
router.get("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;
    const { quantityCategories } = await import("@shared/schema");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const categories = await db
      .select()
      .from(quantityCategories)
      .where(eq(quantityCategories.projectId, project.id))
      .orderBy(quantityCategories.displayOrder);

    res.json(categories);
  } catch (error) {
    console.error("Error fetching quantity categories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new quantity category
router.post("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;
    const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      name: sanitizeShortText(req.body.name),
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validated = insertQuantityCategorySchema.parse({
      projectId: project.id,  // Use the internal UUID, not the code
      ...sanitizedBody,
    });

    const [category] = await db
      .insert(quantityCategories)
      .values(validated)
      .returning();

    res.status(201).json(category);
  } catch (error: any) {
    console.error("Error creating quantity category:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid category data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Update a quantity category
router.patch("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { quantityCategories, insertQuantityCategorySchema, takeoffSheets, projects, bids } = await import("@shared/schema");

    const [existing] = await db.select().from(quantityCategories).where(eq(quantityCategories.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Category not found" }); return; }

    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";
    if (!isSuperAdmin) {
      if (existing.projectId) {
        const [project] = await db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.id, existing.projectId), eq(projects.gcOrganizationId, req.user!.organizationId)))
          .limit(1);
        if (!project) { res.status(403).json({ error: "Access denied" }); return; }
      } else if (existing.bidId) {
        const [bid] = await db.select({ id: bids.id }).from(bids)
          .where(and(eq(bids.id, existing.bidId), eq(bids.gcOrganizationId, req.user!.organizationId)))
          .limit(1);
        if (!bid) { res.status(403).json({ error: "Access denied" }); return; }
      } else {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const sanitizedBody = {
      ...req.body,
      name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validated = insertQuantityCategorySchema.partial().parse(sanitizedBody);

    const [updated] = await db
      .update(quantityCategories)
      .set({ ...validated, updatedAt: new Date() })
      .where(eq(quantityCategories.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating quantity category:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid category data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ====================
// Sheet Page Management
// ====================

// Rename a sheet
const renameSchema = z.object({ sheetName: z.string().min(1).max(200) });
router.patch("/api/takeoff/sheets/:id/rename", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { takeoffSheets } = await import("@shared/schema");

    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "sheetName is required (1-200 characters)" });
      return;
    }
    const { sheetName } = parsed.data;

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(takeoffSheets)
      .set({ sheetName: sanitizeShortText(sheetName.trim()), updatedAt: new Date() })
      .where(eq(takeoffSheets.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Error renaming sheet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const folderGroupSchema = z.object({ folderGroup: z.string().min(1).max(200) });
router.patch("/api/takeoff/sheets/:id/folder-group", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { takeoffSheets } = await import("@shared/schema");

    const parsed = folderGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "folderGroup is required (1-200 characters)" });
      return;
    }
    const folderGroup = sanitizeShortText(parsed.data.folderGroup.trim());

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(takeoffSheets)
      .set({ folderGroup, updatedAt: new Date() })
      .where(eq(takeoffSheets.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating sheet folder group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reorder sheets (batch update sheetIndex)
const reorderItemSchema = z.object({ id: z.string().min(1), sheetIndex: z.number().int().min(0) });
const reorderSchema = z.object({ order: z.array(reorderItemSchema).min(1) });
router.patch("/api/projects/:projectId/takeoff/sheets/reorder", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { takeoffSheets, projects } = await import("@shared/schema");

    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "order must be a non-empty array of { id: string, sheetIndex: number }" });
      return;
    }
    const { order } = parsed.data;

    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, req.user!.organizationId)];
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const userRole = req.user!.role;
    if (userRole !== "ADMIN" && userRole !== "MANAGER" && userRole !== "SUPER_ADMIN") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, projectId), eq(crewMembers.userId, req.user!.id)))
        .limit(1);
      if (!assignment) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      for (const item of order) {
        await tx
          .update(takeoffSheets)
          .set({ sheetIndex: item.sheetIndex, updatedAt: now })
          .where(and(eq(takeoffSheets.id, item.id), eq(takeoffSheets.projectId, projectId)));
      }
    });

    const sheets = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, projectId))
      .orderBy(takeoffSheets.sheetIndex);

    res.json(sheets);
  } catch (error: any) {
    console.error("Error reordering sheets:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Duplicate a sheet (copies sheet + its measurements)
router.post("/api/takeoff/sheets/:id/duplicate", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { takeoffSheets, takeoffMeasurements } = await import("@shared/schema");

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [sourceSheet] = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, id))
      .limit(1);

    if (!sourceSheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const parentFilter = sourceSheet.projectId
      ? eq(takeoffSheets.projectId, sourceSheet.projectId)
      : sourceSheet.bidId
        ? eq(takeoffSheets.bidId, sourceSheet.bidId)
        : eq(takeoffSheets.id, sourceSheet.id);

    const allSheets = await db
      .select({ sheetIndex: takeoffSheets.sheetIndex })
      .from(takeoffSheets)
      .where(parentFilter);

    const maxIndex = allSheets.reduce((max, s) => Math.max(max, s.sheetIndex), 0);

    const [newSheet] = await db
      .insert(takeoffSheets)
      .values({
        projectId: sourceSheet.projectId,
        bidId: sourceSheet.bidId,
        planId: sourceSheet.planId,
        imageUrl: sourceSheet.imageUrl,
        sheetIndex: maxIndex + 1,
        sheetName: `${sourceSheet.sheetName || "Sheet"} (Copy)`,
        scalePxPerFoot: sourceSheet.scalePxPerFoot,
        units: sourceSheet.units,
      })
      .returning();

    const sourceMeasurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, id));

    if (sourceMeasurements.length > 0) {
      await db.insert(takeoffMeasurements).values(
        sourceMeasurements.map((m) => ({
          sheetId: newSheet.id,
          categoryId: m.categoryId,
          groupId: null,
          type: m.type,
          label: m.label,
          points: m.points,
          arcData: m.arcData,
          depthFeet: m.depthFeet,
          count: m.count,
          note: m.note,
          color: m.color,
          visible: m.visible,
          source: m.source,
          status: m.status,
          lineStyle: m.lineStyle,
          lineWidth: m.lineWidth,
          computedLengthFt: m.computedLengthFt,
          computedAreaFt2: m.computedAreaFt2,
          computedVolumeCy: m.computedVolumeCy,
          metadata: m.metadata,
        }))
      );
    }

    res.status(201).json({ sheet: newSheet, measurementsCopied: sourceMeasurements.length });
  } catch (error: any) {
    console.error("Error duplicating sheet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a sheet and its measurements
router.delete("/api/takeoff/sheets/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { takeoffSheets } = await import("@shared/schema");

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    await db.delete(takeoffSheets).where(eq(takeoffSheets.id, id));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting sheet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a quantity category
router.delete("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { quantityCategories, projects, bids } = await import("@shared/schema");

    const [existing] = await db.select().from(quantityCategories).where(eq(quantityCategories.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Category not found" }); return; }

    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";
    if (!isSuperAdmin) {
      if (existing.projectId) {
        const [project] = await db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.id, existing.projectId), eq(projects.gcOrganizationId, req.user!.organizationId)))
          .limit(1);
        if (!project) { res.status(403).json({ error: "Access denied" }); return; }
      } else if (existing.bidId) {
        const [bid] = await db.select({ id: bids.id }).from(bids)
          .where(and(eq(bids.id, existing.bidId), eq(bids.gcOrganizationId, req.user!.organizationId)))
          .limit(1);
        if (!bid) { res.status(403).json({ error: "Access denied" }); return; }
      } else {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    await db.delete(quantityCategories).where(eq(quantityCategories.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting quantity category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// TAKEOFF MARKUP ROUTES
// ====================

// Get markups for a sheet
router.get("/api/takeoff/sheets/:sheetId/markups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffMarkups, users } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const markups = await db
      .select({
        id: takeoffMarkups.id,
        sheetId: takeoffMarkups.sheetId,
        organizationId: takeoffMarkups.organizationId,
        createdBy: takeoffMarkups.createdBy,
        tool: takeoffMarkups.tool,
        points: takeoffMarkups.points,
        color: takeoffMarkups.color,
        thickness: takeoffMarkups.thickness,
        text: takeoffMarkups.text,
        categoryId: takeoffMarkups.categoryId,
        createdAt: takeoffMarkups.createdAt,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(takeoffMarkups)
      .leftJoin(users, eq(takeoffMarkups.createdBy, users.id))
      .where(eq(takeoffMarkups.sheetId, sheetId))
      .orderBy(takeoffMarkups.createdAt);

    const parsed = markups.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsed);
  } catch (error) {
    console.error("Error fetching markups:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a markup
router.post("/api/takeoff/markups", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { takeoffMarkups, insertTakeoffMarkupSchema } = await import("@shared/schema");

    const body = {
      ...req.body,
      createdBy: req.user!.id,
      organizationId: req.user!.organizationId,
      points: Array.isArray(req.body.points) ? JSON.stringify(req.body.points) : req.body.points,
    };

    const validated = insertTakeoffMarkupSchema.parse(body);

    const access = await verifySheetAccess(validated.sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [markup] = await db.insert(takeoffMarkups).values(validated).returning();

    res.status(201).json({
      ...markup,
      points: safeParsePoints(markup.points) || [],
      authorName: req.user!.name,
    });
  } catch (error: any) {
    console.error("Error creating markup:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid markup data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Delete a markup
router.delete("/api/takeoff/markups/:markupId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { markupId } = req.params;
    const { takeoffMarkups } = await import("@shared/schema");

    const [markup] = await db
      .select()
      .from(takeoffMarkups)
      .where(eq(takeoffMarkups.id, markupId))
      .limit(1);

    if (!markup) {
      res.status(404).json({ error: "Markup not found" });
      return;
    }

    const userRole = req.user!.role;
    const userId = req.user!.id;

    const orgId = req.user!.organizationId;
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    if (!isSuperAdmin && markup.organizationId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const isOwner = markup.createdBy === userId;
    const isAdminOrManager = isSuperAdmin || userRole === "ADMIN" || userRole === "MANAGER";

    if (!isOwner && !isAdminOrManager) {
      res.status(403).json({ error: "You can only delete your own markups" });
      return;
    }

    if (isSuperAdmin) {
      await db.delete(takeoffMarkups).where(eq(takeoffMarkups.id, markupId));
    } else {
      await db.delete(takeoffMarkups).where(and(eq(takeoffMarkups.id, markupId), eq(takeoffMarkups.organizationId, orgId!)));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting markup:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/takeoff/sheets/:sheetId/links", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffSheetLinks } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason });
      return;
    }

    const links = await db
      .select()
      .from(takeoffSheetLinks)
      .where(eq(takeoffSheetLinks.sourceSheetId, sheetId));

    res.json(links);
  } catch (error) {
    console.error("Error fetching sheet links:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/takeoff/conditions", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) { res.status(403).json({ error: "Organization required" }); return; }
    const { takeoffConditions } = await import("@shared/schema");
    const conditions = await db
      .select()
      .from(takeoffConditions)
      .where(eq(takeoffConditions.organizationId, orgId))
      .orderBy(sql`${takeoffConditions.lastUsedAt} DESC NULLS LAST`, takeoffConditions.sortOrder);
    res.json(conditions);
  } catch (error) {
    console.error("Error fetching conditions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/sheet-links", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { takeoffSheetLinks, insertTakeoffSheetLinkSchema, takeoffSheets } = await import("@shared/schema");

    const sourceAccess = await verifySheetAccess(req.body.sourceSheetId, req.user!);
    if (!sourceAccess.allowed) {
      res.status(403).json({ error: sourceAccess.reason });
      return;
    }

    const targetAccess = await verifySheetAccess(req.body.targetSheetId, req.user!);
    if (!targetAccess.allowed) {
      res.status(403).json({ error: "No access to target sheet" });
      return;
    }

    const [sourceSheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, req.body.sourceSheetId)).limit(1);
    const [targetSheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, req.body.targetSheetId)).limit(1);

    if (!sourceSheet || !targetSheet) {
      res.status(404).json({ error: "Source or target sheet not found" });
      return;
    }

    const sameContext = (sourceSheet.projectId && sourceSheet.projectId === targetSheet.projectId) ||
                        (sourceSheet.bidId && sourceSheet.bidId === targetSheet.bidId);
    if (!sameContext) {
      res.status(400).json({ error: "Source and target sheets must belong to the same project or bid" });
      return;
    }

    if (req.body.width <= 0 || req.body.height <= 0) {
      res.status(400).json({ error: "Link width and height must be positive" });
      return;
    }

    const validated = insertTakeoffSheetLinkSchema.parse(req.body);

    const [link] = await db
      .insert(takeoffSheetLinks)
      .values(validated)
      .returning();

    res.status(201).json(link);
  } catch (error: any) {
    console.error("Error creating sheet link:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid link data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/api/takeoff/sheet-links/:linkId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { linkId } = req.params;
    const { takeoffSheetLinks } = await import("@shared/schema");

    const [link] = await db
      .select()
      .from(takeoffSheetLinks)
      .where(eq(takeoffSheetLinks.id, linkId))
      .limit(1);

    if (!link) {
      res.status(404).json({ error: "Link not found" });
      return;
    }

    const access = await verifySheetAccess(link.sourceSheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason });
      return;
    }

    await db.delete(takeoffSheetLinks).where(eq(takeoffSheetLinks.id, linkId));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting sheet link:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/sheets/:sheetId/detect-links", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffSheetLinks, takeoffSheets } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason });
      return;
    }

    const sheet = access.sheet!;

    const allSheets = await db
      .select()
      .from(takeoffSheets)
      .where(
        sheet.projectId
          ? eq(takeoffSheets.projectId, sheet.projectId)
          : eq(takeoffSheets.bidId, sheet.bidId!)
      );

    const sheetNameMap = new Map<string, string>();
    for (const s of allSheets) {
      if (s.id === sheetId) continue;
      if (s.sheetName) {
        sheetNameMap.set(s.sheetName.toUpperCase(), s.id);
        const simplified = s.sheetName.replace(/\s+/g, "").toUpperCase();
        sheetNameMap.set(simplified, s.id);
      }
    }

    const detectedLinks: Array<{
      sourceSheetId: string;
      targetSheetId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
      autoDetected: boolean;
    }> = [];

    await db.delete(takeoffSheetLinks).where(
      and(
        eq(takeoffSheetLinks.sourceSheetId, sheetId),
        eq(takeoffSheetLinks.autoDetected, true)
      )
    );

    if (sheet.projectId || sheet.bidId) {
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const { planDocuments, projectPlans, bidDocuments } = await import("@shared/schema");
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();

        const planSheet = allSheets.find(s => s.id === sheetId);
        let pdfBuffer: Buffer | null = null;

        if (planSheet && sheet.bidId) {
          const [bidDoc] = await db.select({ objectKey: bidDocuments.objectKey, fileUrl: bidDocuments.fileUrl })
            .from(bidDocuments)
            .where(and(eq(bidDocuments.bidId, sheet.bidId), eq(bidDocuments.fileUrl, planSheet.imageUrl)))
            .limit(1);
          if (bidDoc?.objectKey) {
            const objectFile = await objectStorageService.getObjectEntityFile(bidDoc.objectKey);
            const [buf] = await objectFile.download();
            pdfBuffer = buf;
          }
        } else if (planSheet?.planId) {
          const [sheetWithDoc] = await db
            .select({ objectKey: planDocuments.objectKey, fileUrl: planDocuments.fileUrl })
            .from(takeoffSheets)
            .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
            .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
            .where(eq(takeoffSheets.id, sheetId))
            .limit(1);
          if (sheetWithDoc?.objectKey) {
            const objectFile = await objectStorageService.getObjectEntityFile(sheetWithDoc.objectKey);
            const [buf] = await objectFile.download();
            pdfBuffer = buf;
          }
        }

        if (pdfBuffer && planSheet) {
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
            const pageNumber = (planSheet.sheetIndex || 0) + 1;

            const samePdfSheets = allSheets.filter(s => s.planId === planSheet.planId);

            if (pageNumber <= pdf.numPages) {
              const page = await pdf.getPage(pageNumber);
              const viewport = page.getViewport({ scale: 1.5 });

              const annotations = await page.getAnnotations();
              for (const ann of annotations) {
                if (ann.subtype === "Link" && ann.dest) {
                  let targetPageIndex: number | null = null;
                  if (typeof ann.dest === "string") {
                    const destinations = await pdf.getDestinations();
                    const dest = destinations[ann.dest];
                    if (dest) {
                      const ref = dest[0];
                      targetPageIndex = await pdf.getPageIndex(ref);
                    }
                  } else if (Array.isArray(ann.dest) && ann.dest[0]) {
                    targetPageIndex = await pdf.getPageIndex(ann.dest[0]);
                  }

                  if (targetPageIndex !== null) {
                    const targetSheet = samePdfSheets.find(s => s.sheetIndex === targetPageIndex);
                    if (targetSheet && targetSheet.id !== sheetId) {
                      const rect = ann.rect;
                      const [x1, y1, x2, y2] = [
                        rect[0] * 1.5,
                        viewport.height - rect[3] * 1.5,
                        rect[2] * 1.5,
                        viewport.height - rect[1] * 1.5,
                      ];
                      detectedLinks.push({
                        sourceSheetId: sheetId,
                        targetSheetId: targetSheet.id,
                        x: x1,
                        y: y1,
                        width: x2 - x1,
                        height: y2 - y1,
                        label: targetSheet.sheetName || `Page ${targetPageIndex + 1}`,
                        autoDetected: true,
                      });
                    }
                  }
                }
              }

              if (detectedLinks.length === 0) {
                const textContent = await page.getTextContent();
                const refPatterns = [
                  /\bSEE\s+(DWG|DRAWING|DETAIL|SHEET|PLAN)\s+([A-Z]-?\d{2,3})\b/gi,
                  /\bREFER\s+TO\s+([A-Z]-?\d{2,3})\b/gi,
                  /\bDETAIL\s+(\d+)\s*[/\\]\s*([A-Z]-?\d{2,3})\b/gi,
                  /\bSECTION\s+(\d+)\s*[/\\]\s*([A-Z]-?\d{2,3})\b/gi,
                  /\bSEE\s+([A-Z]-?\d{2,3})\b/gi,
                ];

                for (const item of textContent.items) {
                  const textItem = item as any;
                  if (!textItem.str) continue;

                  for (const pattern of refPatterns) {
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(textItem.str)) !== null) {
                      const refName = match[match.length - 1].toUpperCase();
                      const targetId = sheetNameMap.get(refName);
                      if (targetId) {
                        const tx = textItem.transform?.[4] * 1.5 || 0;
                        const ty = viewport.height - (textItem.transform?.[5] * 1.5 || 0);
                        const tw = (textItem.width || 80) * 1.5;
                        const th = (textItem.height || 14) * 1.5;

                        const alreadyExists = detectedLinks.some(
                          l => l.targetSheetId === targetId && Math.abs(l.x - tx) < 10 && Math.abs(l.y - ty) < 10
                        );
                        if (!alreadyExists) {
                          detectedLinks.push({
                            sourceSheetId: sheetId,
                            targetSheetId: targetId,
                            x: tx,
                            y: ty,
                            width: Math.max(tw, 40),
                            height: Math.max(th, 20),
                            label: match[0],
                            autoDetected: true,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
        }
      } catch (pdfError) {
        console.error("PDF link detection error:", pdfError);
      }
    }

    if (detectedLinks.length > 0) {
      await db.insert(takeoffSheetLinks).values(detectedLinks);
    }

    const allLinks = await db
      .select()
      .from(takeoffSheetLinks)
      .where(eq(takeoffSheetLinks.sourceSheetId, sheetId));

    res.json({ detected: detectedLinks.length, links: allLinks });
  } catch (error) {
    console.error("Error detecting links:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/conditions", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions, insertTakeoffConditionSchema } = await import("@shared/schema");
    const resolvedOrgId = orgCtx.isSuperAdmin ? req.body.organizationId : orgCtx.orgId;
    if (!resolvedOrgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const body = { ...req.body, organizationId: resolvedOrgId };
    const parsed = insertTakeoffConditionSchema.parse(body);
    const [condition] = await db.insert(takeoffConditions).values(parsed).returning();
    res.json(condition);
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid condition data", details: error.errors });
      return;
    }
    console.error("Error creating condition:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/takeoff/conditions/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions, insertTakeoffConditionSchema } = await import("@shared/schema");
    const { id } = req.params;
    const conditions = orgCtx.isSuperAdmin
      ? [eq(takeoffConditions.id, id)]
      : [eq(takeoffConditions.id, id), eq(takeoffConditions.organizationId, orgCtx.orgId!)];
    const [existing] = await db.select().from(takeoffConditions).where(and(...conditions)).limit(1);
    if (!existing) { res.status(404).json({ error: "Condition not found" }); return; }
    const updateSchema = insertTakeoffConditionSchema.partial().omit({ organizationId: true });
    const validated = updateSchema.parse(req.body);
    const updateData = { ...validated, updatedAt: new Date() };
    const [updated] = await db.update(takeoffConditions).set(updateData).where(and(...conditions)).returning();
    res.json(updated);
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid condition data", details: error.errors });
      return;
    }
    console.error("Error updating condition:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/takeoff/conditions/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions } = await import("@shared/schema");
    const { id } = req.params;
    const conditions = orgCtx.isSuperAdmin
      ? [eq(takeoffConditions.id, id)]
      : [eq(takeoffConditions.id, id), eq(takeoffConditions.organizationId, orgCtx.orgId!)];
    const [existing] = await db.select().from(takeoffConditions).where(and(...conditions)).limit(1);
    if (!existing) { res.status(404).json({ error: "Condition not found" }); return; }
    await db.delete(takeoffConditions).where(and(...conditions));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting condition:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
