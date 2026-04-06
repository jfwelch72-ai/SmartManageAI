import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import {
  projects, users, scopeItems, changeOrders,
  dailyScopeProgress, tmTickets,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

router.get("/api/production-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    logError("Get production rates error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/detail", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    logError("Get production rate detail error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/unified", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    logError("Get unified production rates error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/metrics", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    logError("Get production rate metrics error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/production-rates/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
    logError("Get production rate estimate error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
