import { Router } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks, insertAISettingsSchema, users, aiTakeoffAnalyses, projectSchedules, projectScheduleTasks, jobsiteAnalysisBatches, jobsiteAnalysisPhotos, vendorPricebooks, vendorPricebookItems, aiCoDrafts, organizations, projects, takeoffSheets, changeOrders, organizationSowItems, projectInspections, projectDelays, scopeItems, media, aiInsights, aiGanttRecommendations, aiVendorComparisons, equipment as equipmentTable, tradeTemplates, organizationCalculators, organizationWorkTypes, tradeTypeEnum, masterSowItems, hustlerOrganizations, unitsOfMeasure } from "@shared/schema";
import { logInfo, logError, logWarn } from "./utils/logger";
import { eq, desc, and, sql, gte, asc, isNotNull } from "drizzle-orm";
import {
  runAIAnalysis,
  getLatestAIRun,
  getAIRunById,
  getTasksForRun,
  getTasksForRole,
  updateTaskStatus,
} from "./ai/orchestrator";
import { sensitiveLimiter } from "./rateLimiter";
import { logUpdate, logCreate } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { fromZodError } from "zod-validation-error";
import { type AuthRequest, requireAuth, requireRole, requireFeaturePermission, requireAnyFeaturePermission } from "./auth";
import { openai, AI_MODEL_GPT4O, researchCustomTrade, TradeResearchResult } from "./ai/openaiClient";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { AI_ASSISTANT_SYSTEM_PROMPT, getPageContext } from "./ai/assistantPrompt";
import { z } from "zod";
import { governedAiCall, getAiAuditLog, getOrgLimitsWithUsage, getCostBreakdownByActionType } from "./services/aiGovernance";
import { getTotalStepsForRole, getWalkthroughStep, generateWalkthroughPrompt, getPersonalizedWalkthrough, personalizeContent, getWalkthroughForRole } from "./ai/walkthroughContent";
import {
  analyzeSchedulingModule,
  analyzeDelaysModule,
  analyzeCostsModule,
  analyzeEquipmentModule,
  analyzeVendorPricingModule,
  analyzeProjectHealthModule,
  runComprehensiveAnalysis,
  saveAnalysisResults,
} from "./ai/moduleAnalyzers";
import { getOrgId, parsePagination } from "./utils/routeHelpers";
import { seedScopeStandardizationForTrade } from "./seedTradeExpansion";
import { getTrades, getTradeCategories, getTradesByCategory, getMaterialGroups, getMaterialsByGroup } from "./data/onboarding";

const router = Router();

// ========================================
// Routes from aiRoutes.ts
// ========================================

router.use("/ai-settings", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai-pm", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/cfo", requireAuth, requireAnyFeaturePermission('canUseAiFeatures', 'canAccessFinancials'));
router.use("/ai-analyze", requireAuth, requireFeaturePermission('canUseAiFeatures'));
router.use("/ai/assistant", requireAuth, requireFeaturePermission('canUseAiFeatures'));

