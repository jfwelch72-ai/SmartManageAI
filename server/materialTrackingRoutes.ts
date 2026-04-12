import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { insertNotification } from "./services/notificationService";
import {
  projects, users, scopeItems,
  projectMaterialBudgets, notifications,
} from "@shared/schema";
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";

const router = Router();

router.get("/api/projects/:projectId/material-budgets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { projectMaterialBudgets, projectMaterialUsage, scopeItems: scopeItemsTable } = await import("@shared/schema");
    
    const budgets = await db
      .select({
        budget: projectMaterialBudgets,
        scopeItem: {
          id: scopeItemsTable.id,
          description: scopeItemsTable.description,
          unit: scopeItemsTable.unit,
          totalQuantity: scopeItemsTable.totalQuantity,
          completedQuantity: scopeItemsTable.completedQuantity,
        }
      })
      .from(projectMaterialBudgets)
      .leftJoin(scopeItemsTable, eq(projectMaterialBudgets.scopeItemId, scopeItemsTable.id))
      .where(eq(projectMaterialBudgets.projectId, req.params.projectId))
      .orderBy(projectMaterialBudgets.description);

    res.json(budgets);
  } catch (error) {
    next(error);
  }
});

router.get("/api/projects/:projectId/material-budgets/summary", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { projectMaterialBudgets } = await import("@shared/schema");
    
    const budgets = await db
      .select()
      .from(projectMaterialBudgets)
      .where(eq(projectMaterialBudgets.projectId, req.params.projectId));

    const totalBudgetedCost = budgets.reduce((sum, b) => sum + Number(b.budgetedTotalCost || 0), 0);
    const totalActualCost = budgets.reduce((sum, b) => sum + Number(b.actualTotalCost || 0), 0);
    const itemsAtRisk = budgets.filter(b => Number(b.variancePercent || 0) >= 90).length;
    const alertsTriggered = budgets.filter(b => b.alertTriggered).length;

    res.json({
      totalItems: budgets.length,
      totalBudgetedCost,
      totalActualCost,
      variance: totalActualCost - totalBudgetedCost,
      variancePercent: totalBudgetedCost > 0 ? ((totalActualCost / totalBudgetedCost) * 100).toFixed(2) : 0,
      itemsAtRisk,
      alertsTriggered,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/projects/:projectId/material-usage", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { projectMaterialUsage, scopeItems: scopeItemsTable } = await import("@shared/schema");
    
    const usage = await db
      .select({
        usage: projectMaterialUsage,
        scopeItem: {
          id: scopeItemsTable.id,
          description: scopeItemsTable.description,
          unit: scopeItemsTable.unit,
        },
        createdBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        }
      })
      .from(projectMaterialUsage)
      .leftJoin(scopeItemsTable, eq(projectMaterialUsage.scopeItemId, scopeItemsTable.id))
      .leftJoin(users, eq(projectMaterialUsage.createdById, users.id))
      .where(eq(projectMaterialUsage.projectId, req.params.projectId))
      .orderBy(desc(projectMaterialUsage.usageDate), desc(projectMaterialUsage.createdAt));

    res.json(usage);
  } catch (error) {
    next(error);
  }
});

