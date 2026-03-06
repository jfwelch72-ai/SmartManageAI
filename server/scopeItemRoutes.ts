import { Router } from "express";
import { db } from "./db";
import {
  projects, users, scopeItems, estimates, estimateLineItems,
  insertScopeItemSchema, dailyScopeProgress, insertDailyScopeProgressSchema,
  projectMaterialBudgets, notifications,
} from "@shared/schema";
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { sanitizeText } from "./sanitization";

const router = Router();

const updateScopeItemSchema = insertScopeItemSchema.omit({ projectId: true }).partial();

function calculateBillingStatus(progressEntries: { billingStatus: string }[]): "NOT_READY" | "READY_TO_BILL" | "BILLED" {
  if (progressEntries.length === 0) {
    return "NOT_READY";
  }
  
  const hasNotReady = progressEntries.some(p => p.billingStatus === "NOT_READY");
  const hasReadyToBill = progressEntries.some(p => p.billingStatus === "READY_TO_BILL");
  const allBilled = progressEntries.every(p => p.billingStatus === "BILLED");
  
  if (allBilled) {
    return "BILLED";
  } else if (hasNotReady) {
    return "NOT_READY";
  } else if (hasReadyToBill) {
    return "READY_TO_BILL";
  } else {
    return "NOT_READY";
  }
}

async function syncMaterialBudgetsFromScopeItem(scopeItemId: string, completedQuantity: number) {
  try {
    const [scopeItem] = await db
      .select({ unit: scopeItems.unit })
      .from(scopeItems)
      .where(eq(scopeItems.id, scopeItemId))
      .limit(1);

    if (!scopeItem) return;

    const scopeUnit = (scopeItem.unit || "").toLowerCase().trim();

    const materialBudgets = await db
      .select()
      .from(projectMaterialBudgets)
      .where(eq(projectMaterialBudgets.scopeItemId, scopeItemId));

    for (const materialBudget of materialBudgets) {
      const materialUnit = (materialBudget.unit || "").toLowerCase().trim();
      
      if (scopeUnit !== materialUnit) {
        continue;
      }

      const budgetedQty = Number(materialBudget.budgetedQuantity || 0);
      const budgetedUnitCost = Number(materialBudget.budgetedUnitCost || 0);
      
      const actualQtyUsed = completedQuantity;
      const actualTotalCost = actualQtyUsed * budgetedUnitCost;
      
      const varianceQty = actualQtyUsed - budgetedQty;
      const variancePercent = budgetedQty > 0 ? (actualQtyUsed / budgetedQty) * 100 : 0;
      const shouldAlert = variancePercent >= Number(materialBudget.alertThresholdPercent || 90);
      const alertJustTriggered = shouldAlert && !materialBudget.alertTriggered;

      await db
        .update(projectMaterialBudgets)
        .set({
          actualQuantityUsed: actualQtyUsed.toString(),
          actualTotalCost: actualTotalCost.toFixed(2),
          varianceQuantity: varianceQty.toString(),
          variancePercent: variancePercent.toFixed(2),
          alertTriggered: shouldAlert,
          alertTriggeredAt: alertJustTriggered ? new Date() : materialBudget.alertTriggeredAt,
          updatedAt: new Date(),
        })
        .where(eq(projectMaterialBudgets.id, materialBudget.id));
    }
  } catch (error) {
    console.error("Error syncing material budgets:", error);
  }
}

