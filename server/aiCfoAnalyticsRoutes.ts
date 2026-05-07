import { Router , NextFunction } from "express";
import { safeJsonParse } from "./responseHelper";
import { db } from "./db";
import { vendorPricebooks, vendorPricebookItems, aiCoDrafts, organizations, projects, changeOrders, equipment as equipmentTable } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole, requireAnyFeaturePermission } from "./auth";
import { logError } from "./utils/logger";
import { getOrgId, parsePagination } from "./utils/routeHelpers";
import { getLatestAIRun } from "./ai/orchestrator";
import { getAiAuditLog, getOrgLimitsWithUsage, getCostBreakdownByActionType } from "./services/aiGovernance";

const router = Router();

router.use("/cfo", requireAuth, requireAnyFeaturePermission('canUseAiFeatures', 'canViewFinancials'));

router.get("/cfo/profitability", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const latestRun = await getLatestAIRun();

    if (latestRun?.profitabilityData) {
      const profitabilityData = safeJsonParse(latestRun.profitabilityData, null);
      return res.json(profitabilityData);
    }

    const { calculateAllProjectsProfitability } = await import("./ai/profitabilityEngine");
    const liveData = await calculateAllProjectsProfitability();
    res.json(liveData);
  } catch (error) {
  next(error);
  }
});

router.get("/cfo/equipment-metrics", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const latestRun = await getLatestAIRun();

    if (!latestRun || !latestRun.snapshotData) {
      const allEquipment = await db.select().from(equipmentTable).where(eq(equipmentTable.organizationId, req.user!.organizationId)).limit(500);
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

    const snapshotData = safeJsonParse(latestRun.snapshotData, null);
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
  } catch (error) {
  next(error);
  }
});

router.get("/cfo/forecasting", requireAuth, async (req: AuthRequest, res, next) => {
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
  } catch (error) {
  next(error);
  }
});

router.get("/cfo/scurve-data", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { projects: projectsTable, timeEntries, receipts, subcontractorPayments, subcontractorContracts, budgetLineItems } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");

    const orgProjects = await db.select({
      id: projectsTable.id,
      budget: projectsTable.budget,
      contractAmount: projectsTable.contractAmount,
      startDate: projectsTable.startDate,
      endDate: projectsTable.endDate,
    }).from(projectsTable).where(and(
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

    const orgDefaultRateResult = await db.execute(sql`
      SELECT COALESCE(AVG(NULLIF(jc.default_regular_rate, 0)), 0) as avg_regular,
             COALESCE(AVG(NULLIF(jc.default_overtime_rate, 0)), 0) as avg_overtime
      FROM job_classifications jc
      WHERE jc.organization_id = ${orgId} AND jc.is_active = true
    `);
    const orgDefaultRows = (orgDefaultRateResult.rows || orgDefaultRateResult) as { avg_regular: number; avg_overtime: number }[];
    const orgDefaultRegularRate = Number(orgDefaultRows[0]?.avg_regular) || 0;
    const orgDefaultOvertimeRate = Number(orgDefaultRows[0]?.avg_overtime) || 0;
    const fallbackRegularRate = orgDefaultRegularRate > 0 ? orgDefaultRegularRate : 45;
    const fallbackOvertimeRate = orgDefaultOvertimeRate > 0 ? orgDefaultOvertimeRate : (fallbackRegularRate * 1.5);

    const laborResult = await db.execute(sql`
      SELECT TO_CHAR(te.date, 'YYYY-MM') as month,
        COALESCE(SUM(
          COALESCE(te.hours_regular, 0) * COALESCE(ec.regular_rate, jc.default_regular_rate, ${fallbackRegularRate})
          + COALESCE(te.hours_overtime, 0) * COALESCE(ec.overtime_rate, jc.default_overtime_rate, ${fallbackOvertimeRate})
        ), 0) as total
      FROM time_entries te
      LEFT JOIN employee_classifications ec
        ON ec.user_id = te.user_id AND ec.organization_id = ${orgId} AND ec.is_primary = true AND (ec.end_date IS NULL OR ec.end_date >= NOW())
      LEFT JOIN job_classifications jc
        ON jc.id = ec.classification_id AND jc.organization_id = ${orgId}
      WHERE te.project_id IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})
        AND te.approval_status = 'APPROVED'
      GROUP BY TO_CHAR(te.date, 'YYYY-MM')
      ORDER BY TO_CHAR(te.date, 'YYYY-MM')
    `);
    const laborByMonth = (laborResult.rows || laborResult) as { month: string; total: number }[];

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
  } catch (error) {
  next(error);
  }
});