router.get("/ai-settings", requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    let [settings] = await db.select().from(aiSettings).limit(1);

    if (!settings) {
      [settings] = await db.insert(aiSettings).values({}).returning();
    }

    res.json(settings);
  } catch (error: any) {
    console.error("Error fetching AI settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/ai-settings", sensitiveLimiter, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const sanitizedInput = {
      ...req.body,
      dailyRunTime: req.body.dailyRunTime ? sanitizeShortText(req.body.dailyRunTime) : undefined,
      modelName: req.body.modelName ? sanitizeShortText(req.body.modelName) : undefined,
    };

    const validationResult = insertAISettingsSchema.partial().safeParse(sanitizedInput);
    
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid AI settings data", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const [existingSettings] = await db.select().from(aiSettings).limit(1);

    let updated;
    if (existingSettings) {
      [updated] = await db
        .update(aiSettings)
        .set({ ...validationResult.data, updatedAt: new Date() })
        .where(eq(aiSettings.id, existingSettings.id))
        .returning();
    } else {
      [updated] = await db.insert(aiSettings).values(validationResult.data).returning();
    }

    await logUpdate(
      req.user.id,
      'AI_SETTINGS',
      updated.id,
      existingSettings,
      updated,
      req
    );

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating AI settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai-pm/run", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (orgId) {
      const { checkOrgLimits } = await import("./services/aiGovernance");
      const limitCheck = await checkOrgLimits(orgId);
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: "AI rate limit reached", reason: limitCheck.reason });
      }
    }

    const runId = await runAIAnalysis(req.user!.id, orgId);

    if (orgId) {
      const { db: dbConn } = await import("./db");
      const { aiActionAudit } = await import("@shared/schema");
      try {
        await dbConn.insert(aiActionAudit).values({
          organizationId: orgId,
          actorUserId: req.user!.id,
          actionType: "ai_pm_analysis",
          model: "gpt-4o",
          tokensIn: 0,
          tokensOut: 0,
          costEstimate: "0",
          inputRefs: { runId, triggeredBy: req.user!.id },
          outputRefs: { runId },
          rationale: null,
          approvalRequired: false,
          approvalStatus: null,
          durationMs: 0,
        });
      } catch (_) {}
    }

    await logCreate(
      req.user.id,
      'AI_RUN',
      runId,
      { runId, triggeredBy: req.user.id },
      req
    );

    res.json({ runId, status: 'completed' });
  } catch (error: any) {
    console.error("Error running AI analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/latest-run", requireAuth, async (req: AuthRequest, res) => {
  try {
    const run = await getLatestAIRun();
    
    if (!run) {
      return res.json(null);
    }

    const parsedRun = {
      ...run,
      snapshotData: run.snapshotData ? JSON.parse(run.snapshotData) : null,
      profitabilityData: run.profitabilityData ? JSON.parse(run.profitabilityData) : null,
      aiResponse: run.aiResponse ? JSON.parse(run.aiResponse) : null,
    };

    res.json(parsedRun);
  } catch (error: any) {
    console.error("Error fetching latest AI run:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/runs/:runId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const run = await getAIRunById(req.params.runId);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const parsedRun = {
      ...run,
      snapshotData: run.snapshotData ? JSON.parse(run.snapshotData) : null,
      profitabilityData: run.profitabilityData ? JSON.parse(run.profitabilityData) : null,
      aiResponse: run.aiResponse ? JSON.parse(run.aiResponse) : null,
    };

    res.json(parsedRun);
  } catch (error: any) {
    console.error("Error fetching AI run:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { role, status } = req.query;

    const userRole = role ? String(role) : req.user.role;
    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(userRole, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/tasks/role/:role", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { role } = req.params;
    const { status } = req.query;

    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(role, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/ai-pm/tasks/:taskId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;

    if (!status || !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const [existingTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    if (!existingTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    await updateTaskStatus(req.params.taskId, status, req.user.id);

    const [updatedTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    await logUpdate(
      req.user.id,
      'AI_TASK',
      req.params.taskId,
      existingTask,
      { status },
      req
    );

    res.json(updatedTask);
  } catch (error: any) {
    console.error("Error updating AI task:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/profitability", requireAuth, async (req: AuthRequest, res) => {
  try {
    const latestRun = await getLatestAIRun();

    if (latestRun?.profitabilityData) {
      const profitabilityData = JSON.parse(latestRun.profitabilityData);
      return res.json(profitabilityData);
    }

    const { calculateAllProjectsProfitability } = await import("./ai/profitabilityEngine");
    const liveData = await calculateAllProjectsProfitability();
    res.json(liveData);
  } catch (error: any) {
    console.error("Error fetching profitability data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/equipment-metrics", requireAuth, async (req: AuthRequest, res) => {
  try {
    const latestRun = await getLatestAIRun();

    if (!latestRun || !latestRun.snapshotData) {
      const allEquipment = await db.select().from(equipmentTable).where(eq(equipmentTable.organizationId, req.user.organizationId)).limit(500);
      const totalCount = allEquipment.length;
      const assignedCount = allEquipment.filter((e: any) => e.status === 'ASSIGNED').length;

      return res.json({
        summary: {
          total_owned_equipment: totalCount,
          active_rentals: assignedCount,
          total_rental_cost_mtd: 0,
          underutilized_count: 0,
        },
        rental_vs_owned: [],
        frequently_rented: [],
        underutilized: [],
        project_equipment_costs: [],
        last_updated: null,
      });
    }

    const snapshotData = JSON.parse(latestRun.snapshotData);
    const equipment = snapshotData.equipment || {};
    const roiAnalysis = equipment.roi_analysis || {};

    const fleetSize = equipment.fleet?.length || 0;
    const activeRentals = equipment.active_rentals?.length || 0;
    const rentalHistory = equipment.rental_usage_history || [];
    
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdRentals = rentalHistory.filter((r: any) => {
      const startDate = r.actual_start_date ? new Date(r.actual_start_date) : null;
      return startDate && startDate >= monthStart;
    });
    const totalRentalCostMtd = mtdRentals.reduce((sum: number, r: any) => 
      sum + (r.actual_total_cost || r.quoted_total_cost || 0), 0
    );

    const underutilizedCount = roiAnalysis.underutilized_owned?.length || 0;

    const projectsWithEquipment = equipment.projects_with_equipment || [];
    const projectCosts = projectsWithEquipment.map((p: any) => {
      const planned = Number(p.planned_cost) || 0;
      const actual = Number(p.actual_cost) || 0;
      const total = actual > 0 ? actual : planned;
      return {
        project_code: p.project_code,
        project_name: p.project_name,
        planned_cost: planned,
        actual_cost: actual,
        total_cost: total,
      };
    });

    projectCosts.sort((a: any, b: any) => b.total_cost - a.total_cost);

    res.json({
      summary: {
        total_owned_equipment: fleetSize,
        active_rentals: activeRentals,
        total_rental_cost_mtd: Math.round(totalRentalCostMtd * 100) / 100,
        underutilized_count: underutilizedCount,
      },
      rental_vs_owned: roiAnalysis.rental_vs_owned_comparison || [],
      frequently_rented: roiAnalysis.frequently_rented_equipment || [],
      underutilized: roiAnalysis.underutilized_owned || [],
      project_equipment_costs: projectCosts.slice(0, 10),
      last_updated: latestRun.createdAt,
    });
  } catch (error: any) {
    console.error("Error fetching equipment metrics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/forecasting", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { calculateAllProjectsProfitability } = await import("./ai/profitabilityEngine");
    const { projects } = await import("@shared/schema");
    const allProjects = await db.select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId }).from(projects).where(eq(projects.gcOrganizationId, orgId));
    const allProfitability = await calculateAllProjectsProfitability();
    const orgProjectCodes = new Set(allProjects.map(p => p.code));
    const profitabilityData = allProfitability.filter(p => orgProjectCodes.has(p.project_code));

    const portfolioFFC = profitabilityData.reduce((sum, p) => sum + p.forecast_final_cost, 0);
    const portfolioBudget = profitabilityData.reduce((sum, p) => sum + p.adjusted_budget, 0);
    const portfolioCommitted = profitabilityData.reduce((sum, p) => sum + p.committed_cost, 0);
    const portfolioActual = profitabilityData.reduce((sum, p) => sum + p.total_actual_cost, 0);
    const portfolioVariance = portfolioBudget - portfolioFFC;

    const projectsByOverrun = [...profitabilityData]
      .map(p => ({
        project_code: p.project_code,
        project_name: p.project_name,
        budget: p.adjusted_budget,
        committed: p.committed_cost,
        actual: p.total_actual_cost,
        ffc: p.forecast_final_cost,
        variance: p.adjusted_budget - p.forecast_final_cost,
        variance_percent: p.adjusted_budget > 0 ? ((p.adjusted_budget - p.forecast_final_cost) / p.adjusted_budget) * 100 : 0,
        status: p.status,
        cost_prediction: p.cost_prediction,
      }))
      .sort((a, b) => a.variance - b.variance);

    const { budgetAlerts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const activeAlerts = await db.select().from(budgetAlerts).where(eq(budgetAlerts.isDismissed, false)).limit(200);

    const projectIdMap = new Map<string, typeof profitabilityData[0]>();
    for (const p of profitabilityData) {
      const projRow = allProjects.find(pr => pr.code === p.project_code);
      if (projRow) projectIdMap.set(projRow.id, p);
    }

    const alertsWithProject = activeAlerts
      .filter(a => {
        const proj = projectIdMap.get(a.projectId);
        return proj !== undefined;
      })
      .map(a => {
        const proj = projectIdMap.get(a.projectId);
        return {
          id: a.id,
          projectId: a.projectId,
          projectCode: proj?.project_code || "",
          projectName: proj?.project_name || "",
          costCode: a.costCode,
          alertLevel: a.alertLevel,
          thresholdPercent: Number(a.thresholdPercent),
          currentPercent: Number(a.currentPercent),
          budgetAmount: Number(a.budgetAmount),
          actualAmount: Number(a.actualAmount),
          createdAt: a.createdAt,
        };
      });

    const earlyWarnings = profitabilityData
      .filter(p => p.cost_prediction.early_warning || p.cost_prediction.burn_rate_trend === 'INCREASING')
      .map(p => ({
        project_code: p.project_code,
        project_name: p.project_name,
        warning_message: p.cost_prediction.warning_message,
        predicted_overrun: p.cost_prediction.predicted_overrun,
        confidence_score: p.cost_prediction.confidence_score,
        weeks_until_overrun: p.cost_prediction.weeks_until_overrun,
        burn_rate_trend: p.cost_prediction.burn_rate_trend,
        weekly_burn_rate: p.cost_prediction.weekly_burn_rate,
      }))
      .sort((a, b) => b.predicted_overrun - a.predicted_overrun);

    res.json({
      summary: {
        portfolio_budget: Math.round(portfolioBudget * 100) / 100,
        portfolio_ffc: Math.round(portfolioFFC * 100) / 100,
        portfolio_committed: Math.round(portfolioCommitted * 100) / 100,
        portfolio_actual: Math.round(portfolioActual * 100) / 100,
        portfolio_variance: Math.round(portfolioVariance * 100) / 100,
        project_count: profitabilityData.length,
        at_risk_count: profitabilityData.filter(p => p.status === 'MAJOR_RISK').length,
        early_warning_count: earlyWarnings.length,
      },
      projects: projectsByOverrun,
      alerts: alertsWithProject,
      early_warnings: earlyWarnings,
    });
  } catch (error: any) {
    console.error("Error fetching CFO forecasting data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/scurve-data", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { projects: projectsTable, timeEntries, receipts, subcontractorPayments, subcontractorContracts, budgetLineItems } = await import("@shared/schema");
    const { eq, and: andOp, sql, inArray } = await import("drizzle-orm");

    const orgProjects = await db.select({
      id: projectsTable.id,
      budget: projectsTable.budget,
      contractAmount: projectsTable.contractAmount,
      startDate: projectsTable.startDate,
      endDate: projectsTable.endDate,
    }).from(projectsTable).where(andOp(
      eq(projectsTable.gcOrganizationId, orgId),
      sql`${projectsTable.status} IN ('ACTIVE', 'PLANNING')`
    )).limit(100);

    if (orgProjects.length === 0) return res.json({ months: [] });

    const projectIds = orgProjects.map(p => p.id);

    const totalBudget = orgProjects.reduce((sum, p) => sum + Number(p.contractAmount || p.budget || 0), 0);

    let earliestStart: Date | null = null;
    let latestEnd: Date | null = null;
    for (const p of orgProjects) {
      if (p.startDate) {
        const s = new Date(p.startDate);
        if (!earliestStart || s < earliestStart) earliestStart = s;
      }
      if (p.endDate) {
        const e = new Date(p.endDate);
        if (!latestEnd || e > latestEnd) latestEnd = e;
      }
    }

    if (!earliestStart) earliestStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    if (!latestEnd) latestEnd = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    const laborByMonth = await db.select({
      month: sql<string>`TO_CHAR(${timeEntries.date}, 'YYYY-MM')`.as("month"),
      total: sql<number>`COALESCE(SUM(
        (COALESCE(${timeEntries.hoursRegular}, 0) + COALESCE(${timeEntries.hoursOvertime}, 0) * 1.5) * 
        COALESCE(${timeEntries.payRate}, 45)
      ), 0)`.as("total"),
    }).from(timeEntries)
      .where(andOp(
        inArray(timeEntries.projectId, projectIds),
        eq(timeEntries.approvalStatus, "APPROVED")
      ))
      .groupBy(sql`TO_CHAR(${timeEntries.date}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${timeEntries.date}, 'YYYY-MM')`);

    const receiptsByMonth = await db.select({
      month: sql<string>`TO_CHAR(${receipts.date}, 'YYYY-MM')`.as("month"),
      total: sql<number>`COALESCE(SUM(${receipts.amount}), 0)`.as("total"),
    }).from(receipts)
      .where(inArray(receipts.projectId, projectIds))
      .groupBy(sql`TO_CHAR(${receipts.date}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${receipts.date}, 'YYYY-MM')`);

    const contractIds = await db.select({ id: subcontractorContracts.id })
      .from(subcontractorContracts)
      .where(inArray(subcontractorContracts.projectId, projectIds));
    
    let subPaymentsByMonth: { month: string; total: number }[] = [];
    if (contractIds.length > 0) {
      subPaymentsByMonth = await db.select({
        month: sql<string>`TO_CHAR(${subcontractorPayments.paymentDate}, 'YYYY-MM')`.as("month"),
        total: sql<number>`COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("total"),
      }).from(subcontractorPayments)
        .where(inArray(subcontractorPayments.contractId, contractIds.map(c => c.id)))
        .groupBy(sql`TO_CHAR(${subcontractorPayments.paymentDate}, 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(${subcontractorPayments.paymentDate}, 'YYYY-MM')`);
    }

    const actualByMonth = new Map<string, number>();
    for (const row of laborByMonth) { actualByMonth.set(row.month, (actualByMonth.get(row.month) || 0) + Number(row.total)); }
    for (const row of receiptsByMonth) { actualByMonth.set(row.month, (actualByMonth.get(row.month) || 0) + Number(row.total)); }
    for (const row of subPaymentsByMonth) { actualByMonth.set(row.month, (actualByMonth.get(row.month) || 0) + Number(row.total)); }

    const startMs = earliestStart.getTime();
    const endMs = latestEnd.getTime();
    const totalDuration = endMs - startMs;

    const allMonths: string[] = [];
    const cursor = new Date(earliestStart);
    cursor.setDate(1);
    const endCursor = new Date(Math.max(endMs, Date.now() + 90 * 24 * 60 * 60 * 1000));
    while (cursor <= endCursor) {
      allMonths.push(cursor.toISOString().slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    let cumulativeActual = 0;
    const result = allMonths.map(month => {
      const monthDate = new Date(month + "-15");
      const t = totalDuration > 0 ? Math.max(0, Math.min(1, (monthDate.getTime() - startMs) / totalDuration)) : 0;
      const sCurve = 1 / (1 + Math.exp(-10 * (t - 0.5)));
      const minS = 1 / (1 + Math.exp(5));
      const maxS = 1 / (1 + Math.exp(-5));
      const norm = (sCurve - minS) / (maxS - minS);
      const plannedCumulative = Math.round(totalBudget * Math.max(0, Math.min(1, norm)));

      const monthActual = actualByMonth.get(month) || 0;
      cumulativeActual += monthActual;

      const isFuture = monthDate > new Date();

      return {
        month: new Date(month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        planned: plannedCumulative,
        actual: !isFuture ? Math.round(cumulativeActual) : null,
        forecast: isFuture ? Math.round(cumulativeActual) : null,
      };
    });

    res.json({ months: result });
  } catch (error: any) {
    console.error("Error fetching S-curve data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/cfo/budget-alerts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { budgetAlerts, projects: projectsTable } = await import("@shared/schema");
    const { eq, and: andOp } = await import("drizzle-orm");

    const activeAlerts = await db.select({
      alert: budgetAlerts,
      projectCode: projectsTable.code,
      projectName: projectsTable.name,
    }).from(budgetAlerts)
      .innerJoin(projectsTable, eq(budgetAlerts.projectId, projectsTable.id))
      .where(andOp(eq(budgetAlerts.isDismissed, false), eq(projectsTable.gcOrganizationId, orgId)))
      .limit(200);

    res.json(activeAlerts.map(r => ({
      ...r.alert,
      thresholdPercent: Number(r.alert.thresholdPercent),
      currentPercent: Number(r.alert.currentPercent),
      budgetAmount: Number(r.alert.budgetAmount),
      actualAmount: Number(r.alert.actualAmount),
      projectCode: r.projectCode,
      projectName: r.projectName,
    })));
  } catch (error: any) {
    console.error("Error fetching budget alerts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai-pm/runs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const runs = await db
      .select()
      .from(aiRuns)
      .orderBy(desc(aiRuns.createdAt))
      .limit(50);

    res.json(runs);
  } catch (error: any) {
    console.error("Error fetching AI runs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai/assistant/chat", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { message, currentPath, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Message is required" });
    }

    const [userStatus] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      role: users.role,
      firstName: users.firstName,
    }).from(users).where(eq(users.id, req.user.id));

    const isInWalkthrough = userStatus && !userStatus.walkthroughCompleted && userStatus.walkthroughStep > 0;

    const pageContext = getPageContext(currentPath || '/dashboard');
    const userRole = req.user.role;
    const userName = `${req.user.firstName} ${req.user.lastName}`;
    const userFirstName = userStatus?.firstName || req.user.firstName || 'there';

    let systemPrompt: string;

    if (isInWalkthrough) {
      const walkthroughPrompt = generateWalkthroughPrompt(userStatus.role, userStatus.walkthroughStep, userFirstName);
      const totalSteps = getTotalStepsForRole(userStatus.role);
      
      systemPrompt = `${walkthroughPrompt}

## Current Context
- User: ${userName} (call them "${userFirstName}")
- Role: ${userRole}
- ${pageContext}
- Walkthrough Progress: Step ${userStatus.walkthroughStep} of ${totalSteps}

When ${userFirstName} says they've completed the current step or wants to continue, congratulate them with enthusiasm and remind them to click "Next Step" to proceed. Use their first name naturally to keep it personal. Be supportive and encouraging throughout their learning journey!`;
    } else {
      systemPrompt = `${AI_ASSISTANT_SYSTEM_PROMPT}

## Current Context
- User: ${userName}
- Role: ${userRole}
- ${pageContext}

Tailor your responses to the user's role and current location in the app.`;
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    let completion: any;
    let response: string | null | undefined;

    if (req.user.organizationId) {
      let capturedCompletion: any;
      const governed = await governedAiCall({
        orgId: req.user.organizationId,
        userId: req.user.id,
        actionType: "assistant_chat",
        fn: async () => {
          const c = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.7,
            max_tokens: 1000,
          });
          capturedCompletion = c;
          const r = c.choices[0]?.message?.content;
          return { result: r, completion: c };
        },
      });

      if (governed.blocked) {
        return res.status(429).json({ error: governed.reason || "AI usage limit reached" });
      }

      response = governed.result;
      completion = capturedCompletion;
    } else {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });
      response = completion.choices[0]?.message?.content;
    }

    if (!response) {
      throw new Error('No response from AI');
    }
    res.json({ 
      response,
      isWalkthroughMode: isInWalkthrough,
      walkthroughStep: isInWalkthrough ? userStatus.walkthroughStep : null,
      usage: {
        promptTokens: completion?.usage?.prompt_tokens,
        completionTokens: completion?.usage?.completion_tokens,
      }
    });
  } catch (error: any) {
    console.error("AI Assistant chat error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to get AI response. Please try again." });
  }
});

const aiAnalysisSchema = z.object({
  module: z.enum(['SCHEDULING', 'DELAYS', 'COSTS', 'EQUIPMENT', 'VENDOR_PRICING', 'PROJECT_HEALTH', 'ALL']).optional(),
  projectId: z.string().optional(),
  saveResults: z.boolean().optional().default(true),
});

router.post("/ai-analyze", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const validationResult = aiAnalysisSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid request", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { module, projectId, saveResults } = validationResult.data;
    const organizationId = req.user.organizationId;

    console.log(`[AI Analysis] User ${req.user.email} triggered ${module || 'ALL'} analysis`);

    let result;
    
    if (module === 'ALL' || !module) {
      result = await runComprehensiveAnalysis(organizationId || undefined, projectId);
    } else {
      switch (module) {
        case 'SCHEDULING':
          result = await analyzeSchedulingModule(projectId, organizationId || undefined);
          break;
        case 'DELAYS':
          result = await analyzeDelaysModule(projectId, organizationId || undefined);
          break;
        case 'COSTS':
          result = await analyzeCostsModule(projectId, organizationId || undefined);
          break;
        case 'EQUIPMENT':
          result = await analyzeEquipmentModule(organizationId || undefined);
          break;
        case 'VENDOR_PRICING':
          result = await analyzeVendorPricingModule(organizationId || undefined);
          break;
        case 'PROJECT_HEALTH':
          if (!projectId) {
            return res.status(400).json({ error: "Project ID required for project health analysis" });
          }
          result = await analyzeProjectHealthModule(projectId);
          break;
        default:
          return res.status(400).json({ error: "Invalid module" });
      }
    }

    let savedInsightIds: string[] = [];
    if (saveResults && result.insights.length > 0) {
      savedInsightIds = await saveAnalysisResults(
        result,
        organizationId || undefined,
        projectId,
        req.user.id
      );
    }

    await logCreate(req.user.id, 'AI_ANALYSIS', savedInsightIds[0] || 'batch', { module: module || 'ALL', insightCount: result.insights.length, savedInsightIds }, req);

    res.json({
      success: true,
      module: module || 'ALL',
      insights: result.insights,
      ganttRecommendations: result.ganttRecommendations,
      vendorComparisons: result.vendorComparisons,
      savedInsightIds,
    });
  } catch (error: any) {
    console.error("AI analysis error:", error);
    res.status(500).json({ error: "Failed to run AI analysis" });
  }
});

// ========================================
// Routes from aiFeatureRoutes.ts
// ========================================

/**
 * AI Feature Routes for 7 Major AI-Enhanced Features
 * Features A-G: Auto-Takeoff, Scheduling, Jobsite Analysis, Vendor Pricing,
 * Client Portal, Change Order Generator, Mobile/Offline
 */

// Trade-specific configurations for AI features
const TRADE_DETECTION_PROMPTS: Record<string, string> = {
  ROOFING: "Focus on: roof planes, ridges, valleys, penetrations, drip edge, gutters, shingles, underlayment. Measure in squares (SQ), linear feet (LF), and counts (EA).",
  ELECTRICAL: "Focus on: panels, outlets, switches, light fixtures, conduit runs, wire pulls. Measure in counts (EA), linear feet (LF), circuits.",
  PLUMBING: "Focus on: fixtures, pipe runs, drains, water heaters, valves. Measure in counts (EA), linear feet (LF), fixture units (FU).",
  HVAC: "Focus on: ductwork, registers, equipment, returns, diffusers. Measure in square feet (SF), linear feet (LF), tonnage (TON), CFM.",
  CONCRETE: "Focus on: slabs, footings, walls, columns, rebar grids, form work. Measure in cubic yards (CY), square feet (SF), linear feet (LF), tons (TON).",
  CARPENTRY: "Focus on: framing members, sheathing, trim, doors, windows, blocking. Measure in linear feet (LF), board feet (BF), square feet (SF), counts (EA).",
  MASONRY: "Focus on: block/brick walls, lintels, reinforcement, mortar joints. Measure in square feet (SF), counts (EA), linear feet (LF).",
  PAINTING: "Focus on: wall areas, ceiling areas, trim linear, doors, windows. Measure in square feet (SF), linear feet (LF).",
  FLOORING: "Focus on: floor areas, transitions, base linear, underlayment. Measure in square feet (SF), square yards (SY), linear feet (LF).",
  DRYWALL: "Focus on: wall/ceiling areas, corner bead, joint linear, finishing. Measure in square feet (SF), linear feet (LF), counts (EA).",
  GENERAL_CONTRACTOR: "Comprehensive analysis across all trades. Identify work by trade type and measure using appropriate units for each trade.",
};

// ============================================
// FEATURE A: AI AUTO-TAKEOFF ROUTES
// ============================================

const aiTakeoffAnalyzeSchema = z.object({
  projectId: z.string().optional(),
  bidId: z.string().optional(),
  takeoffSheetId: z.string().optional(),
  tradeType: z.string().optional(),
  analysisMode: z.enum(["QUICK", "DETAILED"]).default("QUICK"),
  focusAreas: z.array(z.string()).optional(),
});

// POST /api/ai-features/takeoff/analyze - Trigger AI analysis
router.post("/ai-features/takeoff/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = aiTakeoffAnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, bidId, takeoffSheetId, tradeType, analysisMode, focusAreas } = parsed.data;

    if (!projectId && !bidId) {
      return res.status(400).json({ error: "Either projectId or bidId is required" });
    }

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL" and other custom types should fall back to GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = tradeType || (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    // Create analysis record
    const [analysis] = await db.insert(aiTakeoffAnalyses).values({
      organizationId,
      projectId: projectId || null,
      bidId: bidId || null,
      takeoffSheetId: takeoffSheetId || null,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisMode: analysisMode as any,
      createdByUserId: userId,
    }).returning();

    // In a production environment, this would queue a background job
    // For now, we'll process synchronously with a mock response
    setTimeout(async () => {
      try {
        await processAiTakeoff(analysis.id, effectiveTradeType, focusAreas);
      } catch (error) {
        console.error("AI Takeoff processing error:", error);
        await db.update(aiTakeoffAnalyses)
          .set({ status: "FAILED", errorMessage: "Processing failed" })
          .where(eq(aiTakeoffAnalyses.id, analysis.id));
      }
    }, 100);

    res.json({
      success: true,
      analysisId: analysis.id,
      status: "QUEUED",
      estimatedTime: analysisMode === "QUICK" ? 30 : 120,
    });
  } catch (error) {
    console.error("AI Takeoff analyze error:", error);
    res.status(500).json({ error: "Failed to start analysis" });
  }
});

// Helper function to process AI takeoff with OpenAI Vision
async function processAiTakeoff(analysisId: string, tradeType: string, focusAreas?: string[]) {
  const startTime = Date.now();
  
  await db.update(aiTakeoffAnalyses)
    .set({ status: "PROCESSING" })
    .where(eq(aiTakeoffAnalyses.id, analysisId));

  try {
    // Get the analysis record to find associated takeoff sheet
    const [analysis] = await db.select()
      .from(aiTakeoffAnalyses)
      .where(eq(aiTakeoffAnalyses.id, analysisId));

    let imageUrl: string | null = null;
    let sheetIndex = 0;
    
    // Try to get image from takeoff sheet if provided
    if (analysis?.takeoffSheetId) {
      const [sheet] = await db.select()
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, analysis.takeoffSheetId));
      if (sheet?.imageUrl) {
        imageUrl = sheet.imageUrl;
      }
      if (sheet) {
        sheetIndex = sheet.sheetIndex || 0;
      }
    }

    if (imageUrl) {
      try {
        let buffer: Buffer | null = null;

        if (imageUrl.startsWith("https://storage.googleapis.com/")) {
          const url = new URL(imageUrl);
          const pathParts = url.pathname.slice(1).split("/");
          const bucketName = pathParts[0];
          const objectName = pathParts.slice(1).join("/");
          const bucket = objectStorageClient.bucket(bucketName);
          const file = bucket.file(objectName);
          [buffer] = await file.download();
        } else if (imageUrl.startsWith("/objects/")) {
          const objectStorageService = new ObjectStorageService();
          const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
          [buffer] = await objectFile.download();
        }

        if (buffer) {
          const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50; // %P (PDF magic bytes)
          
          if (isPdf && sheetIndex >= 0) {
            try {
              const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
              const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
              const pdfDoc = await loadingTask.promise;
              const pageNum = Math.min(sheetIndex + 1, pdfDoc.numPages);
              const page = await pdfDoc.getPage(pageNum);
              
              const scale = 2.0;
              const viewport = page.getViewport({ scale });
              
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };
              const canvas = createCanvas(viewport.width, viewport.height);
              const context = canvas.getContext('2d');
              
              await page.render({ canvasContext: context, viewport, canvas } as any).promise;
              
              const pngBuffer = canvas.toBuffer('image/png') as Buffer;
              const base64Data = pngBuffer.toString("base64");
              imageUrl = `data:image/png;base64,${base64Data}`;
              
              pdfDoc.destroy();
            } catch (pdfRenderError) {
              console.error("PDF page render failed, sending full PDF:", pdfRenderError);
              const base64Data = buffer.toString("base64");
              imageUrl = `data:application/pdf;base64,${base64Data}`;
            }
          } else if (isPdf) {
            const base64Data = buffer.toString("base64");
            imageUrl = `data:application/pdf;base64,${base64Data}`;
          } else {
            const base64Data = buffer.toString("base64");
            imageUrl = `data:image/png;base64,${base64Data}`;
          }
        }
      } catch (downloadError) {
        console.error("Failed to download image for AI takeoff:", downloadError);
        imageUrl = null;
      }
    }

    let detectedItems: any[];
    let metadata: any;
    let aiNotes: string;

    // Use OpenAI Vision if we have an image, otherwise fall back to mock data
    if (imageUrl && openai) {
      try {
        const tradePrompt = TRADE_DETECTION_PROMPTS[tradeType] || TRADE_DETECTION_PROMPTS.GENERAL_CONTRACTOR;
        const focusAreaPrompt = focusAreas?.length ? `Focus especially on: ${focusAreas.join(", ")}. ` : "";
        
        const govResult = await governedAiCall({
          orgId: analysis.organizationId,
          userId: analysis.createdByUserId,
          actionType: "takeoff_analysis",
          inputRefs: { projectId: analysis.projectId },
          fn: async () => {
            const completion = await openai.chat.completions.create({
              model: AI_MODEL_GPT4O,
              messages: [
                {
                  role: "system",
                  content: `You are a construction takeoff specialist analyzing blueprints and construction drawings. 
${tradePrompt}
${focusAreaPrompt}
Analyze the image and extract all measurable quantities for a construction estimate.

Return your analysis as JSON with this exact structure:
{
  "detectedItems": [
    {
      "itemType": "string (e.g., roof_plane, outlet, slab)",
      "description": "string (detailed description)",
      "quantity": number,
      "unit": "string (SQ, SF, LF, EA, CY, etc.)",
      "confidence": number (0-100),
      "notes": "string (optional additional notes)"
    }
  ],
  "metadata": {
    "drawingScale": "string or null",
    "pageSize": "string or null",
    "titleBlock": "string or null",
    "drawingType": "string (plan, elevation, section, detail)"
  },
  "summary": "string (brief summary of what was detected)"
}`
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: imageUrl, detail: "high" }
                    },
                    {
                      type: "text",
                      text: `Analyze page ${sheetIndex + 1} of this construction document for ${tradeType} trade takeoff. Extract all measurable quantities.`
                    }
                  ]
                }
              ],
              max_tokens: 4096,
              temperature: 0.3,
              response_format: { type: "json_object" },
            });
            return { result: completion.choices[0]?.message?.content, completion };
          },
        });

        if (govResult.blocked) {
          throw new Error(govResult.reason || "AI usage limit reached");
        }

        const responseContent = govResult.result || "";
        
        // Parse the JSON response
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          detectedItems = (parsed.detectedItems || []).map((item: any, index: number) => ({
            id: `item-${index + 1}`,
            itemType: item.itemType,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            confidence: item.confidence || 75,
            notes: item.notes,
          }));
          metadata = {
            drawingScale: parsed.metadata?.drawingScale,
            pageSize: parsed.metadata?.pageSize,
            titleBlock: parsed.metadata?.titleBlock,
            drawingType: parsed.metadata?.drawingType,
            tradeType,
            analysisMethod: "OpenAI Vision",
            analysisSource: "openai_vision",
          };
          aiNotes = parsed.summary || `AI Vision detected ${detectedItems.length} items for ${tradeType} trade.`;
        } else {
          throw new Error("Could not parse AI response");
        }
      } catch (visionError) {
        console.error("OpenAI Vision error, falling back to mock data:", visionError);
        const tradeItems = generateTradeSpecificItems(tradeType);
        detectedItems = tradeItems.map((item, index) => ({
          id: `item-${index + 1}`,
          itemType: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          confidence: 70 + Math.floor(Math.random() * 25),
          suggestedSowItem: item.sowItem,
        }));
        metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, analysisMethod: "Fallback (mock)", analysisSource: "demo_fallback" };
        aiNotes = `Fallback: Generated ${detectedItems.length} sample items for ${tradeType} trade.`;
      }
    } else {
      // No image available, use mock data
      const tradeItems = generateTradeSpecificItems(tradeType);
      detectedItems = tradeItems.map((item, index) => ({
        id: `item-${index + 1}`,
        itemType: item.type,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        confidence: 70 + Math.floor(Math.random() * 25),
        suggestedSowItem: item.sowItem,
      }));
      metadata = { drawingScale: "1/4\" = 1'-0\"", pageSize: "24x36", tradeType, analysisMethod: "Demo (no image)", analysisSource: "demo_no_image" };
      aiNotes = `Demo mode: Generated ${detectedItems.length} sample items for ${tradeType} trade.`;
    }

    await db.update(aiTakeoffAnalyses)
      .set({
        status: "COMPLETE",
        detectedItemsJson: JSON.stringify(detectedItems),
        metadataJson: JSON.stringify(metadata),
        aiNotes,
        processingTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(aiTakeoffAnalyses.id, analysisId));
  } catch (error: any) {
    console.error("AI Takeoff processing error:", error);
    await db.update(aiTakeoffAnalyses)
      .set({
        status: "FAILED",
        errorMessage: error.message || "Processing failed",
        processingTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(aiTakeoffAnalyses.id, analysisId));
  }
}

function generateTradeSpecificItems(tradeType: string) {
  const itemsByTrade: Record<string, Array<{type: string; description: string; quantity: number; unit: string; sowItem?: any}>> = {
    ROOFING: [
      { type: "roof_plane", description: "Main Roof Plane - Architectural Shingles", quantity: 28.5, unit: "SQ", sowItem: { name: "Architectural Shingles", code: "ROOF-SHNG-01" } },
      { type: "ridge", description: "Ridge Cap", quantity: 45, unit: "LF", sowItem: { name: "Ridge Cap", code: "ROOF-RDG-01" } },
      { type: "drip_edge", description: "Drip Edge - Aluminum", quantity: 180, unit: "LF", sowItem: { name: "Drip Edge", code: "ROOF-DRP-01" } },
      { type: "penetration", description: "Pipe Boots", quantity: 4, unit: "EA", sowItem: { name: "Pipe Boot Flashing", code: "ROOF-PEN-01" } },
    ],
    ELECTRICAL: [
      { type: "outlet", description: "Duplex Receptacles - 120V", quantity: 24, unit: "EA", sowItem: { name: "Duplex Receptacle", code: "ELEC-RCP-01" } },
      { type: "switch", description: "Single Pole Switches", quantity: 12, unit: "EA", sowItem: { name: "Single Pole Switch", code: "ELEC-SW-01" } },
      { type: "panel", description: "Main Panel - 200A", quantity: 1, unit: "EA", sowItem: { name: "Main Panel 200A", code: "ELEC-PNL-01" } },
      { type: "wire_run", description: "12/2 Romex", quantity: 850, unit: "LF", sowItem: { name: "12/2 NM-B Wire", code: "ELEC-WR-01" } },
    ],
    CONCRETE: [
      { type: "slab", description: "Slab on Grade - 4\" thick", quantity: 125, unit: "CY", sowItem: { name: "Concrete Slab", code: "CONC-SLB-01" } },
      { type: "footing", description: "Continuous Footing", quantity: 18, unit: "CY", sowItem: { name: "Foundation Footing", code: "CONC-FTG-01" } },
      { type: "rebar", description: "#4 Rebar Grid", quantity: 2.5, unit: "TON", sowItem: { name: "Rebar #4", code: "CONC-RBR-01" } },
      { type: "formwork", description: "Foundation Forms", quantity: 320, unit: "SF", sowItem: { name: "Formwork", code: "CONC-FRM-01" } },
    ],
    PLUMBING: [
      { type: "fixture", description: "Lavatory Sink", quantity: 8, unit: "EA", sowItem: { name: "Lavatory Sink", code: "PLMB-FIX-01" } },
      { type: "pipe_run", description: "2\" PVC Drain Line", quantity: 120, unit: "LF", sowItem: { name: "PVC Drain Pipe 2\"", code: "PLMB-DRN-01" } },
      { type: "fixture", description: "Water Closet", quantity: 6, unit: "EA", sowItem: { name: "Water Closet", code: "PLMB-FIX-02" } },
      { type: "valve", description: "Ball Valve 3/4\"", quantity: 12, unit: "EA", sowItem: { name: "Ball Valve", code: "PLMB-VLV-01" } },
    ],
    HVAC: [
      { type: "ductwork", description: "Supply Ductwork - Rectangular", quantity: 450, unit: "LF", sowItem: { name: "Supply Duct", code: "HVAC-DCT-01" } },
      { type: "register", description: "Supply Register 12x6", quantity: 18, unit: "EA", sowItem: { name: "Supply Register", code: "HVAC-REG-01" } },
      { type: "equipment", description: "RTU 5-Ton", quantity: 1, unit: "EA", sowItem: { name: "Rooftop Unit", code: "HVAC-EQP-01" } },
      { type: "return", description: "Return Air Grille", quantity: 6, unit: "EA", sowItem: { name: "Return Grille", code: "HVAC-RET-01" } },
    ],
    CARPENTRY: [
      { type: "framing", description: "2x4 Wall Studs 16\" OC", quantity: 2800, unit: "LF", sowItem: { name: "Wall Framing 2x4", code: "CARP-FRM-01" } },
      { type: "sheathing", description: "7/16\" OSB Sheathing", quantity: 3200, unit: "SF", sowItem: { name: "OSB Wall Sheathing", code: "CARP-SHT-01" } },
      { type: "door", description: "Interior Door - 3/0 x 6/8", quantity: 14, unit: "EA", sowItem: { name: "Interior Door", code: "CARP-DR-01" } },
      { type: "trim", description: "Base Trim - MDF", quantity: 480, unit: "LF", sowItem: { name: "Base Trim", code: "CARP-TRM-01" } },
    ],
    MASONRY: [
      { type: "wall", description: "8\" CMU Block Wall", quantity: 1800, unit: "SF", sowItem: { name: "CMU Block Wall", code: "MASN-BLK-01" } },
      { type: "mortar", description: "Type S Mortar", quantity: 45, unit: "CF", sowItem: { name: "Type S Mortar", code: "MASN-MRT-01" } },
      { type: "rebar", description: "Vertical #5 Rebar", quantity: 0.8, unit: "TON", sowItem: { name: "Vertical Rebar", code: "MASN-RBR-01" } },
      { type: "lintel", description: "Steel Lintel", quantity: 12, unit: "EA", sowItem: { name: "Steel Lintel", code: "MASN-LNT-01" } },
    ],
    DRYWALL: [
      { type: "board", description: "5/8\" Type X Drywall", quantity: 4200, unit: "SF", sowItem: { name: "Drywall 5/8\" Type X", code: "DW-BRD-01" } },
      { type: "framing", description: "Metal Studs 3-5/8\" 20ga", quantity: 1600, unit: "LF", sowItem: { name: "Metal Studs", code: "DW-FRM-01" } },
      { type: "finishing", description: "Level 4 Finish", quantity: 4200, unit: "SF", sowItem: { name: "Level 4 Finish", code: "DW-FIN-01" } },
      { type: "insulation", description: "R-13 Batt Insulation", quantity: 2400, unit: "SF", sowItem: { name: "Batt Insulation R-13", code: "DW-INS-01" } },
    ],
    PAINTING: [
      { type: "wall_paint", description: "Interior Latex Paint - Walls", quantity: 4800, unit: "SF", sowItem: { name: "Interior Wall Paint", code: "PAINT-WL-01" } },
      { type: "ceiling_paint", description: "Ceiling Paint - Flat", quantity: 2200, unit: "SF", sowItem: { name: "Ceiling Paint", code: "PAINT-CL-01" } },
      { type: "trim_paint", description: "Trim Paint - Semi-Gloss", quantity: 600, unit: "LF", sowItem: { name: "Trim Paint", code: "PAINT-TR-01" } },
      { type: "primer", description: "Primer - PVA", quantity: 7000, unit: "SF", sowItem: { name: "PVA Primer", code: "PAINT-PR-01" } },
    ],
    FLOORING: [
      { type: "tile", description: "Porcelain Tile 12x24", quantity: 1200, unit: "SF", sowItem: { name: "Porcelain Floor Tile", code: "FLR-TIL-01" } },
      { type: "carpet", description: "Commercial Carpet Tile", quantity: 800, unit: "SF", sowItem: { name: "Carpet Tile", code: "FLR-CPT-01" } },
      { type: "lvp", description: "Luxury Vinyl Plank", quantity: 1500, unit: "SF", sowItem: { name: "LVP Flooring", code: "FLR-LVP-01" } },
      { type: "base", description: "Rubber Wall Base", quantity: 450, unit: "LF", sowItem: { name: "Rubber Wall Base", code: "FLR-BAS-01" } },
    ],
    LANDSCAPING: [
      { type: "sod", description: "Bermuda Sod", quantity: 5000, unit: "SF", sowItem: { name: "Bermuda Sod", code: "LAND-SOD-01" } },
      { type: "mulch", description: "Hardwood Mulch 3\" Deep", quantity: 25, unit: "CY", sowItem: { name: "Hardwood Mulch", code: "LAND-MLC-01" } },
      { type: "tree", description: "Shade Trees - 2\" Cal", quantity: 8, unit: "EA", sowItem: { name: "Shade Tree 2\" Cal", code: "LAND-TRE-01" } },
      { type: "irrigation", description: "Drip Irrigation Zone", quantity: 4, unit: "EA", sowItem: { name: "Drip Irrigation Zone", code: "LAND-IRR-01" } },
    ],
    DEMOLITION: [
      { type: "interior_demo", description: "Interior Selective Demo", quantity: 3500, unit: "SF", sowItem: { name: "Interior Demo", code: "DEMO-INT-01" } },
      { type: "concrete_demo", description: "Concrete Slab Removal 4\"", quantity: 800, unit: "SF", sowItem: { name: "Concrete Slab Demo", code: "DEMO-CON-01" } },
      { type: "hauling", description: "Debris Hauling", quantity: 12, unit: "EA", sowItem: { name: "Debris Hauling Load", code: "DEMO-HAL-01" } },
      { type: "abatement", description: "Asbestos Abatement", quantity: 200, unit: "SF", sowItem: { name: "Asbestos Abatement", code: "DEMO-ABT-01" } },
    ],
    STEEL_ERECTION: [
      { type: "column", description: "W10x49 Steel Column", quantity: 12, unit: "EA", sowItem: { name: "Steel Column W10", code: "STL-COL-01" } },
      { type: "beam", description: "W18x35 Steel Beam", quantity: 680, unit: "LF", sowItem: { name: "Steel Beam W18", code: "STL-BM-01" } },
      { type: "joist", description: "Open Web Steel Joist 24K", quantity: 42, unit: "EA", sowItem: { name: "Steel Joist 24K", code: "STL-JST-01" } },
      { type: "decking", description: "1.5\" Metal Deck", quantity: 4800, unit: "SF", sowItem: { name: "Metal Deck 1.5\"", code: "STL-DCK-01" } },
    ],
    GLAZING: [
      { type: "storefront", description: "Aluminum Storefront System", quantity: 320, unit: "SF", sowItem: { name: "Storefront System", code: "GLZ-STR-01" } },
      { type: "window", description: "Fixed Window 4x5", quantity: 16, unit: "EA", sowItem: { name: "Fixed Window", code: "GLZ-WIN-01" } },
      { type: "curtainwall", description: "Curtain Wall System", quantity: 800, unit: "SF", sowItem: { name: "Curtain Wall", code: "GLZ-CW-01" } },
      { type: "door", description: "Aluminum Glass Door", quantity: 4, unit: "EA", sowItem: { name: "Glass Door", code: "GLZ-DR-01" } },
    ],
    INSULATION: [
      { type: "batt", description: "R-19 Fiberglass Batt", quantity: 3200, unit: "SF", sowItem: { name: "R-19 Batt", code: "INS-BAT-01" } },
      { type: "rigid", description: "2\" XPS Rigid Board", quantity: 1800, unit: "SF", sowItem: { name: "XPS Rigid 2\"", code: "INS-RGD-01" } },
      { type: "spray_foam", description: "Closed Cell Spray Foam 2\"", quantity: 2400, unit: "SF", sowItem: { name: "Spray Foam 2\"", code: "INS-SPF-01" } },
      { type: "vapor_barrier", description: "6 mil Poly Vapor Barrier", quantity: 3200, unit: "SF", sowItem: { name: "Vapor Barrier", code: "INS-VB-01" } },
    ],
    FIRE_PROTECTION: [
      { type: "sprinkler_head", description: "Pendant Sprinkler Head", quantity: 48, unit: "EA", sowItem: { name: "Pendant Sprinkler", code: "FP-SPR-01" } },
      { type: "pipe", description: "1\" Black Steel Pipe", quantity: 850, unit: "LF", sowItem: { name: "Fire Sprinkler Pipe", code: "FP-PIP-01" } },
      { type: "riser", description: "Fire Sprinkler Riser", quantity: 2, unit: "EA", sowItem: { name: "Sprinkler Riser", code: "FP-RSR-01" } },
      { type: "alarm", description: "Fire Alarm Pull Station", quantity: 8, unit: "EA", sowItem: { name: "Pull Station", code: "FP-ALM-01" } },
    ],
    LOW_VOLTAGE: [
      { type: "data_drop", description: "Cat6A Data Drop", quantity: 36, unit: "EA", sowItem: { name: "Cat6A Data Drop", code: "LV-DAT-01" } },
      { type: "cable", description: "Cat6A Plenum Cable", quantity: 3600, unit: "LF", sowItem: { name: "Cat6A Cable", code: "LV-CBL-01" } },
      { type: "camera", description: "IP Security Camera", quantity: 12, unit: "EA", sowItem: { name: "IP Camera", code: "LV-CAM-01" } },
      { type: "rack", description: "Network Rack 42U", quantity: 1, unit: "EA", sowItem: { name: "Network Rack", code: "LV-RCK-01" } },
    ],
    SOLAR: [
      { type: "panel", description: "400W Solar Panel", quantity: 48, unit: "EA", sowItem: { name: "Solar Panel 400W", code: "SOL-PNL-01" } },
      { type: "inverter", description: "String Inverter 10kW", quantity: 2, unit: "EA", sowItem: { name: "String Inverter", code: "SOL-INV-01" } },
      { type: "racking", description: "Roof Mount Racking", quantity: 960, unit: "SF", sowItem: { name: "Solar Racking", code: "SOL-RCK-01" } },
      { type: "conduit", description: "PV Conduit Run", quantity: 200, unit: "LF", sowItem: { name: "PV Conduit", code: "SOL-CND-01" } },
    ],
    WATERPROOFING: [
      { type: "membrane", description: "Modified Bitumen Membrane", quantity: 2400, unit: "SF", sowItem: { name: "Bitumen Membrane", code: "WP-MEM-01" } },
      { type: "coating", description: "Elastomeric Coating", quantity: 1800, unit: "SF", sowItem: { name: "Elastomeric Coating", code: "WP-COT-01" } },
      { type: "flashing", description: "Sheet Metal Flashing", quantity: 240, unit: "LF", sowItem: { name: "Metal Flashing", code: "WP-FLS-01" } },
      { type: "drain", description: "Interior Floor Drain", quantity: 6, unit: "EA", sowItem: { name: "Floor Drain", code: "WP-DRN-01" } },
    ],
    EARTHWORK: [
      { type: "excavation", description: "Mass Excavation", quantity: 1200, unit: "CY", sowItem: { name: "Mass Excavation", code: "ERTH-EXC-01" } },
      { type: "backfill", description: "Structural Backfill", quantity: 600, unit: "CY", sowItem: { name: "Structural Backfill", code: "ERTH-BKF-01" } },
      { type: "grading", description: "Fine Grading", quantity: 8000, unit: "SF", sowItem: { name: "Fine Grading", code: "ERTH-GRD-01" } },
      { type: "compaction", description: "Soil Compaction Testing", quantity: 20, unit: "EA", sowItem: { name: "Compaction Test", code: "ERTH-CMP-01" } },
    ],
    ASPHALT_PAVING: [
      { type: "paving", description: "2\" HMA Surface Course", quantity: 12000, unit: "SF", sowItem: { name: "HMA Surface Course", code: "ASP-PAV-01" } },
      { type: "base", description: "6\" Aggregate Base", quantity: 12000, unit: "SF", sowItem: { name: "Aggregate Base", code: "ASP-BAS-01" } },
      { type: "striping", description: "Parking Lot Striping", quantity: 2400, unit: "LF", sowItem: { name: "Lot Striping", code: "ASP-STR-01" } },
      { type: "curb", description: "Concrete Curb & Gutter", quantity: 480, unit: "LF", sowItem: { name: "Curb and Gutter", code: "ASP-CRB-01" } },
    ],
    GENERAL_CONTRACTOR: [
      { type: "roof_plane", description: "Main Roof - Shingles", quantity: 28.5, unit: "SQ" },
      { type: "framing", description: "Wall Framing - 2x4 Studs", quantity: 2400, unit: "LF" },
      { type: "slab", description: "Concrete Slab", quantity: 125, unit: "CY" },
      { type: "electrical", description: "Electrical Rough-In", quantity: 1, unit: "LS" },
    ],
  };

  return itemsByTrade[tradeType] || itemsByTrade.GENERAL_CONTRACTOR;
}

// GET /api/ai-features/takeoff/results/:analysisId - Get analysis results
router.get("/ai-features/takeoff/results/:analysisId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [analysis] = await db.select()
      .from(aiTakeoffAnalyses)
      .where(and(
        eq(aiTakeoffAnalyses.id, req.params.analysisId),
        eq(aiTakeoffAnalyses.organizationId, organizationId)
      ));

    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const detectedItems = analysis.detectedItemsJson ? JSON.parse(analysis.detectedItemsJson) : [];
    const metadata = analysis.metadataJson ? JSON.parse(analysis.metadataJson) : {};

    res.json({
      analysisId: analysis.id,
      status: analysis.status,
      tradeType: analysis.tradeType,
      detectedItems,
      metadata,
      aiNotes: analysis.aiNotes,
      processingTimeMs: analysis.processingTimeMs,
    });
  } catch (error) {
    console.error("Get takeoff results error:", error);
    res.status(500).json({ error: "Failed to get results" });
  }
});

// GET /api/ai-features/takeoff/history/:projectId - Get analysis history for project
router.get("/ai-features/takeoff/history/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const analyses = await db.select()
      .from(aiTakeoffAnalyses)
      .where(and(
        eq(aiTakeoffAnalyses.projectId, req.params.projectId),
        eq(aiTakeoffAnalyses.organizationId, organizationId)
      ))
      .orderBy(desc(aiTakeoffAnalyses.createdAt))
      .limit(20);

    res.json({ analyses });
  } catch (error) {
    console.error("Get takeoff history error:", error);
    res.status(500).json({ error: "Failed to get history" });
  }
});

