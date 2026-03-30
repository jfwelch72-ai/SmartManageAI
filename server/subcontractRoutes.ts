/**
 * @openapi
 * /api/subcontracts:
 *   get:
 *     tags: [Subcontractors]
 *     summary: List subcontracts
 *     description: Returns all subcontractor contracts for the organization. Requires financials access.
 *     parameters:
 *       - name: projectId
 *         in: query
 *         schema: { type: string, format: uuid }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of subcontracts }
 *   post:
 *     tags: [Subcontractors]
 *     summary: Create a subcontract
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Subcontract created }
 * /api/subcontracts/projects:
 *   get:
 *     tags: [Subcontractors]
 *     summary: List projects with subcontracts
 *     responses:
 *       200: { description: Projects with subcontract summaries }
 * /api/subcontracts/subcontractors:
 *   get:
 *     tags: [Subcontractors]
 *     summary: List subcontractors
 *     responses:
 *       200: { description: List of subcontractors }
 * /api/subcontracts/project/{projectId}:
 *   get:
 *     tags: [Subcontractors]
 *     summary: Get subcontracts for a project
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Subcontracts for the project }
 * /api/subcontracts/{id}:
 *   get:
 *     tags: [Subcontractors]
 *     summary: Get subcontract details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Subcontract details with line items }
 *       404: { description: Subcontract not found }
 *   patch:
 *     tags: [Subcontractors]
 *     summary: Update a subcontract
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
 *       200: { description: Subcontract updated }
 *   delete:
 *     tags: [Subcontractors]
 *     summary: Delete a subcontract
 *     description: Requires SUPER_ADMIN or ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Subcontract deleted }
 * /api/subcontracts/{id}/pdf:
 *   get:
 *     tags: [Subcontractors]
 *     summary: Export subcontract as PDF
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf: {}
 */
import { logError } from "./utils/logger";
import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  subcontractorContracts, 
  projects,
  organizations,
  crmOrganisations,
  insertSubcontractorContractSchema,
  subcontractSovLineItems,
} from "@shared/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole, requireRoleOrFeature, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { generateSubcontractPDF } from "./subcontract-pdf-service";
import { createAutoPayableFromContract } from "./subcontractorPayablesRoutes";

const router = Router();

async function verifyProjectAccess(projectId: string, orgId: string | null, shouldFilter: boolean, isSuperAdmin: boolean = false): Promise<{ project: any | null; hasAccess: boolean }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return { project: null, hasAccess: false };
  }

  if (!project.gcOrganizationId && !isSuperAdmin) {
    return { project, hasAccess: false };
  }

  if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
    return { project, hasAccess: false };
  }

  return { project, hasAccess: true };
}

async function verifyContractAccess(contractId: string, orgId: string | null, shouldFilter: boolean, isSuperAdmin: boolean = false): Promise<{ contract: any | null; hasAccess: boolean }> {
  const [contract] = await db
    .select()
    .from(subcontractorContracts)
    .where(eq(subcontractorContracts.id, contractId))
    .limit(1);

  if (!contract) {
    return { contract: null, hasAccess: false };
  }

  const { hasAccess } = await verifyProjectAccess(contract.projectId, orgId, shouldFilter, isSuperAdmin);
  if (!hasAccess) {
    return { contract, hasAccess: false };
  }

  return { contract, hasAccess: true };
}

