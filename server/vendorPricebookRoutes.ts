import { Router } from "express";
import { db } from "./db";
import { pricebookImportJobs, vendorPricingCatalogs, crmOrganisations, organizations, users } from "@shared/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { z } from "zod";
import multer from "multer";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

const createImportJobSchema = z.object({
  crmOrganisationId: z.string().uuid(),
  effectiveQuarter: z.string().optional(),
  effectiveDate: z.string().optional(),
});

router.get("/pricebook-imports", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const statusFilter = req.query.status as string;

    const conditions = [eq(pricebookImportJobs.organizationId, req.user.organizationId)];
    if (statusFilter && ["PENDING", "PROCESSING", "COMPLETED", "FAILED"].includes(statusFilter)) {
      conditions.push(eq(pricebookImportJobs.status, statusFilter as any));
    }

    const jobs = await db
      .select({
        id: pricebookImportJobs.id,
        crmOrganisationId: pricebookImportJobs.crmOrganisationId,
        vendorName: crmOrganisations.name,
        fileName: pricebookImportJobs.fileName,
        status: pricebookImportJobs.status,
        itemsExtracted: pricebookImportJobs.itemsExtracted,
        itemsApproved: pricebookImportJobs.itemsApproved,
        errorMessage: pricebookImportJobs.errorMessage,
        effectiveQuarter: pricebookImportJobs.effectiveQuarter,
        effectiveDate: pricebookImportJobs.effectiveDate,
        processedAt: pricebookImportJobs.processedAt,
        createdAt: pricebookImportJobs.createdAt,
        createdBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(pricebookImportJobs)
      .leftJoin(crmOrganisations, eq(pricebookImportJobs.crmOrganisationId, crmOrganisations.id))
      .leftJoin(users, eq(pricebookImportJobs.createdById, users.id))
      .where(and(...conditions))
      .orderBy(desc(pricebookImportJobs.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pricebookImportJobs)
      .where(and(...conditions));

    res.json({
      jobs,
      pagination: {
        total: countResult?.count || 0,
        limit,
        offset,
        hasMore: (countResult?.count || 0) > offset + limit,
      },
    });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to fetch import jobs: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch import jobs" });
  }
});

router.get("/pricebook-imports/:jobId", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId } = req.params;

    const [job] = await db
      .select({
        id: pricebookImportJobs.id,
        organizationId: pricebookImportJobs.organizationId,
        crmOrganisationId: pricebookImportJobs.crmOrganisationId,
        vendorName: crmOrganisations.name,
        fileName: pricebookImportJobs.fileName,
        fileRef: pricebookImportJobs.fileRef,
        status: pricebookImportJobs.status,
        itemsExtracted: pricebookImportJobs.itemsExtracted,
        itemsApproved: pricebookImportJobs.itemsApproved,
        errorMessage: pricebookImportJobs.errorMessage,
        effectiveQuarter: pricebookImportJobs.effectiveQuarter,
        effectiveDate: pricebookImportJobs.effectiveDate,
        processedAt: pricebookImportJobs.processedAt,
        createdAt: pricebookImportJobs.createdAt,
      })
      .from(pricebookImportJobs)
      .leftJoin(crmOrganisations, eq(pricebookImportJobs.crmOrganisationId, crmOrganisations.id))
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      )
      .limit(1);

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    const extractedItems = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.pricebookImportId, jobId))
      .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);

    res.json({
      job,
      extractedItems,
    });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to fetch import job: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch import job" });
  }
});

