import { Router, NextFunction } from "express";
import { logError } from "./utils/logger";
import { db } from "./db";
import { bids, bidDocuments, takeoffSheets, quantityCategories, bimStoreyAssociations, projects } from "@shared/schema";
import { eq, and, max } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, logCreate } from "./auditLogger";
import { sanitizeShortText } from "./sanitization";
import { verifyOrgAccess } from "./orgFilter";
import { verifySheetAccess, isMeasurementLocked } from "./takeoffHelpers";

const router = Router();

async function getBidWithAccess(req: AuthRequest, res: import("express").Response): Promise<typeof bids.$inferSelect | null> {
  const { bidId } = req.params;
  const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
  if (!bid) { res.status(404).json({ error: "Bid not found" }); return null; }
  if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return null;
  return bid;
}

router.get("/api/bids/:bidId/takeoff/sheets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const sheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bid.id))
      .orderBy(takeoffSheets.sheetIndex);
    res.json(sheets);
  } catch (error) {
  next(error);
  }
});

router.post("/api/bids/:bidId/takeoff/import-plan", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
      } catch (error) {
        logError("Error processing PDF:", {}, error instanceof Error ? error : new Error(String(error)));
        return res.status(400).json({ error: "Failed to process PDF file" });
      }
    }

    const baseSheetName = document.title || document.fileName.replace(/\.[^/.]+$/, '');
    const sheetValues = [];
    for (let i = 0; i < pageCount; i++) {
      sheetValues.push({
        bidId: bid.id,
        imageUrl: document.fileUrl,
        sheetIndex: i,
        sheetName: pageCount > 1 ? `${baseSheetName} - Page ${i + 1}` : baseSheetName,
      });
    }

    const sheets = await db.insert(takeoffSheets).values(sheetValues).returning();

    res.status(201).json({ sheets, pageCount });
  } catch (error) {
  next(error);
  }
});

router.post("/api/bids/:bidId/takeoff/plans", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const { fileUrl, fileName, objectKey } = req.body;
    if (!fileUrl || !fileName) return res.status(400).json({ error: "File URL and name are required" });

    const existingSheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bid.id));

    let pageCount = 1;
    const isPdf = fileName?.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      try {
        const { ObjectStorageService, objectStorageClient } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        let gcsFile = null;
        if (objectKey) {
          try { gcsFile = await objectStorageService.getObjectEntityFile(objectKey); } catch {}
        }
        if (!gcsFile && fileUrl) {
          if (fileUrl.startsWith("https://storage.googleapis.com/")) {
            const url = new URL(fileUrl);
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length >= 2) {
              gcsFile = objectStorageClient.bucket(parts[0]).file(parts.slice(1).join("/"));
              const [exists] = await gcsFile.exists();
              if (!exists) gcsFile = null;
            }
          } else {
            try { gcsFile = await objectStorageService.getObjectEntityFile(fileUrl); } catch {}
          }
        }
        if (gcsFile) {
          const [pdfBuffer] = await gcsFile.download();
          const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
          const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true });
          const pdfDoc = await loadingTask.promise;
          pageCount = pdfDoc.numPages;
        }
      } catch (error) {
        logError("Error reading PDF page count for direct upload:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    }

    const baseSheetName = fileName.replace(/\.[^/.]+$/, '');
    const sheetValues = [];
    for (let i = 0; i < pageCount; i++) {
      sheetValues.push({
        bidId: bid.id,
        imageUrl: fileUrl,
        sheetIndex: i,
        sheetName: pageCount > 1 ? `${baseSheetName} - Page ${i + 1}` : baseSheetName,
      });
    }

    const sheets = await db.insert(takeoffSheets).values(sheetValues).returning();

    res.status(201).json({ sheets, pageCount });
  } catch (error) {
  next(error);
  }
});

router.get("/api/bids/:bidId/takeoff/categories", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const categories = await db.select().from(quantityCategories)
      .where(eq(quantityCategories.bidId, bid.id))
      .orderBy(quantityCategories.displayOrder);
    res.json(categories);
  } catch (error) {
  next(error);
  }
});