router.get("/api/projects/:code/scope", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const items = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));

    const enrichedItems = await Promise.all(items.map(async (item) => {
      let sourceEstimate = null;
      
      if (item.estimateLineItemId) {
        const [lineItem] = await db
          .select({ estimateId: estimateLineItems.estimateId })
          .from(estimateLineItems)
          .where(eq(estimateLineItems.id, item.estimateLineItemId))
          .limit(1);
        
        if (lineItem?.estimateId) {
          const [estimate] = await db
            .select({ id: estimates.id, status: estimates.status, versionNumber: estimates.versionNumber })
            .from(estimates)
            .where(eq(estimates.id, lineItem.estimateId))
            .limit(1);
          
          if (estimate) {
            sourceEstimate = {
              id: estimate.id,
              status: estimate.status,
              versionNumber: estimate.versionNumber,
            };
          }
        }
      }
      
      return {
        ...item,
        sourceEstimate,
      };
    }));

    res.json(enrichedItems);
  } catch (error) {
    console.error("Get scope items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/scope", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const sanitizedBody = {
      ...req.body,
      description: sanitizeText(req.body.description),
    };

    const validationResult = insertScopeItemSchema.extend({
      projectId: z.string().optional(),
    }).safeParse({ ...sanitizedBody, projectId: project.id });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const insertData = { ...validationResult.data, projectId: project.id };
    const [newScopeItem] = await db.insert(scopeItems).values([insertData]).returning();
    res.status(201).json(newScopeItem);
  } catch (error: any) {
    console.error("Create scope item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validationResult = updateScopeItemSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [oldItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.id));

    if (!oldItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const [parentProject] = await db.select().from(projects).where(eq(projects.id, oldItem.projectId)).limit(1);
    if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedItem] = await db
      .update(scopeItems)
      .set(updateData)
      .where(eq(scopeItems.id, req.params.id))
      .returning();

    if (!updatedItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    if (updatedItem.billingStatus === "READY_TO_BILL" && oldItem.billingStatus !== "READY_TO_BILL") {
      const orgConditions: SQL[] = [eq(users.role, "ADMIN")];
      if (parentProject.gcOrganizationId) {
        orgConditions.push(eq(users.organizationId, parentProject.gcOrganizationId));
      }
      const admins = await db
        .select()
        .from(users)
        .where(and(...orgConditions));
      
      const notificationsToCreate = admins.map(admin => ({
        userId: admin.id,
        type: "BILLING_READY" as const,
        title: "Scope Item Ready to Bill",
        message: `Scope item "${updatedItem.description}" is ready for billing`,
        relatedEntityId: updatedItem.id,
        relatedEntityType: "scopeItem",
      }));

      if (notificationsToCreate.length > 0) {
        await db.insert(notifications).values(notificationsToCreate);
      }
    }

    res.json(updatedItem);
  } catch (error: any) {
    console.error("Update scope item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [scopeItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.id))
      .limit(1);

    if (!scopeItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const [parentProject] = await db.select().from(projects).where(eq(projects.id, scopeItem.projectId)).limit(1);
    if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

    const userRole = req.user!.effectiveRole || req.user!.role;
    if (userRole === "SUPERINTENDENT" && parentProject.superintendentId !== req.user!.id) {
      res.status(403).json({ error: "You can only delete scope items from projects where you are the assigned superintendent" });
      return;
    }

    const [deletedItem] = await db
      .delete(scopeItems)
      .where(eq(scopeItems.id, req.params.id))
      .returning();

    res.json({ success: true });
  } catch (error) {
    console.error("Delete scope item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/scope-items/:id/materials", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const materialsSchema = z.object({
      actualConcreteYards: z.string().nullable().optional(),
      actualStoneTons: z.string().nullable().optional(),
      actualExcavationYards: z.string().nullable().optional(),
      materialResponsibility: z.enum(["TFR", "SUBCONTRACTOR", "CUSTOMER", "PENDING"]).optional(),
      overageActionStatus: z.enum(["NONE", "PENDING", "BILLED", "DEDUCTED", "ABSORBED", "RESOLVED"]).optional(),
      overageNotes: z.string().optional(),
    });

    const validationResult = materialsSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [scopeItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.id));

    if (!scopeItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const [parentProject] = await db.select().from(projects).where(eq(projects.id, scopeItem.projectId)).limit(1);
    if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

    const data = validationResult.data;
    const actualConcrete = Number(data.actualConcreteYards) || 0;
    const actualStone = Number(data.actualStoneTons) || 0;
    const actualExcavation = Number(data.actualExcavationYards) || 0;
    
    const estConcrete = Number(scopeItem.estimatedConcreteYards) || 0;
    const estStone = Number(scopeItem.estimatedStoneTons) || 0;
    const estExcavation = Number(scopeItem.estimatedExcavationYards) || 0;

    const hasConcreteOverage = estConcrete > 0 && actualConcrete > estConcrete;
    const hasStoneOverage = estStone > 0 && actualStone > estStone;
    const hasExcavationOverage = estExcavation > 0 && actualExcavation > estExcavation;
    const hasAnyOverage = hasConcreteOverage || hasStoneOverage || hasExcavationOverage;

    let overageActionStatus = data.overageActionStatus;
    if (hasAnyOverage && scopeItem.overageActionStatus === "NONE" && !overageActionStatus) {
      overageActionStatus = "PENDING";
    }

    const updateData: any = {
      actualConcreteYards: data.actualConcreteYards,
      actualStoneTons: data.actualStoneTons,
      actualExcavationYards: data.actualExcavationYards,
      materialResponsibility: data.materialResponsibility,
      overageActionStatus: overageActionStatus,
      overageNotes: data.overageNotes,
      updatedAt: new Date(),
    };

    if (overageActionStatus && overageActionStatus !== "NONE" && overageActionStatus !== "PENDING" && 
        scopeItem.overageActionStatus !== overageActionStatus) {
      updateData.overageResolvedById = req.user!.id;
      updateData.overageResolvedAt = new Date();
    }

    const [updatedItem] = await db
      .update(scopeItems)
      .set(updateData)
      .where(eq(scopeItems.id, req.params.id))
      .returning();

    if (hasAnyOverage && scopeItem.overageActionStatus === "NONE") {
      const managerConditions: SQL[] = [sql`${users.role} IN ('ADMIN', 'MANAGER')`];
      if (parentProject.gcOrganizationId) {
        managerConditions.push(eq(users.organizationId, parentProject.gcOrganizationId));
      }
      const managers = await db
        .select()
        .from(users)
        .where(and(...managerConditions));
      
      const overageDetails: string[] = [];
      if (hasConcreteOverage) {
        overageDetails.push(`Concrete: +${(actualConcrete - estConcrete).toFixed(2)} CY`);
      }
      if (hasStoneOverage) {
        overageDetails.push(`Stone: +${(actualStone - estStone).toFixed(2)} Tons`);
      }
      if (hasExcavationOverage) {
        overageDetails.push(`Excavation: +${(actualExcavation - estExcavation).toFixed(2)} CY`);
      }

      const notificationsToCreate = managers.map(manager => ({
        userId: manager.id,
        type: "MATERIAL_OVERAGE" as const,
        title: "Material Overage Detected",
        message: `Overage on "${scopeItem.description}": ${overageDetails.join(", ")}`,
        relatedEntityId: scopeItem.id,
        relatedEntityType: "scopeItem",
      }));

      if (notificationsToCreate.length > 0) {
        await db.insert(notifications).values(notificationsToCreate);
      }
    }

    console.log(`Material update for scope item ${req.params.id} by user ${req.user!.id}:`, {
      actualMaterials: { actualConcrete, actualStone, actualExcavation },
      overages: { hasConcreteOverage, hasStoneOverage, hasExcavationOverage },
      actionStatus: overageActionStatus,
    });

    res.json(updatedItem);
  } catch (error: any) {
    console.error("Update scope item materials error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/material-overages", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.projectId;
    
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const items = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.projectId, projectId));

    const overageItems = items.filter(item => {
      const estConcrete = Number(item.estimatedConcreteYards) || 0;
      const estStone = Number(item.estimatedStoneTons) || 0;
      const estExcavation = Number(item.estimatedExcavationYards) || 0;
      const actualConcrete = Number(item.actualConcreteYards) || 0;
      const actualStone = Number(item.actualStoneTons) || 0;
      const actualExcavation = Number(item.actualExcavationYards) || 0;

      return (
        (estConcrete > 0 && actualConcrete > estConcrete) ||
        (estStone > 0 && actualStone > estStone) ||
        (estExcavation > 0 && actualExcavation > estExcavation)
      );
    }).map(item => {
      const estConcrete = Number(item.estimatedConcreteYards) || 0;
      const estStone = Number(item.estimatedStoneTons) || 0;
      const estExcavation = Number(item.estimatedExcavationYards) || 0;
      const actualConcrete = Number(item.actualConcreteYards) || 0;
      const actualStone = Number(item.actualStoneTons) || 0;
      const actualExcavation = Number(item.actualExcavationYards) || 0;

      return {
        ...item,
        concreteVariance: actualConcrete - estConcrete,
        stoneVariance: actualStone - estStone,
        excavationVariance: actualExcavation - estExcavation,
        hasConcreteOverage: estConcrete > 0 && actualConcrete > estConcrete,
        hasStoneOverage: estStone > 0 && actualStone > estStone,
        hasExcavationOverage: estExcavation > 0 && actualExcavation > estExcavation,
      };
    });

    res.json({ overages: overageItems, count: overageItems.length });
  } catch (error) {
    console.error("Get material overages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/scope-items/:scopeItemId/progress", requireAuth, async (req: AuthRequest, res) => {
  try {
    const progressEntries = await db
      .select({
        progress: dailyScopeProgress,
        creator: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(dailyScopeProgress)
      .leftJoin(users, eq(dailyScopeProgress.createdById, users.id))
      .where(eq(dailyScopeProgress.scopeItemId, req.params.scopeItemId))
      .orderBy(desc(dailyScopeProgress.workDate), desc(dailyScopeProgress.createdAt));

    res.json(progressEntries);
  } catch (error) {
    console.error("Get daily progress error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/scope-items/:scopeItemId/progress", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [scopeItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.scopeItemId))
      .limit(1);

    if (!scopeItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const validationResult = insertDailyScopeProgressSchema.safeParse({
      ...sanitizedBody,
      scopeItemId: req.params.scopeItemId,
      projectId: scopeItem.projectId,
      organizationSowItemId: scopeItem.organizationSowItemId || null,
      createdById: req.user!.id,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newProgress] = await db.insert(dailyScopeProgress).values([validationResult.data]).returning();

    const allProgress = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.scopeItemId, req.params.scopeItemId));

    const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
    const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
    const billingStatus = calculateBillingStatus(allProgress);

    await db
      .update(scopeItems)
      .set({
        completedQuantity: totalCompleted.toString(),
        billedQuantity: totalBilled.toString(),
        billingStatus,
        updatedAt: new Date(),
      })
      .where(eq(scopeItems.id, req.params.scopeItemId));

    await syncMaterialBudgetsFromScopeItem(req.params.scopeItemId, totalCompleted);

    try {
      const totalQty = parseFloat(scopeItem.totalQuantity) || 0;
      const previousCompleted = parseFloat(scopeItem.completedQuantity) || 0;
      const previousPercent = totalQty > 0 ? (previousCompleted / totalQty) * 100 : 0;
      const currentPercent = totalQty > 0 ? (totalCompleted / totalQty) * 100 : 0;

      const [project] = await db
        .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, scopeItem.projectId))
        .limit(1);

      if (project?.gcOrganizationId) {
        const officeManagers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, project.gcOrganizationId),
              eq(users.role, "OFFICE_MANAGER"),
              eq(users.isActive, true)
            )
          );

        if (officeManagers.length > 0) {
          const milestones = [25, 50, 75, 100];
          const crossedMilestones = milestones.filter(
            (m) => previousPercent < m && currentPercent >= m
          );

          if (crossedMilestones.length > 0) {
            const milestoneNotifs = crossedMilestones.flatMap((milestone) =>
              officeManagers.map((mgr) => ({
                userId: mgr.id,
                type: "PROGRESS_MILESTONE" as const,
                title: `${milestone}% Milestone Reached`,
                message: `"${scopeItem.description}" has reached ${milestone}% completion on project ${project.code || "Unknown"}`,
                relatedEntityId: project.id,
                relatedEntityType: "project" as const,
              }))
            );
            await db.insert(notifications).values(milestoneNotifs);
          }

          const dailyNotifs = officeManagers.map((mgr) => ({
            userId: mgr.id,
            type: "DAILY_PROGRESS_LOGGED" as const,
            title: "Daily Progress Logged",
            message: `${newProgress.quantityCompleted} ${scopeItem.unit} logged for "${scopeItem.description}" on project ${project.code || "Unknown"}`,
            relatedEntityId: project.id,
            relatedEntityType: "project" as const,
          }));
          await db.insert(notifications).values(dailyNotifs);
        }
      }
    } catch (notifError) {
      console.error("Failed to create billing progress notifications:", notifError);
    }

    res.status(201).json(newProgress);
  } catch (error: any) {
    console.error("Create daily progress error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/scope-items/:scopeItemId/progress/:progressId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existingProgress] = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.id, req.params.progressId))
      .limit(1);

    if (!existingProgress) {
      res.status(404).json({ error: "Progress entry not found" });
      return;
    }

    const isCreator = existingProgress.createdById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
    
    if (!isCreator && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    if (sanitizedBody.billingStatus) {
      const validStatuses = ["NOT_READY", "READY_TO_BILL", "BILLED"];
      if (!validStatuses.includes(sanitizedBody.billingStatus)) {
        res.status(400).json({ error: "Invalid billing status. Must be one of: NOT_READY, READY_TO_BILL, BILLED" });
        return;
      }
    }

    const updateSchema = insertDailyScopeProgressSchema.omit({
      scopeItemId: true,
      projectId: true,
      createdById: true,
    }).partial();

    const validationResult = updateSchema.safeParse(sanitizedBody);

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const updateData: any = {
      ...validationResult.data,
      updatedAt: new Date(),
    };

    if (validationResult.data.billingStatus === "BILLED" && existingProgress.billingStatus !== "BILLED") {
      updateData.billedDate = new Date();
      updateData.billedById = req.user!.id;
    }

    const [updatedProgress] = await db
      .update(dailyScopeProgress)
      .set(updateData)
      .where(eq(dailyScopeProgress.id, req.params.progressId))
      .returning();

    if (validationResult.data.billingStatus === "READY_TO_BILL" && existingProgress.billingStatus !== "READY_TO_BILL") {
      try {
        const [scopeItem] = await db
          .select()
          .from(scopeItems)
          .where(eq(scopeItems.id, existingProgress.scopeItemId))
          .limit(1);

        if (scopeItem) {
          const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, existingProgress.projectId))
            .limit(1);

          const officeManagers = await db
            .select()
            .from(users)
            .where(eq(users.role, "OFFICE_MANAGER"));

          if (officeManagers.length > 0) {
            const notificationValues = officeManagers.map(manager => ({
              userId: manager.id,
              type: "BILLING_READY" as const,
              title: "Quantities Ready to Bill",
              message: `${scopeItem.description} (${updatedProgress.billedQuantity} ${scopeItem.unit}) is ready to bill on project ${project?.code || 'Unknown'}`,
              relatedEntityId: updatedProgress.id,
              relatedEntityType: "daily_scope_progress" as const,
            }));
            
            await db.insert(notifications).values(notificationValues);
          }
        }
      } catch (notificationError) {
        console.error("Failed to create notifications:", notificationError);
      }
    }

    const allProgress = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.scopeItemId, existingProgress.scopeItemId));

    const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
    const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
    const billingStatus = calculateBillingStatus(allProgress);

    await db
      .update(scopeItems)
      .set({
        completedQuantity: totalCompleted.toString(),
        billedQuantity: totalBilled.toString(),
        billingStatus,
        updatedAt: new Date(),
      })
      .where(eq(scopeItems.id, existingProgress.scopeItemId));

    await syncMaterialBudgetsFromScopeItem(existingProgress.scopeItemId, totalCompleted);

    res.json(updatedProgress);
  } catch (error: any) {
    console.error("Update daily progress error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/scope-items/:scopeItemId/progress/:progressId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existingProgress] = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.id, req.params.progressId))
      .limit(1);

    if (!existingProgress) {
      res.status(404).json({ error: "Progress entry not found" });
      return;
    }

    const isCreator = existingProgress.createdById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
    
    if (!isCreator && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    await db.delete(dailyScopeProgress).where(eq(dailyScopeProgress.id, req.params.progressId));

    const allProgress = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.scopeItemId, existingProgress.scopeItemId));

    const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
    const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
    const billingStatus = calculateBillingStatus(allProgress);

    await db
      .update(scopeItems)
      .set({
        completedQuantity: totalCompleted.toString(),
        billedQuantity: totalBilled.toString(),
        billingStatus,
        updatedAt: new Date(),
      })
      .where(eq(scopeItems.id, existingProgress.scopeItemId));

    await syncMaterialBudgetsFromScopeItem(existingProgress.scopeItemId, totalCompleted);

    res.json({ success: true });
  } catch (error) {
    console.error("Delete daily progress error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
