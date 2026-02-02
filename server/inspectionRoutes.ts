import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { 
  projectInspections, projects, users, notifications, organizations,
  insertProjectInspectionSchema, type ProjectInspection
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { generateInspectionRequestPDF } from "./pdf-service";
import { sendInspectionRequestEmail } from "./email";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  CITY_OFFICIAL: "City Official",
  GC_REPRESENTATIVE: "GC Representative",
  OWNER_REPRESENTATIVE: "Owner Representative"
};

const INSPECTION_STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Requested",
  SCHEDULED: "Scheduled",
  PASSED: "Passed",
  FAILED: "Failed",
  CANCELLED: "Cancelled"
};

const REQUEST_METHOD_LABELS: Record<string, string> = {
  CALL: "Phone Call",
  EMAIL: "Email",
  PORTAL: "Online Portal",
  OTHER: "Other"
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PASSED", "FAILED", "CANCELLED"],
  PASSED: [],
  FAILED: ["SCHEDULED"],
  CANCELLED: []
};

function isValidTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

async function getInspectionById(id: string) {
  const [inspection] = await db
    .select()
    .from(projectInspections)
    .where(eq(projectInspections.id, id))
    .limit(1);
  return inspection;
}

async function generateInspectionNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectInspections)
    .innerJoin(projects, eq(projectInspections.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  
  const count = result?.count || 0;
  return `INSP-${projectCode}-${String(count + 1).padStart(3, '0')}`;
}

function enrichInspection(inspection: ProjectInspection) {
  return {
    ...inspection,
    typeLabel: INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType,
    statusLabel: INSPECTION_STATUS_LABELS[inspection.status] || inspection.status,
    requestMethodLabel: inspection.requestMethod 
      ? REQUEST_METHOD_LABELS[inspection.requestMethod] || inspection.requestMethod 
      : null
  };
}

router.get("/projects/:projectId/inspections", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const { projectId } = req.params;
    const { status, type } = req.query;

    // Verify project exists and check org access
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.json([]);
    }

    const conditions = [eq(projectInspections.projectId, projectId)];
    
    if (status && typeof status === 'string') {
      conditions.push(eq(projectInspections.status, status as any));
    }
    if (type && typeof type === 'string') {
      conditions.push(eq(projectInspections.inspectionType, type as any));
    }

    const inspections = await db
      .select()
      .from(projectInspections)
      .where(and(...conditions))
      .orderBy(desc(projectInspections.createdAt));

    const enrichedInspections = inspections.map(enrichInspection);

    res.json(enrichedInspections);
  } catch (error) {
    console.error("Error fetching project inspections:", error);
    res.status(500).json({ error: "Failed to fetch inspections" });
  }
});

router.post("/projects/:projectId/inspections", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
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

    const inspectionNumber = await generateInspectionNumber(project.code);

    const sanitizedBody = {
      ...req.body,
      projectId,
      inspectionNumber,
      createdById: userId,
      title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : null,
      inspectorName: req.body.inspectorName ? sanitizeShortText(req.body.inspectorName) : null,
      inspectorCompany: req.body.inspectorCompany ? sanitizeShortText(req.body.inspectorCompany) : null,
      inspectorPhone: req.body.inspectorPhone ? sanitizeShortText(req.body.inspectorPhone) : null,
      inspectorEmail: req.body.inspectorEmail ? sanitizeShortText(req.body.inspectorEmail) : null,
      gcRepName: req.body.gcRepName ? sanitizeShortText(req.body.gcRepName) : null,
      gcRepCompany: req.body.gcRepCompany ? sanitizeShortText(req.body.gcRepCompany) : null,
      gcRepPhone: req.body.gcRepPhone ? sanitizeShortText(req.body.gcRepPhone) : null,
      gcRepEmail: req.body.gcRepEmail ? sanitizeShortText(req.body.gcRepEmail) : null,
      ownerRepName: req.body.ownerRepName ? sanitizeShortText(req.body.ownerRepName) : null,
      ownerRepCompany: req.body.ownerRepCompany ? sanitizeShortText(req.body.ownerRepCompany) : null,
      ownerRepPhone: req.body.ownerRepPhone ? sanitizeShortText(req.body.ownerRepPhone) : null,
      ownerRepEmail: req.body.ownerRepEmail ? sanitizeShortText(req.body.ownerRepEmail) : null,
      resultNotes: req.body.resultNotes ? sanitizeText(req.body.resultNotes) : null,
      punchListItems: req.body.punchListItems ? sanitizeText(req.body.punchListItems) : null,
      requestedDate: req.body.requestedDate ? new Date(req.body.requestedDate) : new Date(),
      scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : null,
      completedDate: req.body.completedDate ? new Date(req.body.completedDate) : null,
      reinspectionDate: req.body.reinspectionDate ? new Date(req.body.reinspectionDate) : null,
    };

    const validationResult = insertProjectInspectionSchema.safeParse(sanitizedBody);

    if (!validationResult.success) {
      res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.format() 
      });
      return;
    }

    const [newInspection] = await db
      .insert(projectInspections)
      .values(validationResult.data)
      .returning();

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "projectInspection",
      entityId: newInspection.id,
      newValue: JSON.stringify({ inspectionNumber, type: newInspection.inspectionType, projectId }),
    }, req);

    res.status(201).json(enrichInspection(newInspection));
  } catch (error) {
    console.error("Error creating inspection:", error);
    res.status(500).json({ error: "Failed to create inspection" });
  }
});