router.get("/subcontracts", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json([]);
    }

    const allContracts = await db
      .select({
        contract: subcontractorContracts,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
        subcontractor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
        },
      })
      .from(subcontractorContracts)
      .leftJoin(projects, eq(subcontractorContracts.projectId, projects.id))
      .leftJoin(crmOrganisations, eq(subcontractorContracts.subcontractorId, crmOrganisations.id))
      .orderBy(desc(subcontractorContracts.createdAt));

    let filteredContracts = allContracts;
    if (shouldFilter && orgId && !isSuperAdmin) {
      filteredContracts = allContracts.filter(c => c.project?.gcOrganizationId === orgId);
    }

    const result = filteredContracts.map(c => ({
      ...c.contract,
      project: c.project,
      subcontractor: c.subcontractor,
    }));

    res.json(result);
  } catch (error) {
    logError("Get all subcontracts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/projects", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json([]);
    }

    let query = db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
      })
      .from(projects)
      .orderBy(desc(projects.createdAt))
      .limit(100);

    if (shouldFilter && orgId) {
      query = query.where(eq(projects.gcOrganizationId, orgId)) as typeof query;
    }

    const projectList = await query;
    res.json(projectList);
  } catch (error) {
    logError("Get projects for subcontracts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/subcontractors", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json([]);
    }

    let conditions = [eq(crmOrganisations.type, "SUBCONTRACTOR")];
    if (shouldFilter && orgId) {
      conditions.push(eq(crmOrganisations.organizationId, orgId));
    }

    const subList = await db
      .select({
        id: crmOrganisations.id,
        companyName: crmOrganisations.name,
      })
      .from(crmOrganisations)
      .where(and(...conditions))
      .orderBy(crmOrganisations.name)
      .limit(100);

    res.json(subList);
  } catch (error) {
    logError("Get subcontractors error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/project/:projectId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "HOURLY_EMPLOYEE"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { project, hasAccess } = await verifyProjectAccess(projectId, orgId, shouldFilter, isSuperAdmin);
    if (!project || !hasAccess) {
      return res.status(404).json({ error: "Project not found" });
    }

    const contracts = await db
      .select({
        contract: subcontractorContracts,
        subcontractor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
        },
      })
      .from(subcontractorContracts)
      .leftJoin(crmOrganisations, eq(subcontractorContracts.subcontractorId, crmOrganisations.id))
      .where(eq(subcontractorContracts.projectId, projectId))
      .orderBy(desc(subcontractorContracts.createdAt));

    res.json(contracts.map(c => ({
      ...c.contract,
      subcontractor: c.subcontractor,
    })));
  } catch (error) {
    logError("Get subcontracts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:id", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "HOURLY_EMPLOYEE"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const { contract, hasAccess } = await verifyContractAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!contract || !hasAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const [subcontractor] = await db
      .select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(eq(crmOrganisations.id, contract.subcontractorId))
      .limit(1);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, contract.projectId))
      .limit(1);

    res.json({
      ...contract,
      subcontractor,
      project: {
        id: project?.id,
        name: project?.name,
        code: project?.code,
        locationAddress: project?.locationAddress,
        city: project?.city,
        state: project?.state,
      }
    });
  } catch (error) {
    logError("Get subcontract error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const createSubcontractSchema = z.object({
  subcontractorId: z.string().min(1),
  projectId: z.string().min(1),
  scopeOfWork: z.string().min(1),
  contractAmount: z.string().or(z.number()),
  startDate: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  retentionPercent: z.string().or(z.number()).optional().nullable(),
  notes: z.string().optional().nullable(),
  costCode: z.string().optional().nullable(),
  billingFrequency: z.string().optional().nullable(),
  paymentDueDays: z.number().int().min(0).optional().nullable(),
  earlyPayDiscount: z.string().or(z.number()).optional().nullable(),
  lienWaiverRequired: z.boolean().optional(),
});

router.post("/subcontracts", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const validationResult = createSubcontractSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const data = validationResult.data;

    const { project, hasAccess } = await verifyProjectAccess(data.projectId, orgId, shouldFilter, isSuperAdmin);
    if (!project || !hasAccess) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [subcontractor] = await db
      .select()
      .from(crmOrganisations)
      .where(and(
        eq(crmOrganisations.id, data.subcontractorId),
        eq(crmOrganisations.type, "SUBCONTRACTOR")
      ))
      .limit(1);

    if (!subcontractor) {
      return res.status(404).json({ error: "Subcontractor not found" });
    }

    const [contractCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.projectId, data.projectId));

    const contractNumber = `SC-${project.code || project.id.substring(0, 8)}-${String(contractCount.count + 1).padStart(3, '0')}`;

    const [newContract] = await db
      .insert(subcontractorContracts)
      .values({
        subcontractorId: data.subcontractorId,
        projectId: data.projectId,
        contractNumber,
        scopeOfWork: data.scopeOfWork,
        contractAmount: String(data.contractAmount),
        startDate: data.startDate ? new Date(data.startDate) : null,
        completionDate: data.completionDate ? new Date(data.completionDate) : null,
        paymentTerms: data.paymentTerms,
        retentionPercent: data.retentionPercent ? String(data.retentionPercent) : null,
        notes: data.notes,
        costCode: data.costCode || null,
        billingFrequency: data.billingFrequency || null,
        paymentDueDays: data.paymentDueDays ?? null,
        earlyPayDiscount: data.earlyPayDiscount ? String(data.earlyPayDiscount) : null,
        lienWaiverRequired: data.lienWaiverRequired ?? false,
        status: "PENDING",
        createdById: req.user!.id
      })
      .returning();

    res.status(201).json({
      ...newContract,
      subcontractor
    });
  } catch (error) {
    logError("Create subcontract error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateSubcontractSchema = z.object({
  scopeOfWork: z.string().optional(),
  contractAmount: z.string().or(z.number()).optional(),
  startDate: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  retentionPercent: z.string().or(z.number()).optional().nullable(),
  notes: z.string().optional().nullable(),
  costCode: z.string().optional().nullable(),
  billingFrequency: z.string().optional().nullable(),
  paymentDueDays: z.number().int().min(0).optional().nullable(),
  earlyPayDiscount: z.string().or(z.number()).optional().nullable(),
  lienWaiverRequired: z.boolean().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "TERMINATED"]).optional()
});