router.get("/api/projects/:projectId/takeoff/categories", requireAuth, async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.post("/api/bids/:bidId/takeoff/categories", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const name = sanitizeShortText(req.body.name);
    const color = req.body.color || "#3b82f6";
    const lineStyle = req.body.lineStyle || "solid";
    const lineWidth = req.body.lineWidth ?? 3;
    const displayOrder = req.body.displayOrder ?? 0;
    const wasteFactor = req.body.wasteFactor ?? 0;
    const unitCost = req.body.unitCost ?? null;

    if (!name) return res.status(400).json({ error: "Category name is required" });

    const [category] = await db.insert(quantityCategories).values({
      bidId: bid.id,
      name,
      color,
      lineStyle,
      lineWidth,
      displayOrder,
      wasteFactor,
      unitCost,
    }).returning();

    res.status(201).json(category);
  } catch (error) {
  next(error);
  }
});

router.patch("/api/bids/:bidId/takeoff/sheets/reorder", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.get("/api/bids/:bidId/bim/storey-associations", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const associations = await db.select().from(bimStoreyAssociations)
      .where(eq(bimStoreyAssociations.bidId, bid.id));

    res.json(associations);
  } catch (error) {
  next(error);
  }
});

router.post("/api/bids/:bidId/bim/storey-associations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.delete("/api/bids/:bidId/bim/storey-associations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.get("/api/projects/:projectId/bim/storey-associations", requireAuth, async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.post("/api/projects/:projectId/bim/storey-associations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.delete("/api/projects/:projectId/bim/storey-associations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

// Get all takeoff sheets for a project
router.get("/api/projects/:projectId/takeoff/sheets", requireAuth, async (req: AuthRequest, res, next) => {
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
        scaleLabel: takeoffSheets.scaleLabel,
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
  next(error);
  }
});

// Supersede a sheet: mark old sheet as superseded, new sheet as active revision
router.post("/api/takeoff/sheets/:sheetId/supersede", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    if (oldSheet?.projectId) {
      try {
        const { eventBus } = await import("./events");
        await eventBus.emit({
          type: "takeoff.version_superseded",
          version: 1,
          orgId: req.user!.organizationId || "",
          actorId: req.user!.id,
          timestamp: new Date(),
          payload: {
            oldSheetId: sheetId,
            newSheetId,
            projectId: oldSheet.projectId,
            organizationId: req.user!.organizationId || "",
            oldSheetName: oldSheet.sheetName || null,
            newSheetName: newSheet?.sheetName || null,
            revisionLabel: revisionLabel || newSheet?.revisionLabel || null,
          },
        });
      } catch (evtErr) {
        logError("Failed to emit takeoff.version_superseded event", { error: String(evtErr) });
      }
    }

    res.json({ oldSheet, newSheet });
  } catch (error) {
  next(error);
  }
});

// Stream PDF directly for a takeoff sheet (with authorization)
router.get("/api/takeoff/sheets/:sheetId/pdf", requireAuth, async (req: AuthRequest, res, next) => {
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
      let gcsFile = null;
      if (sheet.planId) {
        const [sheetWithDoc] = await db
          .select({ objectKey: planDocuments.objectKey, fileUrl: planDocuments.fileUrl })
          .from(takeoffSheets)
          .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
          .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
          .where(eq(takeoffSheets.id, sheetId))
          .limit(1);
        gcsFile = await resolveGcsFile(sheetWithDoc?.objectKey, sheetWithDoc?.fileUrl);
      }
      if (!gcsFile && sheet.imageUrl) {
        gcsFile = await resolveGcsFile(sheet.imageUrl, null);
      }
      if (!gcsFile) {
        res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
        return;
      }
      await objectStorageService.downloadObject(gcsFile, res, 3600);
    } else {
      res.status(404).json({ error: "Sheet has no parent" });
    }
  } catch (error) {
  next(error);
  }
});

// Import a plan document to takeoff workspace
router.post("/api/projects/:projectId/takeoff/import-plan", requireAuth, async (req: AuthRequest, res, next) => {
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
    } catch (error) {
      logError("Error processing PDF:", {}, error instanceof Error ? error : new Error(String(error)));
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
  next(error);
  }
});

