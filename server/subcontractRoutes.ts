import { Router, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  subcontractorContracts, 
  subcontractors, 
  projects,
  organizations,
  insertSubcontractorContractSchema
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole, AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { generateSubcontractPDF } from "./subcontract-pdf-service";

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

router.get("/subcontracts/project/:projectId", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FIELD_USER"]), async (req: AuthRequest, res: Response) => {
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
        subcontractor: subcontractors
      })
      .from(subcontractorContracts)
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .where(eq(subcontractorContracts.projectId, projectId))
      .orderBy(desc(subcontractorContracts.createdAt));

    res.json(contracts.map(c => ({
      ...c.contract,
      subcontractor: c.subcontractor
    })));
  } catch (error) {
    console.error("Get subcontracts error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:id", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER", "FIELD_USER"]), async (req: AuthRequest, res: Response) => {
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
      .select()
      .from(subcontractors)
      .where(eq(subcontractors.id, contract.subcontractorId))
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
        zipCode: project?.zipCode
      }
    });
  } catch (error) {
    console.error("Get subcontract error:", error);
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
  notes: z.string().optional().nullable()
});

router.post("/subcontracts", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]), async (req: AuthRequest, res: Response) => {
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
      .from(subcontractors)
      .where(eq(subcontractors.id, data.subcontractorId))
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
        status: "PENDING",
        createdById: req.user!.id
      })
      .returning();

    res.status(201).json({
      ...newContract,
      subcontractor
    });
  } catch (error) {
    console.error("Create subcontract error:", error);
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
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "TERMINATED"]).optional()
});

router.patch("/subcontracts/:id", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]), async (req: AuthRequest, res: Response) => {
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
    if (data.status !== undefined) updates.status = data.status;

    const [updated] = await db
      .update(subcontractorContracts)
      .set(updates)
      .where(eq(subcontractorContracts.id, id))
      .returning();

    const [subcontractor] = await db
      .select()
      .from(subcontractors)
      .where(eq(subcontractors.id, updated.subcontractorId))
      .limit(1);

    res.json({
      ...updated,
      subcontractor
    });
  } catch (error) {
    console.error("Update subcontract error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/subcontracts/:id", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]), async (req: AuthRequest, res: Response) => {
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
    console.error("Delete subcontract error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/subcontracts/:id/pdf", requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "MANAGER"]), async (req: AuthRequest, res: Response) => {
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
      .from(subcontractors)
      .where(eq(subcontractors.id, contract.subcontractorId))
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
          zipCode: org.zipCode || project.zipCode,
          phone: org.phone,
          email: org.email,
          primaryColor: org.primaryColor || '#1a365d',
          accentColor: org.accentColor || '#2563eb'
        };
      }
    }

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
        companyName: subcontractor.companyName,
        contactName: subcontractor.contactName,
        email: subcontractor.email,
        phone: subcontractor.phone,
        address: subcontractor.address,
        specialties: subcontractor.specialties
      },
      project: {
        name: project.name,
        code: project.code || project.id.substring(0, 8),
        locationAddress: project.locationAddress,
        city: project.city,
        state: project.state,
        zipCode: project.zipCode,
        startDate: project.startDate,
        targetCompletionDate: project.targetCompletionDate
      },
      branding,
      includeSignaturePages: includeSignatures
    };

    const pdfStream = generateSubcontractPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Subcontract-${contract.contractNumber}.pdf"`);
    
    pdfStream.pipe(res);
  } catch (error) {
    console.error("Generate subcontract PDF error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