// ============================================
// FEATURE B: AI SCHEDULING ASSISTANT ROUTES
// ============================================

const scheduleGenerateSchema = z.object({
  projectId: z.string(),
  startDate: z.string(),
  workingDays: z.array(z.number()).optional().default([1, 2, 3, 4, 5]),
  crewIds: z.array(z.string()).optional(),
  includeTrades: z.array(z.string()).optional(),
  options: z.object({
    bufferDays: z.number().optional().default(1),
    weatherContingency: z.number().optional().default(10),
    inspectionWaitDays: z.number().optional().default(2),
  }).optional(),
});

// POST /api/ai-features/schedule/generate - Generate AI schedule
router.post("/ai-features/schedule/generate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = scheduleGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, startDate, workingDays, crewIds, options } = parsed.data;

    // Get organization trade type
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    const tradeType = org?.tradeType || "GENERAL_CONTRACTOR";

    // Create schedule
    const [schedule] = await db.insert(projectSchedules).values({
      organizationId,
      projectId,
      name: "AI-Generated Schedule",
      generatedBy: "AI",
      baselineStartDate: startDate,
      workingDays,
      optionsJson: JSON.stringify(options),
      createdByUserId: userId,
    }).returning();

    // Generate trade-specific tasks
    const tasks = await generateTradeScheduleTasks(schedule.id, tradeType, startDate, options);

    res.json({
      success: true,
      scheduleId: schedule.id,
      status: "GENERATED",
      proposedSchedule: {
        startDate,
        endDate: tasks.length > 0 ? tasks[tasks.length - 1].plannedEndDate : startDate,
        totalDays: tasks.reduce((sum, t) => sum + (t.durationDays || 0), 0),
        criticalPathDays: tasks.filter(t => t.isCriticalPath).reduce((sum, t) => sum + (t.durationDays || 0), 0),
        tasks,
      },
      aiNotes: `Generated ${tasks.length} tasks for ${tradeType} project.`,
    });
  } catch (error) {
    console.error("Schedule generate error:", error);
    res.status(500).json({ error: "Failed to generate schedule" });
  }
});