router.post("/api/projects/:projectId/takeoff/plans", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;
    const { fileUrl, fileName, objectKey } = req.body;

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

    const { projectPlans, takeoffSheets } = await import("@shared/schema");

    let pageCount = 1;
    const isPdf = fileName?.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      try {
        const { ObjectStorageService, objectStorageClient } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        let gcsFile = null;
        if (objectKey) {
          try { gcsFile = await objectStorageService.getObjectEntityFile(objectKey); } catch {}
        }
        if (!gcsFile && fileUrl) {
          if (fileUrl.startsWith("https://storage.googleapis.com/")) {
            const url = new URL(fileUrl);
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length >= 2) {
              gcsFile = objectStorageClient.bucket(parts[0]).file(parts.slice(1).join("/"));
              const [exists] = await gcsFile.exists();
              if (!exists) gcsFile = null;
            }
          } else {
            try { gcsFile = await objectStorageService.getObjectEntityFile(fileUrl); } catch {}
          }
        }
        if (gcsFile) {
          const [pdfBuffer] = await gcsFile.download();
          const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
          const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true });
          const pdfDoc = await loadingTask.promise;
          pageCount = pdfDoc.numPages;
        }
      } catch (error) {
        logError("Error reading PDF page count for direct upload:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    }

    const [plan] = await db.insert(projectPlans).values({
      projectId,
      originalPdfUrl: fileUrl,
      fileName,
    }).returning();

    const baseSheetName = fileName.replace(/\.[^/.]+$/, '');
    const sheetValues = [];
    for (let i = 0; i < pageCount; i++) {
      sheetValues.push({
        projectId,
        planId: plan.id,
        imageUrl: fileUrl,
        sheetIndex: i,
        sheetName: pageCount > 1 ? `${baseSheetName} - Page ${i + 1}` : baseSheetName,
      });
    }

    let sheets;
    try {
      sheets = await db.insert(takeoffSheets).values(sheetValues).returning();
    } catch (sheetError) {
      await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
      throw sheetError;
    }

    await logAudit({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "project_plan",
      entityId: plan.id,
      newValue: `Uploaded plan: ${fileName} (${pageCount} page${pageCount > 1 ? "s" : ""})`,
    }, req);

    res.status(201).json({ plan, sheets, pageCount });
  } catch (error) {
  next(error);
  }
});

// Get all measurements across all sheets for a project

const renameSchema = z.object({ sheetName: z.string().min(1).max(200) });
router.patch("/api/takeoff/sheets/:id/rename", requireAuth, async (req: AuthRequest, res, next) => {
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
  } catch (error) {
  next(error);
  }
});

const folderGroupSchema = z.object({ folderGroup: z.string().min(1).max(200) });
router.patch("/api/takeoff/sheets/:id/folder-group", requireAuth, async (req: AuthRequest, res, next) => {
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
  } catch (error) {
  next(error);
  }
});

// Reorder sheets (batch update sheetIndex)
const reorderItemSchema = z.object({ id: z.string().min(1), sheetIndex: z.number().int().min(0) });
const reorderSchema = z.object({ order: z.array(reorderItemSchema).min(1) });
router.patch("/api/projects/:projectId/takeoff/sheets/reorder", requireAuth, async (req: AuthRequest, res, next) => {
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
  } catch (error) {
  next(error);
  }
});

// Duplicate a sheet (copies sheet + its measurements)
router.post("/api/takeoff/sheets/:id/duplicate", requireAuth, async (req: AuthRequest, res, next) => {
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
  } catch (error) {
  next(error);
  }
});

router.delete("/api/takeoff/sheets/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffSheets, takeoffMeasurements } = await import("@shared/schema");

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const confirm = req.query.confirm === "true";

    const measurements = await db
      .select({ id: takeoffMeasurements.id })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, id));

    if (measurements.length > 0 && !confirm) {
      res.status(409).json({
        error: "Sheet has measurements that will be deleted",
        measurementCount: measurements.length,
        hint: "Add ?confirm=true to proceed with deletion",
      });
      return;
    }

    const [sheet] = await db.select({ sheetName: takeoffSheets.sheetName }).from(takeoffSheets).where(eq(takeoffSheets.id, id)).limit(1);

    await db.delete(takeoffSheets).where(eq(takeoffSheets.id, id));

    await logAudit({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "takeoff_sheet",
      entityId: id,
      oldValue: JSON.stringify({ sheetName: sheet?.sheetName, measurementsDeleted: measurements.length }),
      newValue: null,
    }, req);

    res.json({ success: true, measurementsDeleted: measurements.length });
  } catch (error) {
    next(error);
  }
});