router.post("/pricebook-imports", requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const bodyValidation = createImportJobSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      return res.status(400).json({ error: "Invalid input", details: bodyValidation.error.issues });
    }

    const { crmOrganisationId, effectiveQuarter, effectiveDate } = bodyValidation.data;

    const [vendor] = await db
      .select()
      .from(crmOrganisations)
      .where(
        and(
          eq(crmOrganisations.id, crmOrganisationId),
          eq(crmOrganisations.organizationId, req.user.organizationId)
        )
      );

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileRef = `pricebooks/${req.user.organizationId}/${crmOrganisationId}/${timestamp}_${sanitizedFileName}`;

    let storageAvailable = false;
    try {
      const { Storage } = await import('@google-cloud/storage');
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (bucketId) {
        const storage = new Storage();
        const bucket = storage.bucket(bucketId);
        const file = bucket.file(fileRef);
        await file.save(fileBuffer, {
          contentType: 'application/pdf',
          metadata: {
            organizationId: req.user.organizationId,
            crmOrganisationId,
            uploadedBy: req.user.id,
          },
        });
        storageAvailable = true;
        logInfo(`[VendorPricebook] File uploaded to storage: ${fileRef}`);
      }
    } catch (storageError: any) {
      logError(`[VendorPricebook] Storage upload failed (will continue with DB record): ${storageError.message}`);
    }

    const [importJob] = await db.insert(pricebookImportJobs).values({
      organizationId: req.user.organizationId,
      crmOrganisationId,
      fileRef: storageAvailable ? fileRef : `local:${fileName}`,
      fileName,
      status: "PENDING",
      effectiveQuarter: effectiveQuarter || getCurrentQuarter(),
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      createdById: req.user.id,
    }).returning();

    logInfo(`[VendorPricebook] Import job created: ${importJob.id} for vendor ${crmOrganisationId}`);

    res.status(201).json({
      success: true,
      job: importJob,
      message: "Pricebook uploaded. AI extraction will begin shortly.",
    });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to create import job: ${error.message}`);
    res.status(500).json({ error: "Failed to upload pricebook" });
  }
});

router.post("/pricebook-imports/:jobId/process", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    if (job.status !== "PENDING") {
      return res.status(400).json({ error: `Job is already ${job.status.toLowerCase()}` });
    }

    await db
      .update(pricebookImportJobs)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(pricebookImportJobs.id, jobId));

    try {
      const { extractPricingFromPDF } = await import("./ai/vendorPriceListExtractor");
      
      const extractedItems = await extractPricingFromPDF(
        job.fileRef,
        job.crmOrganisationId,
        job.effectiveQuarter || getCurrentQuarter()
      );

      const insertedItems = [];
      for (const item of extractedItems) {
        const [inserted] = await db.insert(vendorPricingCatalogs).values({
          crmOrganisationId: job.crmOrganisationId,
          organizationId: job.organizationId,
          itemName: item.itemName,
          itemCode: item.itemCode,
          category: item.category,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          minimumOrder: item.minimumOrder,
          deliveryFee: item.deliveryFee,
          effectiveQuarter: job.effectiveQuarter || getCurrentQuarter(),
          effectiveDate: job.effectiveDate || new Date(),
          sourceDocUrl: job.fileRef,
          sourceDocName: job.fileName,
          sourceType: "PRICEBOOK_IMPORT",
          approvalStatus: "PENDING_REVIEW",
          pricebookImportId: job.id,
          isActive: true,
          createdById: job.createdById,
        }).returning();
        insertedItems.push(inserted);
      }

      await db
        .update(pricebookImportJobs)
        .set({
          status: "COMPLETED",
          itemsExtracted: insertedItems.length,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pricebookImportJobs.id, jobId));

      logInfo(`[VendorPricebook] Job ${jobId} completed: ${insertedItems.length} items extracted`);

      res.json({
        success: true,
        itemsExtracted: insertedItems.length,
        message: `Successfully extracted ${insertedItems.length} pricing items`,
      });
    } catch (extractionError: any) {
      await db
        .update(pricebookImportJobs)
        .set({
          status: "FAILED",
          errorMessage: extractionError.message,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pricebookImportJobs.id, jobId));

      logError(`[VendorPricebook] Job ${jobId} failed: ${extractionError.message}`);
      res.status(500).json({ error: "AI extraction failed", details: extractionError.message });
    }
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to process import job: ${error.message}`);
    res.status(500).json({ error: "Failed to process import job" });
  }
});

router.post("/pricebook-imports/:jobId/items/:itemId/approve", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId, itemId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    const [item] = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(
        and(
          eq(vendorPricingCatalogs.id, itemId),
          eq(vendorPricingCatalogs.pricebookImportId, jobId)
        )
      );

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "APPROVED",
        approvedByUserId: req.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, itemId));

    const [approvedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorPricingCatalogs)
      .where(
        and(
          eq(vendorPricingCatalogs.pricebookImportId, jobId),
          eq(vendorPricingCatalogs.approvalStatus, "APPROVED")
        )
      );

    await db
      .update(pricebookImportJobs)
      .set({
        itemsApproved: approvedCount?.count || 0,
        updatedAt: new Date(),
      })
      .where(eq(pricebookImportJobs.id, jobId));

    res.json({ success: true, message: "Item approved" });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to approve item: ${error.message}`);
    res.status(500).json({ error: "Failed to approve item" });
  }
});

router.post("/pricebook-imports/:jobId/items/:itemId/reject", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId, itemId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "REJECTED",
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vendorPricingCatalogs.id, itemId),
          eq(vendorPricingCatalogs.pricebookImportId, jobId)
        )
      );

    res.json({ success: true, message: "Item rejected" });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to reject item: ${error.message}`);
    res.status(500).json({ error: "Failed to reject item" });
  }
});

router.post("/pricebook-imports/:jobId/approve-all", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { jobId } = req.params;

    const [job] = await db
      .select()
      .from(pricebookImportJobs)
      .where(
        and(
          eq(pricebookImportJobs.id, jobId),
          eq(pricebookImportJobs.organizationId, req.user.organizationId)
        )
      );

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "APPROVED",
        approvedByUserId: req.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vendorPricingCatalogs.pricebookImportId, jobId),
          eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
        )
      );

    await db
      .update(pricebookImportJobs)
      .set({
        itemsApproved: job.itemsExtracted,
        updatedAt: new Date(),
      })
      .where(eq(pricebookImportJobs.id, jobId));

    res.json({ success: true, message: "All items approved" });
  } catch (error: any) {
    logError(`[VendorPricebook] Failed to approve all items: ${error.message}`);
    res.status(500).json({ error: "Failed to approve all items" });
  }
});

function getCurrentQuarter(): string {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  return `${year}-Q${quarter}`;
}

export default router;