async function generateTradeScheduleTasks(scheduleId: string, tradeType: string, startDate: string, options?: any) {
  const taskTemplates: Record<string, Array<{name: string; duration: number; isCritical: boolean}>> = {
    ROOFING: [
      { name: "Tear-off Existing Roof", duration: 2, isCritical: true },
      { name: "Deck Inspection & Repair", duration: 1, isCritical: true },
      { name: "Install Underlayment", duration: 1, isCritical: true },
      { name: "Install Shingles/Metal", duration: 3, isCritical: true },
      { name: "Install Flashings", duration: 1, isCritical: false },
      { name: "Install Gutters", duration: 1, isCritical: false },
      { name: "Cleanup & Final Inspection", duration: 1, isCritical: true },
    ],
    ELECTRICAL: [
      { name: "Rough-In Wiring", duration: 3, isCritical: true },
      { name: "Panel Installation", duration: 1, isCritical: true },
      { name: "Rough Inspection", duration: 1, isCritical: true },
      { name: "Trim-Out (Devices & Fixtures)", duration: 2, isCritical: false },
      { name: "Panel Terminations", duration: 1, isCritical: true },
      { name: "Final Inspection", duration: 1, isCritical: true },
    ],
    CONCRETE: [
      { name: "Layout & Excavation", duration: 2, isCritical: true },
      { name: "Form Installation", duration: 2, isCritical: true },
      { name: "Rebar Installation", duration: 2, isCritical: true },
      { name: "Pre-Pour Inspection", duration: 1, isCritical: true },
      { name: "Concrete Pour", duration: 1, isCritical: true },
      { name: "Curing Period", duration: 7, isCritical: true },
      { name: "Form Stripping", duration: 1, isCritical: false },
      { name: "Final Finish", duration: 1, isCritical: false },
    ],
    GENERAL_CONTRACTOR: [
      { name: "Site Preparation", duration: 3, isCritical: true },
      { name: "Foundation", duration: 5, isCritical: true },
      { name: "Framing", duration: 10, isCritical: true },
      { name: "MEP Rough-In", duration: 5, isCritical: true },
      { name: "Insulation & Drywall", duration: 5, isCritical: false },
      { name: "Finish Work", duration: 7, isCritical: false },
      { name: "Final Inspections", duration: 2, isCritical: true },
    ],
  };

  const templates = taskTemplates[tradeType] || taskTemplates.GENERAL_CONTRACTOR;
  let currentDate = new Date(startDate);
  const tasks: any[] = [];
  const dependencies: string[] = [];

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const taskStartDate = new Date(currentDate);
    const taskEndDate = new Date(currentDate);
    taskEndDate.setDate(taskEndDate.getDate() + template.duration - 1);

    const [task] = await db.insert(projectScheduleTasks).values({
      scheduleId,
      name: template.name,
      tradeType: tradeType as any,
      plannedStartDate: taskStartDate.toISOString().split('T')[0],
      plannedEndDate: taskEndDate.toISOString().split('T')[0],
      durationDays: template.duration,
      dependencies: dependencies.length > 0 ? [dependencies[dependencies.length - 1]] : [],
      isCriticalPath: template.isCritical,
      status: "NOT_STARTED",
      sortOrder: i,
    }).returning();

    tasks.push(task);
    dependencies.push(task.id);
    currentDate = new Date(taskEndDate);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Update schedule end date
  if (tasks.length > 0) {
    await db.update(projectSchedules)
      .set({ baselineEndDate: tasks[tasks.length - 1].plannedEndDate })
      .where(eq(projectSchedules.id, scheduleId));
  }

  try {
    const { recalculateSchedule } = await import("./cpmEngine");
    await recalculateSchedule(scheduleId);
  } catch (e) {
    console.error("CPM recalculation after generation failed:", e);
  }

  return tasks;
}

// GET /api/ai-features/schedule/:projectId - Get project schedule
router.get("/ai-features/schedule/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [schedule] = await db.select()
      .from(projectSchedules)
      .where(and(
        eq(projectSchedules.projectId, req.params.projectId),
        eq(projectSchedules.organizationId, organizationId),
        eq(projectSchedules.isActive, true)
      ))
      .orderBy(desc(projectSchedules.createdAt))
      .limit(1);

    if (!schedule) {
      return res.json({ schedule: null, tasks: [] });
    }

    const tasks = await db.select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, schedule.id))
      .orderBy(projectScheduleTasks.sortOrder);

    res.json({ schedule, tasks });
  } catch (error) {
    console.error("Get schedule error:", error);
    res.status(500).json({ error: "Failed to get schedule" });
  }
});


// ============================================
// FEATURE C: AI JOBSITE CAMERA ANALYSIS ROUTES
// ============================================

const jobsiteAnalysisSchema = z.object({
  projectId: z.string(),
  date: z.string(),
  analysisTypes: z.array(z.string()).default(["SAFETY", "PROGRESS"]),
  tradeType: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/ai-features/jobsite/analyze - Create jobsite analysis batch
router.post("/ai-features/jobsite/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = jobsiteAnalysisSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, date, analysisTypes, tradeType, notes } = parsed.data;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.gcOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied: project does not belong to your organization" });
    }

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL" and other custom types should fall back to GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = tradeType || (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    const [batch] = await db.insert(jobsiteAnalysisBatches).values({
      organizationId,
      projectId,
      analysisDate: date,
      tradeType: effectiveTradeType as any,
      status: "PENDING",
      analysisTypes,
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      batchId: batch.id,
      status: "QUEUED",
      estimatedTime: 60,
    });
  } catch (error) {
    console.error("Jobsite analysis error:", error);
    res.status(500).json({ error: "Failed to create analysis" });
  }
});

