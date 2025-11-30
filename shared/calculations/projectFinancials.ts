/**
 * Project Financial Calculations Module
 * Pure functions for budget tracking, variance analysis, and project health metrics
 * Used in the AI CFO Dashboard and project profitability reports
 */

export interface LaborEntry {
  hoursRegular: number;
  hoursOvertime: number;
  costRateRegular: number;
  costRateOvertime?: number;
}

export interface ProjectCosts {
  laborCost: number;
  materialCost: number;
  subcontractorCost: number;
  equipmentCost: number;
  otherExpenses: number;
}

export interface ChangeOrderData {
  amount: number;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'DRAFT';
}

export interface BudgetAnalysis {
  baseBudget: number;
  approvedChangeOrders: number;
  adjustedBudget: number;
  totalActualCost: number;
  variance: number;
  variancePercent: number;
  status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
}

export interface ProjectionResult {
  percentComplete: number;
  actualCostToDate: number;
  projectedTotalCost: number;
  estimatedMargin: number;
  estimatedMarginPercent: number;
}

export type ProjectStatus = 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';

export const DEFAULT_COST_RATE = 50;
export const DEFAULT_OT_MULTIPLIER = 1.5;

/**
 * Calculate total labor cost from time entries
 * Supports regular and overtime rates
 */
export function calculateLaborCost(entries: LaborEntry[]): number {
  let total = 0;
  
  for (const entry of entries) {
    const regularHours = Number(entry.hoursRegular) || 0;
    const overtimeHours = Number(entry.hoursOvertime) || 0;
    const regularRate = Number(entry.costRateRegular) || DEFAULT_COST_RATE;
    const overtimeRate = entry.costRateOvertime 
      ? Number(entry.costRateOvertime) 
      : regularRate * DEFAULT_OT_MULTIPLIER;
    
    total += (regularHours * regularRate) + (overtimeHours * overtimeRate);
  }
  
  return Math.round(total * 100) / 100;
}

/**
 * Calculate total hours from labor entries
 */
export function calculateTotalHours(entries: LaborEntry[]): number {
  let total = 0;
  
  for (const entry of entries) {
    total += (Number(entry.hoursRegular) || 0) + (Number(entry.hoursOvertime) || 0);
  }
  
  return Math.round(total * 100) / 100;
}

/**
 * Calculate labor efficiency percentage
 * Compares actual labor cost against budgeted labor
 */
export function calculateLaborEfficiency(
  actualCost: number,
  budgetedCost: number
): string {
  if (budgetedCost <= 0) {
    return 'N/A';
  }
  
  const efficiency = (budgetedCost / actualCost) * 100;
  
  if (efficiency >= 100) {
    return `${Math.round(efficiency)}% (On Target)`;
  } else if (efficiency >= 90) {
    return `${Math.round(efficiency)}% (Slightly Over)`;
  } else {
    return `${Math.round(efficiency)}% (Over Budget)`;
  }
}

/**
 * Sum up all project costs
 */
export function calculateTotalCosts(costs: ProjectCosts): number {
  const total = 
    (Number(costs.laborCost) || 0) +
    (Number(costs.materialCost) || 0) +
    (Number(costs.subcontractorCost) || 0) +
    (Number(costs.equipmentCost) || 0) +
    (Number(costs.otherExpenses) || 0);
  
  return Math.round(total * 100) / 100;
}

/**
 * Calculate total value of change orders by status
 */
export function calculateChangeOrderValue(
  changeOrders: ChangeOrderData[],
  filterStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'DRAFT'
): number {
  const filtered = filterStatus 
    ? changeOrders.filter(co => co.status === filterStatus)
    : changeOrders;
  
  const total = filtered.reduce((sum, co) => sum + (Number(co.amount) || 0), 0);
  
  return Math.round(total * 100) / 100;
}

/**
 * Calculate adjusted budget after approved change orders
 */
export function calculateAdjustedBudget(
  baseBudget: number,
  approvedChangeOrdersValue: number,
  approvedTMValue: number = 0
): number {
  if (baseBudget < 0) {
    throw new Error('Base budget cannot be negative');
  }
  
  const adjusted = baseBudget + approvedChangeOrdersValue + approvedTMValue;
  return Math.round(adjusted * 100) / 100;
}

