import { Router } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import {
  projects, users, scopeItems, changeOrders,
  projectLaborRates, projectEmployeeRates,
  insertProjectSchema,
  timeClockShifts, procurementItems, receipts,
  subcontractorContracts, subcontractorPayments,
  tmDailySheets, tmTickets,
  aiNoteInsights, aiTasks, projectPlans, takeoffMeasurements,
  takeoffSheets, quantityCategories, tasks,
  handoffPackets,
  estimates, estimateLineItems, timeEntries,
  calendarEvents, media, planDocuments, projectNotes,
  dailyScopeProgress, conversations, conversationParticipants,
  crewMembers, crewProjectAssignments,
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

const createProjectSchema = insertProjectSchema.omit({ code: true });
const updateProjectSchema = insertProjectSchema.partial();

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

        // Auto-create a project channel with slug and add all project-org members
        const projOrgId = newProject.gcOrganizationId;
        if (projOrgId) {
          try {
            const slug = `project-${newProject.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40)}`;
            const [channel] = await db.insert(conversations).values({
              type: "GROUP",
              name: newProject.name,
              description: `Project channel for ${newProject.name} (${newProject.code})`,
              channelSlug: slug,
              projectId: newProject.id,
              organizationId: projOrgId,
              createdById: req.user!.id,
            }).returning();
            // Add creator as admin
            await db.insert(conversationParticipants).values({
              conversationId: channel.id,
              userId: req.user!.id,
              isAdmin: true,
            });
            // Add targeted members to the project channel instead of the entire org.
            // Included: project manager, privileged roles, and crew members from
            // crews currently assigned to this project.
            // Creator is already added as admin above; use onConflictDoNothing for safety.
            const PRIVILEGED_ROLES = ["ADMIN", "MANAGER", "PROJECT_MANAGER", "SUPERINTENDENT", "ESTIMATOR"] as const;

            // Privileged users + project manager from the org
            const privilegedUsers = await db
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  eq(users.organizationId, projOrgId),
                  eq(users.isActive, true),
                  inArray(users.role, PRIVILEGED_ROLES as unknown as string[])
                )
              );

            // Project manager (may not be in privileged list if their stored role differs)
            const pmId = newProject.projectManagerId;

            // Crew members from crews assigned to this project — org-scoped for safety
            const crewAssignments = await db
              .select({ crewId: crewProjectAssignments.crewId })
              .from(crewProjectAssignments)
              .where(eq(crewProjectAssignments.projectId, newProject.id));
            const assignedCrewIds = crewAssignments.map(a => a.crewId);

            let crewUserIds: { id: string }[] = [];
            if (assignedCrewIds.length > 0) {
              // Join with users table to enforce org membership (prevent cross-tenant injection)
              crewUserIds = await db
                .select({ id: crewMembers.userId })
                .from(crewMembers)
                .innerJoin(users, and(
                  eq(users.id, crewMembers.userId),
                  eq(users.organizationId, projOrgId),
                  eq(users.isActive, true),
                ))
                .where(inArray(crewMembers.crewId, assignedCrewIds));
            }

            // Validate PM is in the same org before including
            let validatedPmId: string | null = null;
            if (pmId) {
              const pmCheck = await db
                .select({ id: users.id })
                .from(users)
                .where(and(
                  eq(users.id, pmId),
                  eq(users.organizationId, projOrgId),
                  eq(users.isActive, true),
                ))
                .limit(1);
              if (pmCheck.length > 0) validatedPmId = pmId;
            }

            // Collect unique user IDs, excluding the creator (already added as admin)
            const creatorId = req.user!.id;
            const memberSet = new Set<string>();
            for (const u of privilegedUsers) { if (u.id !== creatorId) memberSet.add(u.id); }
            if (validatedPmId && validatedPmId !== creatorId) memberSet.add(validatedPmId);
            for (const u of crewUserIds) { if (u.id !== creatorId) memberSet.add(u.id); }

            const toAdd = Array.from(memberSet).map(userId => ({
              conversationId: channel.id,
              userId,
              isAdmin: false,
            }));
            if (toAdd.length > 0) {
              await db.insert(conversationParticipants).values(toAdd).onConflictDoNothing();
            }
          } catch (channelErr) {
            console.warn("Could not auto-create project channel:", channelErr);
          }
        }

        eventBus.emit({
          type: "project.created",
          orgId: newProject.gcOrganizationId || userOrgId || "",
          actorId: req.user!.id,
          timestamp: new Date(),
          payload: {
            projectId: newProject.id,
            projectCode: newProject.code,
            name: newProject.name,
            clientName: newProject.clientName,
          },
        });

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

    if (validationResult.data.status !== undefined && validationResult.data.status !== existingProject.status) {
      eventBus.emit({
        type: "project.status_changed",
        orgId: updatedProject.gcOrganizationId || req.user!.organizationId || "",
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          projectId: updatedProject.id,
          projectCode: updatedProject.code,
          oldStatus: existingProject.status,
          newStatus: updatedProject.status,
        },
      });
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

export default router;
