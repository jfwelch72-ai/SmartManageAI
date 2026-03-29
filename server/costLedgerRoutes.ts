import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { projects, budgetLineItems, insertBudgetLineItemSchema, orgCostCodes, organizations, forecastAdjustments, budgetAlerts } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { calculateCostLedger } from "./costLedgerService";
import { getCostCodesForTrade } from "@shared/costCodes";
import { successResponse } from "./responseHelper";

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
    logError("Get budget lines error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    evaluateBudgetAlerts(project.id).catch(e => logError("Budget alert eval error:", {}, e instanceof Error ? e : new Error(String(e))));
    res.status(201).json(row);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "23505") {
      return res.status(409).json({ error: "A budget line for that cost code already exists on this project" });
    }
    logError("Create budget line error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    evaluateBudgetAlerts(project.id).catch(e => logError("Budget alert eval error:", {}, e instanceof Error ? e : new Error(String(e))));
    res.json(rows);
  } catch (error: unknown) {
    logError("Bulk upsert budget lines error:", {}, error instanceof Error ? error : new Error(String(error)));
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

    evaluateBudgetAlerts(project.id).catch(e => logError("Budget alert eval error:", {}, e instanceof Error ? e : new Error(String(e))));
    res.json(row);
  } catch (error: unknown) {
    logError("Update budget line error:", {}, error instanceof Error ? error : new Error(String(error)));
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
    successResponse(res);
  } catch (error) {
    logError("Delete budget line error:", {}, error instanceof Error ? error : new Error(String(error)));
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
      Number(project.budgetAlertThreshold || 80),
      Number(project.budgetCriticalThreshold || 95),
    );

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const rawPageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 0;
    const pageSize = rawPageSize > 0 ? Math.min(200, rawPageSize) : 0;

    if (pageSize > 0) {
      const totalRows = result.rows.length;
      const totalPages = Math.ceil(totalRows / pageSize);
      const start = (page - 1) * pageSize;
      const paginatedRows = result.rows.slice(start, start + pageSize);
      res.json({
        ...result,
        rows: paginatedRows,
        totalRowCount: totalRows,
        pagination: { page, pageSize, totalPages, totalRows },
      });
    } else {
      res.json(result);
    }
  } catch (error) {
    logError("Cost ledger error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const forecastAdjustmentSchema = z.object({
  costCode: z.string().min(1),
  adjustedETC: z.coerce.number().finite().min(0, "ETC must be non-negative").transform(v => String(v)),
  note: z.string().optional().nullable(),
});

