/**
 * Bid Calculation Module
 * Pure functions for calculating bid pricing, markup, overhead, and profit margins
 * Used in the Cost Builder workflow and PDF generation
 */

export interface BidLineItem {
  description: string;
  quantity: number;
  unitCost: number;
  laborCost?: number;
  materialCost?: number;
  subcontractCost?: number;
  equipmentCost?: number;
}

export interface BidSummaryInput {
  lineItems: BidLineItem[];
  overheadPercent: number;
  profitPercent: number;
  taxRate?: number;
}

export interface BidSummary {
  totalDirectCost: number;
  laborTotal: number;
  materialTotal: number;
  subcontractTotal: number;
  equipmentTotal: number;
  overheadPercent: number;
  overheadAmount: number;
  profitPercent: number;
  profitAmount: number;
  taxRate: number;
  taxAmount: number;
  finalBidAmount: number;
}

export interface MarkupResult {
  baseCost: number;
  markupPercent: number;
  markupAmount: number;
  totalWithMarkup: number;
}

/**
 * Calculate line item total cost
 * Combines all cost components for a single line item
 */
export function calculateLineItemTotal(item: BidLineItem): number {
  const quantity = Number(item.quantity) || 0;
  const unitCost = Number(item.unitCost) || 0;
  const laborCost = Number(item.laborCost) || 0;
  const materialCost = Number(item.materialCost) || 0;
  const subcontractCost = Number(item.subcontractCost) || 0;
  const equipmentCost = Number(item.equipmentCost) || 0;
  
  const baseTotal = quantity * unitCost;
  const additionalCosts = laborCost + materialCost + subcontractCost + equipmentCost;
  
  return Math.round((baseTotal + additionalCosts) * 100) / 100;
}

/**
 * Calculate markup on a base cost
 * Formula: baseCost * (1 + markupPercent / 100)
 */
export function calculateMarkup(baseCost: number, markupPercent: number): MarkupResult {
  if (baseCost < 0) {
    throw new Error('Base cost cannot be negative');
  }
  if (markupPercent < 0) {
    throw new Error('Markup percent cannot be negative');
  }
  
  const markupAmount = baseCost * (markupPercent / 100);
  const totalWithMarkup = baseCost + markupAmount;
  
  return {
    baseCost: Math.round(baseCost * 100) / 100,
    markupPercent,
    markupAmount: Math.round(markupAmount * 100) / 100,
    totalWithMarkup: Math.round(totalWithMarkup * 100) / 100,
  };
}

/**
 * Calculate overhead amount from direct costs
 * Overhead is typically 10-20% for construction projects
 */
export function calculateOverhead(directCost: number, overheadPercent: number): number {
  if (directCost < 0) {
    throw new Error('Direct cost cannot be negative');
  }
  if (overheadPercent < 0 || overheadPercent > 100) {
    throw new Error('Overhead percent must be between 0 and 100');
  }
  
  return Math.round(directCost * (overheadPercent / 100) * 100) / 100;
}

/**
 * Calculate profit amount from cost basis
 * Profit is calculated after overhead is added
 */
export function calculateProfit(costWithOverhead: number, profitPercent: number): number {
  if (costWithOverhead < 0) {
    throw new Error('Cost cannot be negative');
  }
  if (profitPercent < 0 || profitPercent > 100) {
    throw new Error('Profit percent must be between 0 and 100');
  }
  
  return Math.round(costWithOverhead * (profitPercent / 100) * 100) / 100;
}

/**
 * Calculate sales tax on the total bid
 */
export function calculateTax(amount: number, taxRate: number): number {
  if (amount < 0) {
    throw new Error('Amount cannot be negative');
  }
  if (taxRate < 0 || taxRate > 50) {
    throw new Error('Tax rate must be between 0 and 50 percent');
  }
  
  return Math.round(amount * (taxRate / 100) * 100) / 100;
}

/**
 * Calculate complete bid summary from line items and rates
 * This is the main function used in the Cost Builder workflow
 */
export function calculateBidSummary(input: BidSummaryInput): BidSummary {
  const { lineItems, overheadPercent, profitPercent, taxRate = 0 } = input;
  
  if (overheadPercent < 0 || overheadPercent > 100) {
    throw new Error('Overhead percent must be between 0 and 100');
  }
  if (profitPercent < 0 || profitPercent > 100) {
    throw new Error('Profit percent must be between 0 and 100');
  }
  
  let laborTotal = 0;
  let materialTotal = 0;
  let subcontractTotal = 0;
  let equipmentTotal = 0;
  let totalDirectCost = 0;
  
  for (const item of lineItems) {
    const quantity = Number(item.quantity) || 0;
    const unitCost = Number(item.unitCost) || 0;
    const baseAmount = quantity * unitCost;
    
    laborTotal += Number(item.laborCost) || 0;
    materialTotal += (Number(item.materialCost) || 0) + baseAmount;
    subcontractTotal += Number(item.subcontractCost) || 0;
    equipmentTotal += Number(item.equipmentCost) || 0;
  }
  
  totalDirectCost = laborTotal + materialTotal + subcontractTotal + equipmentTotal;
  
  const overheadAmount = calculateOverhead(totalDirectCost, overheadPercent);
  const costWithOverhead = totalDirectCost + overheadAmount;
  
  const profitAmount = calculateProfit(costWithOverhead, profitPercent);
  const subtotal = costWithOverhead + profitAmount;
  
  const taxAmount = calculateTax(subtotal, taxRate);
  const finalBidAmount = subtotal + taxAmount;
  
  return {
    totalDirectCost: Math.round(totalDirectCost * 100) / 100,
    laborTotal: Math.round(laborTotal * 100) / 100,
    materialTotal: Math.round(materialTotal * 100) / 100,
    subcontractTotal: Math.round(subcontractTotal * 100) / 100,
    equipmentTotal: Math.round(equipmentTotal * 100) / 100,
    overheadPercent,
    overheadAmount: Math.round(overheadAmount * 100) / 100,
    profitPercent,
    profitAmount: Math.round(profitAmount * 100) / 100,
    taxRate,
    taxAmount: Math.round(taxAmount * 100) / 100,
    finalBidAmount: Math.round(finalBidAmount * 100) / 100,
  };
}

/**
 * Calculate profit margin percentage from cost and revenue
 * Formula: ((revenue - cost) / revenue) * 100
 */
export function calculateProfitMargin(cost: number, revenue: number): number {
  if (revenue <= 0) {
    return 0;
  }
  if (cost < 0) {
    throw new Error('Cost cannot be negative');
  }
  
  const margin = ((revenue - cost) / revenue) * 100;
  return Math.round(margin * 100) / 100;
}

/**
 * Calculate break-even point
 * How much revenue needed to cover costs
 */
export function calculateBreakEven(
  fixedCosts: number,
  variableCostPercent: number
): number {
  if (fixedCosts < 0) {
    throw new Error('Fixed costs cannot be negative');
  }
  if (variableCostPercent < 0 || variableCostPercent >= 100) {
    throw new Error('Variable cost percent must be between 0 and 99.99');
  }
  
  const contributionMargin = 1 - (variableCostPercent / 100);
  const breakEvenPoint = fixedCosts / contributionMargin;
  
  return Math.round(breakEvenPoint * 100) / 100;
}
