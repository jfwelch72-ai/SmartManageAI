import { Router } from "express";
import { db } from "./db";
import {
  projects, users, scopeItems, changeOrders,
  projectLaborRates, projectEmployeeRates,
  insertProjectSchema, insertScopeItemSchema,
  insertProjectLaborRateSchema, insertProjectEmployeeRateSchema,
  timeClockShifts, procurementItems, receipts,
  subcontractorContracts, subcontractorPayments,
  tmDailySheets, tmTickets,
  aiNoteInsights, aiTasks, projectPlans, takeoffMeasurements,
  takeoffSheets, quantityCategories, tasks,
  handoffPackets,
  estimates, estimateLineItems, timeEntries,
  calendarEvents, media, planDocuments, projectNotes,
  dailyScopeProgress, insertDailyScopeProgressSchema,
  projectMaterialBudgets,
  notifications,
} from "@shared/schema";
import { eq, and, sql, desc, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { logUpdate, logDelete, logAudit } from "./auditLogger";

const router = Router();

function validateMonetaryAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
  if (amount === null || amount === undefined) {
    return { valid: true };
  }
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  
  if (numAmount <= 0) {
    return { valid: false, error: `${fieldName} must be a positive value (greater than zero)` };
  }
  
  if (numAmount > 100000000) {
    return { valid: false, error: `${fieldName} exceeds maximum allowed value ($100,000,000)` };
  }
  
  return { valid: true };
}

type ProjectStatus = "BID" | "PLANNING" | "ACTIVE" | "COMPLETE" | "CLOSED";
function validateProjectStatusTransition(currentStatus: ProjectStatus, newStatus: ProjectStatus): { valid: boolean; error?: string } {
  const validTransitions: Record<ProjectStatus, ProjectStatus[]> = {
    "BID": ["PLANNING"],
    "PLANNING": ["ACTIVE", "BID"],
    "ACTIVE": ["COMPLETE", "PLANNING"],
    "COMPLETE": ["CLOSED", "ACTIVE"],
    "CLOSED": [],
  };

  if (currentStatus === newStatus) {
    return { valid: true };
  }

  const allowedTransitions = validTransitions[currentStatus];
  if (!allowedTransitions.includes(newStatus)) {
    return { 
      valid: false, 
      error: `Invalid status transition from ${currentStatus} to ${newStatus}. Allowed transitions: ${allowedTransitions.join(", ") || "none (terminal state)"}` 
    };
  }

  return { valid: true };
}

