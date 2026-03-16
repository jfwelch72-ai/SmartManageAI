import { Router } from "express";
import { db } from "./db";
import { projects, budgetLineItems, insertBudgetLineItemSchema, orgCostCodes, organizations } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { calculateCostLedger } from "./costLedgerService";
import { getCostCodesForTrade } from "@shared/costCodes";

async function getValidCostCodes(orgId: string): Promise<Set<string>> {
  const [org] = await db.select({ tradeType: organizations.tradeType })
    .from(organizations).where(eq(organizations.id, orgId));
  const staticCodes = org?.tradeType ? getCostCodesForTrade(org.tradeType) : [];
  const customCodes = await db.select({ code: orgCostCodes.code })
    .from(orgCostCodes)
    .where(eq(orgCostCodes.organizationId, orgId));
  const validSet = new Set<string>();
  for (const c of staticCodes) validSet.add(c.code);
  for (const c of customCodes) validSet.add(c.code);
  return validSet;
}

async function validateCostCodes(orgId: string, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const validSet = await getValidCostCodes(orgId);
  return codes.filter(c => !validSet.has(c));
}

const router = Router();

function canAccessCostLedger(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" ||
    role === "ESTIMATOR" || role === "OFFICE_MANAGER" || role === "HUSTLER";
}

function canEditBudgetLines(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

router.get("/api/projects/:code/budget-lines", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canAccessCostLedger(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const lines = await db.select().from(budgetLineItems)
      .where(eq(budgetLineItems.projectId, project.id));

    res.json(lines);
  } catch (error) {
    console.error("Get budget lines error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/budget-lines", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parseResult = insertBudgetLineItemSchema.safeParse({
      ...req.body,
      projectId: project.id,
    });
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation error", details: parseResult.error.flatten() });
    }

    const data = parseResult.data;
    const invalid = await validateCostCodes(project.gcOrganizationId, [data.costCode]);
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid cost code '${data.costCode}' for this organization` });
    }
    const total = Number(data.laborBudget || 0) + Number(data.materialBudget || 0) +
      Number(data.subcontractorBudget || 0) + Number(data.equipmentBudget || 0) + Number(data.otherBudget || 0);
    const [row] = await db.insert(budgetLineItems).values({ ...data, totalBudget: String(total) }).returning();
    res.status(201).json(row);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "23505") {
      return res.status(409).json({ error: "A budget line for that cost code already exists on this project" });
    }
    console.error("Create budget line error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const bulkUpsertSchema = z.array(z.object({
  costCode: z.string().min(1),
  description: z.string().min(1),
  division: z.string().min(1),
  laborBudget: z.union([z.string(), z.number()]).transform(v => String(v)),
  materialBudget: z.union([z.string(), z.number()]).transform(v => String(v)),
  subcontractorBudget: z.union([z.string(), z.number()]).transform(v => String(v)),
  equipmentBudget: z.union([z.string(), z.number()]).transform(v => String(v)),
  otherBudget: z.union([z.string(), z.number()]).transform(v => String(v)),
}));

router.put("/api/projects/:code/budget-lines", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parseResult = bulkUpsertSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation error", details: parseResult.error.flatten() });
    }
    const parsed = parseResult.data;

    if (parsed.length > 0) {
      const costCodes = parsed.map(l => l.costCode);
      const invalid = await validateCostCodes(project.gcOrganizationId, costCodes);
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid cost codes for this organization: ${invalid.join(", ")}` });
      }
    }

    const rows = await db.transaction(async (tx) => {
      await tx.delete(budgetLineItems).where(eq(budgetLineItems.projectId, project.id));
      if (parsed.length === 0) return [];
      const toInsert = parsed.map(line => {
        const total = Number(line.laborBudget) + Number(line.materialBudget) +
          Number(line.subcontractorBudget) + Number(line.equipmentBudget) + Number(line.otherBudget);
        return {
          projectId: project.id,
          costCode: line.costCode,
          description: line.description,
          division: line.division,
          laborBudget: line.laborBudget,
          materialBudget: line.materialBudget,
          subcontractorBudget: line.subcontractorBudget,
          equipmentBudget: line.equipmentBudget,
          otherBudget: line.otherBudget,
          totalBudget: String(total),
        };
      });
      return tx.insert(budgetLineItems).values(toInsert).returning();
    });
    res.json(rows);
  } catch (error: unknown) {
    console.error("Bulk upsert budget lines error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/projects/:code/budget-lines/:lineId", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const updates: Partial<{
      laborBudget: string;
      materialBudget: string;
      subcontractorBudget: string;
      equipmentBudget: string;
      otherBudget: string;
      description: string;
      division: string;
      updatedAt: Date;
    }> = { updatedAt: new Date() };
    const { laborBudget, materialBudget, subcontractorBudget, equipmentBudget, otherBudget, description, division } = req.body;
    if (laborBudget !== undefined) updates.laborBudget = String(laborBudget);
    if (materialBudget !== undefined) updates.materialBudget = String(materialBudget);
    if (subcontractorBudget !== undefined) updates.subcontractorBudget = String(subcontractorBudget);
    if (equipmentBudget !== undefined) updates.equipmentBudget = String(equipmentBudget);
    if (otherBudget !== undefined) updates.otherBudget = String(otherBudget);
    if (description !== undefined) updates.description = String(description);
    if (division !== undefined) updates.division = String(division);

    const [existing] = await db.select().from(budgetLineItems)
      .where(and(eq(budgetLineItems.id, req.params.lineId), eq(budgetLineItems.projectId, project.id)));
    if (!existing) return res.status(404).json({ error: "Budget line not found" });

    const merged = {
      laborBudget: updates.laborBudget ?? existing.laborBudget,
      materialBudget: updates.materialBudget ?? existing.materialBudget,
      subcontractorBudget: updates.subcontractorBudget ?? existing.subcontractorBudget,
      equipmentBudget: updates.equipmentBudget ?? existing.equipmentBudget,
      otherBudget: updates.otherBudget ?? existing.otherBudget,
    };
    const totalBudget = String(
      Number(merged.laborBudget) + Number(merged.materialBudget) +
      Number(merged.subcontractorBudget) + Number(merged.equipmentBudget) + Number(merged.otherBudget)
    );

    const [row] = await db.update(budgetLineItems).set({ ...updates, totalBudget })
      .where(and(eq(budgetLineItems.id, req.params.lineId), eq(budgetLineItems.projectId, project.id)))
      .returning();

    res.json(row);
  } catch (error: unknown) {
    console.error("Update budget line error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/projects/:code/budget-lines/:lineId", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [deleted] = await db.delete(budgetLineItems)
      .where(and(eq(budgetLineItems.id, req.params.lineId), eq(budgetLineItems.projectId, project.id)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Budget line not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete budget line error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/cost-ledger", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canAccessCostLedger(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const projectBudget = Number(project.contractAmount || project.budget || 0);
    const result = await calculateCostLedger(
      project.id,
      projectBudget,
      project.startDate,
      project.estimatedCompletionDate,
    );

    res.json(result);
  } catch (error) {
    console.error("Cost ledger error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
