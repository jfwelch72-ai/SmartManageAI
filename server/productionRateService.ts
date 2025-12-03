import { db } from "./db";
import { dailyScopeProgress, scopeItems, projects } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export interface ProductionRateStats {
  description: string;
  unit: string;
  avgPerDay: number;
  minPerDay: number;
  maxPerDay: number;
  medianPerDay: number;
  stdDev: number;
  totalDays: number;
  totalProjects: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

export interface LaborEstimate {
  suggestedLaborHours: number;
  productionRateUsed: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  dataSource: string;
  totalDaysOfData: number;
}

export class OrganizationRequiredError extends Error {
  constructor(message: string = "Organization ID is required") {
    super(message);
    this.name = "OrganizationRequiredError";
  }
}

export async function getProductionRateForSOW(
  description: string,
  unit: string,
  organizationId: string
): Promise<ProductionRateStats | null> {
  if (!organizationId || organizationId.trim() === '') {
    throw new OrganizationRequiredError("getProductionRateForSOW requires a valid organizationId");
  }
  
  const conditions: any[] = [
    eq(scopeItems.description, description),
    eq(scopeItems.unit, unit),
    eq(projects.gcOrganizationId, organizationId)
  ];

  const results = await db
    .select({
      workDate: dailyScopeProgress.workDate,
      quantityCompleted: dailyScopeProgress.quantityCompleted,
      projectCode: projects.code,
    })
    .from(dailyScopeProgress)
    .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
    .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
    .where(and(...conditions));

    if (results.length === 0) {
      return null;
    }

    const dailyTotals = new Map<string, { total: number; projects: Set<string> }>();
    
    for (const entry of results) {
      const dateKey = entry.workDate;
      const qty = parseFloat(entry.quantityCompleted);
      
      if (!dailyTotals.has(dateKey)) {
        dailyTotals.set(dateKey, { total: 0, projects: new Set() });
      }
      
      const day = dailyTotals.get(dateKey)!;
      day.total += qty;
      day.projects.add(entry.projectCode);
    }

    const dailyTotalsArray = Array.from(dailyTotals.values()).map(d => d.total);
    const sortedDailyTotals = [...dailyTotalsArray].sort((a, b) => a - b);
    const totalDays = dailyTotals.size;
    const totalQuantity = dailyTotalsArray.reduce((sum, v) => sum + v, 0);
    const avgPerDay = totalDays > 0 ? totalQuantity / totalDays : 0;
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

    const totalProjects = new Set(results.map(r => r.projectCode)).size;

    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
    if (totalDays >= 10 && totalProjects >= 3) {
      confidence = 'HIGH';
    } else if (totalDays >= 5 && totalProjects >= 2) {
      confidence = 'MEDIUM';
    } else if (totalDays >= 2) {
      confidence = 'LOW';
    }

  return {
    description,
    unit,
    avgPerDay: Math.round(avgPerDay * 100) / 100,
    minPerDay: Math.round(minPerDay * 100) / 100,
    maxPerDay: Math.round(maxPerDay * 100) / 100,
    medianPerDay: Math.round(medianPerDay * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    totalDays,
    totalProjects,
    confidence,
  };
}

export async function estimateLaborHoursFromProductionRate(
  description: string,
  unit: string,
  quantity: number,
  organizationId: string,
  workdayHours: number = 8
): Promise<LaborEstimate> {
  if (!organizationId || organizationId.trim() === '') {
    throw new OrganizationRequiredError("estimateLaborHoursFromProductionRate requires a valid organizationId");
  }
  
  const rate = await getProductionRateForSOW(description, unit, organizationId);

  if (!rate || rate.avgPerDay === 0) {
    return {
      suggestedLaborHours: 0,
      productionRateUsed: 0,
      confidence: 'NONE',
      dataSource: 'No production data available',
      totalDaysOfData: 0,
    };
  }

  const daysNeeded = quantity / rate.avgPerDay;
  const suggestedLaborHours = Math.round(daysNeeded * workdayHours * 100) / 100;

  return {
    suggestedLaborHours,
    productionRateUsed: rate.avgPerDay,
    confidence: rate.confidence,
    dataSource: `Based on ${rate.totalDays} days of data across ${rate.totalProjects} projects`,
    totalDaysOfData: rate.totalDays,
  };
}

export async function getProductionRateSuggestions(
  organizationId: string,
  searchTerm?: string,
  unit?: string,
  limit: number = 10
): Promise<ProductionRateStats[]> {
  if (!organizationId || organizationId.trim() === '') {
    throw new OrganizationRequiredError("getProductionRateSuggestions requires a valid organizationId");
  }
  
  const conditions: any[] = [eq(projects.gcOrganizationId, organizationId)];

    const results = await db
      .select({
        description: scopeItems.description,
        unit: scopeItems.unit,
        workDate: dailyScopeProgress.workDate,
        quantityCompleted: dailyScopeProgress.quantityCompleted,
        projectCode: projects.code,
      })
      .from(dailyScopeProgress)
      .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
      .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
      .where(and(...conditions));

    const ratesBySOW = new Map<string, {
      description: string;
      unit: string;
      dailyTotals: Map<string, number>;
      projectCodes: Set<string>;
    }>();

    for (const entry of results) {
      const key = `${entry.description}|||${entry.unit}`;
      
      if (!ratesBySOW.has(key)) {
        ratesBySOW.set(key, {
          description: entry.description,
          unit: entry.unit,
          dailyTotals: new Map(),
          projectCodes: new Set(),
        });
      }

      const sow = ratesBySOW.get(key)!;
      const qty = parseFloat(entry.quantityCompleted);
      const dateKey = entry.workDate;
      
      sow.dailyTotals.set(dateKey, (sow.dailyTotals.get(dateKey) || 0) + qty);
      sow.projectCodes.add(entry.projectCode);
    }

    const allRates: ProductionRateStats[] = [];

    const sowValues = Array.from(ratesBySOW.values());
    for (const sow of sowValues) {
      if (searchTerm && !sow.description.toLowerCase().includes(searchTerm.toLowerCase())) {
        continue;
      }
      if (unit && sow.unit !== unit) {
        continue;
      }

      const dailyTotalsArray: number[] = Array.from(sow.dailyTotals.values());
      const sortedDailyTotals: number[] = [...dailyTotalsArray].sort((a: number, b: number) => a - b);
      const totalDays = sow.dailyTotals.size;
      const totalQuantity: number = dailyTotalsArray.reduce((sum: number, v: number) => sum + v, 0);
      const avgPerDay: number = totalDays > 0 ? totalQuantity / totalDays : 0;
      const minPerDay: number = sortedDailyTotals.length > 0 ? sortedDailyTotals[0] : 0;
      const maxPerDay: number = sortedDailyTotals.length > 0 ? sortedDailyTotals[sortedDailyTotals.length - 1] : 0;

      let medianPerDay: number = 0;
      if (sortedDailyTotals.length > 0) {
        const mid = Math.floor(sortedDailyTotals.length / 2);
        medianPerDay = sortedDailyTotals.length % 2 !== 0
          ? sortedDailyTotals[mid]
          : (sortedDailyTotals[mid - 1] + sortedDailyTotals[mid]) / 2;
      }

      let stdDev: number = 0;
      if (sortedDailyTotals.length > 1) {
        const variance = sortedDailyTotals.reduce((sum: number, dayTotal: number) => sum + Math.pow(dayTotal - avgPerDay, 2), 0) / sortedDailyTotals.length;
        stdDev = Math.sqrt(variance);
      }

      const totalProjects = sow.projectCodes.size;

      let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
      if (totalDays >= 10 && totalProjects >= 3) {
        confidence = 'HIGH';
      } else if (totalDays >= 5 && totalProjects >= 2) {
        confidence = 'MEDIUM';
      } else if (totalDays >= 2) {
        confidence = 'LOW';
      }

      allRates.push({
        description: sow.description,
        unit: sow.unit,
        avgPerDay: Math.round(avgPerDay * 100) / 100,
        minPerDay: Math.round(minPerDay * 100) / 100,
        maxPerDay: Math.round(maxPerDay * 100) / 100,
        medianPerDay: Math.round(medianPerDay * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        totalDays,
        totalProjects,
        confidence,
      });
    }

  allRates.sort((a, b) => {
    const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
    return confidenceOrder[a.confidence] - confidenceOrder[b.confidence] || b.totalDays - a.totalDays;
  });

  return allRates.slice(0, limit);
}
