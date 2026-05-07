/**
 * Task #2576 — Apply org-level estimating factors to a cost roll-up.
 *
 * Single source of truth for the order of operations so the estimate
 * GET response, the bid summary calculator, and the CSV/PDF exports
 * always agree on the final number.
 *
 * Order (industry standard):
 *   1. Direct cost (material + labor + equipment + consumables + sub)
 *   2. + labor burden  on labor only
 *   3. + small tools   on labor only
 *   4. + escalation    on (1+2+3)         (time-of-contract escalation)
 *   5. + overhead      on (1+2+3+4)
 *   6. + profit        on (1+2+3+4+5)
 *   7. + bond          on (1+2+3+4+5+6)
 *
 * Each factor is a fraction in [0, 1] (10% = 0.10). Fractions are
 * clamped on read; negative or NaN values fall back to 0.
 */

export interface EstimatingFactors {
  laborBurdenPercent: number;
  smallToolsPercent: number;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  escalationPercent: number;
  /**
   * Global default waste factor applied on top of material cost when an
   * assembly / category does not provide its own. Stored on
   * `ai_estimator_org_factors.waste_factor` (pre-existing column) and
   * surfaced through this single trust-setting bag for parity with the
   * other markups.
   */
  wasteFactorPercent: number;
}

export const DEFAULT_ESTIMATING_FACTORS: EstimatingFactors = {
  laborBurdenPercent: 0,
  smallToolsPercent: 0,
  overheadPercent: 0,
  profitPercent: 0,
  bondPercent: 0,
  escalationPercent: 0,
  wasteFactorPercent: 0,
};

function clamp(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  // 100% (1.0) is allowed; runaway 5x markups get clamped to 1.0 as a
  // sanity net so a typo doesn't print a $50M bond on a $10M job.
  return Math.min(n, 1);
}

export function normalizeFactors(
  raw: Partial<Record<keyof EstimatingFactors, unknown>> | null | undefined,
): EstimatingFactors {
  const r = raw ?? {};
  return {
    laborBurdenPercent: clamp(r.laborBurdenPercent),
    smallToolsPercent: clamp(r.smallToolsPercent),
    overheadPercent: clamp(r.overheadPercent),
    profitPercent: clamp(r.profitPercent),
    bondPercent: clamp(r.bondPercent),
    escalationPercent: clamp(r.escalationPercent),
    wasteFactorPercent: clamp(r.wasteFactorPercent),
  };
}

export interface CostBreakdown {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  consumablesCost: number;
  subcontractCost: number;
}

export interface AppliedTotals {
  directCost: number;
  materialWaste: number;
  laborBurden: number;
  smallTools: number;
  escalation: number;
  overhead: number;
  profit: number;
  bond: number;
  grandTotal: number;
  factors: EstimatingFactors;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function applyOrgFactors(
  costs: Partial<CostBreakdown>,
  rawFactors: Partial<Record<keyof EstimatingFactors, unknown>> | null | undefined,
): AppliedTotals {
  const factors = normalizeFactors(rawFactors);
  const material = num(costs.materialCost);
  const labor = num(costs.laborCost);
  const equipment = num(costs.equipmentCost);
  const consumables = num(costs.consumablesCost);
  const subcontract = num(costs.subcontractCost);

  // Waste applies on top of raw material before any markup chain — a
  // contractor pays for the wasted material itself.
  const materialWaste = material * factors.wasteFactorPercent;
  const directCost =
    material + materialWaste + labor + equipment + consumables + subcontract;
  const laborBurden = labor * factors.laborBurdenPercent;
  const smallTools = labor * factors.smallToolsPercent;

  const afterLaborAdds = directCost + laborBurden + smallTools;
  const escalation = afterLaborAdds * factors.escalationPercent;

  const afterEscalation = afterLaborAdds + escalation;
  const overhead = afterEscalation * factors.overheadPercent;

  const afterOverhead = afterEscalation + overhead;
  const profit = afterOverhead * factors.profitPercent;

  const afterProfit = afterOverhead + profit;
  const bond = afterProfit * factors.bondPercent;

  const grandTotal = afterProfit + bond;

  return {
    directCost,
    materialWaste,
    laborBurden,
    smallTools,
    escalation,
    overhead,
    profit,
    bond,
    grandTotal,
    factors,
  };
}