async function processJobsiteBatch(batchId: string, user: { id?: string; organizationId?: string; role?: string }) {
  const [batch] = await db.select()
    .from(jobsiteAnalysisBatches)
    .where(eq(jobsiteAnalysisBatches.id, batchId));

  if (!batch) throw new Error("Batch not found");

  try {
  await db.update(jobsiteAnalysisBatches)
    .set({ status: "PROCESSING" })
    .where(eq(jobsiteAnalysisBatches.id, batchId));

  const photos = await db.select()
    .from(jobsiteAnalysisPhotos)
    .where(eq(jobsiteAnalysisPhotos.batchId, batchId));

  let safetyFindings: any[];
  let progressFindings: any[];
  let summary: any;
  let crewFindings: any;
  let aiNotes: string;

  if (photos.length > 0 && openai) {
    try {
      const tradeType = batch.tradeType || "GENERAL_CONTRACTOR";
      const analysisTypes = batch.analysisTypes || ["SAFETY", "PROGRESS"];
      
      const safetyPrompt = analysisTypes.includes("SAFETY") 
        ? `SAFETY: Identify any safety hazards, PPE compliance issues, fall hazards, housekeeping problems. Rate severity as CRITICAL, HIGH, MEDIUM, or LOW.` 
        : "";
      const progressPrompt = analysisTypes.includes("PROGRESS")
        ? `PROGRESS: Estimate work completion percentage, identify active work areas, note quality of workmanship.`
        : "";
      const crewPrompt = `CREW: Estimate number of workers visible, assess PPE compliance percentage.`;
      
      const tradeContext = TRADE_DETECTION_PROMPTS[tradeType] || TRADE_DETECTION_PROMPTS.GENERAL_CONTRACTOR;
      const imageUrl = photos[0].fileUrl;
      
      const govResult = await governedAiCall({
        orgId: batch.organizationId,
        userId: user?.id || null,
        actionType: "jobsite_analysis",
        inputRefs: { projectId: batch.projectId },
        fn: async () => {
          const completion = await openai!.chat.completions.create({
            model: AI_MODEL_GPT4O,
            messages: [
              {
                role: "system",
                content: `You are a construction site safety and progress inspector for ${tradeType} trade work.
${tradeContext}

Analyze the jobsite photo and provide a comprehensive assessment.

${safetyPrompt}
${progressPrompt}
${crewPrompt}

Return your analysis as JSON with this exact structure:
{
  "summary": {
    "overallSafetyScore": number (0-100),
    "estimatedCompletion": number (0-100 percentage),
    "crewCountEstimate": number,
    "weatherConditions": "string",
    "primaryConcerns": ["array of concerns"]
  },
  "safetyFindings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "PPE|FALL_HAZARD|HOUSEKEEPING|ELECTRICAL|FIRE|OTHER",
      "description": "detailed description",
      "recommendation": "corrective action"
    }
  ],
  "progressFindings": [
    {
      "workArea": "area name",
      "tradeType": "${tradeType}",
      "estimatedComplete": number (0-100),
      "observations": "quality and progress notes"
    }
  ],
  "crewFindings": {
    "estimatedCount": number,
    "ppeCompliance": number (0-100),
    "activeWorkAreas": ["array of areas"]
  },
  "notes": "overall summary of findings"
}`
              },
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: imageUrl, detail: "high" }
                  },
                  {
                    type: "text",
                    text: `Analyze this construction jobsite photo for ${tradeType} trade work. Focus on safety hazards, work progress, and crew activity.`
                  }
                ]
              }
            ],
            max_tokens: 4096,
            temperature: 0.3,
          });
          return { result: completion.choices[0]?.message?.content, completion };
        },
      });

      if (govResult.blocked) {
        await db.update(jobsiteAnalysisBatches)
          .set({ status: "FAILED", errorMessage: govResult.reason || "AI rate limited", updatedAt: new Date() })
          .where(eq(jobsiteAnalysisBatches.id, batchId));
        return;
      }

      const responseContent = govResult.result || "";
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        summary = parsed.summary || {
          overallSafetyScore: 80, estimatedCompletion: 50, crewCountEstimate: 5,
          weatherConditions: "Unknown", primaryConcerns: [],
        };
        safetyFindings = (parsed.safetyFindings || []).map((f: any, i: number) => ({
          id: `sf-${i + 1}`, severity: f.severity || "MEDIUM", category: f.category || "OTHER",
          description: f.description, recommendation: f.recommendation, photoId: photos[0].id,
        }));
        progressFindings = (parsed.progressFindings || []).map((f: any, i: number) => ({
          id: `pf-${i + 1}`, workArea: f.workArea || "General Area", tradeType: f.tradeType || tradeType,
          estimatedComplete: f.estimatedComplete || 0, observations: f.observations, photoId: photos[0].id,
        }));
        crewFindings = parsed.crewFindings || { estimatedCount: 0, ppeCompliance: 100, activeWorkAreas: [] };
        aiNotes = parsed.notes || "AI Vision analysis complete.";
      } else {
        throw new Error("Could not parse AI response");
      }
    } catch (visionError) {
      console.error("OpenAI Vision error for jobsite analysis, falling back to mock:", visionError);
      safetyFindings = generateSafetyFindings(batch.tradeType || "GENERAL_CONTRACTOR");
      progressFindings = generateProgressFindings(batch.tradeType || "GENERAL_CONTRACTOR");
      summary = {
        overallSafetyScore: 85, estimatedCompletion: 45, crewCountEstimate: 6,
        weatherConditions: "Clear, 72°F",
        primaryConcerns: safetyFindings.filter((f: any) => f.severity === "HIGH").map((f: any) => f.description),
        analysisMethod: "Fallback (mock)",
      };
      crewFindings = { estimatedCount: 6, ppeCompliance: 90, activeWorkAreas: ["Main building", "North side"] };
      aiNotes = "Fallback: Generated sample analysis data.";
    }
  } else {
    safetyFindings = generateSafetyFindings(batch.tradeType || "GENERAL_CONTRACTOR");
    progressFindings = generateProgressFindings(batch.tradeType || "GENERAL_CONTRACTOR");
    summary = {
      overallSafetyScore: 85, estimatedCompletion: 45, crewCountEstimate: 6,
      weatherConditions: "Clear, 72°F",
      primaryConcerns: safetyFindings.filter((f: any) => f.severity === "HIGH").map((f: any) => f.description),
      analysisMethod: "Demo (no photos)",
    };
    crewFindings = { estimatedCount: 6, ppeCompliance: 90, activeWorkAreas: ["Main building", "North side"] };
    aiNotes = "Demo mode: Generated sample analysis data.";
  }

  await db.update(jobsiteAnalysisBatches)
    .set({
      status: "COMPLETE",
      summaryJson: JSON.stringify(summary),
      safetyFindingsJson: JSON.stringify(safetyFindings),
      progressFindingsJson: JSON.stringify(progressFindings),
      crewFindingsJson: JSON.stringify(crewFindings),
      aiNotes,
      updatedAt: new Date(),
    })
    .where(eq(jobsiteAnalysisBatches.id, batchId));
  } catch (processingError) {
    console.error(`processJobsiteBatch uncaught error for batch ${batchId}:`, processingError);
    await db.update(jobsiteAnalysisBatches)
      .set({
        status: "FAILED",
        errorMessage: processingError instanceof Error ? processingError.message : "Unexpected processing error",
        updatedAt: new Date(),
      })
      .where(eq(jobsiteAnalysisBatches.id, batchId));
  }
}

// POST /api/ai-features/jobsite/:batchId/process - Process uploaded photos with AI Vision
router.post("/ai-features/jobsite/:batchId/process", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    const userRole = req.user?.role;
    
    if (userRole !== "SUPER_ADMIN" && !organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const batchId = req.params.batchId;

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    if (userRole !== "SUPER_ADMIN" && batch.organizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    await processJobsiteBatch(batchId, req.user!);

    res.json({ success: true, status: "COMPLETE" });
  } catch (error) {
    console.error("Process jobsite analysis error:", error);
    res.status(500).json({ error: "Failed to process analysis" });
  }
});

function generateSafetyFindings(tradeType: string) {
  const findings = [
    { id: "sf-1", severity: "MEDIUM", category: "PPE", description: "Worker without hard hat observed in photo 3", recommendation: "Ensure all workers wear hard hats on site" },
    { id: "sf-2", severity: "LOW", category: "HOUSEKEEPING", description: "Material storage could be better organized", recommendation: "Organize materials to clear walkways" },
  ];
  
  if (tradeType === "ROOFING") {
    findings.push({ id: "sf-3", severity: "HIGH", category: "FALL_HAZARD", description: "Ladder not properly secured at roof access", recommendation: "Secure ladder with proper tie-offs" });
  }
  
  return findings;
}

function generateProgressFindings(tradeType: string) {
  const findings = [
    { id: "pf-1", workArea: "Main Building", tradeType, estimatedComplete: 45, observations: "Work progressing on schedule" },
    { id: "pf-2", workArea: "North Section", tradeType, estimatedComplete: 60, observations: "Ahead of schedule in this area" },
  ];
  return findings;
}

// GET /api/ai-features/jobsite/results/:batchId - Get analysis results
router.get("/ai-features/jobsite/results/:batchId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(and(
        eq(jobsiteAnalysisBatches.id, req.params.batchId),
        eq(jobsiteAnalysisBatches.organizationId, organizationId)
      ));

    if (!batch) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    const photos = await db.select()
      .from(jobsiteAnalysisPhotos)
      .where(eq(jobsiteAnalysisPhotos.batchId, batch.id));

    res.json({
      batchId: batch.id,
      status: batch.status,
      projectId: batch.projectId,
      date: batch.analysisDate,
      tradeType: batch.tradeType,
      summary: batch.summaryJson ? JSON.parse(batch.summaryJson) : null,
      safetyFindings: batch.safetyFindingsJson ? JSON.parse(batch.safetyFindingsJson) : [],
      progressFindings: batch.progressFindingsJson ? JSON.parse(batch.progressFindingsJson) : [],
      crewFindings: batch.crewFindingsJson ? JSON.parse(batch.crewFindingsJson) : null,
      photos,
    });
  } catch (error) {
    console.error("Get jobsite results error:", error);
    res.status(500).json({ error: "Failed to get results" });
  }
});

// GET /api/ai-features/jobsite/history/:projectId - Get analysis history
router.get("/ai-features/jobsite/history/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const batches = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(and(
        eq(jobsiteAnalysisBatches.projectId, req.params.projectId),
        eq(jobsiteAnalysisBatches.organizationId, organizationId)
      ))
      .orderBy(desc(jobsiteAnalysisBatches.analysisDate))
      .limit(30);

    const batchIds = batches.map(b => b.id);
    let photoCountMap: Record<string, number> = {};
    if (batchIds.length > 0) {
      const photoCounts = await db.select({
        batchId: jobsiteAnalysisPhotos.batchId,
        count: sql<number>`count(*)::int`,
      })
        .from(jobsiteAnalysisPhotos)
        .where(sql`${jobsiteAnalysisPhotos.batchId} IN (${sql.join(batchIds.map(id => sql`${id}`), sql`, `)})`)
        .groupBy(jobsiteAnalysisPhotos.batchId);
      for (const pc of photoCounts) {
        photoCountMap[pc.batchId] = pc.count;
      }
    }

    const batchesWithCounts = batches.map(b => {
      let safetyScore: number | undefined;
      let safetyFindings: any[] = [];
      let summary: any = undefined;
      try {
        if (b.summaryJson) summary = JSON.parse(b.summaryJson);
        if (summary) safetyScore = summary.overallSafetyScore;
      } catch {}
      try {
        if (b.safetyFindingsJson) safetyFindings = JSON.parse(b.safetyFindingsJson);
      } catch {}
      return {
        ...b,
        photoCount: photoCountMap[b.id] || 0,
        safetyScore,
        safetyFindings,
        summary,
      };
    });

    res.json({ batches: batchesWithCounts });
  } catch (error) {
    console.error("Get jobsite history error:", error);
    res.status(500).json({ error: "Failed to get history" });
  }
});

// GET /api/ai-features/jobsite/project-photos/:projectId - Get unanalyzed project photos
router.get("/ai-features/jobsite/project-photos/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const projectId = req.params.projectId;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.gcOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const allPhotos = await db.select()
      .from(media)
      .where(and(
        eq(media.projectId, projectId),
        eq(media.type, "IMAGE")
      ))
      .orderBy(desc(media.uploadedAt));

    const alreadyUsed = await db.select({ fileUrl: jobsiteAnalysisPhotos.fileUrl })
      .from(jobsiteAnalysisPhotos)
      .innerJoin(jobsiteAnalysisBatches, eq(jobsiteAnalysisPhotos.batchId, jobsiteAnalysisBatches.id))
      .where(eq(jobsiteAnalysisBatches.projectId, projectId));

    const usedUrls = new Set(alreadyUsed.map(p => p.fileUrl));
    const unanalyzed = allPhotos.filter(p => !usedUrls.has(p.fileUrl));

    res.json({ photos: unanalyzed, total: allPhotos.length, unanalyzedCount: unanalyzed.length });
  } catch (error) {
    console.error("Get project photos error:", error);
    res.status(500).json({ error: "Failed to get project photos" });
  }
});

// POST /api/ai-features/jobsite/:batchId/attach-photos - Attach photos and trigger processing
const attachPhotosSchema = z.object({
  photos: z.array(z.object({
    fileUrl: z.string().min(1),
    fileKey: z.string().optional(),
    originalFilename: z.string().optional(),
  })).min(1, "At least one photo is required"),
});

router.post("/ai-features/jobsite/:batchId/attach-photos", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    if (!organizationId || !userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = attachPhotosSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { photos } = parsed.data;
    const batchId = req.params.batchId;

    const [batch] = await db.select()
      .from(jobsiteAnalysisBatches)
      .where(eq(jobsiteAnalysisBatches.id, batchId));

    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    if (batch.organizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, batch.projectId)).limit(1);
    if (!project || project.gcOrganizationId !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const projectMedia = await db.select({ fileUrl: media.fileUrl })
      .from(media)
      .where(and(eq(media.projectId, batch.projectId), eq(media.type, "IMAGE")));
    const validMediaUrls = new Set(projectMedia.map(m => m.fileUrl));

    const { uploadIntents } = await import("@shared/schema");
    const orgIntents = await db.select({ objectKey: uploadIntents.objectKey })
      .from(uploadIntents)
      .where(and(
        eq(uploadIntents.organizationId, organizationId),
        isNotNull(uploadIntents.confirmedAt),
      ));
    const validObjectKeys = new Set(orgIntents.map(i => i.objectKey));

    const validatedPhotos = photos.filter(p => {
      if (validMediaUrls.has(p.fileUrl)) return true;
      if (p.fileKey && validObjectKeys.has(p.fileKey)) return true;
      const normalizedPath = p.fileUrl.replace(/^\//, "");
      if (validObjectKeys.has(normalizedPath)) return true;
      return false;
    });

    if (validatedPhotos.length === 0) {
      return res.status(400).json({ error: "No valid photos to attach" });
    }

    const photoRecords = validatedPhotos.map(p => ({
      batchId,
      fileKey: p.fileKey || p.fileUrl,
      fileUrl: p.fileUrl,
      originalFilename: p.originalFilename || null,
    }));

    await db.insert(jobsiteAnalysisPhotos).values(photoRecords);

    res.json({ success: true, photosAttached: validatedPhotos.length, batchId });

    processJobsiteBatch(batchId, req.user!).catch(err => {
      console.error("Background batch processing error:", err);
    });
  } catch (error) {
    console.error("Attach photos error:", error);
    res.status(500).json({ error: "Failed to attach photos" });
  }
});

// ============================================
// FEATURE D: VENDOR PRICING SYNC ROUTES
// ============================================

const pricebookUploadSchema = z.object({
  vendorId: z.string(),
  fileKey: z.string(),
  fileName: z.string().optional(),
  fileType: z.enum(["CSV", "XLSX"]),
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  tradeType: z.string().optional(),
});

// POST /api/ai-features/vendors/pricebook/upload - Upload pricebook
router.post("/ai-features/vendors/pricebook/upload", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = pricebookUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { vendorId, fileKey, fileName, fileType, effectiveDate, expirationDate, tradeType } = parsed.data;

    const [pricebook] = await db.insert(vendorPricebooks).values({
      organizationId,
      vendorId,
      fileKey,
      fileName,
      fileType,
      effectiveDate: effectiveDate || null,
      expirationDate: expirationDate || null,
      tradeType: tradeType as any || null,
      status: "PENDING",
      uploadedByUserId: userId,
    }).returning();

    res.json({
      success: true,
      pricebookId: pricebook.id,
      status: "PROCESSING",
    });
  } catch (error) {
    console.error("Pricebook upload error:", error);
    res.status(500).json({ error: "Failed to upload pricebook" });
  }
});

// GET /api/ai-features/vendors/pricebook/items - Get pricebook items
router.get("/ai-features/vendors/pricebook/items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { vendorId, category, search } = req.query;

    let query = db.select()
      .from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.organizationId, organizationId),
        eq(vendorPricebookItems.isActive, true)
      ));

    const items = await query.limit(100);

    res.json({ items, totalCount: items.length });
  } catch (error) {
    console.error("Get pricebook items error:", error);
    res.status(500).json({ error: "Failed to get items" });
  }
});

// GET /api/ai-features/vendors/pricebooks - List vendor pricebooks
router.get("/ai-features/vendors/pricebooks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const pricebooks = await db.select()
      .from(vendorPricebooks)
      .where(eq(vendorPricebooks.organizationId, organizationId))
      .orderBy(desc(vendorPricebooks.createdAt));

    res.json({ pricebooks });
  } catch (error) {
    console.error("Get pricebooks error:", error);
    res.status(500).json({ error: "Failed to get pricebooks" });
  }
});

