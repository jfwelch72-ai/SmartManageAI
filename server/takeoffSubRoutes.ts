import { Router } from "express";
import { db } from "./db";
import {
  projects, subcontractorContracts, subcontractors, subcontractorPayments,
  filePermissions
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, and, sql } from "drizzle-orm";
import { logCreate, logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { createArcSegment } from "@shared/utils/geometry";

const router = Router();

// ====================
// Subcontractor Routes
// ====================

// Get subcontractor contracts for a project
router.get("/api/projects/:code/subcontractors", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

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

    // Verify contract exists
    const [contract] = await db
      .select()
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.id, contractId))
      .limit(1);

    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

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

    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

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
    const { takeoffSheets, projectPlans } = await import("@shared/schema");

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

// Stream PDF directly for a takeoff sheet (with authorization)
router.get("/api/takeoff/sheets/:sheetId/pdf", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffSheets, projectPlans, planDocuments } = await import("@shared/schema");

    // Get the sheet with plan and document info
    const [sheetData] = await db
      .select({
        sheet: takeoffSheets,
        plan: projectPlans,
        document: planDocuments,
      })
      .from(takeoffSheets)
      .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
      .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
      .where(eq(takeoffSheets.id, sheetId))
      .limit(1);

    if (!sheetData) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const { sheet, plan, document } = sheetData;

    // Verify project exists and user has access
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, sheet.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Check if user has permission to access this document
    const userRole = req.user!.role;
    const userId = req.user!.id;

    // Admins and Managers have full access
    const hasRoleAccess = userRole === "ADMIN" || userRole === "MANAGER";

    // Check if user uploaded the document or has explicit permission
    let hasDocumentAccess = hasRoleAccess;
    if (!hasDocumentAccess && document) {
      // Check if user uploaded this document
      const isUploader = document.uploadedById === userId;
      
      // Check for explicit file permission
      const [permission] = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, document.id),
            eq(filePermissions.fileType, "DOCUMENT"),
            eq(filePermissions.userId, userId)
          )
        )
        .limit(1);

      hasDocumentAccess = isUploader || !!permission;
    }

    if (!hasDocumentAccess) {
      res.status(403).json({ error: "You do not have permission to access this document" });
      return;
    }

    // If document exists and has objectKey, stream the file
    if (document?.objectKey) {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
        
        // Stream the file directly to the response with caching
        await objectStorageService.downloadObject(objectFile, res, 3600); // 1 hour cache
        return;
      } catch (error: any) {
        console.error("Error streaming PDF from objectKey:", error);
        
        // If object not found, return 404 instead of 500
        if (error.name === 'ObjectNotFoundError' || error.message?.includes('not found')) {
          res.status(404).json({ error: "PDF file no longer exists. Please re-upload the document." });
          return;
        }
        
        res.status(500).json({ error: "Internal server error" });
        return;
      }
    }

    // No valid document/objectKey available - cannot serve PDF securely
    res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
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

    const { planDocuments, projectPlans, takeoffSheets } = await import("@shared/schema");

    // Get the document
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