router.get("/cfo/budget-alerts", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { budgetAlerts, projects: projectsTable } = await import("@shared/schema");

    const activeAlerts = await db.select({
      alert: budgetAlerts,
      projectCode: projectsTable.code,
      projectName: projectsTable.name,
    }).from(budgetAlerts)
      .innerJoin(projectsTable, eq(budgetAlerts.projectId, projectsTable.id))
      .where(and(eq(budgetAlerts.isDismissed, false), eq(projectsTable.gcOrganizationId, orgId)))
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
  } catch (error) {
  next(error);
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
router.post("/ai-features/vendors/pricebook/upload", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

// GET /api/ai-features/vendors/pricebook/items - Get pricebook items
router.get("/ai-features/vendors/pricebook/items", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

// GET /api/ai-features/vendors/pricebooks - List vendor pricebooks
router.get("/ai-features/vendors/pricebooks", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
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
router.post("/ai-features/change-orders/generate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
    const draftContent = await generateCoDraft(effectiveTradeType, linkedItems, organizationId);

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
    next(error);
  }
});

async function generateCoDraft(tradeType: string, linkedItems: any, organizationId?: string) {
  const tradeTerms: Record<string, string> = {
    ROOFING: "hidden deck damage discovered during tear-off operations",
    ELECTRICAL: "additional circuits required per updated code requirements",
    CONCRETE: "unforeseen soil conditions requiring additional excavation",
    GENERAL_CONTRACTOR: "scope modifications per field conditions",
  };

  const reason = tradeTerms[tradeType] || tradeTerms.GENERAL_CONTRACTOR;

  let skilledRate = 75;
  let generalRate = 45;

  if (organizationId) {
    try {
      const { jobClassifications } = await import("@shared/schema");
      const classifications = await db.select({
        name: jobClassifications.name,
        rate: jobClassifications.defaultRegularRate,
      }).from(jobClassifications)
        .where(and(eq(jobClassifications.organizationId, organizationId), eq(jobClassifications.isActive, true)))
        .orderBy(desc(jobClassifications.defaultRegularRate));

      const ratesWithValues = classifications.filter(c => c.rate && Number(c.rate) > 0);

      if (ratesWithValues.length > 0) {
        skilledRate = Number(ratesWithValues[0].rate);
        generalRate = ratesWithValues.length > 1
          ? Number(ratesWithValues[ratesWithValues.length - 1].rate)
          : skilledRate;
      }
    } catch (err) {
      logError("Failed to fetch org classification rates for CO draft:", { organizationId }, err instanceof Error ? err : new Error(String(err)));
    }
  }

  const skilledAmount = 16 * skilledRate;
  const generalAmount = 8 * generalRate;
  const laborTotal = skilledAmount + generalAmount;
  const materialsTotal = 850;
  const equipmentTotal = 150;
  const subtotal = laborTotal + materialsTotal + equipmentTotal;
  const overhead = Math.round(subtotal * 0.1);
  const profit = Math.round(subtotal * 0.1);

  return {
    title: `Change Order - ${new Date().toLocaleDateString()}`,
    description: `This change order addresses ${reason}. Work includes additional labor and materials as detailed below.`,
    justification: linkedItems.notes || `Additional work required due to ${reason}. This was not foreseeable at time of original bid.`,
    scopeOfWork: `Furnish all labor, materials, and equipment necessary to complete the additional work as described. Work to be performed in accordance with project specifications and industry standards.`,
    exclusions: "This change order does not include: work outside the described scope, permits unless noted, or changes to project schedule beyond completion of this work.",
    terms: "Payment due upon completion and acceptance. Work to commence within 5 business days of approval.",
    lineItems: {
      labor: [
        { description: "Skilled Labor", hours: 16, rate: skilledRate, amount: skilledAmount },
        { description: "General Labor", hours: 8, rate: generalRate, amount: generalAmount },
      ],
      materials: [
        { description: "Additional Materials", quantity: 1, unit: "LS", unitPrice: 850, amount: 850 },
      ],
      equipment: [
        { description: "Equipment Usage", days: 1, dailyRate: 150, amount: 150 },
      ],
    },
    subtotals: {
      labor: laborTotal,
      materials: materialsTotal,
      equipment: equipmentTotal,
      subtotal,
      overhead,
      profit,
      total: subtotal + overhead + profit,
    },
  };
}

// GET /api/ai-features/change-orders/drafts/:projectId - Get drafts for project
router.get("/ai-features/change-orders/drafts/:projectId", requireAuth, async (req: AuthRequest, res, next) => {
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
        sql`${aiCoDrafts.status} IN ('DRAFT')`
      ))
      .orderBy(desc(aiCoDrafts.createdAt));

    res.json({ drafts });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/ai-features/change-orders/drafts/:draftId - Update draft status
router.patch("/ai-features/change-orders/drafts/:draftId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

    const { status } = req.body;
    const validStatuses = ["DRAFT", "CONVERTED", "DISCARDED"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const [draft] = await db.select().from(aiCoDrafts).where(
      and(eq(aiCoDrafts.id, req.params.draftId), eq(aiCoDrafts.organizationId, organizationId))
    );
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    await db.update(aiCoDrafts)
      .set({ status, updatedAt: new Date() })
      .where(eq(aiCoDrafts.id, draft.id));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai-features/change-orders/drafts/:draftId/convert - Convert draft to real CO
router.post("/ai-features/change-orders/drafts/:draftId/convert", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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

    const draftContent = safeJsonParse(draft.draftContentJson, {});

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
    next(error);
  }
});

// GET /api/ai-features/sub-recommendations - Get subcontractor recommendations
router.get("/ai-features/sub-recommendations", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
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

router.get("/audit", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { limit, offset } = parsePagination(req);
    const { dateFrom, dateTo } = parseDateRange(req);
    const result = await getAiAuditLog(orgId, limit, offset, dateFrom, dateTo);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/usage", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const data = await getOrgLimitsWithUsage(orgId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get("/cost-breakdown", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { dateFrom, dateTo } = parseDateRange(req);
    const breakdown = await getCostBreakdownByActionType(orgId, dateFrom, dateTo);
    res.json(breakdown);
  } catch (err) {
    next(err);
  }
});

export default router;