// Delete a quantity category
router.delete("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});


// =============================================
// TAKEOFF VERSIONS ROUTES
// =============================================

router.get("/api/takeoff/versions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffVersions, projects, bids } = await import("@shared/schema");
    const { projectId, bidId, sheetId } = req.query;

    if (sheetId) {
      const access = await verifySheetAccess(sheetId as string, req.user!);
      if (!access.allowed) {
        res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
        return;
      }
    } else if (projectId) {
      const [project] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, projectId as string), eq(projects.gcOrganizationId, req.user!.organizationId)))
        .limit(1);
      if (!project) { res.status(403).json({ error: "Access denied" }); return; }
    } else if (bidId) {
      const [bid] = await db.select({ id: bids.id }).from(bids)
        .where(and(eq(bids.id, bidId as string), eq(bids.gcOrganizationId, req.user!.organizationId)))
        .limit(1);
      if (!bid) { res.status(403).json({ error: "Access denied" }); return; }
    } else {
      res.status(400).json({ error: "Provide projectId, bidId, or sheetId" });
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [];
    if (sheetId) conditions.push(eq(takeoffVersions.sheetId, sheetId as string));
    if (projectId) conditions.push(eq(takeoffVersions.projectId, projectId as string));
    if (bidId) conditions.push(eq(takeoffVersions.bidId, bidId as string));

    const { users } = await import("@shared/schema");
    const versions = await db.select().from(takeoffVersions)
      .where(and(...conditions))
      .orderBy(takeoffVersions.versionNumber);

    const versionsWithAuthors = await Promise.all(versions.map(async (v) => {
      let createdByName: string | null = null;
      if (v.createdById) {
        const [user] = await db.select({ firstName: users.firstName, lastName: users.lastName })
          .from(users).where(eq(users.id, v.createdById)).limit(1);
        if (user) createdByName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || null;
      }
      return { ...v, createdByName };
    }));
    res.json(versionsWithAuthors);
  } catch (error) {
    next(error);
  }
});

router.post("/api/takeoff/versions", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { takeoffVersions, takeoffMeasurements } = await import("@shared/schema");
    const { sheetId, projectId, bidId, label } = req.body;
    const userId = req.user!.id;

    if (!sheetId) {
      res.status(400).json({ error: "sheetId is required" });
      return;
    }

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const existingVersions = await db.select().from(takeoffVersions)
      .where(eq(takeoffVersions.sheetId, sheetId))
      .orderBy(takeoffVersions.versionNumber);

    const nextVersionNumber = existingVersions.length > 0
      ? Math.max(...existingVersions.map(v => v.versionNumber)) + 1
      : 1;

    if (existingVersions.length > 0) {
      const currentDraft = existingVersions.find(v => v.status === "DRAFT");
      if (currentDraft) {
        await db.update(takeoffVersions)
          .set({ status: "LOCKED" })
          .where(eq(takeoffVersions.id, currentDraft.id));
      }
    }

    const [newVersion] = await db.insert(takeoffVersions).values({
      sheetId,
      projectId: access.sheet?.projectId || null,
      bidId: access.sheet?.bidId || null,
      versionNumber: nextVersionNumber,
      status: "DRAFT",
      createdById: userId,
      label: label ? sanitizeShortText(label) : `v${nextVersionNumber}`,
    }).returning();

    const currentMeasurements = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, sheetId));

    const previousVersion = existingVersions.find(v => v.status === "DRAFT") || existingVersions[existingVersions.length - 1];

    if (previousVersion) {
      const prevMeasurements = currentMeasurements.filter(
        m => m.takeoffVersionId === previousVersion.id || !m.takeoffVersionId
      );

      if (prevMeasurements.length > 0) {
        const clonedValues = prevMeasurements.map(m => ({
          sheetId: m.sheetId,
          categoryId: m.categoryId,
          groupId: m.groupId,
          takeoffVersionId: newVersion.id,
          originMeasurementId: m.originMeasurementId || m.id,
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
          pitchRatio: m.pitchRatio,
          costCodeId: m.costCodeId,
          unitCost: m.unitCost,
          lineStyle: m.lineStyle,
          lineWidth: m.lineWidth,
          computedLengthFt: m.computedLengthFt,
          computedAreaFt2: m.computedAreaFt2,
          computedVolumeCy: m.computedVolumeCy,
          computedSurfaceAreaFt2: m.computedSurfaceAreaFt2,
          deductions: m.deductions,
          metadata: m.metadata,
          subcontractorId: m.subcontractorId,
          supplierId: m.supplierId,
          locationTag: m.locationTag,
          installationStatus: m.installationStatus,
        }));

        await db.insert(takeoffMeasurements).values(clonedValues);
      }
    } else {
      if (currentMeasurements.length > 0) {
        for (const m of currentMeasurements) {
          if (!m.takeoffVersionId) {
            await db.update(takeoffMeasurements)
              .set({ takeoffVersionId: newVersion.id })
              .where(eq(takeoffMeasurements.id, m.id));
          }
        }
      }
    }

    res.status(201).json(newVersion);
  } catch (error) {
    next(error);
  }
});