// Get measurements for a sheet
router.get("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffMeasurements } = await import("@shared/schema");

    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, sheetId))
      .orderBy(takeoffMeasurements.createdAt);

    // Parse points JSON string to array for frontend
    const parsedMeasurements = measurements.map(m => ({
      ...m,
      points: JSON.parse(m.points),
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

    // SECURITY: Sanitize text inputs for data integrity
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

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
    };

    const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

    // PHASE 2.3a: If updating points, recompute arc length if applicable
    let finalValues = { ...validated };
    if (validated.points && validated.type === "LINEAR") {
      // Get the sheet's scale to compute arc length
      const measurement = await db
        .select({ sheetId: takeoffMeasurements.sheetId })
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.id, id))
        .limit(1);

      if (measurement && measurement.length > 0) {
        const sheet = await db
          .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
          .from(takeoffSheets)
          .where(eq(takeoffSheets.id, measurement[0].sheetId))
          .limit(1);

        if (sheet && sheet.length > 0 && sheet[0].scalePxPerFoot) {
          const points = typeof validated.points === 'string' ? JSON.parse(validated.points) : validated.points;
          
          // If 3 points, this is an arc - compute arc length
          if (points.length === 3) {
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
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({ ...finalValues, updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Measurement not found" });
      return;
    }

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
    const { takeoffMeasurements, takeoffSheets, projects, crewProjectAssignments, crewMembers, insertTakeoffMeasurementSchema } = await import("@shared/schema");

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

    // Validate that the sheet exists and belongs to a valid project
    const sheetWithProject = await db
      .select({
        sheetId: takeoffSheets.id,
        projectId: takeoffSheets.projectId,
        projectCode: projects.code,
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
      })
      .from(takeoffSheets)
      .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
      .where(eq(takeoffSheets.id, validated.sheetId))
      .limit(1);

    if (!sheetWithProject || sheetWithProject.length === 0) {
      res.status(404).json({ error: "Sheet not found or does not belong to a valid project" });
      return;
    }

    // Authorization check: Only ADMIN/MANAGER or users assigned to the project can create measurements
    const userRole = req.user!.role;
    if (userRole !== "ADMIN" && userRole !== "MANAGER") {
      // Check if user is assigned to this project via crew assignments
      const userAssignment = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(
          and(
            eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
            eq(crewMembers.userId, req.user!.id)
          )
        )
        .limit(1);

      if (!userAssignment || userAssignment.length === 0) {
        res.status(403).json({ error: "You do not have access to this project" });
        return;
      }
    }

    // PHASE 2.3a: Compute arc length for 3-point LINEAR measurements (arcs)
    let finalValues = { ...validated };
    if (validated.type === "LINEAR" && sheetWithProject[0].scalePxPerFoot) {
      const points = JSON.parse(validated.points);
      
      // If 3 points, this is an arc - compute arc length
      if (points.length === 3) {
        try {
          const [start, middle, end] = points;
          const arcSegment = createArcSegment(start, end, middle, sheetWithProject[0].scalePxPerFoot);
          
          if (arcSegment) {
            // Store the computed arc length in feet
            finalValues = {
              ...validated,
              computedLengthFt: arcSegment.arcLength,
            };
            console.log(`[Arc Measurement] Computed arc length: ${arcSegment.arcLength.toFixed(2)} LF`);
          }
        } catch (error) {
          console.error("Error computing arc length:", error);
          // If arc computation fails, don't block the measurement creation
          // The frontend will handle displaying the measurement
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

    const [deleted] = await db
      .delete(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Measurement not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting measurement:", error);
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

    // Validate that the sheet exists and belongs to a valid project
    const sheetWithProject = await db
      .select({
        sheetId: takeoffSheets.id,
        projectId: takeoffSheets.projectId,
      })
      .from(takeoffSheets)
      .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
      .where(eq(takeoffSheets.id, id))
      .limit(1);

    if (!sheetWithProject || sheetWithProject.length === 0) {
      res.status(404).json({ error: "Sheet not found or does not belong to a valid project" });
      return;
    }

    // Authorization check: Only ADMIN/MANAGER or users assigned to the project can calibrate
    const userRole = req.user!.role;
    if (userRole !== "ADMIN" && userRole !== "MANAGER") {
      // Check if user is assigned to this project via crew assignments
      const userAssignment = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(
          and(
            eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
            eq(crewMembers.userId, req.user!.id)
          )
        )
        .limit(1);

      if (!userAssignment || userAssignment.length === 0) {
        res.status(403).json({ error: "You do not have access to this project" });
        return;
      }
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

          default:
            // COUNT and NOTE don't have computed quantities
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

// ====================
// QUANTITY CATEGORY ROUTES
// ====================

// Get all quantity categories for a project
router.get("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;
    const { quantityCategories } = await import("@shared/schema");

    // Get the project to find its internal ID
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

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

    // Get the project to find its internal ID
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

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
    const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

    // SECURITY: Sanitize text inputs for data integrity
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
router.patch("/api/takeoff/sheets/:id/rename", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { sheetName } = req.body;
    const { takeoffSheets, projects } = await import("@shared/schema");

    if (!sheetName || typeof sheetName !== "string" || sheetName.trim().length === 0) {
      res.status(400).json({ error: "sheetName is required" });
      return;
    }

    const [sheet] = await db
      .select({ id: takeoffSheets.id, projectId: takeoffSheets.projectId })
      .from(takeoffSheets)
      .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
      .where(eq(takeoffSheets.id, id))
      .limit(1);

    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const userRole = req.user!.role;
    if (userRole !== "ADMIN" && userRole !== "MANAGER" && userRole !== "SUPER_ADMIN") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, sheet.projectId), eq(crewMembers.userId, req.user!.id)))
        .limit(1);
      if (!assignment) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
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

router.patch("/api/takeoff/sheets/:id/folder-group", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { folderGroup } = req.body;
    const { takeoffSheets, projects } = await import("@shared/schema");

    if (!folderGroup || typeof folderGroup !== "string" || folderGroup.trim().length === 0) {
      res.status(400).json({ error: "folderGroup is required" });
      return;
    }

    const [sheet] = await db
      .select({ id: takeoffSheets.id, projectId: takeoffSheets.projectId })
      .from(takeoffSheets)
      .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
      .where(and(eq(takeoffSheets.id, id), eq(projects.orgId, req.user!.orgId)))
      .limit(1);

    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(takeoffSheets)
      .set({ folderGroup: folderGroup.trim(), updatedAt: new Date() })
      .where(eq(takeoffSheets.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating sheet folder group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reorder sheets (batch update sheetIndex)
router.patch("/api/projects/:projectId/takeoff/sheets/reorder", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { order } = req.body;
    const { takeoffSheets, projects } = await import("@shared/schema");

    if (!Array.isArray(order) || order.length === 0) {
      res.status(400).json({ error: "order must be a non-empty array of { id, sheetIndex }" });
      return;
    }

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
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
    for (const item of order) {
      if (!item.id || typeof item.sheetIndex !== "number") continue;
      await db
        .update(takeoffSheets)
        .set({ sheetIndex: item.sheetIndex, updatedAt: now })
        .where(and(eq(takeoffSheets.id, item.id), eq(takeoffSheets.projectId, projectId)));
    }

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
    const { takeoffSheets, takeoffMeasurements, projects } = await import("@shared/schema");

    const [sourceSheet] = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, id))
      .limit(1);

    if (!sourceSheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const userRole = req.user!.role;
    if (userRole !== "ADMIN" && userRole !== "MANAGER" && userRole !== "SUPER_ADMIN") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, sourceSheet.projectId), eq(crewMembers.userId, req.user!.id)))
        .limit(1);
      if (!assignment) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const allSheets = await db
      .select({ sheetIndex: takeoffSheets.sheetIndex })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, sourceSheet.projectId));

    const maxIndex = allSheets.reduce((max, s) => Math.max(max, s.sheetIndex), 0);

    const [newSheet] = await db
      .insert(takeoffSheets)
      .values({
        projectId: sourceSheet.projectId,
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
    const { takeoffSheets, projects } = await import("@shared/schema");

    const [sheet] = await db
      .select({ id: takeoffSheets.id, projectId: takeoffSheets.projectId })
      .from(takeoffSheets)
      .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
      .where(eq(takeoffSheets.id, id))
      .limit(1);

    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const userRole = req.user!.role;
    if (userRole !== "ADMIN" && userRole !== "MANAGER" && userRole !== "SUPER_ADMIN") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, sheet.projectId), eq(crewMembers.userId, req.user!.id)))
        .limit(1);
      if (!assignment) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
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
    const { quantityCategories } = await import("@shared/schema");

    const [deleted] = await db
      .delete(quantityCategories)
      .where(eq(quantityCategories.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting quantity category:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