router.patch("/subcontracts/:id", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const { contract, hasAccess } = await verifyContractAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!contract || !hasAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const validationResult = updateSubcontractSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const data = validationResult.data;
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (data.scopeOfWork !== undefined) updates.scopeOfWork = data.scopeOfWork;
    if (data.contractAmount !== undefined) updates.contractAmount = String(data.contractAmount);
    if (data.startDate !== undefined) updates.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.completionDate !== undefined) updates.completionDate = data.completionDate ? new Date(data.completionDate) : null;
    if (data.paymentTerms !== undefined) updates.paymentTerms = data.paymentTerms;
    if (data.retentionPercent !== undefined) updates.retentionPercent = data.retentionPercent ? String(data.retentionPercent) : null;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.costCode !== undefined) updates.costCode = data.costCode || null;
    if (data.billingFrequency !== undefined) updates.billingFrequency = data.billingFrequency || null;
    if (data.paymentDueDays !== undefined) updates.paymentDueDays = data.paymentDueDays ?? null;
    if (data.earlyPayDiscount !== undefined) updates.earlyPayDiscount = data.earlyPayDiscount ? String(data.earlyPayDiscount) : null;
    if (data.lienWaiverRequired !== undefined) updates.lienWaiverRequired = data.lienWaiverRequired;
    if (data.status !== undefined) updates.status = data.status;

    const oldStatus = contract.status;
    
    const [updated] = await db
      .update(subcontractorContracts)
      .set(updates)
      .where(eq(subcontractorContracts.id, id))
      .returning();

    const [subcontractor] = await db
      .select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(eq(crmOrganisations.id, updated.subcontractorId))
      .limit(1);

    // Auto-create payable when contract status changes to COMPLETED
    if (data.status === "COMPLETED" && oldStatus !== "COMPLETED") {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, contract.projectId))
        .limit(1);
      
      if (project?.gcOrganizationId) {
        const result = await createAutoPayableFromContract(
          id,
          project.gcOrganizationId,
          req.user!.id
        );
        if (result.success) {
          console.log(`Auto-created payable ${result.paymentId} for completed contract ${contract.contractNumber}`);
        } else if (result.error) {
          console.log(`Auto-payable creation skipped: ${result.error}`);
        }
      }
    }

    res.json({
      ...updated,
      subcontractor
    });
  } catch (error) {
    logError("Update subcontract error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/subcontracts/:id", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const { contract, hasAccess } = await verifyContractAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!contract || !hasAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    await db
      .delete(subcontractorContracts)
      .where(eq(subcontractorContracts.id, id));

    res.status(204).send();
  } catch (error) {
    logError("Delete subcontract error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:id/pdf", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], 'canAccessFinancials'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
    const includeSignatures = req.query.signatures !== 'false';

    if (mustDenyAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const { contract, hasAccess } = await verifyContractAccess(id, orgId, shouldFilter, isSuperAdmin);
    if (!contract || !hasAccess) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const [subcontractor] = await db
      .select()
      .from(crmOrganisations)
      .where(and(
        eq(crmOrganisations.id, contract.subcontractorId),
        eq(crmOrganisations.type, "SUBCONTRACTOR")
      ))
      .limit(1);

    if (!subcontractor) {
      return res.status(404).json({ error: "Subcontractor not found" });
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, contract.projectId))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    let branding: any = {
      organizationName: 'SmartManageAI'
    };

    if (project.gcOrganizationId) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, project.gcOrganizationId))
        .limit(1);

      if (org) {
        branding = {
          organizationName: org.name,
          address: org.address || project.locationAddress,
          city: org.city || project.city,
          state: org.state || project.state,
          zipCode: org.zipCode || '',
          phone: org.phone,
          email: org.email,
          primaryColor: org.primaryColor || '#1a365d',
          accentColor: org.accentColor || '#2563eb'
        };
      }
    }

    const sovItems = await db
      .select()
      .from(subcontractSovLineItems)
      .where(eq(subcontractSovLineItems.contractId, id))
      .orderBy(asc(subcontractSovLineItems.itemNumber));

    const pdfData = {
      contract: {
        contractNumber: contract.contractNumber,
        scopeOfWork: contract.scopeOfWork,
        contractAmount: contract.contractAmount,
        startDate: contract.startDate,
        completionDate: contract.completionDate,
        status: contract.status,
        paymentTerms: contract.paymentTerms,
        retentionPercent: contract.retentionPercent,
        notes: contract.notes,
        createdAt: contract.createdAt
      },
      subcontractor: {
        companyName: subcontractor.name,
        contactName: null,
        email: null,
        phone: null,
        address: subcontractor.address,
        specialties: subcontractor.specialties
      },
      project: {
        name: project.name,
        code: project.code || project.id.substring(0, 8),
        locationAddress: project.locationAddress,
        city: project.city,
        state: project.state,
        zipCode: null,
        startDate: project.startDate,
        targetCompletionDate: project.estimatedCompletionDate
      },
      sovItems: sovItems.map(item => ({
        itemNumber: item.itemNumber,
        description: item.description,
        scheduledValue: item.scheduledValue,
        originalValue: item.originalValue,
        changeOrderRef: item.changeOrderRef,
      })),
      branding,
      includeSignaturePages: includeSignatures
    };

    const pdfStream = generateSubcontractPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Subcontract-${contract.contractNumber}.pdf"`);
    
    pdfStream.pipe(res);
  } catch (error) {
    logError("Generate subcontract PDF error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