router.get("/api/takeoff/versions/compare", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffVersions, takeoffMeasurements } = await import("@shared/schema");
    const { versionAId, versionBId } = req.query;

    if (!versionAId || !versionBId) {
      res.status(400).json({ error: "versionAId and versionBId are required" });
      return;
    }

    const [versionA] = await db.select().from(takeoffVersions)
      .where(eq(takeoffVersions.id, versionAId as string)).limit(1);
    const [versionB] = await db.select().from(takeoffVersions)
      .where(eq(takeoffVersions.id, versionBId as string)).limit(1);

    if (versionA?.sheetId) {
      const access = await verifySheetAccess(versionA.sheetId, req.user!);
      if (!access.allowed) { res.status(403).json({ error: "Access denied" }); return; }
    }
    if (versionB?.sheetId && versionB.sheetId !== versionA?.sheetId) {
      const access = await verifySheetAccess(versionB.sheetId, req.user!);
      if (!access.allowed) { res.status(403).json({ error: "Access denied" }); return; }
    }

    if (!versionA || !versionB) {
      res.status(404).json({ error: "One or both versions not found" });
      return;
    }

    const measurementsA = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.takeoffVersionId, versionAId as string));
    const measurementsB = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.takeoffVersionId, versionBId as string));

    type MeasurementRow = typeof measurementsA[number];
    const getLineageKey = (m: MeasurementRow) => m.originMeasurementId || m.id;

    const mapA = new Map(measurementsA.map(m => [getLineageKey(m), m]));
    const mapB = new Map(measurementsB.map(m => [getLineageKey(m), m]));

    const added: MeasurementRow[] = [];
    const removed: MeasurementRow[] = [];
    const changed: { older: MeasurementRow; newer: MeasurementRow; deltas: { lengthDelta: number; areaDelta: number; volumeDelta: number; costDelta: number } }[] = [];
    const unchanged: MeasurementRow[] = [];

    for (const [key, mB] of mapB) {
      const mA = mapA.get(key);
      if (!mA) {
        added.push(mB);
      } else {
        const lengthDelta = (mB.computedLengthFt || 0) - (mA.computedLengthFt || 0);
        const areaDelta = (mB.computedAreaFt2 || 0) - (mA.computedAreaFt2 || 0);
        const volumeDelta = (mB.computedVolumeCy || 0) - (mA.computedVolumeCy || 0);
        const costDelta = ((mB.unitCost || 0) * (mB.computedAreaFt2 || mB.computedLengthFt || mB.count || 0)) -
          ((mA.unitCost || 0) * (mA.computedAreaFt2 || mA.computedLengthFt || mA.count || 0));

        if (Math.abs(lengthDelta) > 0.01 || Math.abs(areaDelta) > 0.01 || Math.abs(volumeDelta) > 0.01 || Math.abs(costDelta) > 0.01) {
          changed.push({
            older: mA,
            newer: mB,
            deltas: { lengthDelta, areaDelta, volumeDelta, costDelta },
          });
        } else {
          unchanged.push(mB);
        }
      }
    }

    for (const [key, mA] of mapA) {
      if (!mapB.has(key)) {
        removed.push(mA);
      }
    }

    const totalCostA = measurementsA.reduce((sum, m) => {
      const qty = m.computedAreaFt2 || m.computedLengthFt || m.count || 0;
      return sum + (m.unitCost || 0) * qty;
    }, 0);
    const totalCostB = measurementsB.reduce((sum, m) => {
      const qty = m.computedAreaFt2 || m.computedLengthFt || m.count || 0;
      return sum + (m.unitCost || 0) * qty;
    }, 0);

    const totalLengthA = measurementsA.reduce((sum, m) => sum + (m.computedLengthFt || 0), 0);
    const totalLengthB = measurementsB.reduce((sum, m) => sum + (m.computedLengthFt || 0), 0);
    const totalAreaA = measurementsA.reduce((sum, m) => sum + (m.computedAreaFt2 || 0), 0);
    const totalAreaB = measurementsB.reduce((sum, m) => sum + (m.computedAreaFt2 || 0), 0);

    res.json({
      versionA,
      versionB,
      summary: {
        addedCount: added.length,
        removedCount: removed.length,
        changedCount: changed.length,
        unchangedCount: unchanged.length,
        totalCostDelta: totalCostB - totalCostA,
        totalLengthDelta: totalLengthB - totalLengthA,
        totalAreaDelta: totalAreaB - totalAreaA,
      },
      added,
      removed,
      changed,
      unchanged,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/takeoff/versions/:versionId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffVersions, takeoffMeasurements, users } = await import("@shared/schema");
    const { versionId } = req.params;

    const [version] = await db.select().from(takeoffVersions)
      .where(eq(takeoffVersions.id, versionId))
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    if (version.sheetId) {
      const access = await verifySheetAccess(version.sheetId, req.user!);
      if (!access.allowed) { res.status(403).json({ error: "Access denied" }); return; }
    }

    const measurements = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.takeoffVersionId, versionId));

    let createdByName: string | null = null;
    if (version.createdById) {
      const [user] = await db.select({ firstName: users.firstName, lastName: users.lastName })
        .from(users).where(eq(users.id, version.createdById)).limit(1);
      if (user) createdByName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    }

    res.json({ ...version, createdByName, measurements });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/takeoff/measurements/:id/properties", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffMeasurements } = await import("@shared/schema");
    const { id } = req.params;
    const propertiesSchema = z.object({
      subcontractorId: z.string().nullable().optional(),
      supplierId: z.string().nullable().optional(),
      locationTag: z.string().nullable().optional(),
      installationStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "ON_HOLD"]).optional(),
      costCodeId: z.string().nullable().optional(),
    });

    const parsed = propertiesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid property data", details: parsed.error.errors });
      return;
    }

    const { subcontractorId, supplierId, locationTag, installationStatus, costCodeId } = parsed.data;

    const [existing] = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Measurement not found" });
      return;
    }

    const locked = await isMeasurementLocked(id);
    if (locked) {
      res.status(403).json({ error: "Cannot edit properties of a measurement in a locked version" });
      return;
    }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const updates: Partial<typeof takeoffMeasurements.$inferInsert> = { updatedAt: new Date() };
    if (subcontractorId !== undefined) updates.subcontractorId = subcontractorId;
    if (supplierId !== undefined) updates.supplierId = supplierId;
    if (locationTag !== undefined) updates.locationTag = locationTag ? sanitizeShortText(locationTag) : null;
    if (installationStatus !== undefined) updates.installationStatus = installationStatus;
    if (costCodeId !== undefined) updates.costCodeId = costCodeId;

    const [updated] = await db.update(takeoffMeasurements)
      .set(updates)
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