router.post("/api/projects/:projectId/material-usage", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { projectMaterialUsage, projectMaterialBudgets, insertProjectMaterialUsageSchema } = await import("@shared/schema");
    
    const validationResult = insertProjectMaterialUsageSchema.safeParse({
      ...req.body,
      projectId: req.params.projectId,
      createdById: req.user!.id,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const data = validationResult.data;
    if (!data.totalCost && data.quantityUsed && data.unitCost) {
      data.totalCost = (Number(data.quantityUsed) * Number(data.unitCost)).toFixed(2);
    }

    const [newUsage] = await db.insert(projectMaterialUsage).values(data).returning();

    if (data.materialBudgetId) {
      const allUsage = await db
        .select()
        .from(projectMaterialUsage)
        .where(eq(projectMaterialUsage.materialBudgetId, data.materialBudgetId));

      const totalQuantityUsed = allUsage.reduce((sum, u) => sum + Number(u.quantityUsed || 0), 0);
      const totalCostUsed = allUsage.reduce((sum, u) => sum + Number(u.totalCost || 0), 0);

      const [budget] = await db
        .select()
        .from(projectMaterialBudgets)
        .where(eq(projectMaterialBudgets.id, data.materialBudgetId));

      if (budget) {
        const budgetedQty = Number(budget.budgetedQuantity || 0);
        const varianceQty = totalQuantityUsed - budgetedQty;
        const variancePercent = budgetedQty > 0 ? (totalQuantityUsed / budgetedQty) * 100 : 0;
        const shouldAlert = variancePercent >= Number(budget.alertThresholdPercent || 90);
        const alertJustTriggered = shouldAlert && !budget.alertTriggered;

        await db
          .update(projectMaterialBudgets)
          .set({
            actualQuantityUsed: totalQuantityUsed.toString(),
            actualTotalCost: totalCostUsed.toString(),
            varianceQuantity: varianceQty.toString(),
            variancePercent: variancePercent.toFixed(2),
            alertTriggered: shouldAlert,
            alertTriggeredAt: alertJustTriggered ? new Date() : budget.alertTriggeredAt,
            updatedAt: new Date(),
          })
          .where(eq(projectMaterialBudgets.id, data.materialBudgetId));

        if (alertJustTriggered) {
          try {
            const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId));
            if (project) {
              const mgrConditions: SQL[] = [sql`${users.role} IN ('ADMIN', 'MANAGER')`];
              if (project.gcOrganizationId) {
                mgrConditions.push(eq(users.organizationId, project.gcOrganizationId));
              }
              const managers = await db.select().from(users).where(and(...mgrConditions));
              
              for (const manager of managers) {
                await insertNotification({
                  userId: manager.id,
                  organizationId: project.gcOrganizationId || orgId,
                  type: "MATERIAL_OVERAGE",
                  title: "Material Budget Alert",
                  message: `${budget.description} on project ${project.name} (${project.code}) has reached ${variancePercent.toFixed(1)}% of budgeted quantity. Consider a change order.`,
                  relatedEntityType: "PROJECT",
                  relatedEntityId: req.params.projectId,
                });
              }
            }
          } catch (notifError) {
            logError("Failed to create material alert notification:", {}, notifError instanceof Error ? notifError : new Error(String(notifError)));
          }
        }
      }
    }

    res.status(201).json(newUsage);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/projects/:projectId/material-usage/:usageId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { projectMaterialUsage, projectMaterialBudgets } = await import("@shared/schema");
    
    const [existing] = await db
      .select()
      .from(projectMaterialUsage)
      .where(eq(projectMaterialUsage.id, req.params.usageId));

    if (!existing) {
      res.status(404).json({ error: "Usage entry not found" });
      return;
    }

    if (existing.projectId !== req.params.projectId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const isCreator = existing.createdById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(req.user!.role);
    if (!isCreator && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };

    if (updateData.quantityUsed || updateData.unitCost) {
      const qty = updateData.quantityUsed || existing.quantityUsed;
      const cost = updateData.unitCost || existing.unitCost;
      updateData.totalCost = (Number(qty) * Number(cost)).toFixed(2);
    }

    const [updated] = await db
      .update(projectMaterialUsage)
      .set(updateData)
      .where(eq(projectMaterialUsage.id, req.params.usageId))
      .returning();

    const budgetId = updated.materialBudgetId || existing.materialBudgetId;
    if (budgetId) {
      const allUsage = await db
        .select()
        .from(projectMaterialUsage)
        .where(eq(projectMaterialUsage.materialBudgetId, budgetId));

      const totalQuantityUsed = allUsage.reduce((sum, u) => sum + Number(u.quantityUsed || 0), 0);
      const totalCostUsed = allUsage.reduce((sum, u) => sum + Number(u.totalCost || 0), 0);

      const [budget] = await db.select().from(projectMaterialBudgets).where(eq(projectMaterialBudgets.id, budgetId));
      if (budget) {
        const budgetedQty = Number(budget.budgetedQuantity || 0);
        const variancePercent = budgetedQty > 0 ? (totalQuantityUsed / budgetedQty) * 100 : 0;

        await db.update(projectMaterialBudgets).set({
          actualQuantityUsed: totalQuantityUsed.toString(),
          actualTotalCost: totalCostUsed.toString(),
          varianceQuantity: (totalQuantityUsed - budgetedQty).toString(),
          variancePercent: variancePercent.toFixed(2),
          alertTriggered: variancePercent >= Number(budget.alertThresholdPercent || 90),
          updatedAt: new Date(),
        }).where(eq(projectMaterialBudgets.id, budgetId));
      }
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/projects/:projectId/material-usage/:usageId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { projectMaterialUsage, projectMaterialBudgets } = await import("@shared/schema");
    
    const [existing] = await db
      .select()
      .from(projectMaterialUsage)
      .where(eq(projectMaterialUsage.id, req.params.usageId));

    if (!existing) {
      res.status(404).json({ error: "Usage entry not found" });
      return;
    }

    if (existing.projectId !== req.params.projectId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const isCreator = existing.createdById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(req.user!.role);
    if (!isCreator && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    const budgetId = existing.materialBudgetId;

    await db.delete(projectMaterialUsage).where(eq(projectMaterialUsage.id, req.params.usageId));

    if (budgetId) {
      const allUsage = await db
        .select()
        .from(projectMaterialUsage)
        .where(eq(projectMaterialUsage.materialBudgetId, budgetId));

      const totalQuantityUsed = allUsage.reduce((sum, u) => sum + Number(u.quantityUsed || 0), 0);
      const totalCostUsed = allUsage.reduce((sum, u) => sum + Number(u.totalCost || 0), 0);

      const [budget] = await db.select().from(projectMaterialBudgets).where(eq(projectMaterialBudgets.id, budgetId));
      if (budget) {
        const budgetedQty = Number(budget.budgetedQuantity || 0);
        const variancePercent = budgetedQty > 0 ? (totalQuantityUsed / budgetedQty) * 100 : 0;

        await db.update(projectMaterialBudgets).set({
          actualQuantityUsed: totalQuantityUsed.toString(),
          actualTotalCost: totalCostUsed.toString(),
          varianceQuantity: (totalQuantityUsed - budgetedQty).toString(),
          variancePercent: variancePercent.toFixed(2),
          alertTriggered: variancePercent >= Number(budget.alertThresholdPercent || 90),
          updatedAt: new Date(),
        }).where(eq(projectMaterialBudgets.id, budgetId));
      }
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