router.get("/inspections/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    res.json(enrichInspection(inspection));
  } catch (error) {
    console.error("Error fetching inspection:", error);
    res.status(500).json({ error: "Failed to fetch inspection" });
  }
});

router.patch("/inspections/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    if (inspection.status === "PASSED" || inspection.status === "CANCELLED") {
      res.status(400).json({ error: `Cannot edit inspection in ${inspection.status} status` });
      return;
    }

    const updateData: any = {
      updatedAt: new Date()
    };

    if (req.body.title !== undefined) updateData.title = sanitizeShortText(req.body.title);
    if (req.body.description !== undefined) updateData.description = sanitizeText(req.body.description);
    if (req.body.inspectionType !== undefined) updateData.inspectionType = req.body.inspectionType;
    if (req.body.requestMethod !== undefined) updateData.requestMethod = req.body.requestMethod;
    if (req.body.scheduledDate !== undefined) updateData.scheduledDate = req.body.scheduledDate ? new Date(req.body.scheduledDate) : null;
    if (req.body.completedDate !== undefined) updateData.completedDate = req.body.completedDate ? new Date(req.body.completedDate) : null;
    
    if (req.body.inspectorContactId !== undefined) updateData.inspectorContactId = req.body.inspectorContactId;
    if (req.body.inspectorName !== undefined) updateData.inspectorName = sanitizeShortText(req.body.inspectorName);
    if (req.body.inspectorCompany !== undefined) updateData.inspectorCompany = sanitizeShortText(req.body.inspectorCompany);
    if (req.body.inspectorPhone !== undefined) updateData.inspectorPhone = sanitizeShortText(req.body.inspectorPhone);
    if (req.body.inspectorEmail !== undefined) updateData.inspectorEmail = sanitizeShortText(req.body.inspectorEmail);
    
    if (req.body.gcRepContactId !== undefined) updateData.gcRepContactId = req.body.gcRepContactId;
    if (req.body.gcRepName !== undefined) updateData.gcRepName = sanitizeShortText(req.body.gcRepName);
    if (req.body.gcRepCompany !== undefined) updateData.gcRepCompany = sanitizeShortText(req.body.gcRepCompany);
    if (req.body.gcRepPhone !== undefined) updateData.gcRepPhone = sanitizeShortText(req.body.gcRepPhone);
    if (req.body.gcRepEmail !== undefined) updateData.gcRepEmail = sanitizeShortText(req.body.gcRepEmail);
    
    if (req.body.ownerRepContactId !== undefined) updateData.ownerRepContactId = req.body.ownerRepContactId;
    if (req.body.ownerRepName !== undefined) updateData.ownerRepName = sanitizeShortText(req.body.ownerRepName);
    if (req.body.ownerRepCompany !== undefined) updateData.ownerRepCompany = sanitizeShortText(req.body.ownerRepCompany);
    if (req.body.ownerRepPhone !== undefined) updateData.ownerRepPhone = sanitizeShortText(req.body.ownerRepPhone);
    if (req.body.ownerRepEmail !== undefined) updateData.ownerRepEmail = sanitizeShortText(req.body.ownerRepEmail);
    
    if (req.body.resultNotes !== undefined) updateData.resultNotes = sanitizeText(req.body.resultNotes);
    if (req.body.punchListItems !== undefined) updateData.punchListItems = sanitizeText(req.body.punchListItems);
    if (req.body.reinspectionRequired !== undefined) updateData.reinspectionRequired = req.body.reinspectionRequired;
    if (req.body.reinspectionDate !== undefined) updateData.reinspectionDate = req.body.reinspectionDate ? new Date(req.body.reinspectionDate) : null;

    const [updatedInspection] = await db
      .update(projectInspections)
      .set(updateData)
      .where(eq(projectInspections.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectInspection",
      entityId: updatedInspection.id,
      newValue: JSON.stringify({ changes: Object.keys(updateData) }),
    }, req);

    res.json(enrichInspection(updatedInspection));
  } catch (error) {
    console.error("Error updating inspection:", error);
    res.status(500).json({ error: "Failed to update inspection" });
  }
});

