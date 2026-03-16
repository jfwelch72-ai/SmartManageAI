import { Router } from "express";
import { db } from "./db";
import { projects, budgetLineItems, insertBudgetLineItemSchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { calculateCostLedger } from "./costLedgerService";

const router = Router();

function canAccessCostLedger(role?: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "MANAGER" ||
    role === "SUPERINTENDENT" || role === "ESTIMATOR" || role === "OFFICE_MANAGER" ||
    role === "HUSTLER" || role === "PROJECT_ENGINEER" || role === "PROCUREMENT_MANAGER";
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

    const [row] = await db.insert(budgetLineItems).values(parseResult.data).returning();
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

    const rows = await db.transaction(async (tx) => {
      await tx.delete(budgetLineItems).where(eq(budgetLineItems.projectId, project.id));
      if (parsed.length === 0) return [];
      const toInsert = parsed.map(line => ({
        projectId: project.id,
        costCode: line.costCode,
        description: line.description,
        division: line.division,
        laborBudget: line.laborBudget,
        materialBudget: line.materialBudget,
        subcontractorBudget: line.subcontractorBudget,
        equipmentBudget: line.equipmentBudget,
        otherBudget: line.otherBudget,
      }));
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

    const [row] = await db.update(budgetLineItems).set(updates)
      .where(and(eq(budgetLineItems.id, req.params.lineId), eq(budgetLineItems.projectId, project.id)))
      .returning();

    if (!row) return res.status(404).json({ error: "Budget line not found" });
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