router.put("/api/projects/:code/forecast-adjustments", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parseResult = forecastAdjustmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation error", details: parseResult.error.flatten() });
    }

    const { costCode, adjustedETC, note } = parseResult.data;

    const [existing] = await db.select().from(forecastAdjustments)
      .where(and(eq(forecastAdjustments.projectId, project.id), eq(forecastAdjustments.costCode, costCode)));

    let row;
    if (existing) {
      [row] = await db.update(forecastAdjustments).set({
        adjustedETC,
        note: note || null,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      }).where(eq(forecastAdjustments.id, existing.id)).returning();
    } else {
      [row] = await db.insert(forecastAdjustments).values({
        projectId: project.id,
        costCode,
        adjustedETC,
        note: note || null,
        updatedBy: req.user!.id,
      }).returning();
    }

    evaluateBudgetAlerts(project.id).catch(e => logError("Budget alert eval error:", {}, e instanceof Error ? e : new Error(String(e))));
    res.json(row);
  } catch (error) {
    logError("Forecast adjustment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/projects/:code/forecast-adjustments/:costCode", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [deleted] = await db.delete(forecastAdjustments)
      .where(and(eq(forecastAdjustments.projectId, project.id), eq(forecastAdjustments.costCode, req.params.costCode)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Forecast adjustment not found" });
    evaluateBudgetAlerts(project.id).catch(e => logError("Budget alert eval error:", {}, e instanceof Error ? e : new Error(String(e))));
    successResponse(res);
  } catch (error) {
    logError("Delete forecast adjustment error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/projects/:code/budget-thresholds", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const schema = z.object({
      budgetAlertThreshold: z.number().min(1).max(100).optional(),
      budgetCriticalThreshold: z.number().min(1).max(100).optional(),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation error", details: parseResult.error.flatten() });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (parseResult.data.budgetAlertThreshold !== undefined) {
      updates.budgetAlertThreshold = String(parseResult.data.budgetAlertThreshold);
    }
    if (parseResult.data.budgetCriticalThreshold !== undefined) {
      updates.budgetCriticalThreshold = String(parseResult.data.budgetCriticalThreshold);
    }

    const [updated] = await db.update(projects).set(updates).where(eq(projects.id, project.id)).returning();
    res.json({
      budgetAlertThreshold: Number(updated.budgetAlertThreshold || 80),
      budgetCriticalThreshold: Number(updated.budgetCriticalThreshold || 95),
    });
  } catch (error) {
    logError("Update budget thresholds error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/budget-alerts", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canAccessCostLedger(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const alerts = await db.select().from(budgetAlerts)
      .where(and(eq(budgetAlerts.projectId, project.id), eq(budgetAlerts.isDismissed, false)));

    res.json(alerts);
  } catch (error) {
    logError("Get budget alerts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/projects/:code/budget-alerts/:alertId/dismiss", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canEditBudgetLines(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [updated] = await db.update(budgetAlerts).set({
      isDismissed: true,
      dismissedBy: req.user!.id,
      dismissedAt: new Date(),
    }).where(and(eq(budgetAlerts.id, req.params.alertId), eq(budgetAlerts.projectId, project.id))).returning();

    if (!updated) return res.status(404).json({ error: "Alert not found" });
    res.json(updated);
  } catch (error) {
    logError("Dismiss budget alert error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export async function evaluateBudgetAlerts(projectId: string): Promise<void> {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return;

    const projectBudget = Number(project.contractAmount || project.budget || 0);
    const alertThreshold = Number(project.budgetAlertThreshold || 80);
    const criticalThreshold = Number(project.budgetCriticalThreshold || 95);

    const ledger = await calculateCostLedger(
      project.id,
      projectBudget,
      project.startDate,
      project.estimatedCompletionDate,
      alertThreshold,
      criticalThreshold,
    );

    const existingAlerts = await db.select().from(budgetAlerts)
      .where(and(eq(budgetAlerts.projectId, project.id), eq(budgetAlerts.isDismissed, false)));

    const existingAlertKeys = new Set(existingAlerts.map(a => `${a.costCode || 'TOTAL'}-${a.alertLevel}`));

    const alertsToCreate: Array<{
      projectId: string;
      costCode: string | null;
      alertLevel: string;
      thresholdPercent: string;
      currentPercent: string;
      budgetAmount: string;
      actualAmount: string;
    }> = [];

    for (const row of [...ledger.rows, ledger.totals]) {
      if (!row.alertLevel) continue;
      const costCodeKey = row.costCode === "TOTAL" ? null : row.costCode;
      const key = `${costCodeKey || 'TOTAL'}-${row.alertLevel}`;
      if (existingAlertKeys.has(key)) continue;

      alertsToCreate.push({
        projectId: project.id,
        costCode: costCodeKey,
        alertLevel: row.alertLevel,
        thresholdPercent: String(row.alertLevel === "CRITICAL" ? criticalThreshold : alertThreshold),
        currentPercent: String(row.percentUsed),
        budgetAmount: String(row.budgetedTotal),
        actualAmount: String(row.actualTotal),
      });
    }

    if (alertsToCreate.length > 0) {
      await db.insert(budgetAlerts).values(alertsToCreate);

      const { eventBus } = await import("./events");

      for (const alert of alertsToCreate) {
        await eventBus.emit({
          type: "budget.alert_triggered",
          version: 1,
          orgId: project.gcOrganizationId || "",
          actorId: "system",
          timestamp: new Date(),
          payload: {
            projectId: project.id,
            projectCode: project.code,
            costCode: alert.costCode || null,
            alertLevel: alert.alertLevel,
            thresholdPercent: Number(alert.thresholdPercent),
            currentPercent: Number(alert.currentPercent),
          },
        });
      }
    }
  } catch (error) {
    logError("evaluateBudgetAlerts error:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

export default router;
