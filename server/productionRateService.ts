import { db } from "./db";
import { dailyScopeProgress, scopeItems, projects, users, timeClockShifts } from "@shared/schema";
import { eq, and, sql, gte, lte, isNotNull } from "drizzle-orm";

// Enhanced Production Rate Stats with full cost metrics
export interface ProductionRateStats {
  description: string;
  unit: string;
  // Productivity metrics
  avgQuantityPerDay: number;
  minQuantityPerDay: number;
  maxQuantityPerDay: number;
  medianQuantityPerDay: number;
  avgCrewSize: number;
  // Labor metrics
  avgLaborHoursPerUnit: number;
  avgLaborCostPerUnit: number;
  totalLaborHours: number;
  totalLaborCost: number;
  // Material metrics
  avgMaterialCostPerUnit: number;
  totalMaterialCost: number;
  // Equipment metrics
  avgEquipmentCostPerUnit: number;
  totalEquipmentCost: number;
  // Total cost metrics
  avgTotalCostPerUnit: number;
  totalCost: number;
  // Profitability (if unit price available)
  avgRevenuePerUnit: number;
  avgProfitPerUnit: number;
  avgProfitMargin: number;
  // Statistics
  totalQuantityCompleted: number;
  totalDays: number;
  totalProjects: number;
  stdDev: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

// Simplified stats for backward compatibility
export interface SimpleProductionRateStats {
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
  suggestedLaborCost: number;
  suggestedMaterialCost: number;
  suggestedTotalCost: number;
  productionRateUsed: number;
  laborHoursPerUnit: number;
  laborCostPerUnit: number;
  materialCostPerUnit: number;
  totalCostPerUnit: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  dataSource: string;
  totalDaysOfData: number;
}

export interface QuantityRangeBucket {
  minQuantity: number;
  maxQuantity: number;
  label: string;
  stats: ProductionRateStats;
}

export class OrganizationRequiredError extends Error {
  constructor(message: string = "Organization ID is required") {
    super(message);
    this.name = "OrganizationRequiredError";
  }
}

// Helper to calculate statistics
function calculateStats(values: number[]): { avg: number; min: number; max: number; median: number; stdDev: number } {
  if (values.length === 0) {
    return { avg: 0, min: 0, max: 0, median: 0, stdDev: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  let median = 0;
  const mid = Math.floor(sorted.length / 2);
  median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  
  let stdDev = 0;
  if (values.length > 1) {
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    stdDev = Math.sqrt(variance);
  }
  
  return { avg, min, max, median, stdDev };
}

function round(num: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function determineConfidence(totalDays: number, totalProjects: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' {
  if (totalDays >= 10 && totalProjects >= 3) return 'HIGH';
  if (totalDays >= 5 && totalProjects >= 2) return 'MEDIUM';
  if (totalDays >= 2) return 'LOW';
  return 'NONE';
}

// Enhanced function to get comprehensive production rate metrics
export async function getProductionRateForSOW(
  description: string,
  unit: string,
  organizationId: string,
  options?: {
    minQuantity?: number;
    maxQuantity?: number;
    startDate?: Date;
    endDate?: Date;
    projectId?: string;
  }
): Promise<ProductionRateStats | null> {
  if (!organizationId || organizationId.trim() === '') {
    throw new OrganizationRequiredError("getProductionRateForSOW requires a valid organizationId");
  }
  
  const conditions: any[] = [
    eq(scopeItems.description, description),
    eq(scopeItems.unit, unit),
    eq(projects.gcOrganizationId, organizationId)
  ];

  if (options?.startDate) {
    conditions.push(gte(dailyScopeProgress.workDate, options.startDate.toISOString().split('T')[0]));
  }
  if (options?.endDate) {
    conditions.push(lte(dailyScopeProgress.workDate, options.endDate.toISOString().split('T')[0]));
  }
  if (options?.projectId) {
    conditions.push(eq(dailyScopeProgress.projectId, options.projectId));
  }

  const results = await db
    .select({
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
      projectCode: projects.code,
      unitPrice: scopeItems.unitPrice,
    })
    .from(dailyScopeProgress)
    .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
    .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
    .where(and(...conditions));

  if (results.length === 0) {
    return null;
  }

  // Filter by quantity range if specified
  let filteredResults = results;
  if (options?.minQuantity !== undefined || options?.maxQuantity !== undefined) {
    filteredResults = results.filter(r => {
      const qty = parseFloat(r.quantityCompleted);
      if (options?.minQuantity !== undefined && qty < options.minQuantity) return false;
      if (options?.maxQuantity !== undefined && qty > options.maxQuantity) return false;
      return true;
    });
    
    if (filteredResults.length === 0) return null;
  }

  // Aggregate data
  const dailyQuantities: number[] = [];
  const crewSizes: number[] = [];
  const laborHoursPerUnit: number[] = [];
  const laborCostPerUnit: number[] = [];
  const materialCostPerUnit: number[] = [];
  const totalCostPerUnit: number[] = [];
  const unitPrices: number[] = [];
  
  let totalQuantity = 0;
  let totalLaborHours = 0;
  let totalLaborCost = 0;
  let totalMaterialCost = 0;
  let totalEquipmentCost = 0;
  const projectCodes = new Set<string>();
  const workDates = new Set<string>();

  for (const entry of filteredResults) {
    const qty = parseFloat(entry.quantityCompleted) || 0;
    totalQuantity += qty;
    dailyQuantities.push(qty);
    
    if (entry.crewSize) crewSizes.push(entry.crewSize);
    if (entry.laborHours) totalLaborHours += parseFloat(entry.laborHours);
    if (entry.laborCost) totalLaborCost += parseFloat(entry.laborCost);
    if (entry.materialCost) totalMaterialCost += parseFloat(entry.materialCost);
    if (entry.equipmentCost) totalEquipmentCost += parseFloat(entry.equipmentCost);
    if (entry.laborHoursPerUnit) laborHoursPerUnit.push(parseFloat(entry.laborHoursPerUnit));
    if (entry.laborCostPerUnit) laborCostPerUnit.push(parseFloat(entry.laborCostPerUnit));
    if (entry.materialCostPerUnit) materialCostPerUnit.push(parseFloat(entry.materialCostPerUnit));
    if (entry.totalCostPerUnit) totalCostPerUnit.push(parseFloat(entry.totalCostPerUnit));
    if (entry.unitPrice) unitPrices.push(parseFloat(entry.unitPrice));
    
    projectCodes.add(entry.projectCode);
    workDates.add(entry.workDate);
  }

  const totalDays = workDates.size;
  const totalProjects = projectCodes.size;
  const qtyStats = calculateStats(dailyQuantities);
  const confidence = determineConfidence(totalDays, totalProjects);

  // Calculate per-unit averages from aggregates if not stored
  const avgLaborHoursPerUnit = laborHoursPerUnit.length > 0 
    ? laborHoursPerUnit.reduce((a, b) => a + b, 0) / laborHoursPerUnit.length
    : (totalQuantity > 0 ? totalLaborHours / totalQuantity : 0);
    
  const avgLaborCostPerUnit = laborCostPerUnit.length > 0
    ? laborCostPerUnit.reduce((a, b) => a + b, 0) / laborCostPerUnit.length
    : (totalQuantity > 0 ? totalLaborCost / totalQuantity : 0);
    
  const avgMaterialCostPerUnit = materialCostPerUnit.length > 0
    ? materialCostPerUnit.reduce((a, b) => a + b, 0) / materialCostPerUnit.length
    : (totalQuantity > 0 ? totalMaterialCost / totalQuantity : 0);
    
  const avgEquipmentCostPerUnit = totalQuantity > 0 ? totalEquipmentCost / totalQuantity : 0;
  const totalCost = totalLaborCost + totalMaterialCost + totalEquipmentCost;
  const avgTotalCostPerUnit = totalQuantity > 0 ? totalCost / totalQuantity : 0;
  
  const avgRevenuePerUnit = unitPrices.length > 0 
    ? unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length 
    : 0;
  const avgProfitPerUnit = avgRevenuePerUnit - avgTotalCostPerUnit;
  const avgProfitMargin = avgRevenuePerUnit > 0 ? (avgProfitPerUnit / avgRevenuePerUnit) * 100 : 0;
  const avgCrewSize = crewSizes.length > 0 ? crewSizes.reduce((a, b) => a + b, 0) / crewSizes.length : 0;

  return {
    description,
    unit,
    avgQuantityPerDay: round(qtyStats.avg),
    minQuantityPerDay: round(qtyStats.min),
    maxQuantityPerDay: round(qtyStats.max),
    medianQuantityPerDay: round(qtyStats.median),
    avgCrewSize: round(avgCrewSize, 1),
    avgLaborHoursPerUnit: round(avgLaborHoursPerUnit, 4),
    avgLaborCostPerUnit: round(avgLaborCostPerUnit, 4),
    totalLaborHours: round(totalLaborHours),
    totalLaborCost: round(totalLaborCost),
    avgMaterialCostPerUnit: round(avgMaterialCostPerUnit, 4),
    totalMaterialCost: round(totalMaterialCost),
    avgEquipmentCostPerUnit: round(avgEquipmentCostPerUnit, 4),
    totalEquipmentCost: round(totalEquipmentCost),
    avgTotalCostPerUnit: round(avgTotalCostPerUnit, 4),
    totalCost: round(totalCost),
    avgRevenuePerUnit: round(avgRevenuePerUnit, 4),
    avgProfitPerUnit: round(avgProfitPerUnit, 4),
    avgProfitMargin: round(avgProfitMargin, 1),
    totalQuantityCompleted: round(totalQuantity),
    totalDays,
    totalProjects,
    stdDev: round(qtyStats.stdDev),
    confidence,
  };
}

// Get production rates with quantity bucketing
export async function getProductionRatesByQuantityRange(
  description: string,
  unit: string,
  organizationId: string,
  buckets: Array<{ minQuantity: number; maxQuantity: number; label: string }>
): Promise<QuantityRangeBucket[]> {
  const results: QuantityRangeBucket[] = [];
  
  for (const bucket of buckets) {
    const stats = await getProductionRateForSOW(description, unit, organizationId, {
      minQuantity: bucket.minQuantity,
      maxQuantity: bucket.maxQuantity,
    });
    
    if (stats) {
      results.push({
        minQuantity: bucket.minQuantity,
        maxQuantity: bucket.maxQuantity,
        label: bucket.label,
        stats,
      });
    }
  }
  
  return results;
}

// Default quantity buckets for common use
export const DEFAULT_QUANTITY_BUCKETS = [
  { minQuantity: 0, maxQuantity: 500, label: 'Small (0-500)' },
  { minQuantity: 500, maxQuantity: 2000, label: 'Medium (500-2000)' },
  { minQuantity: 2000, maxQuantity: 10000, label: 'Large (2000-10000)' },
  { minQuantity: 10000, maxQuantity: Infinity, label: 'Extra Large (10000+)' },
];

// Enhanced labor estimate with full cost projections
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
  
  // Try to find rate in appropriate quantity bucket first
  let rate = await getProductionRateForSOW(description, unit, organizationId, {
    minQuantity: quantity * 0.5,
    maxQuantity: quantity * 2,
  });
  
  // Fall back to overall rate if no data in range
  if (!rate) {
    rate = await getProductionRateForSOW(description, unit, organizationId);
  }

  if (!rate || rate.avgQuantityPerDay === 0) {
    return {
      suggestedLaborHours: 0,
      suggestedLaborCost: 0,
      suggestedMaterialCost: 0,
      suggestedTotalCost: 0,
      productionRateUsed: 0,
      laborHoursPerUnit: 0,
      laborCostPerUnit: 0,
      materialCostPerUnit: 0,
      totalCostPerUnit: 0,
      confidence: 'NONE',
      dataSource: 'No production data available',
      totalDaysOfData: 0,
    };
  }

  const daysNeeded = quantity / rate.avgQuantityPerDay;
  const suggestedLaborHours = rate.avgLaborHoursPerUnit > 0 
    ? round(quantity * rate.avgLaborHoursPerUnit)
    : round(daysNeeded * workdayHours);
  const suggestedLaborCost = round(quantity * rate.avgLaborCostPerUnit);
  const suggestedMaterialCost = round(quantity * rate.avgMaterialCostPerUnit);
  const suggestedTotalCost = round(quantity * rate.avgTotalCostPerUnit);

  return {
    suggestedLaborHours,
    suggestedLaborCost,
    suggestedMaterialCost,
    suggestedTotalCost,
    productionRateUsed: rate.avgQuantityPerDay,
    laborHoursPerUnit: rate.avgLaborHoursPerUnit,
    laborCostPerUnit: rate.avgLaborCostPerUnit,
    materialCostPerUnit: rate.avgMaterialCostPerUnit,
    totalCostPerUnit: rate.avgTotalCostPerUnit,
    confidence: rate.confidence,
    dataSource: `Based on ${rate.totalDays} days of data across ${rate.totalProjects} projects (${round(rate.totalQuantityCompleted)} ${unit} total)`,
    totalDaysOfData: rate.totalDays,
  };
}

// Get all production rate suggestions with full metrics
export async function getProductionRateSuggestions(
  organizationId: string,
  searchTerm?: string,
  unit?: string,
  limit: number = 20
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
      laborHours: dailyScopeProgress.laborHours,
      laborCost: dailyScopeProgress.laborCost,
      materialCost: dailyScopeProgress.materialCost,
      equipmentCost: dailyScopeProgress.equipmentCost,
      crewSize: dailyScopeProgress.crewSize,
      projectCode: projects.code,
      unitPrice: scopeItems.unitPrice,
    })
    .from(dailyScopeProgress)
    .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
    .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
    .where(and(...conditions));

  // Group by SOW description + unit
  const ratesBySOW = new Map<string, {
    description: string;
    unit: string;
    entries: typeof results;
  }>();

  for (const entry of results) {
    if (searchTerm && !entry.description.toLowerCase().includes(searchTerm.toLowerCase())) {
      continue;
    }
    if (unit && entry.unit !== unit) {
      continue;
    }
    
    const key = `${entry.description}|||${entry.unit}`;
    if (!ratesBySOW.has(key)) {
      ratesBySOW.set(key, {
        description: entry.description,
        unit: entry.unit,
        entries: [],
      });
    }
    ratesBySOW.get(key)!.entries.push(entry);
  }

  const allRates: ProductionRateStats[] = [];

  for (const sow of ratesBySOW.values()) {
    const rate = await getProductionRateForSOW(sow.description, sow.unit, organizationId);
    if (rate) {
      allRates.push(rate);
    }
  }

  // Sort by confidence then by total data
  allRates.sort((a, b) => {
    const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
    return confidenceOrder[a.confidence] - confidenceOrder[b.confidence] || b.totalDays - a.totalDays;
  });

  return allRates.slice(0, limit);
}

// Get production rate for a specific organizationSowItemId (Unified SOW Tracking)
// This provides more reliable cross-project aggregation than description matching
export async function getProductionRateBySowItemId(
  organizationSowItemId: string,
  organizationId: string,
  options?: { minQuantity?: number; maxQuantity?: number }
): Promise<ProductionRateStats | null> {
  if (!organizationSowItemId || organizationSowItemId.trim() === '') {
    return null;
  }
  
  if (!organizationId || organizationId.trim() === '') {
    throw new OrganizationRequiredError("getProductionRateBySowItemId requires a valid organizationId");
  }
  
  const conditions: any[] = [
    eq(dailyScopeProgress.organizationSowItemId, organizationSowItemId),
    eq(projects.gcOrganizationId, organizationId),
    isNotNull(dailyScopeProgress.quantityCompleted),
  ];
  
  if (options?.minQuantity !== undefined) {
    conditions.push(gte(sql`CAST(${scopeItems.totalQuantity} AS NUMERIC)`, options.minQuantity));
  }
  if (options?.maxQuantity !== undefined && options.maxQuantity !== Infinity) {
    conditions.push(lte(sql`CAST(${scopeItems.totalQuantity} AS NUMERIC)`, options.maxQuantity));
  }
  
  const results = await db
    .select({
      description: scopeItems.description,
      unit: scopeItems.unit,
      workDate: dailyScopeProgress.workDate,
      quantityCompleted: dailyScopeProgress.quantityCompleted,
      laborHours: dailyScopeProgress.laborHours,
      laborCost: dailyScopeProgress.laborCost,
      materialCost: dailyScopeProgress.materialCost,
      equipmentCost: dailyScopeProgress.equipmentCost,
      crewSize: dailyScopeProgress.crewSize,
      projectCode: projects.code,
      unitPrice: scopeItems.unitPrice,
    })
    .from(dailyScopeProgress)
    .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
    .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
    .where(and(...conditions));
  
  if (results.length === 0) {
    return null;
  }
  
  const description = results[0].description;
  const unit = results[0].unit;
  
  // Process and aggregate the results using the same logic as getProductionRateForSOW
  const dailyQuantities: number[] = [];
  const crewSizes: number[] = [];
  let totalLaborHours = 0;
  let totalLaborCost = 0;
  let totalMaterialCost = 0;
  let totalEquipmentCost = 0;
  let totalQuantity = 0;
  let totalRevenue = 0;
  const projectSet = new Set<string>();
  
  for (const row of results) {
    const qty = parseFloat(row.quantityCompleted);
    if (qty > 0) {
      dailyQuantities.push(qty);
      totalQuantity += qty;
      projectSet.add(row.projectCode);
      
      if (row.laborHours) totalLaborHours += parseFloat(row.laborHours);
      if (row.laborCost) totalLaborCost += parseFloat(row.laborCost);
      if (row.materialCost) totalMaterialCost += parseFloat(row.materialCost);
      if (row.equipmentCost) totalEquipmentCost += parseFloat(row.equipmentCost);
      if (row.crewSize) crewSizes.push(row.crewSize);
      if (row.unitPrice) totalRevenue += qty * parseFloat(row.unitPrice);
    }
  }
  
  if (dailyQuantities.length === 0) {
    return null;
  }
  
  const totalDays = dailyQuantities.length;
  const totalProjects = projectSet.size;
  
  // Calculate confidence level
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 
    totalDays >= 10 && totalProjects >= 3 ? 'HIGH' :
    totalDays >= 5 ? 'MEDIUM' :
    totalDays >= 1 ? 'LOW' : 'NONE';
  
  // Calculate averages
  const qtyStats = calculateStatsHelper(dailyQuantities);
  const avgLaborHoursPerUnit = totalQuantity > 0 ? totalLaborHours / totalQuantity : 0;
  const avgLaborCostPerUnit = totalQuantity > 0 ? totalLaborCost / totalQuantity : 0;
  const avgMaterialCostPerUnit = totalQuantity > 0 ? totalMaterialCost / totalQuantity : 0;
  const avgEquipmentCostPerUnit = totalQuantity > 0 ? totalEquipmentCost / totalQuantity : 0;
  const totalCost = totalLaborCost + totalMaterialCost + totalEquipmentCost;
  const avgTotalCostPerUnit = totalQuantity > 0 ? totalCost / totalQuantity : 0;
  const avgRevenuePerUnit = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
  const avgProfitPerUnit = avgRevenuePerUnit - avgTotalCostPerUnit;
  const avgProfitMargin = avgRevenuePerUnit > 0 ? (avgProfitPerUnit / avgRevenuePerUnit) * 100 : 0;
  const avgCrewSize = crewSizes.length > 0 ? crewSizes.reduce((a, b) => a + b, 0) / crewSizes.length : 0;
  
  return {
    description,
    unit,
    avgQuantityPerDay: round(qtyStats.avg),
    minQuantityPerDay: round(qtyStats.min),
    maxQuantityPerDay: round(qtyStats.max),
    medianQuantityPerDay: round(qtyStats.median),
    avgCrewSize: round(avgCrewSize, 1),
    avgLaborHoursPerUnit: round(avgLaborHoursPerUnit, 4),
    avgLaborCostPerUnit: round(avgLaborCostPerUnit, 4),
    totalLaborHours: round(totalLaborHours),
    totalLaborCost: round(totalLaborCost),
    avgMaterialCostPerUnit: round(avgMaterialCostPerUnit, 4),
    totalMaterialCost: round(totalMaterialCost),
    avgEquipmentCostPerUnit: round(avgEquipmentCostPerUnit, 4),
    totalEquipmentCost: round(totalEquipmentCost),
    avgTotalCostPerUnit: round(avgTotalCostPerUnit, 4),
    totalCost: round(totalCost),
    avgRevenuePerUnit: round(avgRevenuePerUnit, 4),
    avgProfitPerUnit: round(avgProfitPerUnit, 4),
    avgProfitMargin: round(avgProfitMargin, 1),
    totalQuantityCompleted: round(totalQuantity),
    totalDays,
    totalProjects,
    stdDev: round(qtyStats.stdDev),
    confidence,
  };
}

// Helper to calculate statistics (inline copy for use in new function)
function calculateStatsHelper(values: number[]): { avg: number; min: number; max: number; median: number; stdDev: number } {
  if (values.length === 0) {
    return { avg: 0, min: 0, max: 0, median: 0, stdDev: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  let median = 0;
  const mid = Math.floor(sorted.length / 2);
  median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  
  let stdDev = 0;
  if (values.length > 1) {
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    stdDev = Math.sqrt(variance);
  }
  
  return { avg, min, max, median, stdDev };
}

// Calculate and store per-unit metrics when creating/updating scope progress
export function calculatePerUnitMetrics(
  quantityCompleted: number,
  laborHours?: number,
  laborCost?: number,
  materialCost?: number,
  equipmentCost?: number
): {
  laborHoursPerUnit: string | null;
  laborCostPerUnit: string | null;
  materialCostPerUnit: string | null;
  totalCostPerUnit: string | null;
} {
  if (quantityCompleted <= 0) {
    return {
      laborHoursPerUnit: null,
      laborCostPerUnit: null,
      materialCostPerUnit: null,
      totalCostPerUnit: null,
    };
  }

  const totalCost = (laborCost || 0) + (materialCost || 0) + (equipmentCost || 0);

  return {
    laborHoursPerUnit: laborHours !== undefined ? round(laborHours / quantityCompleted, 4).toString() : null,
    laborCostPerUnit: laborCost !== undefined ? round(laborCost / quantityCompleted, 4).toString() : null,
    materialCostPerUnit: materialCost !== undefined ? round(materialCost / quantityCompleted, 4).toString() : null,
    totalCostPerUnit: totalCost > 0 ? round(totalCost / quantityCompleted, 4).toString() : null,
  };
}
