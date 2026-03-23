import { Router } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import { projects, users, scopeItems, changeOrders, projectLaborRates, projectEmployeeRates, insertProjectSchema, timeClockShifts, procurementItems, receipts, subcontractorContracts, subcontractorPayments, tmDailySheets, tmTickets, aiNoteInsights, aiTasks, projectPlans, takeoffMeasurements, takeoffSheets, quantityCategories, tasks, handoffPackets, estimates, estimateLineItems, timeEntries, calendarEvents, media, planDocuments, projectNotes, dailyScopeProgress, conversations, conversationParticipants, crewMembers, crewProjectAssignments, scheduleOfValues, sovLineItems, insertProjectNoteSchema, insertMediaSchema, insertTimeEntrySchema, insertTMDailySheetSchema, insertEstimateSchema, insertProcurementItemSchema, filePermissions, subcontractors, bidSubcontractorQuotes, bidMaterialQuotes, organizations, orgCostCodes, insertOrgCostCodeSchema } from "@shared/schema";
import { eq, and, sql, desc, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { logUpdate, logDelete, logAudit, logCreate, logApprove } from "./auditLogger";

const router = Router();

// ========================================
// Routes from projectCoreRoutes.ts
// ========================================

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

        await eventBus.emit({
          type: "project.created",
          version: 1,
          orgId: newProject.gcOrganizationId || userOrgId || "",
          actorId: req.user!.id,
          timestamp: new Date(),
          payload: {
            projectId: newProject.id,
            projectCode: newProject.code,
            name: newProject.name,
            projectStatus: newProject.status,
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
      await eventBus.emit({
        type: "project.status_changed",
        version: 1,
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
    
    // GCS cleanup for change order attachments before DB delete
    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const projectChangeOrders = await db.select({ attachmentsJson: changeOrders.attachmentsJson }).from(changeOrders).where(eq(changeOrders.projectId, project.id));
      for (const co of projectChangeOrders) {
        if (co.attachmentsJson) {
          let attachments: any[] = [];
          try { attachments = JSON.parse(co.attachmentsJson); } catch (_) {}
          for (const att of attachments) {
            if (att.objectKey) {
              try {
                const objectFile = await objectStorageService.getObjectEntityFile(att.objectKey);
                await objectFile.delete();
              } catch (e) {
                console.error("Error deleting change order attachment GCS object:", e);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Error during change order attachment GCS cleanup:", e);
    }
    await db.delete(changeOrders).where(eq(changeOrders.projectId, project.id));

    // GCS cleanup for receipts before DB delete
    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const projectReceipts = await db.select({ objectKey: receipts.objectKey }).from(receipts).where(eq(receipts.projectId, project.id));
      for (const receipt of projectReceipts) {
        if (receipt.objectKey) {
          try {
            const objectFile = await objectStorageService.getObjectEntityFile(receipt.objectKey);
            await objectFile.delete();
          } catch (e) {
            console.error("Error deleting receipt GCS object:", e);
          }
        }
      }
    } catch (e) {
      console.error("Error during receipt GCS cleanup:", e);
    }
    await db.delete(receipts).where(eq(receipts.projectId, project.id));
    await db.delete(procurementItems).where(eq(procurementItems.projectId, project.id));
    
    const plansToDelete = await db.select().from(projectPlans).where(eq(projectPlans.projectId, project.id));
    for (const plan of plansToDelete) {
      await db.delete(takeoffMeasurements).where(eq(takeoffMeasurements.sheetId, plan.id));
    }
    await db.delete(projectPlans).where(eq(projectPlans.projectId, project.id));
    await db.delete(takeoffSheets).where(eq(takeoffSheets.projectId, project.id));
    await db.delete(quantityCategories).where(eq(quantityCategories.projectId, project.id));

    // GCS cleanup for plan documents before DB delete
    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const projectDocs = await db.select({ objectKey: planDocuments.objectKey }).from(planDocuments).where(eq(planDocuments.projectId, project.id));
      for (const doc of projectDocs) {
        if (doc.objectKey) {
          try {
            const objectFile = await objectStorageService.getObjectEntityFile(doc.objectKey);
            await objectFile.delete();
          } catch (e) {
            console.error("Error deleting plan document GCS object:", e);
          }
        }
      }
    } catch (e) {
      console.error("Error during plan document GCS cleanup:", e);
    }
    await db.delete(planDocuments).where(eq(planDocuments.projectId, project.id));
    
    await db.delete(projectNotes).where(eq(projectNotes.projectId, project.id));
    
    await db.delete(calendarEvents).where(eq(calendarEvents.projectId, project.id));

    // GCS cleanup for media before DB delete
    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const projectMedia = await db.select({ objectKey: media.objectKey }).from(media).where(eq(media.projectId, project.id));
      for (const m of projectMedia) {
        if (m.objectKey) {
          try {
            const objectFile = await objectStorageService.getObjectEntityFile(m.objectKey);
            await objectFile.delete();
          } catch (e) {
            console.error("Error deleting media GCS object:", e);
          }
        }
      }
    } catch (e) {
      console.error("Error during media GCS cleanup:", e);
    }
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

// Returns the list of change order IDs that already have a linked SOV line item for this project
router.get("/api/projects/:code/sov-co-linked-ids", requireAuth, async (req: AuthRequest, res) => {
  try {
    const project = await db.query.projects.findFirst({ where: eq(projects.code, req.params.code) });
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const sovRows = await db
      .select({ id: scheduleOfValues.id })
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, project.id));

    if (sovRows.length === 0) return res.json({ linkedCoIds: [] });

    const sovIds = sovRows.map((r) => r.id);
    const linkedRows = await db
      .select({ linkedChangeOrderId: sovLineItems.linkedChangeOrderId })
      .from(sovLineItems)
      .where(
        and(
          inArray(sovLineItems.sovId, sovIds),
          sql`${sovLineItems.linkedChangeOrderId} IS NOT NULL`
        )
      );

    const linkedCoIds = linkedRows
      .map((r) => r.linkedChangeOrderId)
      .filter((id): id is string => !!id);

    res.json({ linkedCoIds });
  } catch (error) {
    console.error("SOV CO linked IDs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/closeout-readiness", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const project = await db.query.projects.findFirst({ where: eq(projects.code, req.params.code) });
    if (!project) return res.status(404).json({ error: "Project not found" });
    const { verifyOrgAccess } = await import("./orgFilter");
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { punchListItems, rfis, vendorInvoices, purchaseOrders } = await import("@shared/schema");
    const { count } = await import("drizzle-orm");

    const openPunchListItems = await db
      .select({ cnt: count() })
      .from(punchListItems)
      .where(and(
        eq(punchListItems.projectId, project.id),
        sql`${punchListItems.status} NOT IN ('VERIFIED', 'REJECTED')`
      ));

    const pendingChangeOrders = await db
      .select({ cnt: count() })
      .from(changeOrders)
      .where(and(
        eq(changeOrders.projectId, project.id),
        sql`${changeOrders.status} IN ('SUBMITTED', 'PENDING_APPROVAL')`
      ));

    const submittedTmTickets = await db
      .select({ cnt: count() })
      .from(tmTickets)
      .where(and(
        eq(tmTickets.projectId, project.id),
        sql`${tmTickets.status} = 'SUBMITTED'`
      ));

    // Count SOV pay applications in active billing states (DRAFT = not yet submitted, SUBMITTED = awaiting client payment)
    const pendingPayApps = await db
      .select({ cnt: count() })
      .from(scheduleOfValues)
      .where(and(
        eq(scheduleOfValues.projectId, project.id),
        sql`${scheduleOfValues.status} IN ('DRAFT', 'SUBMITTED')`
      ));

    // Count open RFIs (not yet answered or closed)
    const openRfis = await db
      .select({ cnt: count() })
      .from(rfis)
      .where(and(
        eq(rfis.projectId, project.id),
        sql`${rfis.status} IN ('SUBMITTED', 'UNDER_REVIEW', 'FORWARDED')`
      ));

    // Count unpaid vendor invoices linked to this project via purchase orders
    // Terminal state is only PAID; PENDING, MATCHED, APPROVED, DISPUTED are open
    const unpaidVendorInvoices = await db
      .select({ cnt: count() })
      .from(vendorInvoices)
      .innerJoin(purchaseOrders, eq(vendorInvoices.poId, purchaseOrders.id))
      .where(and(
        eq(purchaseOrders.projectId, project.id),
        sql`${vendorInvoices.status} != 'PAID'`
      ));

    res.json({
      openPunchListItems: Number(openPunchListItems[0]?.cnt ?? 0),
      pendingChangeOrders: Number(pendingChangeOrders[0]?.cnt ?? 0),
      submittedTmTickets: Number(submittedTmTickets[0]?.cnt ?? 0),
      pendingPayApplications: Number(pendingPayApps[0]?.cnt ?? 0),
      openRfis: Number(openRfis[0]?.cnt ?? 0),
      unpaidVendorInvoices: Number(unpaidVendorInvoices[0]?.cnt ?? 0),
    });
  } catch (error) {
    console.error("Closeout readiness error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from projectContentRoutes.ts
// ========================================

function validateJSONField(jsonString: string | null | undefined, fieldName: string): { valid: boolean; error?: string; parsed?: any } {
  if (jsonString === null || jsonString === undefined) {
    return { valid: true };
  }

  if (jsonString === "") {
    return { valid: true, parsed: null };
  }

  try {
    const parsed = JSON.parse(jsonString);
    return { valid: true, parsed };
  } catch (error) {
    return { 
      valid: false, 
      error: `${fieldName} contains invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}` 
    };
  }
}

// ====================
// Project Notes Routes
// ====================

router.get("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const notes = await db
      .select()
      .from(projectNotes)
      .where(eq(projectNotes.projectId, project.id))
      .orderBy(desc(projectNotes.createdAt));

    res.json(notes);
  } catch (error) {
    console.error("Get notes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const sanitizedBody = {
      ...req.body,
      content: sanitizeText(req.body.content),
    };

    const validationResult = insertProjectNoteSchema.extend({
      projectId: z.string().optional(),
      authorId: z.string().optional(),
    }).safeParse({
      ...sanitizedBody,
      projectId: project.id,
      authorId: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const insertData = { ...validationResult.data, projectId: project.id, authorId: req.user!.id };
    const [newNote] = await db.insert(projectNotes).values([insertData]).returning();
    res.status(201).json(newNote);
  } catch (error: any) {
    console.error("Create note error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Media Routes
// ====================

router.get("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const allMedia = await db
      .select()
      .from(media)
      .where(eq(media.projectId, project.id))
      .orderBy(desc(media.uploadedAt));

    const { filterFilesByPermissions } = await import("./fileAccessHelpers");
    const projectMedia = await filterFilesByPermissions(
      allMedia,
      req.user!.id,
      req.user!.role,
      "MEDIA"
    );

    res.json(projectMedia);
  } catch (error) {
    console.error("Get media error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      caption: req.body.caption ? sanitizeText(req.body.caption) : undefined,
    };

    const validationResult = insertMediaSchema.extend({
      projectId: z.string().optional(),
      uploadedById: z.string().optional(),
    }).safeParse({
      ...sanitizedBody,
      projectId: project.id,
      uploadedById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    
    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
      validationResult.data.fileUrl,
      {
        owner: req.user!.id,
        organizationId: req.user!.organizationId!,
        visibility: "private",
      }
    );

    const insertData = { ...validationResult.data, projectId: project.id, uploadedById: req.user!.id, objectKey };
    const [newMedia] = await db.insert(media).values([insertData]).returning();
    
    await db.insert(filePermissions).values([{
      fileId: newMedia.id,
      fileType: "MEDIA",
      userId: req.user!.id,
      grantedById: req.user!.id,
    }]);

    res.status(201).json(newMedia);
  } catch (error: any) {
    console.error("Create media error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/media/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [mediaItem] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);

    if (!mediaItem) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    const canDelete = req.user!.role === "ADMIN" || 
                     req.user!.role === "MANAGER" || 
                     req.user!.role === "SUPERINTENDENT" ||
                     mediaItem.uploadedById === req.user!.id;

    if (!canDelete) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    if (mediaItem.objectKey) {
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(mediaItem.objectKey);
        await objectFile.delete();
      } catch (error) {
        console.error("Error deleting media file from object storage:", error);
      }
    }

    await db.delete(media).where(eq(media.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete media error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Cost Codes Route
// ====================

router.get("/api/cost-codes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { getCostCodesForTrade } = await import("@shared/costCodes");
    const orgId = req.user!.organizationId;
    const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const tradeType = org?.tradeType || "OTHER";
    const staticCodes = getCostCodesForTrade(tradeType);

    const orgRows = await db.select().from(orgCostCodes).where(eq(orgCostCodes.organizationId, orgId));
    const orgEntries = orgRows.map(r => ({
      code: r.code,
      description: r.description,
      division: r.division,
      isCustom: r.isCustom,
      isActive: r.isActive,
    }));

    const orgCodeSet = new Set(orgRows.map(r => r.code));
    const customFirst = orgEntries.filter(e => e.isCustom);
    const overrides = orgEntries.filter(e => !e.isCustom);
    const overrideMap = new Map(overrides.map(o => [o.code, o]));

    const staticWithOverrides = staticCodes
      .filter(c => !orgCodeSet.has(c.code) || overrideMap.has(c.code))
      .map(c => {
        const override = overrideMap.get(c.code);
        if (override) return { ...c, isActive: override.isActive };
        return c;
      });

    const merged = [
      ...customFirst,
      ...staticWithOverrides,
    ];

    res.json(merged);
  } catch (error) {
    console.error("Error fetching cost codes:", error);
    res.status(500).json({ error: "Failed to fetch cost codes" });
  }
});

router.get("/api/cost-codes/org", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const rows = await db
      .select({
        id: orgCostCodes.id,
        organizationId: orgCostCodes.organizationId,
        code: orgCostCodes.code,
        description: orgCostCodes.description,
        division: orgCostCodes.division,
        isCustom: orgCostCodes.isCustom,
        isActive: orgCostCodes.isActive,
        deactivatedById: orgCostCodes.deactivatedById,
        deactivatedAt: orgCostCodes.deactivatedAt,
        deactivatedByName: sql<string | null>`(SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = ${orgCostCodes.deactivatedById})`,
        createdAt: orgCostCodes.createdAt,
        updatedAt: orgCostCodes.updatedAt,
      })
      .from(orgCostCodes)
      .where(eq(orgCostCodes.organizationId, orgId));
    res.json(rows);
  } catch (error) {
    console.error("Error fetching org cost codes:", error);
    res.status(500).json({ error: "Failed to fetch custom cost codes" });
  }
});

router.post("/api/cost-codes", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const isCustom = req.body.isCustom !== false;

    if (isCustom) {
      const { getCostCodesForTrade } = await import("@shared/costCodes");
      const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
      const tradeType = org?.tradeType || "OTHER";
      const staticCodes = getCostCodesForTrade(tradeType);
      if (staticCodes.some(c => c.code === req.body.code)) {
        return res.status(400).json({ error: "Cannot create a custom code with the same code as a standard code. Deactivate the standard code instead." });
      }
    }

    const parsed = insertOrgCostCodeSchema.parse({ ...req.body, organizationId: orgId, isCustom });
    const insertData: Record<string, any> = { ...parsed };
    if (parsed.isActive === false) {
      insertData.deactivatedById = req.user!.id;
      insertData.deactivatedAt = new Date();
    }
    const [row] = await db.insert(orgCostCodes).values(insertData).returning();
    res.status(201).json(row);
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "A cost code with that code already exists" });
    }
    console.error("Error creating org cost code:", error);
    res.status(500).json({ error: "Failed to create cost code" });
  }
});

router.patch("/api/cost-codes/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    const id = Number(req.params.id);
    const { code, description, division, isActive, isCustom } = req.body;

    const [existing] = await db.select().from(orgCostCodes).where(and(eq(orgCostCodes.id, id), eq(orgCostCodes.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Cost code not found" });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (code !== undefined) updates.code = code;
    if (description !== undefined) updates.description = description;
    if (division !== undefined) updates.division = division;
    if (isCustom !== undefined) updates.isCustom = isCustom;

    if (isActive !== undefined) {
      updates.isActive = isActive;
      if (isActive === false && existing.isActive === true) {
        updates.deactivatedById = req.user!.id;
        updates.deactivatedAt = new Date();
      } else if (isActive === true && existing.isActive === false) {
        updates.deactivatedById = null;
        updates.deactivatedAt = null;
      }
    }

    const [row] = await db.update(orgCostCodes).set(updates).where(and(eq(orgCostCodes.id, id), eq(orgCostCodes.organizationId, orgId))).returning();
    res.json(row);
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "A cost code with that code already exists" });
    }
    console.error("Error updating org cost code:", error);
    res.status(500).json({ error: "Failed to update cost code" });
  }
});

// ====================
// Time Entry Routes
// ====================

router.get("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { page = "1", limit = "50", status, userId, projectId } = req.query;
    
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
    
    if (limitNum > 1000) {
      limitNum = 1000;
    }

    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    
    if (req.user!.role === "HOURLY_EMPLOYEE") {
      conditions.push(eq(timeEntries.userId, req.user!.id));
    } else if (userId) {
      conditions.push(eq(timeEntries.userId, userId as string));
    }

    if (status) {
      if (status === 'approved') {
        conditions.push(sql`${timeEntries.approvedById} IS NOT NULL`);
      } else if (status === 'pending') {
        conditions.push(sql`${timeEntries.approvedById} IS NULL`);
      }
    }

    if (projectId) {
      conditions.push(eq(timeEntries.projectId, projectId as string));
    }

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntries)
      .where(conditions.length > 0 ? and(...conditions) : sql`true`);
    const totalCount = totalResult[0]?.count || 0;

    let query = db.select().from(timeEntries);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const entries = await query
      .orderBy(desc(timeEntries.date))
      .limit(limitNum)
      .offset(offset);

    const userIds = [...new Set(entries.map(e => e.userId))];
    const userRows = userIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const userMap = new Map(userRows.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    const enrichedEntries = entries.map(e => ({
      ...e,
      userName: userMap.get(e.userId) || 'Unknown',
    }));

    res.json({
      data: enrichedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
    console.error("Get time entries error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/time-entries", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const entries = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.projectId, project.id))
      .orderBy(desc(timeEntries.date));

    res.json(entries);
  } catch (error) {
    console.error("Get project time entries error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const validationResult = insertTimeEntrySchema.extend({
      userId: z.string().optional(),
      date: z.coerce.date(),
    }).safeParse({
      ...sanitizedBody,
      userId: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const entryDate = new Date(validationResult.data.date);
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    if (entryDate > now) {
      res.status(400).json({ 
        error: "Invalid date",
        details: "Time entries cannot be created for future dates."
      });
      return;
    }

    if (req.user!.role !== "ADMIN" && entryDate < ninetyDaysAgo) {
      res.status(400).json({ 
        error: "Invalid date",
        details: "Time entries cannot be created for dates more than 90 days in the past. Please contact an administrator."
      });
      return;
    }

    const insertData = { ...validationResult.data, userId: req.user!.id };
    
    const [newEntry] = await db.insert(timeEntries).values([insertData]).returning();
    
    await logCreate(req.user!.id, "TIME_ENTRY", newEntry.id, newEntry, req);
    
    res.status(201).json(newEntry);
  } catch (error: any) {
    console.error("Create time entry error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const schema = z.object({
      date: z.coerce.date().optional(),
      hoursRegular: z.string().optional(),
      hoursOvertime: z.string().optional(),
      costCode: z.string().optional(),
      notes: z.string().optional(),
      adminOverride: z.boolean().optional(),
    });

    const data = schema.parse(sanitizedBody);

    const [existingEntry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, req.params.id))
      .limit(1);

    if (!existingEntry) {
      res.status(404).json({ error: "Time entry not found" });
      return;
    }

    if (existingEntry.approvedAt || existingEntry.approvedById) {
      if (req.user!.role !== "ADMIN" || !data.adminOverride) {
        res.status(403).json({ 
          error: "This time entry has been approved and is locked. Only administrators can modify approved entries with explicit override." 
        });
        return;
      }
    }

    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit your own time entries" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    
    if (data.date) updates.date = data.date;
    if (data.hoursRegular !== undefined) updates.hoursRegular = data.hoursRegular;
    if (data.hoursOvertime !== undefined) updates.hoursOvertime = data.hoursOvertime;
    if (data.costCode !== undefined) updates.costCode = data.costCode;
    if (data.notes !== undefined) updates.notes = data.notes;

    const [updatedEntry] = await db
      .update(timeEntries)
      .set(updates)
      .where(eq(timeEntries.id, req.params.id))
      .returning();

    await logUpdate(
      req.user!.id,
      "TIME_ENTRY",
      req.params.id,
      existingEntry,
      { ...updates, adminOverride: data.adminOverride },
      req
    );

    res.json(updatedEntry);
  } catch (error) {
    console.error("Update time entry error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existingEntry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, req.params.id))
      .limit(1);

    if (!existingEntry) {
      res.status(404).json({ error: "Time entry not found" });
      return;
    }

    if ((existingEntry.approvedAt || existingEntry.approvedById) && req.user!.role !== "ADMIN") {
      res.status(403).json({ 
        error: "This time entry has been approved and is locked. Only administrators can delete approved entries." 
      });
      return;
    }

    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
      res.status(403).json({ error: "You can only delete your own time entries" });
      return;
    }

    await db.delete(timeEntries).where(eq(timeEntries.id, req.params.id));

    await logDelete(req.user!.id, "TIME_ENTRY", req.params.id, existingEntry, req);

    res.status(204).send();
  } catch (error) {
    console.error("Delete time entry error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [existingEntry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, req.params.id))
      .limit(1);

    if (!existingEntry) {
      res.status(404).json({ error: "Time entry not found" });
      return;
    }

    const [updatedEntry] = await db
      .update(timeEntries)
      .set({
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, req.params.id))
      .returning();

    await logApprove(req.user!.id, "TIME_ENTRY", req.params.id, { approver: req.user!.email }, req);

    res.json(updatedEntry);
  } catch (error) {
    console.error("Approve time entry error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// T&M Daily Sheet Routes
// ====================

router.get("/api/projects/:code/tm-sheets", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const tickets = await db
      .select({
        ticket: tmTickets,
        repFirstName: users.firstName,
        repLastName: users.lastName,
      })
      .from(tmTickets)
      .leftJoin(users, eq(tmTickets.tfrRepresentativeId, users.id))
      .where(eq(tmTickets.projectId, project.id))
      .orderBy(desc(tmTickets.workDate));

    const mappedSheets = tickets.map(row => ({
      id: row.ticket.id,
      projectId: row.ticket.projectId,
      date: row.ticket.workDate,
      tfrRepName: row.repFirstName && row.repLastName 
        ? `${row.repFirstName} ${row.repLastName}` 
        : "Unknown",
      clientRepName: null,
      weather: null,
      descriptionOfWork: row.ticket.scopeDescription,
      crewSize: null,
      laborSummaryJson: null,
      equipmentUsedJson: null,
      materialsUsedJson: null,
      attachmentsJson: null,
      clientSignatureName: null,
      clientSignatureDate: null,
      createdById: row.ticket.createdById,
      createdAt: row.ticket.createdAt,
      updatedAt: row.ticket.updatedAt,
      ticketNumber: row.ticket.ticketNumber,
      status: row.ticket.status,
      billingStatus: row.ticket.billingStatus,
      grandTotal: row.ticket.grandTotal,
      workTypeName: row.ticket.workTypeName,
      categoryName: row.ticket.categoryName,
      scopeQuantity: row.ticket.scopeQuantity,
      scopeUnit: row.ticket.scopeUnit,
    }));

    res.json(mappedSheets);
  } catch (error) {
    console.error("Get T&M sheets error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/tm-sheets", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      descriptionOfWork: sanitizeText(req.body.descriptionOfWork),
      weather: req.body.weather ? sanitizeShortText(req.body.weather) : undefined,
    };

    const validationResult = insertTMDailySheetSchema.extend({
      createdById: z.string().optional(),
      date: z.coerce.date(),
    }).safeParse({
      ...sanitizedBody,
      createdById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const insertData = { ...validationResult.data, createdById: req.user!.id };

    const jsonFields: Array<{ field: keyof typeof insertData; value: string | null | undefined; name: string }> = [
      { field: "laborSummaryJson", value: insertData.laborSummaryJson, name: "Labor summary JSON" },
      { field: "equipmentUsedJson", value: insertData.equipmentUsedJson, name: "Equipment used JSON" },
      { field: "materialsUsedJson", value: insertData.materialsUsedJson, name: "Materials used JSON" },
      { field: "attachmentsJson", value: insertData.attachmentsJson, name: "Attachments JSON" },
    ];

    for (const fieldDef of jsonFields) {
      if (fieldDef.value !== null && fieldDef.value !== undefined) {
        const jsonCheck = validateJSONField(fieldDef.value, fieldDef.name);
        if (!jsonCheck.valid) {
          res.status(400).json({ error: jsonCheck.error });
          return;
        }
        if (fieldDef.value === "" || jsonCheck.parsed === null) {
          (insertData as any)[fieldDef.field] = null;
        }
      }
    }

    const [existingSheet] = await db
      .select()
      .from(tmDailySheets)
      .where(
        and(
          eq(tmDailySheets.projectId, insertData.projectId),
          sql`DATE(${tmDailySheets.date}) = DATE(${insertData.date})`
        )
      )
      .limit(1);

    if (existingSheet) {
      res.status(409).json({ 
        error: "T&M sheet already exists for this project and date",
        details: "A Time & Materials sheet has already been created for this project on the specified date."
      });
      return;
    }

    const [newSheet] = await db.insert(tmDailySheets).values([insertData]).returning();
    res.status(201).json(newSheet);
  } catch (error: any) {
    console.error("Create T&M sheet error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Estimates Routes
// ====================

router.get("/api/projects/:code/estimates", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const projectEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, project.id))
      .orderBy(desc(estimates.versionNumber));

    res.json(projectEstimates);
  } catch (error) {
    console.error("Get estimates error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:id/estimate", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id;
    
    const projectEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, projectId))
      .orderBy(desc(estimates.versionNumber));
    
    if (projectEstimates.length === 0) {
      res.json({ estimate: null });
      return;
    }
    
    const activeEstimate = projectEstimates.find(e => e.status === "APPROVED") || projectEstimates[0];
    
    const lineItems = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, activeEstimate.id));
    
    const totals = lineItems.reduce((acc, item) => {
      return {
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        laborHours: acc.laborHours + Number(item.laborHours || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      };
    }, {
      materialCost: 0,
      laborCost: 0,
      laborHours: 0,
      equipmentCost: 0,
      consumablesCost: 0,
      subcontractCost: 0,
      overheadAllocation: 0,
      profitAllocation: 0,
      totalCost: 0,
    });
    
    res.json({
      estimate: {
        ...activeEstimate,
        lineItems,
        totals,
      }
    });
  } catch (error) {
    console.error("Get project estimate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:id/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id;
    
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const existingEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, projectId))
      .limit(1);
    
    if (existingEstimates.length > 0) {
      const estimate = existingEstimates[0];
      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));
      
      const totals = lineItems.reduce((acc, item) => ({
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        laborHours: acc.laborHours + Number(item.laborHours || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      }), {
        materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
        consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
        profitAllocation: 0, totalCost: 0,
      });
      
      res.json({ estimate: { ...estimate, lineItems, totals } });
      return;
    }
    
    const [newEstimate] = await db.insert(estimates).values({
      projectId,
      createdById: req.user!.id,
      status: "DRAFT",
      versionNumber: 1,
    }).returning();
    
    res.status(201).json({
      estimate: {
        ...newEstimate,
        lineItems: [],
        totals: {
          materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
          consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
          profitAllocation: 0, totalCost: 0,
        }
      }
    });
  } catch (error) {
    console.error("Create project estimate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/estimates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertEstimateSchema.extend({
      createdById: z.string().optional(),
    }).safeParse({
      ...req.body,
      createdById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const jsonFields: Array<{ field: keyof typeof validationResult.data; value: string | null | undefined; name: string }> = [
      { field: "altPricesJson", value: validationResult.data.altPricesJson, name: "Alternative prices JSON" },
      { field: "costBreakdownJson", value: validationResult.data.costBreakdownJson, name: "Cost breakdown JSON" },
    ];

    for (const fieldDef of jsonFields) {
      if (fieldDef.value !== null && fieldDef.value !== undefined) {
        const jsonCheck = validateJSONField(fieldDef.value, fieldDef.name);
        if (!jsonCheck.valid) {
          res.status(400).json({ error: jsonCheck.error });
          return;
        }
        if (fieldDef.value === "" || jsonCheck.parsed === null) {
          (validationResult.data as any)[fieldDef.field] = null;
        }
      }
    }

    const insertData = { ...validationResult.data, createdById: req.user!.id };
    const [newEstimate] = await db.insert(estimates).values([insertData]).returning();
    res.status(201).json(newEstimate);
  } catch (error: any) {
    console.error("Create estimate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Procurement Routes
// ====================

router.get("/api/projects/:code/procurement", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const items = await db
      .select()
      .from(procurementItems)
      .where(eq(procurementItems.projectId, project.id));

    res.json(items);
  } catch (error) {
    console.error("Get procurement items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/procurement", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertProcurementItemSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const data = validationResult.data;

    const [project] = await db.select().from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [newItem] = await db.insert(procurementItems).values(data).returning();
    res.status(201).json(newItem);
  } catch (error: any) {
    console.error("Create procurement item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateProcurementSchema = insertProcurementItemSchema.omit({ projectId: true }).partial();

router.patch("/api/procurement/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const validationResult = updateProcurementSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [existing] = await db.select().from(procurementItems).where(eq(procurementItems.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Procurement item not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project || !verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedItem] = await db
      .update(procurementItems)
      .set(updateData)
      .where(eq(procurementItems.id, req.params.id))
      .returning();

    res.json(updatedItem);
  } catch (error: any) {
    console.error("Update procurement item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/procurement/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [existing] = await db.select().from(procurementItems).where(eq(procurementItems.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Procurement item not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project || !verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    await db.delete(procurementItems).where(eq(procurementItems.id, req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete procurement item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Pending Quotes Routes (for quotes transferred from bids but not yet selected)
// ====================

router.get("/api/projects/:code/pending-quotes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const pendingSubQuotes = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(and(
        eq(bidSubcontractorQuotes.projectId, project.id),
        eq(bidSubcontractorQuotes.isSelected, false)
      ))
      .orderBy(desc(bidSubcontractorQuotes.createdAt));

    const pendingMatQuotes = await db
      .select()
      .from(bidMaterialQuotes)
      .where(and(
        eq(bidMaterialQuotes.projectId, project.id),
        eq(bidMaterialQuotes.isSelected, false)
      ))
      .orderBy(desc(bidMaterialQuotes.createdAt));

    res.json({
      subcontractorQuotes: pendingSubQuotes,
      materialQuotes: pendingMatQuotes,
    });
  } catch (error) {
    console.error("Get pending quotes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/pending-quotes/subcontractor/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [quote] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(and(
        eq(bidSubcontractorQuotes.id, req.params.quoteId),
        eq(bidSubcontractorQuotes.projectId, project.id),
        eq(bidSubcontractorQuotes.isSelected, false)
      ))
      .limit(1);

    if (!quote) {
      res.status(404).json({ error: "Pending quote not found" });
      return;
    }

    let subcontractor;
    if (quote.contactEmail || quote.contactPhone) {
      const { or, and: andFn } = await import("drizzle-orm");
      const contactConditions = [];
      if (quote.contactEmail) {
        contactConditions.push(eq(subcontractors.email, quote.contactEmail));
      }
      if (quote.contactPhone) {
        contactConditions.push(eq(subcontractors.phone, quote.contactPhone));
      }
      
      subcontractor = await db.query.subcontractors.findFirst({
        where: andFn(
          eq(subcontractors.companyName, quote.subcontractorName),
          or(...contactConditions)
        ),
      });
    }
    
    if (!subcontractor) {
      subcontractor = await db.query.subcontractors.findFirst({
        where: eq(subcontractors.companyName, quote.subcontractorName),
      });
    }

    if (!subcontractor) {
      [subcontractor] = await db.insert(subcontractors).values({
        companyName: quote.subcontractorName,
        contactName: quote.contactName || null,
        email: quote.contactEmail || null,
        phone: quote.contactPhone || null,
        notes: quote.notes || null,
        isActive: true,
      }).returning();
    }

    const existingContracts = await db
      .select()
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.projectId, project.id));

    const contractNumber = `SC-${project.code}-${String(existingContracts.length + 1).padStart(3, '0')}`;
    const paymentTerms = quote.leadTime ? `Lead Time: ${quote.leadTime}`.substring(0, 500) : null;
    
    const notesParts: string[] = [];
    if (quote.estimatedCompletionTime) notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
    if (quote.notes) notesParts.push(quote.notes);
    if (quote.fileUrl) {
      const sanitizedFileName = (quote.fileName || 'Document').replace(/[\r\n]/g, ' ').trim();
      notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
    }
    
    const notes = notesParts.length > 0 ? notesParts.join('\n').substring(0, 1000) : null;
    
    const [newContract] = await db.insert(subcontractorContracts).values({
      subcontractorId: subcontractor.id,
      projectId: project.id,
      contractNumber,
      scopeOfWork: quote.scopeOfWork,
      contractAmount: quote.quoteAmount,
      status: "PENDING",
      paymentTerms,
      notes,
      createdById: req.user!.id,
    }).returning();

    await db
      .update(bidSubcontractorQuotes)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, quote.id));

    res.json({ 
      success: true, 
      contract: newContract,
      message: `Subcontractor contract created: ${contractNumber}`
    });
  } catch (error) {
    console.error("Select pending subcontractor quote error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/pending-quotes/material/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [quote] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(and(
        eq(bidMaterialQuotes.id, req.params.quoteId),
        eq(bidMaterialQuotes.projectId, project.id),
        eq(bidMaterialQuotes.isSelected, false)
      ))
      .limit(1);

    if (!quote) {
      res.status(404).json({ error: "Pending quote not found" });
      return;
    }

    let fullDescription = quote.materialName;
    if (quote.specs) fullDescription += ` - ${quote.specs}`;
    if (quote.description) fullDescription += `\n${quote.description}`;
    
    const additionalInfo: string[] = [];
    if (quote.leadTime) additionalInfo.push(`Lead Time: ${quote.leadTime}`);
    if (quote.supplierContact) additionalInfo.push(`Supplier Contact: ${quote.supplierContact}`);
    
    if (additionalInfo.length > 0) {
      fullDescription += `\n\n[Quote Details]\n${additionalInfo.join('\n')}`;
    }
    
    const [newItem] = await db.insert(procurementItems).values({
      projectId: project.id,
      description: fullDescription,
      vendor: quote.supplierName || null,
      quantity: "1",
      unit: "LOT",
      unitCost: quote.cost,
      status: "PLANNED",
      neededByDate: null,
    }).returning();

    await db
      .update(bidMaterialQuotes)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(bidMaterialQuotes.id, quote.id));

    res.json({ 
      success: true, 
      procurementItem: newItem,
      message: `Procurement item created: ${quote.materialName}`
    });
  } catch (error) {
    console.error("Select pending material quote error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