// ============================================
// FEATURE F: AI CHANGE ORDER GENERATOR ROUTES
// ============================================

const coGenerateSchema = z.object({
  projectId: z.string(),
  tradeType: z.string().optional(),
  linkedItems: z.object({
    delayIds: z.array(z.string()).optional(),
    inspectionIds: z.array(z.string()).optional(),
    sowItemIds: z.array(z.string()).optional(),
    photoIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
  pricingSource: z.enum(["MANUAL", "CALCULATOR", "VENDOR_PRICING"]).default("MANUAL"),
  includeBreakdown: z.boolean().default(true),
});

// POST /api/ai-features/change-orders/generate - Generate AI change order draft
router.post("/ai-features/change-orders/generate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId || !organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = coGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { projectId, tradeType, linkedItems, pricingSource, includeBreakdown } = parsed.data;

    // Get organization trade type if not provided
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    // Valid trade types from the enum - "MANUAL", "SCOPE_CHANGE", "DELAY", "INSPECTION" and other
    // non-trade values should fall back to org trade type or GENERAL_CONTRACTOR
    const validTradeTypes = [
      "GENERAL_CONTRACTOR", "CONCRETE", "EARTHWORK", "ASPHALT_PAVING", "ROOFING", "ELECTRICAL",
      "PLUMBING", "HVAC", "CARPENTRY", "MASONRY", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING",
      "DEMOLITION", "STEEL_ERECTION", "GLAZING", "INSULATION", "FIRE_PROTECTION", "LOW_VOLTAGE",
      "SOLAR", "WATERPROOFING", "OTHER"
    ];
    const orgTradeType = org?.tradeType;
    const effectiveTradeType = (tradeType && validTradeTypes.includes(tradeType))
      ? tradeType
      : (orgTradeType && validTradeTypes.includes(orgTradeType) ? orgTradeType : "GENERAL_CONTRACTOR");

    // Generate AI draft content
    const draftContent = await generateCoDraft(effectiveTradeType, linkedItems);

    const [draft] = await db.insert(aiCoDrafts).values({
      organizationId,
      projectId,
      tradeType: effectiveTradeType as any,
      linkedItemsJson: JSON.stringify(linkedItems),
      draftContentJson: JSON.stringify(draftContent),
      pricingJson: JSON.stringify(draftContent.lineItems),
      aiConfidence: 82,
      aiNotes: `Generated change order draft for ${effectiveTradeType} project.`,
      status: "DRAFT",
      createdByUserId: userId,
    }).returning();

    res.json({
      success: true,
      draftId: draft.id,
      draft: draftContent,
      aiConfidence: 82,
      aiNotes: `Generated change order draft based on ${Object.keys(linkedItems).filter(k => linkedItems[k as keyof typeof linkedItems]?.length).length} linked item types.`,
    });
  } catch (error) {
    console.error("Generate CO error:", error);
    res.status(500).json({ error: "Failed to generate change order" });
  }
});

async function generateCoDraft(tradeType: string, linkedItems: any) {
  const tradeTerms: Record<string, string> = {
    ROOFING: "hidden deck damage discovered during tear-off operations",
    ELECTRICAL: "additional circuits required per updated code requirements",
    CONCRETE: "unforeseen soil conditions requiring additional excavation",
    GENERAL_CONTRACTOR: "scope modifications per field conditions",
  };

  const reason = tradeTerms[tradeType] || tradeTerms.GENERAL_CONTRACTOR;
  
  return {
    title: `Change Order - ${new Date().toLocaleDateString()}`,
    description: `This change order addresses ${reason}. Work includes additional labor and materials as detailed below.`,
    justification: linkedItems.notes || `Additional work required due to ${reason}. This was not foreseeable at time of original bid.`,
    scopeOfWork: `Furnish all labor, materials, and equipment necessary to complete the additional work as described. Work to be performed in accordance with project specifications and industry standards.`,
    exclusions: "This change order does not include: work outside the described scope, permits unless noted, or changes to project schedule beyond completion of this work.",
    terms: "Payment due upon completion and acceptance. Work to commence within 5 business days of approval.",
    lineItems: {
      labor: [
        { description: "Skilled Labor", hours: 16, rate: 75, amount: 1200 },
        { description: "General Labor", hours: 8, rate: 45, amount: 360 },
      ],
      materials: [
        { description: "Additional Materials", quantity: 1, unit: "LS", unitPrice: 850, amount: 850 },
      ],
      equipment: [
        { description: "Equipment Usage", days: 1, dailyRate: 150, amount: 150 },
      ],
    },
    subtotals: {
      labor: 1560,
      materials: 850,
      equipment: 150,
      subtotal: 2560,
      overhead: 256,
      profit: 256,
      total: 3072,
    },
  };
}

// GET /api/ai-features/change-orders/drafts/:projectId - Get drafts for project
router.get("/ai-features/change-orders/drafts/:projectId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const drafts = await db.select()
      .from(aiCoDrafts)
      .where(and(
        eq(aiCoDrafts.projectId, req.params.projectId),
        eq(aiCoDrafts.organizationId, organizationId),
        sql`${aiCoDrafts.status} IN ('DRAFT', 'REVIEWED')`
      ))
      .orderBy(desc(aiCoDrafts.createdAt));

    res.json({ drafts });
  } catch (error) {
    console.error("Get CO drafts error:", error);
    res.status(500).json({ error: "Failed to get drafts" });
  }
});

// PATCH /api/ai-features/change-orders/drafts/:draftId - Update draft status (e.g. REJECTED, REVIEWED)
router.patch("/ai-features/change-orders/drafts/:draftId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status is required" });

    const [draft] = await db.select().from(aiCoDrafts).where(
      and(eq(aiCoDrafts.id, req.params.draftId), eq(aiCoDrafts.organizationId, organizationId))
    );
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    await db.update(aiCoDrafts)
      .set({ status, updatedAt: new Date() })
      .where(eq(aiCoDrafts.id, draft.id));

    res.json({ success: true });
  } catch (error) {
    console.error("Update CO draft error:", error);
    res.status(500).json({ error: "Failed to update draft" });
  }
});

// POST /api/ai-features/change-orders/drafts/:draftId/convert - Convert draft to real CO
router.post("/ai-features/change-orders/drafts/:draftId/convert", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [draft] = await db.select()
      .from(aiCoDrafts)
      .where(and(
        eq(aiCoDrafts.id, req.params.draftId),
        eq(aiCoDrafts.organizationId, organizationId)
      ));

    if (!draft) {
      return res.status(404).json({ error: "Draft not found" });
    }

    const draftContent = draft.draftContentJson ? JSON.parse(draft.draftContentJson) : {};

    // Generate next change order number
    const existingCOs = await db.select()
      .from(changeOrders)
      .where(eq(changeOrders.projectId, draft.projectId));
    const nextNumber = `CO-${String(existingCOs.length + 1).padStart(3, '0')}`;

    // Create actual change order
    const [co] = await db.insert(changeOrders).values({
      projectId: draft.projectId,
      changeOrderNumber: nextNumber,
      description: draftContent.description || "AI Generated Change Order",
      amount: String(draftContent.subtotals?.total || 0),
      status: "DRAFT",
      requestedById: req.user!.id,
    }).returning();

    // Update draft status
    await db.update(aiCoDrafts)
      .set({ status: "CONVERTED", convertedToCoId: co.id, updatedAt: new Date() })
      .where(eq(aiCoDrafts.id, draft.id));

    res.json({
      success: true,
      changeOrderId: co.id,
    });
  } catch (error) {
    console.error("Convert CO draft error:", error);
    res.status(500).json({ error: "Failed to convert draft" });
  }
});

// GET /api/ai-features/sub-recommendations - Get subcontractor recommendations
router.get("/ai-features/sub-recommendations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { getSubcontractorRecommendations } = await import("./ai/subRecommendationEngine");
    const tradeSpecialty = req.query.trade as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const maxResults = req.query.limit ? parseInt(req.query.limit as string) : 10;

    const recommendations = await getSubcontractorRecommendations({
      organizationId,
      tradeSpecialty: tradeSpecialty || undefined,
      projectId: projectId || undefined,
      maxResults,
    });

    res.json({ recommendations, total: recommendations.length });
  } catch (error) {
    console.error("Sub recommendations error:", error);
    res.status(500).json({ error: "Failed to get recommendations" });
  }
});

// ========================================
// Routes from aiGovernanceRoutes.ts
// ========================================

function parseDateRange(req: any): { dateFrom?: Date; dateTo?: Date } {
  const range = req.query.dateRange as string | undefined;
  if (!range || range === "all") return {};
  const now = new Date();
  const dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let dateFrom: Date;
  switch (range) {
    case "today":
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;
    case "week":
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
      break;
    case "month":
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 0, 0, 0, 0);
      break;
    default:
      return {};
  }
  return { dateFrom, dateTo };
}

router.get("/audit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { limit, offset } = parsePagination(req);
    const { dateFrom, dateTo } = parseDateRange(req);
    const result = await getAiAuditLog(orgId, limit, offset, dateFrom, dateTo);
    res.json(result);
  } catch (err) {
    logError("Failed to get AI audit log", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI audit log" });
  }
});

router.get("/usage", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const data = await getOrgLimitsWithUsage(orgId);
    res.json(data);
  } catch (err) {
    logError("Failed to get AI usage", { error: String(err) });
    res.status(500).json({ error: "Failed to get AI usage" });
  }
});

router.get("/cost-breakdown", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { dateFrom, dateTo } = parseDateRange(req);
    const breakdown = await getCostBreakdownByActionType(orgId, dateFrom, dateTo);
    res.json(breakdown);
  } catch (err) {
    logError("Failed to get cost breakdown", { error: String(err) });
    res.status(500).json({ error: "Failed to get cost breakdown" });
  }
});

// ========================================
// Routes from aiOnboardingRoutes.ts
// ========================================

const onboardingCompleteSchema = z.object({
  companyName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(2, "Company name must be at least 2 characters").max(200))
    .transform(s => sanitizeShortText(s)),
  tradeType: z.enum(tradeTypeEnum.enumValues, { 
    errorMap: () => ({ message: "Invalid trade type" }) 
  }),
  tradeName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().max(200))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  crewSize: z.number().int().min(1).max(10000).optional().nullable(),
  region: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().max(200))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  materials: z.array(
    z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(100))
      .transform(s => sanitizeShortText(s))
  ).max(50).optional().nullable(),
  workTypes: z.array(
    z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(100))
      .transform(s => sanitizeShortText(s))
  ).max(50).optional().nullable(),
  websiteUrl: z.string()
    .transform(s => s?.trim() || '')
    .transform(s => {
      if (s && s.length > 0 && !s.startsWith('http://') && !s.startsWith('https://')) {
        return `https://${s}`;
      }
      return s;
    })
    .pipe(z.string().url().max(500).or(z.literal('')))
    .transform(s => s ? sanitizeShortText(s) : null)
    .optional()
    .nullable(),
  suggestedCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
  })).max(20).optional().nullable(),
  customSowItems: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
    unit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    category: z.string().max(100).transform(s => sanitizeShortText(s)).optional(),
  })).max(50).optional().nullable(),
  customWorkTypes: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    unit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    defaultRate: z.number().optional(),
  })).max(30).optional().nullable(),
  customCalculators: z.array(z.object({
    name: z.string().max(100).transform(s => sanitizeShortText(s)),
    description: z.string().max(500).transform(s => sanitizeText(s)).optional(),
    outputUnit: z.string().max(20).transform(s => sanitizeShortText(s)).optional(),
    inputs: z.array(z.object({
      name: z.string().max(50),
      unit: z.string().max(20).optional(),
    })).max(10).optional(),
  })).max(20).optional().nullable(),
}).refine(
  (data) => data.tradeType !== 'OTHER' || (data.tradeName && data.tradeName.length >= 2),
  { message: "Custom trade name is required for specialty trades", path: ["tradeName"] }
);

const onboardingChatSchema = z.object({
  message: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(1, "Message is required").max(2000))
    .transform(s => sanitizeText(s)),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
      .transform(s => s?.trim() || '')
      .pipe(z.string().max(5000))
      .transform(s => sanitizeText(s)),
  })).max(30).optional().default([]),
  tradeResearch: z.object({
    tradeName: z.string(),
    tradeDescription: z.string().optional(),
    scopeOfWorkItems: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    commonMaterials: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    workTypes: z.array(z.object({
      name: z.string(),
      unit: z.string().optional(),
      typicalProductionRate: z.string().optional(),
      description: z.string().optional(),
    })).optional(),
    calculators: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      outputUnit: z.string().optional(),
      inputs: z.array(z.object({
        name: z.string(),
        unit: z.string().optional(),
      })).optional(),
    })).optional(),
    vendorCategories: z.array(z.string()).optional(),
    industryNotes: z.string().optional(),
  }).optional().nullable(),
});

const tradeResearchSchema = z.object({
  tradeName: z.string()
    .transform(s => s?.trim() || '')
    .pipe(z.string().min(2, "Trade name must be at least 2 characters").max(100))
    .transform(s => sanitizeShortText(s)),
});