/**
 * Calculate budget variance
 * Positive = under budget, Negative = over budget
 */
export function calculateVariance(budget: number, actualCost: number): number {
  return Math.round((budget - actualCost) * 100) / 100;
}

/**
 * Calculate variance as percentage of budget
 */
export function calculateVariancePercent(budget: number, actualCost: number): number {
  if (budget <= 0) {
    return 0;
  }
  
  const variance = budget - actualCost;
  const percent = (variance / budget) * 100;
  
  return Math.round(percent * 100) / 100;
}

/**
 * Determine project financial status based on variance
 * - ON_BUDGET: variance >= 10% (healthy margin)
 * - MINOR_CONCERN: variance 0-10% (tight but okay)
 * - MAJOR_RISK: variance < 0% (over budget)
 */
export function determineProjectStatus(variancePercent: number): ProjectStatus {
  if (variancePercent >= 10) {
    return 'ON_BUDGET';
  } else if (variancePercent >= 0) {
    return 'MINOR_CONCERN';
  } else {
    return 'MAJOR_RISK';
  }
}

/**
 * Comprehensive budget analysis
 */
export function analyzeBudget(
  baseBudget: number,
  changeOrders: ChangeOrderData[],
  costs: ProjectCosts
): BudgetAnalysis {
  const approvedCOValue = calculateChangeOrderValue(changeOrders, 'APPROVED');
  const adjustedBudget = calculateAdjustedBudget(baseBudget, approvedCOValue);
  const totalActualCost = calculateTotalCosts(costs);
  const variance = calculateVariance(adjustedBudget, totalActualCost);
  const variancePercent = calculateVariancePercent(adjustedBudget, totalActualCost);
  const status = determineProjectStatus(variancePercent);
  
  return {
    baseBudget: Math.round(baseBudget * 100) / 100,
    approvedChangeOrders: approvedCOValue,
    adjustedBudget,
    totalActualCost,
    variance,
    variancePercent,
    status,
  };
}

/**
 * Calculate project completion percentage based on timeline
 */
export function calculatePercentComplete(
  startDate: Date,
  endDate: Date,
  currentDate: Date = new Date()
): number {
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = currentDate.getTime() - startDate.getTime();
  
  if (totalDuration <= 0) {
    return 50; // Default if dates are invalid
  }
  
  const percent = (elapsed / totalDuration) * 100;
  
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/**
 * Project cost at completion
 * Based on current spend rate and percent complete
 */
export function calculateProjectedCost(
  actualCostToDate: number,
  percentComplete: number
): number {
  if (percentComplete <= 0 || percentComplete > 100) {
    return actualCostToDate;
  }
  
  const projectedTotal = actualCostToDate / (percentComplete / 100);
  
  return Math.round(projectedTotal * 100) / 100;
}

/**
 * Calculate estimated margin at project completion
 */
export function calculateEstimatedMargin(
  adjustedBudget: number,
  projectedCost: number
): number {
  return Math.round((adjustedBudget - projectedCost) * 100) / 100;
}

/**
 * Full project financial projection
 */
export function projectFinancials(
  startDate: Date,
  endDate: Date,
  adjustedBudget: number,
  actualCostToDate: number,
  currentDate: Date = new Date()
): ProjectionResult {
  const percentComplete = calculatePercentComplete(startDate, endDate, currentDate);
  const projectedTotalCost = calculateProjectedCost(actualCostToDate, percentComplete);
  const estimatedMargin = calculateEstimatedMargin(adjustedBudget, projectedTotalCost);
  const estimatedMarginPercent = adjustedBudget > 0 
    ? Math.round((estimatedMargin / adjustedBudget) * 100 * 100) / 100 
    : 0;
  
  return {
    percentComplete,
    actualCostToDate: Math.round(actualCostToDate * 100) / 100,
    projectedTotalCost,
    estimatedMargin,
    estimatedMarginPercent,
  };
}

/**
 * Calculate material spend rate
 * Daily average material spending
 */
export function calculateMaterialSpendRate(
  totalMaterialCost: number,
  daysElapsed: number
): string {
  if (daysElapsed <= 0) {
    return '$0/day';
  }
  
  const dailyRate = totalMaterialCost / daysElapsed;
  return `$${Math.round(dailyRate).toLocaleString()}/day`;
}