const BID_CODE_START = 260001;
async function getNextBidCode(): Promise<string> {
  const result = await db.execute(sql`
    SELECT GREATEST(
      COALESCE((
        SELECT MAX(CAST(code AS INTEGER))
        FROM bids 
        WHERE code ~ '^[0-9]+$' 
        AND CAST(code AS INTEGER) >= ${BID_CODE_START}
      ), ${BID_CODE_START - 1}),
      COALESCE((
        SELECT MAX(CAST(code AS INTEGER))
        FROM projects 
        WHERE code ~ '^[0-9]+$' 
        AND CAST(code AS INTEGER) >= ${BID_CODE_START}
      ), ${BID_CODE_START - 1})
    ) as max_code
  `);
  
  const maxCode = Number(result.rows[0]?.max_code) || BID_CODE_START - 1;
  return String(maxCode + 1);
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

const createProjectSchema = insertProjectSchema.omit({ code: true });
const updateProjectSchema = insertProjectSchema.partial();
const updateScopeItemSchema = insertScopeItemSchema.omit({ projectId: true }).partial();

// ====================
// Project Routes
// ====================

router.get("/api/projects", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { page = "1", limit = "50", status } = req.query;
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json({
        data: [],
        pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 0 }
      });
    }
    
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
    
    if (limitNum > 1000) {
      limitNum = 1000;
    }

    const offset = (pageNum - 1) * limitNum;

    const validStatuses = ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"];
    if (status && !validStatuses.includes(status as string)) {
      res.status(400).json({ error: "Invalid status parameter. Must be one of: BID, PLANNING, ACTIVE, COMPLETE, CLOSED" });
      return;
    }

    const conditions: SQL[] = [];
    
    const userRole = req.user!.effectiveRole || req.user!.role;
    if (userRole === "HOURLY_EMPLOYEE") {
      if (status && status !== "ACTIVE") {
        return res.json({
          data: [],
          pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 0 }
        });
      }
      conditions.push(eq(projects.status, "ACTIVE" as any));
    } else if (status) {
      conditions.push(eq(projects.status, status as any));
    }
    
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    
    const whereCondition = conditions.length > 0 
      ? (conditions.length === 1 ? conditions[0] : and(...conditions))
      : undefined;

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(whereCondition);
    const totalCount = totalResult[0]?.count || 0;

    let query = db.select().from(projects);
    if (whereCondition) {
      query = query.where(whereCondition) as any;
    }
    const allProjects = await query
      .orderBy(desc(projects.createdAt))
      .limit(limitNum)
      .offset(offset);
    
    const userIds = new Set<string>();
    allProjects.forEach(p => {
      if (p.estimatorId) userIds.add(p.estimatorId);
      if (p.superintendentId) userIds.add(p.superintendentId);
    });
    
    let userMap = new Map<string, string>();
    if (userIds.size > 0) {
      const relevantUsers = await db.select().from(users).where(inArray(users.id, Array.from(userIds)));
      userMap = new Map(relevantUsers.map(u => [u.id, `${u.firstName} ${u.lastName}`]));
    }
    
    const projectsWithNames = allProjects.map(project => ({
      ...project,
      estimator: project.estimatorId ? userMap.get(project.estimatorId) || undefined : undefined,
      superintendent: project.superintendentId ? userMap.get(project.superintendentId) || undefined : undefined,
    }));
      
    res.json({
      data: projectsWithNames,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
    console.error("Get projects error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/with-pending-change-orders", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [eq(changeOrders.status, "SUBMITTED")];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }

    const result = await db
      .selectDistinct({ projectId: changeOrders.projectId })
      .from(changeOrders)
      .innerJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(and(...conditions));
    
    const projectIds = result.map(r => r.projectId);
    res.json(projectIds);
  } catch (error) {
    console.error("Get projects with pending COs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const projectScopeItems = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));

    res.json({ ...project, scopeItems: projectScopeItems });
  } catch (error) {
    console.error("Get project error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Project Labor Rates Routes
// ====================

router.get("/api/projects/:code/labor-rates", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [laborRates] = await db
      .select()
      .from(projectLaborRates)
      .where(eq(projectLaborRates.projectId, project.id))
      .limit(1);

    res.json(laborRates || null);
  } catch (error) {
    console.error("Get project labor rates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/labor-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const laborRateSchema = z.object({
      defaultRegularRate: z.string().or(z.number()).transform(v => String(v)),
      defaultOvertimeRate: z.string().or(z.number()).transform(v => String(v)),
      burdenMultiplier: z.string().or(z.number()).transform(v => String(v)),
      notes: z.string().optional(),
    });

    const validationResult = laborRateSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [existing] = await db
      .select()
      .from(projectLaborRates)
      .where(eq(projectLaborRates.projectId, project.id))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(projectLaborRates)
        .set({
          ...validationResult.data,
          updatedAt: new Date(),
        })
        .where(eq(projectLaborRates.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(projectLaborRates)
        .values({
          projectId: project.id,
          ...validationResult.data,
        })
        .returning();
    }

    await logAudit({
      userId: req.user!.id,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "projectLaborRates",
      entityId: result.id,
      newValue: JSON.stringify({ projectCode: req.params.code, ...validationResult.data }),
    }, req);

    res.json(result);
  } catch (error) {
    console.error("Create/update project labor rates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/employee-rates", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const employeeRates = await db
      .select({
        id: projectEmployeeRates.id,
        projectId: projectEmployeeRates.projectId,
        userId: projectEmployeeRates.userId,
        regularRate: projectEmployeeRates.regularRate,
        overtimeRate: projectEmployeeRates.overtimeRate,
        notes: projectEmployeeRates.notes,
        createdAt: projectEmployeeRates.createdAt,
        updatedAt: projectEmployeeRates.updatedAt,
        employee: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
        },
      })
      .from(projectEmployeeRates)
      .innerJoin(users, eq(projectEmployeeRates.userId, users.id))
      .where(eq(projectEmployeeRates.projectId, project.id));

    res.json(employeeRates);
  } catch (error) {
    console.error("Get employee rate overrides error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/employee-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const employeeRateSchema = z.object({
      userId: z.string().min(1, "Employee ID is required"),
      regularRate: z.string().or(z.number()).transform(v => String(v)),
      overtimeRate: z.string().or(z.number()).transform(v => String(v)),
      notes: z.string().optional(),
    });

    const validationResult = employeeRateSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [employee] = await db.select().from(users).where(eq(users.id, validationResult.data.userId)).limit(1);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(projectEmployeeRates)
      .where(and(
        eq(projectEmployeeRates.projectId, project.id),
        eq(projectEmployeeRates.userId, validationResult.data.userId)
      ))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(projectEmployeeRates)
        .set({
          regularRate: validationResult.data.regularRate,
          overtimeRate: validationResult.data.overtimeRate,
          notes: validationResult.data.notes,
          updatedAt: new Date(),
        })
        .where(eq(projectEmployeeRates.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(projectEmployeeRates)
        .values({
          projectId: project.id,
          userId: validationResult.data.userId,
          regularRate: validationResult.data.regularRate,
          overtimeRate: validationResult.data.overtimeRate,
          notes: validationResult.data.notes,
        })
        .returning();
    }

    await logAudit({
      userId: req.user!.id,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "projectEmployeeRates",
      entityId: result.id,
      newValue: JSON.stringify({ projectCode: req.params.code, employeeId: validationResult.data.userId }),
    }, req);

    res.json(result);
  } catch (error) {
    console.error("Create/update employee rate override error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/projects/:code/employee-rates/:rateId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [rateOverride] = await db
      .select()
      .from(projectEmployeeRates)
      .where(and(
        eq(projectEmployeeRates.id, req.params.rateId),
        eq(projectEmployeeRates.projectId, project.id)
      ))
      .limit(1);

    if (!rateOverride) {
      res.status(404).json({ error: "Rate override not found" });
      return;
    }

    await db.delete(projectEmployeeRates).where(eq(projectEmployeeRates.id, req.params.rateId));

    await logAudit({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "projectEmployeeRates",
      entityId: req.params.rateId,
      oldValue: JSON.stringify({ projectCode: req.params.code }),
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Delete employee rate override error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/financials", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { timeClockShifts, procurementItems, receipts, subcontractorContracts, subcontractorPayments, timeEntries } = await import("@shared/schema");
    const { sum, gte, lte, desc } = await import("drizzle-orm");
    
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const projectChangeOrders = await db
      .select({
        amount: changeOrders.amount,
        status: changeOrders.status,
      })
      .from(changeOrders)
      .where(eq(changeOrders.projectId, project.id));

    const approvedCOs = projectChangeOrders.filter(co => co.status === 'APPROVED');
    const approvedCOValue = approvedCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);

    const { tmDailySheets, tmTickets } = await import("@shared/schema");
    const projectTMSheets = await db
      .select()
      .from(tmDailySheets)
      .where(eq(tmDailySheets.projectId, project.id));

    const projectTMTickets = await db
      .select()
      .from(tmTickets)
      .where(eq(tmTickets.projectId, project.id));

    const approvedTMTickets = projectTMTickets.filter(t => t.status === "APPROVED");
    const pendingTMTickets = projectTMTickets.filter(t => t.status === "SUBMITTED");
    const draftTMTickets = projectTMTickets.filter(t => t.status === "DRAFT");
    
    const tmTicketApprovedTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
    const tmTicketPendingTotal = pendingTMTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
    const tmTicketLaborTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.totalLaborCost || 0), 0);
    const tmTicketEquipmentTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.totalEquipmentCost || 0), 0);
    const tmTicketMaterialTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.totalMaterialCost || 0), 0);

    let tmLaborTotal = 0;
    let tmEquipmentTotal = 0;
    let tmMaterialsTotal = 0;
    
    for (const sheet of projectTMSheets) {
      if (sheet.laborSummaryJson) {
        try {
          const laborData = JSON.parse(sheet.laborSummaryJson);
          if (Array.isArray(laborData)) {
            laborData.forEach((item: any) => {
              tmLaborTotal += Number(item.total || item.amount || 0);
            });
          } else if (laborData.total) {
            tmLaborTotal += Number(laborData.total);
          }
        } catch (e) { /* ignore invalid JSON */ }
      }
      if (sheet.equipmentUsedJson) {
        try {
          const equipData = JSON.parse(sheet.equipmentUsedJson);
          if (Array.isArray(equipData)) {
            equipData.forEach((item: any) => {
              tmEquipmentTotal += Number(item.total || item.amount || item.cost || 0);
            });
          } else if (equipData.total) {
            tmEquipmentTotal += Number(equipData.total);
          }
        } catch (e) { /* ignore invalid JSON */ }
      }
      if (sheet.materialsUsedJson) {
        try {
          const matData = JSON.parse(sheet.materialsUsedJson);
          if (Array.isArray(matData)) {
            matData.forEach((item: any) => {
              tmMaterialsTotal += Number(item.total || item.amount || item.cost || 0);
            });
          } else if (matData.total) {
            tmMaterialsTotal += Number(matData.total);
          }
        } catch (e) { /* ignore invalid JSON */ }
      }
    }
    
    const tmChargesTotal = tmLaborTotal + tmEquipmentTotal + tmMaterialsTotal;

    const [projectRates] = await db
      .select()
      .from(projectLaborRates)
      .where(eq(projectLaborRates.projectId, project.id))
      .limit(1);

    const employeeRateOverrides = await db
      .select()
      .from(projectEmployeeRates)
      .where(eq(projectEmployeeRates.projectId, project.id));

    const employeeRatesMap: Record<string, { regular: number; overtime: number }> = {};
    employeeRateOverrides.forEach(r => {
      employeeRatesMap[r.userId] = {
        regular: Number(r.regularRate),
        overtime: Number(r.overtimeRate),
      };
    });

    const laborShifts = await db
      .select({
        totalHours: timeClockShifts.totalHours,
        userId: timeClockShifts.userId,
        approvalStatus: timeClockShifts.approvalStatus,
      })
      .from(timeClockShifts)
      .where(eq(timeClockShifts.projectId, project.id));

    const userIds = Array.from(new Set(laborShifts.map(s => s.userId)));
    const userDefaultRates: Record<string, { regular: number; overtime: number }> = {};
    
    if (userIds.length > 0) {
      const usersData = await db
        .select({
          id: users.id,
          costRateRegular: users.costRateRegular,
          costRateOvertime: users.costRateOvertime,
        })
        .from(users)
        .where(inArray(users.id, userIds));
      
      usersData.forEach(u => {
        userDefaultRates[u.id] = {
          regular: Number(u.costRateRegular || 50),
          overtime: Number(u.costRateOvertime || 75),
        };
      });
    }

    const getEffectiveRate = (userId: string): { regular: number; overtime: number } => {
      if (employeeRatesMap[userId]) {
        return employeeRatesMap[userId];
      }
      if (projectRates) {
        return {
          regular: Number(projectRates.defaultRegularRate),
          overtime: Number(projectRates.defaultOvertimeRate),
        };
      }
      if (userDefaultRates[userId]) {
        return userDefaultRates[userId];
      }
      return { regular: 50, overtime: 75 };
    };

    const burdenMultiplier = projectRates ? Number(projectRates.burdenMultiplier) : 1.0;

    const approvedShifts = laborShifts.filter(s => s.approvalStatus === 'APPROVED');
    const totalLaborHours = approvedShifts.reduce((sum, s) => sum + Number(s.totalHours || 0), 0);
    const baseLaborCost = approvedShifts.reduce((sum, s) => {
      const rate = getEffectiveRate(s.userId);
      return sum + (Number(s.totalHours || 0) * rate.regular);
    }, 0);
    const totalLaborCost = baseLaborCost * burdenMultiplier;

    const materials = await db
      .select({
        unitCost: procurementItems.unitCost,
        quantity: procurementItems.quantity,
        status: procurementItems.status,
      })
      .from(procurementItems)
      .where(eq(procurementItems.projectId, project.id));

    const totalMaterialCost = materials.reduce((sum, item) => {
      const cost = Number(item.unitCost || 0) * Number(item.quantity || 0);
      return sum + cost;
    }, 0);

    const subPayments = await db
      .select({
        amount: subcontractorPayments.amount,
      })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .where(eq(subcontractorContracts.projectId, project.id));

    const totalSubcontractorCost = subPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const expenseReceipts = await db
      .select({
        amount: receipts.amount,
      })
      .from(receipts)
      .where(eq(receipts.projectId, project.id));

    const totalOtherExpenses = expenseReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

    const budget = Number(project.budget || 0);
    const originalContract = Number(project.contractAmount || 0);
    const contractAdditions = approvedCOValue + tmChargesTotal + tmTicketApprovedTotal;
    const adjustedContract = originalContract + contractAdditions;
    
    const totalActualCost = totalLaborCost + totalMaterialCost + totalSubcontractorCost + totalOtherExpenses;
    
    const projectedProfit = originalContract - budget;
    const actualProfit = adjustedContract - totalActualCost;

    res.json({
      budget,
      originalContract,
      adjustedContract,
      contractAdditions,
      approvedChangeOrdersTotal: approvedCOValue,
      approvedChangeOrdersCount: approvedCOs.length,
      tmCharges: {
        labor: tmLaborTotal,
        equipment: tmEquipmentTotal,
        materials: tmMaterialsTotal,
        total: tmChargesTotal,
        sheetsCount: projectTMSheets.length,
      },
      tmTickets: {
        total: projectTMTickets.length,
        approved: approvedTMTickets.length,
        pending: pendingTMTickets.length,
        draft: draftTMTickets.length,
        approvedTotal: tmTicketApprovedTotal,
        pendingTotal: tmTicketPendingTotal,
        labor: tmTicketLaborTotal,
        equipment: tmTicketEquipmentTotal,
        materials: tmTicketMaterialTotal,
      },
      projectedProfit,
      actualProfit,
      actualCosts: {
        labor: totalLaborCost,
        laborHours: totalLaborHours,
        laborBaseCost: baseLaborCost,
        materials: totalMaterialCost,
        subcontractors: totalSubcontractorCost,
        otherExpenses: totalOtherExpenses,
        total: totalActualCost,
      },
      laborRates: {
        configured: !!projectRates,
        defaultRegularRate: projectRates ? Number(projectRates.defaultRegularRate) : null,
        defaultOvertimeRate: projectRates ? Number(projectRates.defaultOvertimeRate) : null,
        burdenMultiplier: burdenMultiplier,
        employeeOverrideCount: employeeRateOverrides.length,
      },
      profitVariance: actualProfit - projectedProfit,
      profitVariancePercent: projectedProfit !== 0 ? ((actualProfit - projectedProfit) / projectedProfit) * 100 : 0,
    });
  } catch (error) {
    console.error("Get project financials error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      name: sanitizeShortText(req.body.name),
      description: sanitizeText(req.body.description),
      clientName: sanitizeShortText(req.body.clientName),
      location: sanitizeText(req.body.location),
    };

    const validationResult = createProjectSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const MAX_RETRIES = 3;
    let lastError: any = null;
    
    const userOrgId = req.user?.organizationId;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const nextCode = await getNextBidCode();
        console.log(`[Create Project] Auto-assigned code: ${nextCode} (attempt ${attempt + 1})`);

        const [newProject] = await db.insert(projects).values({
          ...validationResult.data,
          code: nextCode,
          gcOrganizationId: validationResult.data.gcOrganizationId || userOrgId,
        }).returning();
        res.status(201).json(newProject);
        return;
      } catch (insertError: any) {
        if (insertError.code === '23505' && attempt < MAX_RETRIES - 1) {
          console.log(`[Create Project] Code conflict, retrying... (attempt ${attempt + 1})`);
          lastError = insertError;
          continue;
        }
        throw insertError;
      }
    }
    
    throw lastError;
  } catch (error: any) {
    console.error("Create project error:", error);
    if (error.code === '23505') {
      res.status(409).json({ error: "Unable to generate unique project code - please try again" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.patch("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [existingProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, req.params.code))
      .limit(1);

    if (!existingProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, existingProject.gcOrganizationId)) return;

    const userRole = req.user!.effectiveRole || req.user!.role;
    if (userRole === "ESTIMATOR" && existingProject.estimatorId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit projects where you are the assigned estimator" });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
      clientName: req.body.clientName ? sanitizeShortText(req.body.clientName) : undefined,
      location: req.body.location ? sanitizeText(req.body.location) : undefined,
    };

    const validationResult = updateProjectSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    if (validationResult.data.status !== undefined) {
      const currentProject = existingProject;

      const transitionCheck = validateProjectStatusTransition(
        currentProject.status as ProjectStatus,
        validationResult.data.status as ProjectStatus
      );

      if (!transitionCheck.valid) {
        res.status(400).json({ error: transitionCheck.error });
        return;
      }
    }

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedProject] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.code, req.params.code))
      .returning();

    if (!updatedProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json(updatedProject);
  } catch (error: any) {
    console.error("Update project error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    await db.delete(aiNoteInsights).where(eq(aiNoteInsights.projectId, project.id));
    await db.delete(aiTasks).where(eq(aiTasks.projectId, project.id));
    
    await db.delete(timeClockShifts).where(eq(timeClockShifts.projectId, project.id));
    await db.delete(projectEmployeeRates).where(eq(projectEmployeeRates.projectId, project.id));
    await db.delete(projectLaborRates).where(eq(projectLaborRates.projectId, project.id));
    
    await db.delete(dailyScopeProgress).where(eq(dailyScopeProgress.projectId, project.id));
    await db.delete(scopeItems).where(eq(scopeItems.projectId, project.id));
    
    await db.delete(changeOrders).where(eq(changeOrders.projectId, project.id));
    await db.delete(receipts).where(eq(receipts.projectId, project.id));
    await db.delete(procurementItems).where(eq(procurementItems.projectId, project.id));
    
    const plansToDelete = await db.select().from(projectPlans).where(eq(projectPlans.projectId, project.id));
    for (const plan of plansToDelete) {
      await db.delete(takeoffMeasurements).where(eq(takeoffMeasurements.sheetId, plan.id));
    }
    await db.delete(projectPlans).where(eq(projectPlans.projectId, project.id));
    await db.delete(takeoffSheets).where(eq(takeoffSheets.projectId, project.id));
    await db.delete(quantityCategories).where(eq(quantityCategories.projectId, project.id));
    await db.delete(planDocuments).where(eq(planDocuments.projectId, project.id));
    
    await db.delete(projectNotes).where(eq(projectNotes.projectId, project.id));
    
    await db.delete(calendarEvents).where(eq(calendarEvents.projectId, project.id));
    
    await db.delete(media).where(eq(media.projectId, project.id));
    
    await db.delete(tasks).where(eq(tasks.projectId, project.id));
    
    await db.delete(handoffPackets).where(eq(handoffPackets.projectId, project.id));
    
    const projectEstimates = await db.select().from(estimates).where(eq(estimates.projectId, project.id));
    for (const estimate of projectEstimates) {
      await db.delete(estimateLineItems).where(eq(estimateLineItems.estimateId, estimate.id));
    }
    await db.delete(estimates).where(eq(estimates.projectId, project.id));
    
    await db.delete(tmDailySheets).where(eq(tmDailySheets.projectId, project.id));
    
    await db.delete(timeEntries).where(eq(timeEntries.projectId, project.id));

    const [deletedProject] = await db
      .delete(projects)
      .where(eq(projects.code, req.params.code))
      .returning();

    await logDelete(req.user!.id, "projects", project.id, { code: project.code, name: project.name }, req);

    res.json({ success: true, message: `Project ${project.code} deleted successfully` });
  } catch (error) {
    console.error("Delete project error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/projects/:code/financials", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const { budget, contractAmount, texturaDrawDate, drawDayOfMonth } = req.body;

    if (budget !== undefined) {
      const budgetCheck = validateMonetaryAmount(budget, "Budget");
      if (!budgetCheck.valid) {
        res.status(400).json({ error: budgetCheck.error });
        return;
      }
    }

    if (contractAmount !== undefined) {
      const contractCheck = validateMonetaryAmount(contractAmount, "Contract amount");
      if (!contractCheck.valid) {
        res.status(400).json({ error: contractCheck.error });
        return;
      }
    }

    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const updateData: any = { updatedAt: new Date() };
    if (budget !== undefined) updateData.budget = budget;
    if (contractAmount !== undefined) updateData.contractAmount = contractAmount;
    if (texturaDrawDate !== undefined) updateData.texturaDrawDate = texturaDrawDate;
    if (drawDayOfMonth !== undefined) updateData.drawDayOfMonth = drawDayOfMonth;

    await logUpdate(
      req.user!.id,
      "PROJECT",
      project.id,
      JSON.stringify({
        budget: project.budget,
        contractAmount: project.contractAmount,
        texturaDrawDate: project.texturaDrawDate,
        drawDayOfMonth: project.drawDayOfMonth,
      }),
      JSON.stringify({
        budget,
        contractAmount,
        texturaDrawDate,
        drawDayOfMonth,
      }),
      req
    );

    const [updated] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.code, req.params.code))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update project financials error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Scope of Work Routes
// ====================

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

// =============================
// Daily Scope Progress Routes
// =============================

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

// =============================
// Project Material Budget & Usage Routes
// =============================

router.get("/api/projects/:projectId/material-budgets", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Get material budgets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/material-budgets/summary", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Get material budget summary error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/material-usage", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Get material usage error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:projectId/material-usage", requireAuth, async (req: AuthRequest, res) => {
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
              const mgrConditions: SQL[] = [sql`${users.role} IN ('ADMIN', 'MANAGER', 'OFFICE_MANAGER')`];
              if (project.gcOrganizationId) {
                mgrConditions.push(eq(users.organizationId, project.gcOrganizationId));
              }
              const managers = await db.select().from(users).where(and(...mgrConditions));
              
              for (const manager of managers) {
                await db.insert(notifications).values({
                  userId: manager.id,
                  type: "MATERIAL_OVERAGE",
                  title: "Material Budget Alert",
                  message: `${budget.description} on project ${project.name} (${project.code}) has reached ${variancePercent.toFixed(1)}% of budgeted quantity. Consider a change order.`,
                  relatedEntityType: "PROJECT",
                  relatedEntityId: req.params.projectId,
                });
              }
            }
          } catch (notifError) {
            console.error("Failed to create material alert notification:", notifError);
          }
        }
      }
    }

    res.status(201).json(newUsage);
  } catch (error) {
    console.error("Create material usage error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/projects/:projectId/material-usage/:usageId", requireAuth, async (req: AuthRequest, res) => {
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
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
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
    console.error("Update material usage error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/projects/:projectId/material-usage/:usageId", requireAuth, async (req: AuthRequest, res) => {
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
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
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
    console.error("Delete material usage error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =============================
// Production Rate Tracking Routes
// =============================

router.get("/api/production-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, projectCode, unit } = req.query;
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.json({ rates: [], summary: { totalSOWTypes: 0, totalWorkDays: 0, totalProjects: 0, totalEntries: 0 }, availableUnits: [] });
    }
    
    let query = db
      .select({
        description: scopeItems.description,
        unit: scopeItems.unit,
        projectId: dailyScopeProgress.projectId,
        projectCode: projects.code,
        projectName: projects.name,
        workDate: dailyScopeProgress.workDate,
        quantityCompleted: dailyScopeProgress.quantityCompleted,
      })
      .from(dailyScopeProgress)
      .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
      .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id));
    
    const conditions: any[] = [];
    
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    
    if (startDate) {
      conditions.push(sql`${dailyScopeProgress.workDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${dailyScopeProgress.workDate} <= ${endDate}`);
    }
    if (projectCode) {
      conditions.push(eq(projects.code, projectCode as string));
    }
    if (unit) {
      conditions.push(eq(scopeItems.unit, unit as string));
    }
    
    let results;
    if (conditions.length > 0) {
      results = await query.where(and(...conditions));
    } else {
      results = await query;
    }
    
    const ratesBySOW = new Map<string, {
      description: string;
      unit: string;
      totalQuantity: number;
      projectCodes: Set<string>;
      dailyTotals: Map<string, number>;
      entryCount: number;
    }>();
    
    for (const entry of results) {
      const key = `${entry.description}|||${entry.unit}`;
      const qty = parseFloat(entry.quantityCompleted);
      const dateKey = entry.workDate;
      
      if (!ratesBySOW.has(key)) {
        ratesBySOW.set(key, {
          description: entry.description,
          unit: entry.unit,
          totalQuantity: 0,
          projectCodes: new Set(),
          dailyTotals: new Map(),
          entryCount: 0,
        });
      }
      
      const sow = ratesBySOW.get(key)!;
      sow.totalQuantity += qty;
      sow.projectCodes.add(entry.projectCode);
      sow.entryCount += 1;
      
      const currentDayTotal = sow.dailyTotals.get(dateKey) || 0;
      sow.dailyTotals.set(dateKey, currentDayTotal + qty);
    }
    
    const productionRates = Array.from(ratesBySOW.values()).map(sow => {
      const dailyTotalsArray = Array.from(sow.dailyTotals.values());
      const sortedDailyTotals = [...dailyTotalsArray].sort((a, b) => a - b);
      const totalDays = sow.dailyTotals.size;
      const avgPerDay = totalDays > 0 ? sow.totalQuantity / totalDays : 0;
      const minPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[0] : 0;
      const maxPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[sortedDailyTotals.length - 1] : 0;
      
      let medianPerDay = 0;
      if (sortedDailyTotals.length > 0) {
        const mid = Math.floor(sortedDailyTotals.length / 2);
        medianPerDay = sortedDailyTotals.length % 2 !== 0 
          ? sortedDailyTotals[mid] 
          : (sortedDailyTotals[mid - 1] + sortedDailyTotals[mid]) / 2;
      }
      
      let stdDev = 0;
      if (sortedDailyTotals.length > 1) {
        const variance = sortedDailyTotals.reduce((sum, dayTotal) => sum + Math.pow(dayTotal - avgPerDay, 2), 0) / sortedDailyTotals.length;
        stdDev = Math.sqrt(variance);
      }
      
      return {
        description: sow.description,
        unit: sow.unit,
        totalQuantity: Math.round(sow.totalQuantity * 100) / 100,
        totalDays,
        totalProjects: sow.projectCodes.size,
        avgPerDay: Math.round(avgPerDay * 100) / 100,
        minPerDay: Math.round(minPerDay * 100) / 100,
        maxPerDay: Math.round(maxPerDay * 100) / 100,
        medianPerDay: Math.round(medianPerDay * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        entryCount: sow.entryCount,
      };
    });
    
    productionRates.sort((a, b) => b.totalQuantity - a.totalQuantity);
    
    const summary = {
      totalSOWTypes: productionRates.length,
      totalWorkDays: new Set(results.map(r => r.workDate)).size,
      totalProjects: new Set(results.map(r => r.projectCode)).size,
      totalEntries: results.length,
    };
    
    const availableUnits = Array.from(new Set(productionRates.map(r => r.unit))).sort();
    
    res.json({
      rates: productionRates,
      summary,
      availableUnits,
    });
  } catch (error) {
    console.error("Get production rates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/detail", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { description, unit, startDate, endDate } = req.query;
    
    if (!description || !unit) {
      res.status(400).json({ error: "Description and unit are required" });
      return;
    }
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.json({ entries: [], dailySummary: [], projectStats: [], aggregates: { totalQuantity: 0, totalDays: 0, totalProjects: 0, avgPerDay: 0 } });
    }
    
    const conditions: any[] = [
      eq(scopeItems.description, description as string),
      eq(scopeItems.unit, unit as string)
    ];
    
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    
    let query = db
      .select({
        id: dailyScopeProgress.id,
        workDate: dailyScopeProgress.workDate,
        quantityCompleted: dailyScopeProgress.quantityCompleted,
        notes: dailyScopeProgress.notes,
        projectCode: projects.code,
        projectName: projects.name,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
      })
      .from(dailyScopeProgress)
      .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
      .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
      .leftJoin(users, eq(dailyScopeProgress.createdById, users.id))
      .where(and(...conditions))
      .orderBy(desc(dailyScopeProgress.workDate));
    
    let results = await query;
    
    if (startDate) {
      results = results.filter(r => r.workDate >= (startDate as string));
    }
    if (endDate) {
      results = results.filter(r => r.workDate <= (endDate as string));
    }
    
    const dailyTotals = new Map<string, { total: number; projects: Set<string> }>();
    for (const entry of results) {
      const dateKey = entry.workDate;
      if (!dailyTotals.has(dateKey)) {
        dailyTotals.set(dateKey, { total: 0, projects: new Set() });
      }
      const day = dailyTotals.get(dateKey)!;
      day.total += parseFloat(entry.quantityCompleted);
      day.projects.add(entry.projectCode);
    }
    
    const projectStats = new Map<string, { 
      code: string; 
      name: string; 
      totalQuantity: number; 
      workDates: Set<string>;
      entries: number 
    }>();
    
    for (const entry of results) {
      if (!projectStats.has(entry.projectCode)) {
        projectStats.set(entry.projectCode, {
          code: entry.projectCode,
          name: entry.projectName,
          totalQuantity: 0,
          workDates: new Set(),
          entries: 0,
        });
      }
      const proj = projectStats.get(entry.projectCode)!;
      proj.totalQuantity += parseFloat(entry.quantityCompleted);
      proj.workDates.add(entry.workDate);
      proj.entries += 1;
    }
    
    const dailyTotalsArray = Array.from(dailyTotals.entries())
      .map(([date, data]) => ({
        date,
        total: Math.round(data.total * 100) / 100,
        projectCount: data.projects.size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    
    res.json({
      description,
      unit,
      entries: results.map(r => ({
        id: r.id,
        workDate: r.workDate,
        quantity: parseFloat(r.quantityCompleted),
        notes: r.notes,
        projectCode: r.projectCode,
        projectName: r.projectName,
        createdBy: r.creatorFirstName && r.creatorLastName 
          ? `${r.creatorFirstName} ${r.creatorLastName}` 
          : 'Unknown',
      })),
      dailyTotals: dailyTotalsArray,
      projectStats: Array.from(projectStats.values()).map(p => {
        const days = p.workDates.size;
        return {
          code: p.code,
          name: p.name,
          totalQuantity: Math.round(p.totalQuantity * 100) / 100,
          days,
          entries: p.entries,
          avgPerDay: days > 0 ? Math.round((p.totalQuantity / days) * 100) / 100 : 0,
        };
      }),
    });
  } catch (error) {
    console.error("Get production rate detail error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/unified", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, projectCode, source } = req.query;
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.json({ rates: [], ratesByWorkType: [], summary: { totalWorkTypes: 0, totalEntries: 0, totalProjects: 0 } });
    }
    
    const unifiedRates: {
      workTypeCode: string;
      workTypeName: string;
      categoryName: string;
      unit: string;
      source: 'SCOPE_PROGRESS' | 'TM_TICKET' | 'CHANGE_ORDER';
      quantity: number;
      projectCode: string;
      projectName: string;
      workDate: string | null;
      entryId: string;
    }[] = [];

    if (!source || source === 'SCOPE_PROGRESS' || source === 'ALL') {
      const scopeConditions: any[] = [];
      if (shouldFilter && orgId) {
        scopeConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const scopeQuery = scopeConditions.length > 0 
        ? db
            .select({
              id: dailyScopeProgress.id,
              description: scopeItems.description,
              unit: scopeItems.unit,
              projectCode: projects.code,
              projectName: projects.name,
              workDate: dailyScopeProgress.workDate,
              quantityCompleted: dailyScopeProgress.quantityCompleted,
            })
            .from(dailyScopeProgress)
            .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
            .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
            .where(and(...scopeConditions))
            .limit(2000)
        : db
            .select({
              id: dailyScopeProgress.id,
              description: scopeItems.description,
              unit: scopeItems.unit,
              projectCode: projects.code,
              projectName: projects.name,
              workDate: dailyScopeProgress.workDate,
              quantityCompleted: dailyScopeProgress.quantityCompleted,
            })
            .from(dailyScopeProgress)
            .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
            .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
            .limit(2000);
      
      const scopeResults = await scopeQuery;

      for (const r of scopeResults) {
        if (startDate && r.workDate < startDate) continue;
        if (endDate && r.workDate > endDate) continue;
        if (projectCode && r.projectCode !== projectCode) continue;

        unifiedRates.push({
          workTypeCode: r.description,
          workTypeName: r.description,
          categoryName: 'Scope Progress',
          unit: r.unit,
          source: 'SCOPE_PROGRESS',
          quantity: parseFloat(r.quantityCompleted),
          projectCode: r.projectCode,
          projectName: r.projectName,
          workDate: r.workDate,
          entryId: r.id,
        });
      }
    }

    if (!source || source === 'TM_TICKET' || source === 'ALL') {
      const tmConditions: any[] = [sql`${tmTickets.workTypeCode} IS NOT NULL`];
      if (shouldFilter && orgId) {
        tmConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const tmResults = await db
        .select({
          id: tmTickets.id,
          workTypeCode: tmTickets.workTypeCode,
          workTypeName: tmTickets.workTypeName,
          categoryName: tmTickets.categoryName,
          scopeUnit: tmTickets.scopeUnit,
          scopeQuantity: tmTickets.scopeQuantity,
          projectCode: projects.code,
          projectName: projects.name,
          workDate: tmTickets.workDate,
          status: tmTickets.status,
        })
        .from(tmTickets)
        .innerJoin(projects, eq(tmTickets.projectId, projects.id))
        .where(and(...tmConditions))
        .limit(2000);

      for (const r of tmResults) {
        if (startDate && r.workDate < startDate) continue;
        if (endDate && r.workDate > endDate) continue;
        if (projectCode && r.projectCode !== projectCode) continue;
        if (!r.scopeQuantity) continue;

        unifiedRates.push({
          workTypeCode: r.workTypeCode!,
          workTypeName: r.workTypeName || r.workTypeCode!,
          categoryName: r.categoryName || 'T&M Work',
          unit: r.scopeUnit || 'EA',
          source: 'TM_TICKET',
          quantity: parseFloat(r.scopeQuantity),
          projectCode: r.projectCode,
          projectName: r.projectName,
          workDate: r.workDate,
          entryId: r.id,
        });
      }
    }

    if (!source || source === 'CHANGE_ORDER' || source === 'ALL') {
      const coConditions: any[] = [sql`${changeOrders.workTypeCode} IS NOT NULL`];
      if (shouldFilter && orgId) {
        coConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const coResults = await db
        .select({
          id: changeOrders.id,
          workTypeCode: changeOrders.workTypeCode,
          workTypeName: changeOrders.workTypeName,
          categoryName: changeOrders.categoryName,
          scopeUnit: changeOrders.scopeUnit,
          scopeQuantity: changeOrders.scopeQuantity,
          projectCode: projects.code,
          projectName: projects.name,
          createdAt: changeOrders.createdAt,
          status: changeOrders.status,
        })
        .from(changeOrders)
        .innerJoin(projects, eq(changeOrders.projectId, projects.id))
        .where(and(...coConditions))
        .limit(2000);

      for (const r of coResults) {
        const workDate = r.createdAt ? r.createdAt.toISOString().split('T')[0] : null;
        if (startDate && workDate && workDate < startDate) continue;
        if (endDate && workDate && workDate > endDate) continue;
        if (projectCode && r.projectCode !== projectCode) continue;
        if (!r.scopeQuantity) continue;

        unifiedRates.push({
          workTypeCode: r.workTypeCode!,
          workTypeName: r.workTypeName || r.workTypeCode!,
          categoryName: r.categoryName || 'Change Order',
          unit: r.scopeUnit || 'EA',
          source: 'CHANGE_ORDER',
          quantity: parseFloat(r.scopeQuantity),
          projectCode: r.projectCode,
          projectName: r.projectName,
          workDate,
          entryId: r.id,
        });
      }
    }

    const aggregated = new Map<string, {
      workTypeCode: string;
      workTypeName: string;
      categoryName: string;
      unit: string;
      totalQuantity: number;
      sources: { SCOPE_PROGRESS: number; TM_TICKET: number; CHANGE_ORDER: number };
      projectCodes: Set<string>;
      dailyTotals: Map<string, number>;
      entryCount: number;
    }>();

    for (const entry of unifiedRates) {
      const key = `${entry.workTypeCode}|||${entry.unit}`;
      
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          workTypeCode: entry.workTypeCode,
          workTypeName: entry.workTypeName,
          categoryName: entry.categoryName,
          unit: entry.unit,
          totalQuantity: 0,
          sources: { SCOPE_PROGRESS: 0, TM_TICKET: 0, CHANGE_ORDER: 0 },
          projectCodes: new Set(),
          dailyTotals: new Map(),
          entryCount: 0,
        });
      }

      const agg = aggregated.get(key)!;
      agg.totalQuantity += entry.quantity;
      agg.sources[entry.source] += entry.quantity;
      agg.projectCodes.add(entry.projectCode);
      agg.entryCount += 1;

      if (entry.workDate) {
        const currentDayTotal = agg.dailyTotals.get(entry.workDate) || 0;
        agg.dailyTotals.set(entry.workDate, currentDayTotal + entry.quantity);
      }
    }

    const rates = Array.from(aggregated.values()).map(agg => {
      const dailyTotalsArray = Array.from(agg.dailyTotals.values());
      const sortedDailyTotals = [...dailyTotalsArray].sort((a, b) => a - b);
      const totalDays = agg.dailyTotals.size;
      const avgPerDay = totalDays > 0 ? agg.totalQuantity / totalDays : 0;
      const minPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[0] : 0;
      const maxPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[sortedDailyTotals.length - 1] : 0;

      let medianPerDay = 0;
      if (sortedDailyTotals.length > 0) {
        const mid = Math.floor(sortedDailyTotals.length / 2);
        medianPerDay = sortedDailyTotals.length % 2 !== 0 
          ? sortedDailyTotals[mid] 
          : (sortedDailyTotals[mid - 1] + sortedDailyTotals[mid]) / 2;
      }

      return {
        workTypeCode: agg.workTypeCode,
        workTypeName: agg.workTypeName,
        categoryName: agg.categoryName,
        unit: agg.unit,
        totalQuantity: Math.round(agg.totalQuantity * 100) / 100,
        totalDays,
        totalProjects: agg.projectCodes.size,
        avgPerDay: Math.round(avgPerDay * 100) / 100,
        minPerDay: Math.round(minPerDay * 100) / 100,
        maxPerDay: Math.round(maxPerDay * 100) / 100,
        medianPerDay: Math.round(medianPerDay * 100) / 100,
        entryCount: agg.entryCount,
        sourceBreakdown: {
          scopeProgress: Math.round(agg.sources.SCOPE_PROGRESS * 100) / 100,
          tmTickets: Math.round(agg.sources.TM_TICKET * 100) / 100,
          changeOrders: Math.round(agg.sources.CHANGE_ORDER * 100) / 100,
        },
      };
    });

    rates.sort((a, b) => b.totalQuantity - a.totalQuantity);

    const summary = {
      totalWorkTypes: rates.length,
      totalEntries: unifiedRates.length,
      totalProjects: new Set(unifiedRates.map(r => r.projectCode)).size,
      bySource: {
        scopeProgress: unifiedRates.filter(r => r.source === 'SCOPE_PROGRESS').length,
        tmTickets: unifiedRates.filter(r => r.source === 'TM_TICKET').length,
        changeOrders: unifiedRates.filter(r => r.source === 'CHANGE_ORDER').length,
      },
    };

    const availableUnits = Array.from(new Set(rates.map(r => r.unit))).sort();
    const availableCategories = Array.from(new Set(rates.map(r => r.categoryName))).sort();

    res.json({
      rates,
      summary,
      availableUnits,
      availableCategories,
    });
  } catch (error) {
    console.error("Get unified production rates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/metrics", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { description, unit, startDate, endDate, projectCode, minQuantity, maxQuantity } = req.query;
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.json({ 
        rates: [], 
        summary: { 
          totalSOWTypes: 0, 
          totalQuantity: 0,
          totalLaborHours: 0, 
          totalLaborCost: 0, 
          totalMaterialCost: 0,
          totalCost: 0 
        } 
      });
    }

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }
    if (description) {
      conditions.push(sql`LOWER(${scopeItems.description}) LIKE LOWER(${'%' + description + '%'})`);
    }
    if (unit) {
      conditions.push(eq(scopeItems.unit, unit as string));
    }
    if (startDate) {
      conditions.push(sql`${dailyScopeProgress.workDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${dailyScopeProgress.workDate} <= ${endDate}`);
    }
    if (projectCode) {
      conditions.push(eq(projects.code, projectCode as string));
    }

    const results = await db
      .select({
        description: scopeItems.description,
        unit: scopeItems.unit,
        unitPrice: scopeItems.unitPrice,
        projectCode: projects.code,
        projectName: projects.name,
        workDate: dailyScopeProgress.workDate,
        quantityCompleted: dailyScopeProgress.quantityCompleted,
        laborHours: dailyScopeProgress.laborHours,
        laborCost: dailyScopeProgress.laborCost,
        materialCost: dailyScopeProgress.materialCost,
        equipmentCost: dailyScopeProgress.equipmentCost,
        crewSize: dailyScopeProgress.crewSize,
        laborHoursPerUnit: dailyScopeProgress.laborHoursPerUnit,
        laborCostPerUnit: dailyScopeProgress.laborCostPerUnit,
        materialCostPerUnit: dailyScopeProgress.materialCostPerUnit,
        totalCostPerUnit: dailyScopeProgress.totalCostPerUnit,
      })
      .from(dailyScopeProgress)
      .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
      .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(5000);

    let filteredResults = results;
    if (minQuantity || maxQuantity) {
      filteredResults = results.filter(r => {
        const qty = parseFloat(r.quantityCompleted);
        if (minQuantity && qty < parseFloat(minQuantity as string)) return false;
        if (maxQuantity && qty > parseFloat(maxQuantity as string)) return false;
        return true;
      });
    }

    const aggregated = new Map<string, {
      description: string;
      unit: string;
      avgUnitPrice: number;
      unitPriceCount: number;
      totalQuantity: number;
      totalLaborHours: number;
      totalLaborCost: number;
      totalMaterialCost: number;
      totalEquipmentCost: number;
      crewSizes: number[];
      projectCodes: Set<string>;
      workDates: Set<string>;
      laborHoursPerUnit: number[];
      laborCostPerUnit: number[];
      materialCostPerUnit: number[];
      totalCostPerUnit: number[];
    }>();

    for (const entry of filteredResults) {
      const key = `${entry.description}|||${entry.unit}`;
      
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          description: entry.description,
          unit: entry.unit,
          avgUnitPrice: 0,
          unitPriceCount: 0,
          totalQuantity: 0,
          totalLaborHours: 0,
          totalLaborCost: 0,
          totalMaterialCost: 0,
          totalEquipmentCost: 0,
          crewSizes: [],
          projectCodes: new Set(),
          workDates: new Set(),
          laborHoursPerUnit: [],
          laborCostPerUnit: [],
          materialCostPerUnit: [],
          totalCostPerUnit: [],
        });
      }

      const agg = aggregated.get(key)!;
      const qty = parseFloat(entry.quantityCompleted) || 0;
      agg.totalQuantity += qty;
      
      if (entry.laborHours) agg.totalLaborHours += parseFloat(entry.laborHours);
      if (entry.laborCost) agg.totalLaborCost += parseFloat(entry.laborCost);
      if (entry.materialCost) agg.totalMaterialCost += parseFloat(entry.materialCost);
      if (entry.equipmentCost) agg.totalEquipmentCost += parseFloat(entry.equipmentCost);
      if (entry.crewSize) agg.crewSizes.push(entry.crewSize);
      if (entry.unitPrice) {
        agg.avgUnitPrice += parseFloat(entry.unitPrice);
        agg.unitPriceCount += 1;
      }
      if (entry.laborHoursPerUnit) agg.laborHoursPerUnit.push(parseFloat(entry.laborHoursPerUnit));
      if (entry.laborCostPerUnit) agg.laborCostPerUnit.push(parseFloat(entry.laborCostPerUnit));
      if (entry.materialCostPerUnit) agg.materialCostPerUnit.push(parseFloat(entry.materialCostPerUnit));
      if (entry.totalCostPerUnit) agg.totalCostPerUnit.push(parseFloat(entry.totalCostPerUnit));
      
      agg.projectCodes.add(entry.projectCode);
      agg.workDates.add(entry.workDate);
    }

    const rates = Array.from(aggregated.values()).map(agg => {
      const totalCost = agg.totalLaborCost + agg.totalMaterialCost + agg.totalEquipmentCost;
      const avgUnitPrice = agg.unitPriceCount > 0 ? agg.avgUnitPrice / agg.unitPriceCount : 0;
      
      const avgLaborHoursPerUnit = agg.laborHoursPerUnit.length > 0
        ? agg.laborHoursPerUnit.reduce((a, b) => a + b, 0) / agg.laborHoursPerUnit.length
        : (agg.totalQuantity > 0 ? agg.totalLaborHours / agg.totalQuantity : 0);
      
      const avgLaborCostPerUnit = agg.laborCostPerUnit.length > 0
        ? agg.laborCostPerUnit.reduce((a, b) => a + b, 0) / agg.laborCostPerUnit.length
        : (agg.totalQuantity > 0 ? agg.totalLaborCost / agg.totalQuantity : 0);
      
      const avgMaterialCostPerUnit = agg.materialCostPerUnit.length > 0
        ? agg.materialCostPerUnit.reduce((a, b) => a + b, 0) / agg.materialCostPerUnit.length
        : (agg.totalQuantity > 0 ? agg.totalMaterialCost / agg.totalQuantity : 0);
      
      const avgEquipmentCostPerUnit = agg.totalQuantity > 0 ? agg.totalEquipmentCost / agg.totalQuantity : 0;
      const avgTotalCostPerUnit = avgLaborCostPerUnit + avgMaterialCostPerUnit + avgEquipmentCostPerUnit;
      
      const avgProfitPerUnit = avgUnitPrice - avgTotalCostPerUnit;
      const profitMargin = avgUnitPrice > 0 ? (avgProfitPerUnit / avgUnitPrice) * 100 : 0;
      
      const avgCrewSize = agg.crewSizes.length > 0 
        ? agg.crewSizes.reduce((a, b) => a + b, 0) / agg.crewSizes.length 
        : 0;
      
      const totalDays = agg.workDates.size;
      const avgQuantityPerDay = totalDays > 0 ? agg.totalQuantity / totalDays : 0;
      
      let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
      const totalProjects = agg.projectCodes.size;
      if (totalDays >= 10 && totalProjects >= 3) confidence = 'HIGH';
      else if (totalDays >= 5 && totalProjects >= 2) confidence = 'MEDIUM';
      else if (totalDays >= 2) confidence = 'LOW';

      return {
        description: agg.description,
        unit: agg.unit,
        totalQuantity: Math.round(agg.totalQuantity * 100) / 100,
        avgQuantityPerDay: Math.round(avgQuantityPerDay * 100) / 100,
        avgCrewSize: Math.round(avgCrewSize * 10) / 10,
        totalLaborHours: Math.round(agg.totalLaborHours * 100) / 100,
        totalLaborCost: Math.round(agg.totalLaborCost * 100) / 100,
        avgLaborHoursPerUnit: Math.round(avgLaborHoursPerUnit * 1000) / 1000,
        avgLaborCostPerUnit: Math.round(avgLaborCostPerUnit * 100) / 100,
        totalMaterialCost: Math.round(agg.totalMaterialCost * 100) / 100,
        avgMaterialCostPerUnit: Math.round(avgMaterialCostPerUnit * 100) / 100,
        totalEquipmentCost: Math.round(agg.totalEquipmentCost * 100) / 100,
        avgEquipmentCostPerUnit: Math.round(avgEquipmentCostPerUnit * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        avgTotalCostPerUnit: Math.round(avgTotalCostPerUnit * 100) / 100,
        avgRevenuePerUnit: Math.round(avgUnitPrice * 100) / 100,
        avgProfitPerUnit: Math.round(avgProfitPerUnit * 100) / 100,
        profitMargin: Math.round(profitMargin * 10) / 10,
        totalDays,
        totalProjects,
        confidence,
        hasLaborData: agg.totalLaborHours > 0,
        hasMaterialData: agg.totalMaterialCost > 0,
      };
    });

    rates.sort((a, b) => {
      const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence] || b.totalDays - a.totalDays;
    });

    const summary = {
      totalSOWTypes: rates.length,
      totalQuantity: rates.reduce((sum, r) => sum + r.totalQuantity, 0),
      totalLaborHours: rates.reduce((sum, r) => sum + r.totalLaborHours, 0),
      totalLaborCost: rates.reduce((sum, r) => sum + r.totalLaborCost, 0),
      totalMaterialCost: rates.reduce((sum, r) => sum + r.totalMaterialCost, 0),
      totalEquipmentCost: rates.reduce((sum, r) => sum + r.totalEquipmentCost, 0),
      totalCost: rates.reduce((sum, r) => sum + r.totalCost, 0),
      totalProjects: new Set(filteredResults.map(r => r.projectCode)).size,
      ratesWithLaborData: rates.filter(r => r.hasLaborData).length,
      ratesWithMaterialData: rates.filter(r => r.hasMaterialData).length,
    };

    const availableUnits = Array.from(new Set(rates.map(r => r.unit))).sort();

    res.json({
      rates,
      summary,
      availableUnits,
    });
  } catch (error) {
    console.error("Get production rate metrics error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { description, unit, quantity } = req.query;
    
    if (!description || !unit || !quantity) {
      res.status(400).json({ error: "description, unit, and quantity are required" });
      return;
    }

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { estimateLaborHoursFromProductionRate } = await import("./productionRateService");
    
    const estimate = await estimateLaborHoursFromProductionRate(
      description as string,
      unit as string,
      parseFloat(quantity as string),
      orgId || ""
    );

    res.json({
      description,
      unit,
      requestedQuantity: parseFloat(quantity as string),
      estimate: {
        suggestedLaborHours: estimate.suggestedLaborHours,
        suggestedLaborCost: estimate.suggestedLaborCost,
        suggestedMaterialCost: estimate.suggestedMaterialCost,
        suggestedTotalCost: estimate.suggestedTotalCost,
        laborHoursPerUnit: estimate.laborHoursPerUnit,
        laborCostPerUnit: estimate.laborCostPerUnit,
        materialCostPerUnit: estimate.materialCostPerUnit,
        totalCostPerUnit: estimate.totalCostPerUnit,
        productionRate: estimate.productionRateUsed,
        confidence: estimate.confidence,
        dataSource: estimate.dataSource,
      },
    });
  } catch (error) {
    console.error("Get production rate estimate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