router.post("/inspections/:id/schedule", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    if (!isValidTransition(inspection.status, "SCHEDULED")) {
      res.status(400).json({ 
        error: `Cannot schedule inspection from ${inspection.status} status` 
      });
      return;
    }

    if (!req.body.scheduledDate) {
      res.status(400).json({ error: "Scheduled date is required" });
      return;
    }

    const [updatedInspection] = await db
      .update(projectInspections)
      .set({
        status: "SCHEDULED" as const,
        scheduledDate: new Date(req.body.scheduledDate),
        updatedAt: new Date()
      })
      .where(eq(projectInspections.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectInspection",
      entityId: updatedInspection.id,
      newValue: JSON.stringify({ status: "SCHEDULED", scheduledDate: req.body.scheduledDate }),
    }, req);

    res.json(enrichInspection(updatedInspection));
  } catch (error) {
    console.error("Error scheduling inspection:", error);
    res.status(500).json({ error: "Failed to schedule inspection" });
  }
});

router.post("/inspections/:id/pass", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    if (!isValidTransition(inspection.status, "PASSED")) {
      res.status(400).json({ 
        error: `Cannot mark inspection as passed from ${inspection.status} status` 
      });
      return;
    }

    const [updatedInspection] = await db
      .update(projectInspections)
      .set({
        status: "PASSED" as const,
        completedDate: new Date(),
        resultNotes: req.body.resultNotes ? sanitizeText(req.body.resultNotes) : inspection.resultNotes,
        updatedAt: new Date()
      })
      .where(eq(projectInspections.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectInspection",
      entityId: updatedInspection.id,
      newValue: JSON.stringify({ status: "PASSED" }),
    }, req);

    res.json(enrichInspection(updatedInspection));
  } catch (error) {
    console.error("Error passing inspection:", error);
    res.status(500).json({ error: "Failed to pass inspection" });
  }
});

router.post("/inspections/:id/fail", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    if (!isValidTransition(inspection.status, "FAILED")) {
      res.status(400).json({ 
        error: `Cannot mark inspection as failed from ${inspection.status} status` 
      });
      return;
    }

    const [updatedInspection] = await db
      .update(projectInspections)
      .set({
        status: "FAILED" as const,
        completedDate: new Date(),
        resultNotes: req.body.resultNotes ? sanitizeText(req.body.resultNotes) : inspection.resultNotes,
        punchListItems: req.body.punchListItems ? sanitizeText(req.body.punchListItems) : inspection.punchListItems,
        reinspectionRequired: req.body.reinspectionRequired ?? true,
        reinspectionDate: req.body.reinspectionDate ? new Date(req.body.reinspectionDate) : null,
        updatedAt: new Date()
      })
      .where(eq(projectInspections.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectInspection",
      entityId: updatedInspection.id,
      newValue: JSON.stringify({ status: "FAILED", reinspectionRequired: updatedInspection.reinspectionRequired }),
    }, req);

    res.json(enrichInspection(updatedInspection));
  } catch (error) {
    console.error("Error failing inspection:", error);
    res.status(500).json({ error: "Failed to fail inspection" });
  }
});

router.post("/inspections/:id/cancel", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    if (!isValidTransition(inspection.status, "CANCELLED")) {
      res.status(400).json({ 
        error: `Cannot cancel inspection from ${inspection.status} status` 
      });
      return;
    }

    const [updatedInspection] = await db
      .update(projectInspections)
      .set({
        status: "CANCELLED" as const,
        resultNotes: req.body.reason ? sanitizeText(req.body.reason) : inspection.resultNotes,
        updatedAt: new Date()
      })
      .where(eq(projectInspections.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectInspection",
      entityId: updatedInspection.id,
      newValue: JSON.stringify({ status: "CANCELLED", reason: req.body.reason }),
    }, req);

    res.json(enrichInspection(updatedInspection));
  } catch (error) {
    console.error("Error cancelling inspection:", error);
    res.status(500).json({ error: "Failed to cancel inspection" });
  }
});

router.delete("/inspections/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      res.status(404).json({ error: "Inspection not found" });
      return;
    }

    if (inspection.status !== "REQUESTED" && inspection.status !== "CANCELLED") {
      res.status(400).json({ 
        error: "Can only delete inspections in REQUESTED or CANCELLED status" 
      });
      return;
    }

    await db
      .delete(projectInspections)
      .where(eq(projectInspections.id, req.params.id));

    await logAudit({
      userId,
      action: "DELETE",
      entityType: "projectInspection",
      entityId: inspection.id,
      oldValue: JSON.stringify({ inspectionNumber: inspection.inspectionNumber }),
    }, req);

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting inspection:", error);
    res.status(500).json({ error: "Failed to delete inspection" });
  }
});