router.get("/ai/onboarding/sow-items/:tradeType", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tradeType } = req.params;
    
    if (!tradeTypeEnum.enumValues.includes(tradeType as any)) {
      return res.status(400).json({ error: "Invalid trade type" });
    }

    const items = await db
      .select()
      .from(masterSowItems)
      .where(eq(masterSowItems.tradeType, tradeType as any))
      .orderBy(asc(masterSowItems.sortOrder));

    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      const cat = item.categoryName || 'General';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description,
        defaultUomCode: item.defaultUomCode,
        csiCode: item.csiCode,
      });
    }

    res.json({ 
      tradeType,
      items,
      groupedByCategory: grouped,
      totalCount: items.length 
    });
  } catch (error: any) {
    console.error("Error fetching master SOW items:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/onboarding/trades", requireAuth, async (req: AuthRequest, res) => {
  try {
    const templates = await db
      .select({
        tradeType: tradeTemplates.tradeType,
        displayName: tradeTemplates.displayName,
        description: tradeTemplates.description,
        csiDivision: tradeTemplates.csiDivision,
        iconName: tradeTemplates.iconName,
        colorHex: tradeTemplates.colorHex,
        isGcTrade: tradeTemplates.isGcTrade,
      })
      .from(tradeTemplates)
      .where(eq(tradeTemplates.isActive, true))
      .orderBy(asc(tradeTemplates.displayName));

    res.json(templates);
  } catch (error: any) {
    console.error("Error fetching trade templates:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ai/onboarding/units", requireAuth, async (req: AuthRequest, res) => {
  try {
    const units = await db
      .select()
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.isActive, true))
      .orderBy(asc(unitsOfMeasure.sortOrder));

    res.json(units);
  } catch (error: any) {
    console.error("Error fetching units:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getSowSuggestionsForTrade(tradeType: string): Promise<string[]> {
  const items = await db
    .select({ name: masterSowItems.name })
    .from(masterSowItems)
    .where(eq(masterSowItems.tradeType, tradeType as any))
    .orderBy(asc(masterSowItems.sortOrder))
    .limit(20);
  
  return items.map(i => i.name);
}

function buildOnboardingTaxonomyBlock(): string {
  const categories = getTradeCategories();
  return categories.map(cat => {
    const trades = getTradesByCategory(cat);
    const tradeNames = trades.slice(0, 20).map(t => t.trade_name).join(', ');
    const suffix = trades.length > 20 ? ` (+${trades.length - 20} more)` : '';
    return `**${cat}** (${trades.length} trades): ${tradeNames}${suffix}`;
  }).join('\n');
}

function buildOnboardingMaterialBlock(): string {
  const groups = getMaterialGroups();
  return groups.map(g => {
    const mats = getMaterialsByGroup(g);
    const names = mats.slice(0, 8).map(m => m.display_name).join(', ');
    const suffix = mats.length > 8 ? ` (+${mats.length - 8} more)` : '';
    return `**${g}**: ${names}${suffix}`;
  }).join('\n');
}

async function buildOnboardingSystemPrompt(): Promise<string> {
  const templates = await db
    .select({
      tradeType: tradeTemplates.tradeType,
      displayName: tradeTemplates.displayName,
      materialCategories: tradeTemplates.materialCategories,
    })
    .from(tradeTemplates)
    .where(eq(tradeTemplates.isActive, true));

  const tradeTypes = templates.map(t => t.tradeType).join(', ');

  const materialSuggestions = templates
    .filter(t => t.materialCategories)
    .map(t => `${t.tradeType}: ${t.materialCategories}`)
    .join('\n');

  return `You are an AI assistant helping new contractors set up their construction management platform. Your goal is to have a friendly, in-depth conversation to understand their business so we can configure the system perfectly for their needs, including pre-building their scope of work items and material calculators.

## Your Conversation Flow:

### For Known Trades (22 preset trades):
1. **Welcome & Trade** - Warmly greet them and ask what type of contracting work they specialize in
2. **Crew Size** - Ask about their typical crew size (can be a range like "5-10")
3. **Region** - Ask what geographic area they primarily serve
4. **Work Types/SOW** - Based on their trade, we have pre-built scope of work items. Ask them to confirm which services they offer
5. **Materials** - Based on their trade, suggest material categories they likely use
6. **Website** - Ask if they have a company website (optional) for brand color matching
7. **Confirmation** - Summarize everything and ask them to confirm

### For Unknown/Custom Trades (OTHER):
1. **Welcome & Trade** - Greet them and identify that we don't have a preset for their trade
2. **Trade Name** - Get the specific name of their trade/specialty
3. **Crew Size** - Ask about their typical crew size
4. **Region** - Ask what geographic area they primarily serve
5. **SOW Items** - Have them describe 5-10 common job types/services they perform
6. **Work Types** - Ask about the units they measure work in
7. **Materials** - Ask what materials they commonly use
8. **Calculators** - Suggest helpful calculators based on their trade
9. **Website** - Ask if they have a company website
10. **Confirmation** - Summarize and confirm

## Available Trade Types:
${tradeTypes}

## Material Categories by Trade:
${materialSuggestions}

## RESPONSE FORMAT:
Always respond with VALID JSON in this exact structure:
{
  "message": "Your conversational message here",
  "data": {
    "companyName": null,
    "tradeType": null,
    "tradeName": null,
    "crewSize": null,
    "region": null,
    "materials": null,
    "workTypes": null,
    "websiteUrl": null,
    "suggestedCalculators": null,
    "customSowItems": [
      {"name": "Pool Installation", "description": "Full pool installation service", "unit": "EA", "category": "Installation"}
    ] or null (ONLY for OTHER trade),
    "customWorkTypes": [
      {"name": "Pool Excavation", "unit": "CY", "defaultRate": 50}
    ] or null (ONLY for OTHER trade),
    "customCalculators": [
      {"name": "Pool Volume Calculator", "description": "Calculate gallons from dimensions", "outputUnit": "gallons", "inputs": [{"name": "length", "unit": "ft"}, {"name": "width", "unit": "ft"}, {"name": "depth", "unit": "ft"}]}
    ] or null (ONLY for OTHER trade)
  },
  "suggestions": {
    "workTypes": null,
    "materials": null
  },
  "isComplete": false,
  "isCustomTrade": false,
  "step": 1
}

## Important Guidelines:

### CONVERSATIONAL PRIORITY - THIS IS CRITICAL:
- **ALWAYS acknowledge what the user said before moving on** - If they ask a question, answer it first. If they share something interesting, comment on it. Don't just extract data and rush to the next question.
- **Be genuinely interested** - React to what they share. "Oh, roofing in Texas? You must stay busy after storm season!" is better than "Got it. What's your crew size?"
- **If the user asks a question or goes off-topic, FULLY address it** before continuing the setup flow. Users hate feeling ignored.
- **Match their energy** - If they're brief, be efficient. If they're chatty, engage with them.
- **Use natural transitions** - Instead of "Next question:", say things like "That helps a lot! By the way..." or "Makes sense. One more thing I'm curious about..."

### Smart Research Triggers:
When the user mentions MATERIALS, SUPPLIES, or asks about what they'll need:
- Proactively suggest specific materials relevant to their trade
- Offer insights like "Most roofing contractors I work with track shingles, underlayment, flashing, and vents. Does that sound about right for you?"

When the user asks about SCOPE OF WORK, JOB TYPES, or SERVICES:
- Share the pre-built scope items we have for their trade
- Ask if there are any specific services they want to add or remove

### General Conversation Rules:
- Be conversational and friendly, not robotic
- Ask ONE question at a time - don't overwhelm them
- When you identify their trade from our preset list, tell them we have pre-built scope of work items for their trade that will be loaded automatically
- **SPECIAL: General Contractor Mode** - If user identifies as a GC/General Contractor/Builder, inform them this unlocks access to ALL 22 trade templates with scope of work items, calculators, and work types for subcontractor coordination across every specialty
- **SPECIAL: Custom Trade (OTHER)** - If user's trade doesn't match our 22 presets:
  - Set tradeType to "OTHER" and isCustomTrade to true
  - Tell them: "I don't have a preset template for your trade, but no problem! I'll help you set up a fully customized system. This actually gives you more flexibility to define exactly how you work."
  - Gather customSowItems (at least 5-10 common job types they perform)
  - Gather customWorkTypes with appropriate units
  - Ask about any calculations they frequently need
  - Be extra thorough since we're building their configuration from scratch
- For materials, suggest based on their trade's material categories (or ask if OTHER)
- For the website, explain it's optional but we can match their system colors to their brand
- Set isComplete to true only when you have gathered: trade type, crew size, region, and confirmed they're ready
- For OTHER trades, also ensure you have: tradeName, customSowItems (at least 3), customWorkTypes (at least 2)

Step progression for preset trades: 1=trade, 2=crew, 3=region, 4=workTypes confirmation, 5=materials, 6=website, 7=confirmation
Step progression for OTHER trades: 1=trade, 2=tradeName, 3=crew, 4=region, 5=customSowItems, 6=customWorkTypes, 7=materials, 8=customCalculators, 9=website, 10=confirmation`;
}

router.post("/ai/onboarding/complete", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {

    const validationResult = onboardingCompleteSchema.safeParse(req.body);
    if (!validationResult.success) {
      logError(`[Onboarding] Validation failed for user ${req.user.id}: ${fromZodError(validationResult.error).toString()}`);
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { 
      companyName, tradeType, tradeName, crewSize, region, materials, workTypes, websiteUrl, suggestedCalculators,
      customSowItems, customWorkTypes, customCalculators 
    } = validationResult.data;

    const validTradeTypes = tradeTypeEnum.enumValues;
    if (!validTradeTypes.includes(tradeType as any)) {
      logError(`[Onboarding] INVALID trade type attempted: "${tradeType}" by user ${req.user.id}`);
      return res.status(400).json({ 
        error: "Invalid trade type", 
        message: `Trade type "${tradeType}" is not valid. Valid options: ${validTradeTypes.join(', ')}` 
      });
    }

    logInfo(`[Onboarding] Starting for user ${req.user.id} | trade: ${tradeType} | company: ${companyName}`);

    const isHustler = req.user.role === 'HUSTLER';
    const isCustomTrade = tradeType === 'OTHER';
    const orgName = companyName || 'My Company';
    const sanitizedMaterials = materials || [];
    const sanitizedWorkTypes = (workTypes || []).filter((wt): wt is string => typeof wt === 'string' && wt.length > 0);

    let newOrg: typeof organizations.$inferSelect;
    
    if (req.user.organizationId && !isHustler) {
      const existingOrg = await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user.organizationId),
      });
      
      if (existingOrg && existingOrg.onboardingStatus === 'NOT_STARTED') {
        logInfo(`[Onboarding] Updating existing org ${existingOrg.id} for user ${req.user.id}`);
        
        const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const slug = `${baseSlug}-${Date.now().toString(36)}`;
        
        const [updatedOrg] = await db.update(organizations)
          .set({
            name: orgName,
            slug,
            tradeType: tradeType as any,
            tradeName: tradeName || null,
            typicalCrewSize: crewSize || null,
            region: region || null,
            websiteUrl: websiteUrl || null,
            onboardingStatus: 'COMPLETED',
            onboardingData: JSON.stringify({ 
              materials: sanitizedMaterials, 
              workTypes: sanitizedWorkTypes,
              suggestedCalculators: suggestedCalculators || [],
              customSowItems: customSowItems || [],
              customWorkTypes: customWorkTypes || [],
              customCalculators: customCalculators || [],
              isCustomTrade,
              completedAt: new Date() 
            }),
          })
          .where(eq(organizations.id, existingOrg.id))
          .returning();
        
        newOrg = updatedOrg;
      } else {
        logWarn(`[Onboarding] Non-Hustler user ${req.user.id} already has completed org ${req.user.organizationId}`);
        return res.status(400).json({ error: "You already belong to an organization" });
      }
    } else {
      const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const slug = `${baseSlug}-${Date.now().toString(36)}`;

      const [createdOrg] = await db.insert(organizations).values({
        name: orgName,
        slug,
        tradeType: tradeType as any,
        tradeName: tradeName || null,
        typicalCrewSize: crewSize || null,
        region: region || null,
        websiteUrl: websiteUrl || null,
        onboardingStatus: 'COMPLETED',
        onboardingData: JSON.stringify({ 
          materials: sanitizedMaterials, 
          workTypes: sanitizedWorkTypes,
          suggestedCalculators: suggestedCalculators || [],
          customSowItems: customSowItems || [],
          customWorkTypes: customWorkTypes || [],
          customCalculators: customCalculators || [],
          isCustomTrade,
          completedAt: new Date() 
        }),
      }).returning();
      
      newOrg = createdOrg;
    }

    if (isHustler) {
      await db.insert(hustlerOrganizations).values({
        userId: req.user.id,
        organizationId: newOrg.id,
        roleOverride: 'ADMIN',
        isActive: true,
      }).onConflictDoNothing();
      
      if (!req.user.organizationId) {
        await db.update(users)
          .set({ 
            organizationId: newOrg.id,
            isActive: true 
          })
          .where(eq(users.id, req.user.id));
      }
      
      logInfo(`[Onboarding] Hustler ${req.user.id} linked to new org ${newOrg.id}`);
    } else {
      await db.update(users)
        .set({ 
          organizationId: newOrg.id,
          role: 'ADMIN',
          isActive: true 
        })
        .where(eq(users.id, req.user.id));
    }

    const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
    
    logInfo(`[Onboarding] SOW generation | isGC: ${isGeneralContractor} | isCustom: ${isCustomTrade} | trade: ${tradeType}`);
    
    if (isCustomTrade) {
      const customTradeName = tradeName || 'Custom Trade';
      let sowItemCount = 0;
      
      if (customSowItems && customSowItems.length > 0) {
        for (let i = 0; i < customSowItems.length; i++) {
          const item = customSowItems[i];
          if (item && item.name) {
            const code = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
            await db.insert(organizationSowItems).values({
              organizationId: newOrg.id,
              categoryName: item.category || customTradeName,
              name: item.name,
              code: `custom_${code}_${i}`,
              description: item.description || null,
              unit: item.unit || 'EA',
              displayOrder: i,
              isFromTemplate: false,
              isActive: true,
            }).onConflictDoNothing();
            sowItemCount++;
          }
        }
      }
      
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName: customTradeName,
          name: wt,
          code: `sow_${code}_${i}`,
          displayOrder: sowItemCount + i,
          isFromTemplate: false,
          isActive: true,
        }).onConflictDoNothing();
        sowItemCount++;
      }
      
      if (sowItemCount === 0) {
        const defaultSowItems = [
          { name: `${customTradeName} - Standard Service`, category: customTradeName },
          { name: `${customTradeName} - Repair/Maintenance`, category: customTradeName },
          { name: `${customTradeName} - Installation`, category: customTradeName },
          { name: `${customTradeName} - Consultation`, category: customTradeName },
          { name: `${customTradeName} - Emergency Service`, category: customTradeName },
        ];
        for (let i = 0; i < defaultSowItems.length; i++) {
          const item = defaultSowItems[i];
          const code = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
          await db.insert(organizationSowItems).values({
            organizationId: newOrg.id,
            categoryName: item.category,
            name: item.name,
            code: `default_${code}_${i}`,
            unit: 'EA',
            displayOrder: i,
            isFromTemplate: false,
            isActive: true,
          }).onConflictDoNothing();
        }
      }
      
      let workTypeCount = 0;
      if (customWorkTypes && customWorkTypes.length > 0) {
        for (const wt of customWorkTypes) {
          if (wt && wt.name) {
            await db.insert(organizationWorkTypes).values({
              organizationId: newOrg.id,
              name: wt.name,
              category: customTradeName,
              unit: wt.unit || 'EA',
              defaultProductionRate: wt.defaultRate ? String(wt.defaultRate) : null,
            }).onConflictDoNothing();
            workTypeCount++;
          }
        }
      }
      
      if (workTypeCount === 0) {
        const defaultWorkTypes = [
          { name: 'General Work', unit: 'HR' },
          { name: 'Project Completion', unit: 'EA' },
          { name: 'Service Call', unit: 'EA' },
          { name: 'Material Installation', unit: 'SF' },
        ];
        for (const wt of defaultWorkTypes) {
          await db.insert(organizationWorkTypes).values({
            organizationId: newOrg.id,
            name: wt.name,
            category: customTradeName,
            unit: wt.unit,
          }).onConflictDoNothing();
        }
      }
      
      if (customCalculators && customCalculators.length > 0) {
        for (const calc of customCalculators) {
          if (calc && calc.name) {
            await db.insert(organizationCalculators).values({
              organizationId: newOrg.id,
              name: calc.name,
              category: customTradeName,
              unit: calc.outputUnit || 'units',
              formulaJson: JSON.stringify({ 
                type: 'custom', 
                description: calc.description || '',
                inputs: calc.inputs || [] 
              }),
              inputFieldsJson: JSON.stringify(calc.inputs || []),
            }).onConflictDoNothing();
          }
        }
      }
      
      if (!customCalculators || customCalculators.length === 0) {
        await db.insert(organizationCalculators).values({
          organizationId: newOrg.id,
          name: 'Material Quantity Calculator',
          category: customTradeName,
          unit: 'units',
          formulaJson: JSON.stringify({ 
            type: 'custom', 
            description: 'Calculate material quantity based on area',
            formula: 'area * coverage_rate'
          }),
          inputFieldsJson: JSON.stringify([
            { name: 'area', label: 'Area (sq ft)', type: 'number' },
            { name: 'coverage_rate', label: 'Coverage Rate', type: 'number' }
          ]),
        }).onConflictDoNothing();
      }
      
    } else {
      let masterItems;
      if (isGeneralContractor) {
        masterItems = await db
          .select()
          .from(masterSowItems)
          .where(eq(masterSowItems.isActive, true))
          .orderBy(asc(masterSowItems.tradeType), asc(masterSowItems.sortOrder));
      } else {
        masterItems = await db
          .select()
          .from(masterSowItems)
          .where(and(
            eq(masterSowItems.tradeType, tradeType as any),
            eq(masterSowItems.isActive, true)
          ))
          .orderBy(asc(masterSowItems.sortOrder));
      }

      for (const item of masterItems) {
        const categoryName = isGeneralContractor 
          ? `${item.tradeType} - ${item.categoryName || 'General'}`
          : (item.categoryName || 'General');
        
        const itemCode = isGeneralContractor
          ? `${item.tradeType}_${item.code}`
          : item.code;
        
        await db.insert(organizationSowItems).values({
          organizationId: newOrg.id,
          categoryName,
          name: item.name,
          code: itemCode,
          description: item.description,
          unit: item.defaultUomCode || 'EA',
          displayOrder: item.sortOrder || 0,
          requiresDimensions: item.requiresDimensions || false,
          dimensionLabel: item.dimensionLabel,
          isFromTemplate: true,
          isActive: true,
        }).onConflictDoNothing();
      }

      const masterItemNames = new Set(masterItems.map(m => m.name.toLowerCase()));
      for (let i = 0; i < sanitizedWorkTypes.length; i++) {
        const wt = sanitizedWorkTypes[i];
        if (!masterItemNames.has(wt.toLowerCase())) {
          const code = wt.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
          await db.insert(organizationSowItems).values({
            organizationId: newOrg.id,
            categoryName: tradeName || tradeType,
            name: wt,
            code: `custom_${code}_${i}`,
            displayOrder: masterItems.length + i,
            isFromTemplate: false,
            isActive: true,
          }).onConflictDoNothing();
        }
      }

      let templates;
      if (isGeneralContractor) {
        templates = await db.select().from(tradeTemplates).where(eq(tradeTemplates.isActive, true));
      } else {
        const [template] = await db.select().from(tradeTemplates).where(
          and(eq(tradeTemplates.tradeType, tradeType as any), eq(tradeTemplates.isActive, true))
        );
        templates = template ? [template] : [];
      }
      
      for (const template of templates) {
        try {
          const templateWorkTypes = JSON.parse(template.workTypesJson || '[]');
          for (let wtIdx = 0; wtIdx < templateWorkTypes.length; wtIdx++) {
            const wt = templateWorkTypes[wtIdx];
            if (wt && wt.name) {
              const workTypeName = isGeneralContractor 
                ? `[${template.tradeType}] ${wt.name}`
                : wt.name;
              const category = template.displayName || template.tradeType;
              
              await db.insert(organizationWorkTypes).values({
                organizationId: newOrg.id,
                name: workTypeName,
                category,
                unit: wt.unit || 'EA',
                defaultProductionRate: wt.rate ? String(wt.rate) : null,
              }).onConflictDoNothing();
            }
          }
        } catch (e) {
          console.error("Error parsing work types:", e);
        }

        try {
          const calculators = JSON.parse(template.calculatorConfigJson || '[]');
          for (let calcIdx = 0; calcIdx < calculators.length; calcIdx++) {
            const calc = calculators[calcIdx];
            if (calc && calc.name) {
              const calcName = isGeneralContractor 
                ? `[${template.tradeType}] ${calc.name}`
                : calc.name;
              const category = template.displayName || template.tradeType;
              
              await db.insert(organizationCalculators).values({
                organizationId: newOrg.id,
                name: calcName,
                category,
                unit: calc.output || 'units',
                formulaJson: JSON.stringify({ type: calc.type, inputs: calc.inputs, output: calc.output }),
                inputFieldsJson: JSON.stringify(calc.inputs || []),
              }).onConflictDoNothing();
            }
          }
        } catch (e) {
          console.error("Error parsing calculators:", e);
        }
      }
    }

    if (suggestedCalculators && suggestedCalculators.length > 0) {
      for (const calc of suggestedCalculators) {
        if (calc && calc.name) {
          await db.insert(organizationCalculators).values({
            organizationId: newOrg.id,
            name: calc.name,
            category: tradeName || tradeType,
            unit: 'units',
            formulaJson: JSON.stringify({ formula: 'quantity * rate', description: calc.description || '' }),
            inputFieldsJson: JSON.stringify([{ name: 'quantity', label: 'Quantity', type: 'number' }]),
          }).onConflictDoNothing();
        }
      }
    }

    try {
      await seedScopeStandardizationForTrade(tradeType);
      logInfo(`[Onboarding] Scope standardization seeded for trade: ${tradeType}`);
    } catch (scopeErr: any) {
      logWarn(`[Onboarding] Scope standardization seeding failed (non-fatal): ${scopeErr.message}`);
    }

    if (websiteUrl) {
      extractThemeFromWebsite(newOrg.id, websiteUrl, req.user.id).catch(err => {
        console.error("Theme extraction failed:", err.message);
      });
    }

    logInfo(`[Onboarding] SUCCESS | org: ${newOrg.id} | trade: ${tradeType} | isHustler: ${isHustler} | company: ${orgName}`);

    res.json({ 
      success: true, 
      organization: newOrg,
      message: "Your account has been configured successfully!",
      isHustler,
    });
  } catch (error: any) {
    logError(`[Onboarding] FAILED: ${error.message || "Unknown error"}`);
    console.error("Onboarding complete error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to complete onboarding. Please try again." });
  }
});

