import { Router } from "express";
import { db } from "./db";
import { bids, bidDocuments, takeoffSheets, quantityCategories } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, and } from "drizzle-orm";
import { logAudit } from "./auditLogger";
import { sanitizeShortText } from "./sanitization";
import { verifyOrgAccess } from "./orgFilter";

const router = Router();

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

router.post("/api/bids/:bidId/takeoff/categories", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const name = sanitizeShortText(req.body.name);
    const color = req.body.color || "#3b82f6";
    const displayOrder = req.body.displayOrder ?? 0;

    if (!name) return res.status(400).json({ error: "Category name is required" });

    const [category] = await db.insert(quantityCategories).values({
      bidId: bid.id,
      name,
      color,
      displayOrder,
    }).returning();

    res.status(201).json(category);
  } catch (error) {
    console.error("Create bid quantity category error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/bids/:bidId/takeoff/sheets/reorder", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bid = await getBidWithAccess(req, res);
    if (!bid) return;

    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: "Order array is required" });

    for (const item of order) {
      await db.update(takeoffSheets)
        .set({ sheetIndex: item.sheetIndex })
        .where(and(eq(takeoffSheets.id, item.id), eq(takeoffSheets.bidId, bid.id)));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Reorder bid sheets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