router.post("/inspections/:id/generate-pdf", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, inspection.projectId)).limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, project.gcOrganizationId!)).limit(1);
    
    const [createdByUser] = await db.select().from(users).where(eq(users.id, inspection.createdById)).limit(1);

    const pdfData = {
      inspection: {
        inspectionNumber: inspection.inspectionNumber,
        title: inspection.title,
        description: inspection.description,
        inspectionType: inspection.inspectionType,
        typeLabel: INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType,
        requestMethod: inspection.requestMethod,
        requestMethodLabel: inspection.requestMethod ? REQUEST_METHOD_LABELS[inspection.requestMethod] || inspection.requestMethod : null,
        requestedDate: inspection.requestedDate,
        scheduledDate: inspection.scheduledDate,
        status: inspection.status,
        statusLabel: INSPECTION_STATUS_LABELS[inspection.status] || inspection.status,
        inspectorName: inspection.inspectorName,
        inspectorCompany: inspection.inspectorCompany,
        inspectorPhone: inspection.inspectorPhone,
        inspectorEmail: inspection.inspectorEmail,
        gcRepName: inspection.gcRepName,
        gcRepCompany: inspection.gcRepCompany,
        gcRepPhone: inspection.gcRepPhone,
        gcRepEmail: inspection.gcRepEmail,
        ownerRepName: inspection.ownerRepName,
        ownerRepCompany: inspection.ownerRepCompany,
        ownerRepPhone: inspection.ownerRepPhone,
        ownerRepEmail: inspection.ownerRepEmail,
      },
      project: {
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        locationAddress: project.locationAddress,
        city: project.city,
        state: project.state,
      },
      createdBy: {
        firstName: createdByUser?.firstName || 'Unknown',
        lastName: createdByUser?.lastName || 'User',
        email: createdByUser?.email || null,
        phone: createdByUser?.phone || null,
      },
      organizationName: org?.name || 'SmartManageAI',
      branding: org ? {
        organizationName: org.name,
        primaryColor: org.primaryColor || '#1a365d',
        accentColor: '#0284c7',
      } : undefined,
    };

    const pdfStream = generateInspectionRequestPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Inspection-${inspection.inspectionNumber}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Error generating inspection PDF:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.get("/inspections/:id/pdf", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const inspection = await getInspectionById(req.params.id);

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, inspection.projectId)).limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, project.gcOrganizationId!)).limit(1);
    
    const [createdByUser] = await db.select().from(users).where(eq(users.id, inspection.createdById)).limit(1);

    const pdfData = {
      inspection: {
        inspectionNumber: inspection.inspectionNumber,
        title: inspection.title,
        description: inspection.description,
        inspectionType: inspection.inspectionType,
        typeLabel: INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType,
        requestMethod: inspection.requestMethod,
        requestMethodLabel: inspection.requestMethod ? REQUEST_METHOD_LABELS[inspection.requestMethod] || inspection.requestMethod : null,
        requestedDate: inspection.requestedDate,
        scheduledDate: inspection.scheduledDate,
        status: inspection.status,
        statusLabel: INSPECTION_STATUS_LABELS[inspection.status] || inspection.status,
        inspectorName: inspection.inspectorName,
        inspectorCompany: inspection.inspectorCompany,
        inspectorPhone: inspection.inspectorPhone,
        inspectorEmail: inspection.inspectorEmail,
        gcRepName: inspection.gcRepName,
        gcRepCompany: inspection.gcRepCompany,
        gcRepPhone: inspection.gcRepPhone,
        gcRepEmail: inspection.gcRepEmail,
        ownerRepName: inspection.ownerRepName,
        ownerRepCompany: inspection.ownerRepCompany,
        ownerRepPhone: inspection.ownerRepPhone,
        ownerRepEmail: inspection.ownerRepEmail,
      },
      project: {
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        locationAddress: project.locationAddress,
        city: project.city,
        state: project.state,
      },
      createdBy: {
        firstName: createdByUser?.firstName || 'Unknown',
        lastName: createdByUser?.lastName || 'User',
        email: createdByUser?.email || null,
        phone: createdByUser?.phone || null,
      },
      organizationName: org?.name || 'SmartManageAI',
      branding: org ? {
        organizationName: org.name,
        primaryColor: org.primaryColor || '#1a365d',
        accentColor: '#0284c7',
      } : undefined,
    };

    const pdfStream = generateInspectionRequestPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Inspection-${inspection.inspectionNumber}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Error serving inspection PDF:", error);
    res.status(500).json({ error: "Failed to serve PDF" });
  }
});

export default router;