async function extractThemeFromWebsite(organizationId: string, websiteUrl: string, userId: string | null): Promise<void> {
  try {
    const url = new URL(websiteUrl);
    
    if (!['http:', 'https:'].includes(url.protocol)) {
      console.log("Theme extraction: Invalid protocol");
      return;
    }
    
    const hostname = url.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^0\./,
      /^169\.254\./,
      /\.local$/i,
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i,
    ];
    
    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      console.log("Theme extraction: Blocked internal IP/hostname");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SmartManageAI-Theme-Extractor/1.0',
        'Accept': 'text/html',
      },
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log("Theme extraction: Failed to fetch website");
      return;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1000000) {
      console.log("Theme extraction: Response too large");
      return;
    }

    const html = await response.text();
    
    const colorPatterns = [
      /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
    ];

    const foundColors: string[] = [];
    for (const pattern of colorPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        foundColors.push(...matches.slice(0, 10));
      }
    }

    if (foundColors.length > 0) {
      const governed = await governedAiCall({
        orgId: organizationId,
        userId,
        actionType: "onboarding_theme_extraction",
        inputRefs: { websiteUrl },
        fn: async () => {
          const colorAnalysis = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'system',
              content: 'You are a design expert. Given a list of colors found on a website, identify the most likely primary brand color, secondary color, and accent color. Return JSON with: {"primaryColor": "#hex", "secondaryColor": "#hex", "accentColor": "#hex"}'
            }, {
              role: 'user',
              content: `Colors found on website: ${foundColors.slice(0, 20).join(', ')}`
            }],
            response_format: { type: "json_object" },
            temperature: 0.3,
            max_tokens: 100,
          });
          return { result: colorAnalysis.choices[0]?.message?.content || '{}', completion: colorAnalysis };
        },
      });

      if (governed.blocked) {
        console.log(`Theme extraction blocked: ${governed.reason}`);
        return;
      }

      const themeColors = JSON.parse(governed.result);
      
      if (themeColors.primaryColor || themeColors.secondaryColor || themeColors.accentColor) {
        await db.update(organizations)
          .set({
            primaryColor: themeColors.primaryColor || null,
            secondaryColor: themeColors.secondaryColor || null,
            accentColor: themeColors.accentColor || null,
            themeExtractedAt: new Date(),
          })
          .where(eq(organizations.id, organizationId));
        
        console.log(`Theme extracted for org ${organizationId}:`, themeColors);
      }
    }
  } catch (error: any) {
    console.error("Theme extraction error:", error.message);
  }
}

router.post("/ai/onboarding/research-trade", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const validationResult = tradeResearchSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { tradeName } = validationResult.data;
    
    if (!tradeName) {
      return res.status(400).json({ error: "Trade name is required" });
    }
    
    console.log(`[Trade Research API] Researching trade: ${tradeName}`);
    const research = await researchCustomTrade(tradeName);
    
    res.json({
      success: true,
      research,
    });
  } catch (error: any) {
    console.error("Trade research error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to research trade. Please try again." });
  }
});

function buildTradeResearchContext(research: TradeResearchResult): string {
  const sowItems = research.scopeOfWorkItems
    ?.slice(0, 12)
    .map(item => `- ${item.name} (${item.unit}): ${item.description || ''}`)
    .join('\n') || '';
  
  const materials = research.commonMaterials
    ?.slice(0, 10)
    .map(m => `- ${m.name} (${m.unit}): ${m.description || ''}`)
    .join('\n') || '';
  
  const workTypes = research.workTypes
    ?.slice(0, 6)
    .map(wt => `- ${wt.name} (${wt.unit})${wt.typicalProductionRate ? ` - typical rate: ${wt.typicalProductionRate}` : ''}`)
    .join('\n') || '';
  
  const calculators = research.calculators
    ?.slice(0, 4)
    .map(c => `- ${c.name}: ${c.description || ''}`)
    .join('\n') || '';

  return `
## IMPORTANT: Research Data for "${research.tradeName}"

You have access to RESEARCHED INDUSTRY DATA for this specialty trade. Use this information to make educated suggestions during the conversation.

**Trade Description:** ${research.tradeDescription || ''}

**Common Scope of Work Items (suggest these):**
${sowItems}

**Common Materials:**
${materials}

**Work Types with Typical Units:**
${workTypes}

**Useful Calculators:**
${calculators}

**Vendor Categories:** ${research.vendorCategories?.join(', ') || 'General suppliers'}

**Industry Notes:** ${research.industryNotes || ''}

INSTRUCTIONS:
- Use this research to make informed suggestions
- Present the SOW items as "Based on ${research.tradeName} industry standards, here are common services..."
- Offer the materials list as suggestions they can confirm
- Suggest the work types with appropriate units
- Recommend the calculators that would be helpful
- The user can accept, modify, or add to these suggestions
`;
}

router.post("/ai/onboarding/chat", sensitiveLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    const validationResult = onboardingChatSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: fromZodError(validationResult.error).toString() 
      });
    }

    const { message, conversationHistory, tradeResearch } = validationResult.data;

    let systemPrompt = await buildOnboardingSystemPrompt();
    
    if (tradeResearch && tradeResearch.tradeName) {
      const researchContext = buildTradeResearchContext(tradeResearch as TradeResearchResult);
      systemPrompt += researchContext;
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    for (const msg of conversationHistory.slice(-20)) {
      if (msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message || '' });

    const governed = await governedAiCall({
      orgId: req.user.organizationId!,
      userId: req.user.id,
      actionType: "onboarding_chat",
      inputRefs: { messageLength: message?.length },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.7,
          max_tokens: 800,
          response_format: { type: "json_object" },
        });
        return { result: completion.choices[0]?.message?.content, completion };
      },
    });

    if (governed.blocked) {
      return res.status(429).json({ error: "AI rate limit reached", reason: governed.reason });
    }

    const responseText = governed.result;
    if (!responseText) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(responseText);
    res.json(parsed);
  } catch (error: any) {
    console.error("AI Onboarding error:", error.message || "Unknown error");
    res.status(500).json({ error: "Failed to get AI response. Please try again." });
  }
});

router.get("/ai/walkthrough/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [freshUser] = await db.select({
      walkthroughCompleted: users.walkthroughCompleted,
      walkthroughStep: users.walkthroughStep,
      walkthroughStartedAt: users.walkthroughStartedAt,
      role: users.role,
      organizationId: users.organizationId,
      firstName: users.firstName,
    }).from(users).where(eq(users.id, req.user.id));

    if (!freshUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!freshUser.organizationId) {
      return res.json({
        walkthroughCompleted: true,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
        totalSteps: 0,
        role: freshUser.role,
        walkthrough: null,
      });
    }

    const user = freshUser;
    const firstName = user.firstName || 'there';
    const walkthrough = getPersonalizedWalkthrough(user.role, firstName);
    const totalSteps = getTotalStepsForRole(user.role);
    
    const rawStep = user.walkthroughStep > 0 ? getWalkthroughStep(user.role, user.walkthroughStep) : null;
    const currentStep = rawStep ? {
      ...rawStep,
      description: personalizeContent(rawStep.description, firstName),
      action: personalizeContent(rawStep.action, firstName),
      encouragement: rawStep.encouragement ? personalizeContent(rawStep.encouragement, firstName) : undefined,
    } : null;

    res.json({
      walkthroughCompleted: user.walkthroughCompleted,
      walkthroughStep: user.walkthroughStep,
      walkthroughStartedAt: user.walkthroughStartedAt,
      totalSteps,
      role: user.role,
      firstName,
      walkthrough: walkthrough ? {
        roleName: walkthrough.roleName,
        welcomeMessage: walkthrough.welcomeMessage,
        completionMessage: walkthrough.completionMessage,
        currentStep,
      } : null,
    });
  } catch (error: any) {
    console.error("Walkthrough status error:", error.message);
    res.status(500).json({ error: "Failed to get walkthrough status" });
  }
});

router.post("/ai/walkthrough/start", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const firstName = req.user.firstName || 'there';
    const walkthrough = getPersonalizedWalkthrough(req.user.role, firstName);
    if (!walkthrough) {
      return res.status(400).json({ error: "No walkthrough available for this role" });
    }

    await db.update(users)
      .set({
        walkthroughStep: 1,
        walkthroughStartedAt: new Date(),
        walkthroughCompleted: false,
      })
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    const firstStep = walkthrough.steps[0] || null;

    res.json({
      success: true,
      currentStep: 1,
      totalSteps: walkthrough.steps.length,
      welcomeMessage: walkthrough.welcomeMessage,
      step: firstStep,
      firstName,
    });
  } catch (error: any) {
    console.error("Walkthrough start error:", error.message);
    res.status(500).json({ error: "Failed to start walkthrough" });
  }
});

router.post("/ai/walkthrough/next", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const [user] = await db.select({
      walkthroughStep: users.walkthroughStep,
      role: users.role,
      firstName: users.firstName,
    }).from(users).where(and(
      eq(users.id, req.user.id),
      eq(users.organizationId, req.user.organizationId)
    ));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const firstName = user.firstName || 'there';
    const totalSteps = getTotalStepsForRole(user.role);
    const nextStep = user.walkthroughStep + 1;

    if (nextStep > totalSteps) {
      await db.update(users)
        .set({
          walkthroughCompleted: true,
          walkthroughStep: totalSteps,
        })
        .where(and(
          eq(users.id, req.user.id),
          eq(users.organizationId, req.user.organizationId)
        ));

      const walkthrough = getPersonalizedWalkthrough(user.role, firstName);

      res.json({
        success: true,
        completed: true,
        completionMessage: walkthrough?.completionMessage || `Congratulations, ${firstName}! You've completed the walkthrough!`,
        firstName,
      });
    } else {
      await db.update(users)
        .set({ walkthroughStep: nextStep })
        .where(and(
          eq(users.id, req.user.id),
          eq(users.organizationId, req.user.organizationId)
        ));

      const rawStep = getWalkthroughStep(user.role, nextStep);
      const stepContent = rawStep ? {
        ...rawStep,
        description: personalizeContent(rawStep.description, firstName),
        action: personalizeContent(rawStep.action, firstName),
        encouragement: rawStep.encouragement ? personalizeContent(rawStep.encouragement, firstName) : undefined,
      } : null;

      res.json({
        success: true,
        completed: false,
        currentStep: nextStep,
        totalSteps,
        step: stepContent,
        firstName,
      });
    }
  } catch (error: any) {
    console.error("Walkthrough next error:", error.message);
    res.status(500).json({ error: "Failed to advance walkthrough" });
  }
});

router.post("/ai/walkthrough/complete", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const totalSteps = getTotalStepsForRole(req.user.role);

    await db.update(users)
      .set({
        walkthroughCompleted: true,
        walkthroughStep: totalSteps,
      })
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    res.json({
      success: true,
      message: "Walkthrough completed",
    });
  } catch (error: any) {
    console.error("Walkthrough complete error:", error.message);
    res.status(500).json({ error: "Failed to complete walkthrough" });
  }
});

router.post("/ai/walkthrough/reset", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    await db.update(users)
      .set({
        walkthroughCompleted: false,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
      })
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    res.json({
      success: true,
      message: "Walkthrough reset",
    });
  } catch (error: any) {
    console.error("Walkthrough reset error:", error.message);
    res.status(500).json({ error: "Failed to reset walkthrough" });
  }
});

router.patch("/ai/walkthrough/step", requireAuth, async (req: AuthRequest, res) => {
  try {

    if (!req.user.organizationId) {
      return res.status(400).json({ error: "Please complete organization setup first" });
    }

    const { step, completed } = req.body;

    if (typeof step !== 'number' || step < 0) {
      return res.status(400).json({ error: "Valid step number is required" });
    }

    const updateData: Record<string, any> = {
      walkthroughStep: step,
    };

    if (typeof completed === 'boolean') {
      updateData.walkthroughCompleted = completed;
    }

    if (step === 1 && !completed) {
      updateData.walkthroughStartedAt = new Date();
    }

    await db.update(users)
      .set(updateData)
      .where(and(
        eq(users.id, req.user.id),
        eq(users.organizationId, req.user.organizationId)
      ));

    res.json({
      success: true,
      step,
      completed: updateData.walkthroughCompleted ?? false,
    });
  } catch (error: any) {
    console.error("Walkthrough step update error:", error.message);
    res.status(500).json({ error: "Failed to update walkthrough step" });
  }
});

export default router;
