import { describe, it, expect } from 'vitest';
import {
  calculateLaborCost,
  calculateTotalHours,
  calculateLaborEfficiency,
  calculateTotalCosts,
  calculateChangeOrderValue,
  calculateAdjustedBudget,
  calculateVariance,
  calculateVariancePercent,
  determineProjectStatus,
  analyzeBudget,
  calculatePercentComplete,
  calculateProjectedCost,
  calculateEstimatedMargin,
  projectFinancials,
  calculateMaterialSpendRate,
  LaborEntry,
  ChangeOrderData,
  ProjectCosts,
  DEFAULT_COST_RATE,
  DEFAULT_OT_MULTIPLIER,
} from './projectFinancials';

describe('Project Financial Calculations', () => {
  describe('calculateLaborCost', () => {
    it('should calculate cost with regular and overtime hours', () => {
      const entries: LaborEntry[] = [
        { hoursRegular: 40, hoursOvertime: 8, costRateRegular: 50, costRateOvertime: 75 },
        { hoursRegular: 40, hoursOvertime: 4, costRateRegular: 45, costRateOvertime: 67.50 },
      ];
      
      // Entry 1: (40 * 50) + (8 * 75) = 2000 + 600 = 2600
      // Entry 2: (40 * 45) + (4 * 67.50) = 1800 + 270 = 2070
      // Total: 4670
      expect(calculateLaborCost(entries)).toBe(4670);
    });

    it('should use default rate when not provided', () => {
      const entries: LaborEntry[] = [
        { hoursRegular: 40, hoursOvertime: 0, costRateRegular: 0 },
      ];
      
      // Uses DEFAULT_COST_RATE ($50)
      expect(calculateLaborCost(entries)).toBe(40 * DEFAULT_COST_RATE);
    });

    it('should calculate OT rate from regular when not provided', () => {
      const entries: LaborEntry[] = [
        { hoursRegular: 0, hoursOvertime: 10, costRateRegular: 40 },
      ];
      
      // OT = regular * 1.5 = 40 * 1.5 = 60
      expect(calculateLaborCost(entries)).toBe(10 * 40 * DEFAULT_OT_MULTIPLIER);
    });

    it('should handle empty entries', () => {
      expect(calculateLaborCost([])).toBe(0);
    });

    it('should handle string numbers (from database)', () => {
      const entries = [
        { hoursRegular: '40' as any, hoursOvertime: '8' as any, costRateRegular: '50' as any },
      ];
      
      expect(calculateLaborCost(entries)).toBe(2600);
    });
  });

  describe('calculateTotalHours', () => {
    it('should sum all hours including overtime', () => {
      const entries: LaborEntry[] = [
        { hoursRegular: 40, hoursOvertime: 8, costRateRegular: 50 },
        { hoursRegular: 40, hoursOvertime: 12, costRateRegular: 50 },
      ];
      
      expect(calculateTotalHours(entries)).toBe(100);
    });

    it('should handle zero hours', () => {
      const entries: LaborEntry[] = [
        { hoursRegular: 0, hoursOvertime: 0, costRateRegular: 50 },
      ];
      
      expect(calculateTotalHours(entries)).toBe(0);
    });
  });

  describe('calculateLaborEfficiency', () => {
    it('should report on target when under budget', () => {
      expect(calculateLaborEfficiency(9000, 10000)).toBe('111% (On Target)');
    });

    it('should report slightly over when close to budget', () => {
      expect(calculateLaborEfficiency(10500, 10000)).toBe('95% (Slightly Over)');
    });

    it('should report over budget when significantly exceeded', () => {
      expect(calculateLaborEfficiency(15000, 10000)).toBe('67% (Over Budget)');
    });

    it('should return N/A for zero budget', () => {
      expect(calculateLaborEfficiency(5000, 0)).toBe('N/A');
    });
  });

  describe('calculateTotalCosts', () => {
    it('should sum all cost categories', () => {
      const costs: ProjectCosts = {
        laborCost: 50000,
        materialCost: 30000,
        subcontractorCost: 25000,
        equipmentCost: 10000,
        otherExpenses: 5000,
      };
      
      expect(calculateTotalCosts(costs)).toBe(120000);
    });

    it('should handle null/undefined values', () => {
      const costs: ProjectCosts = {
        laborCost: 50000,
        materialCost: null as any,
        subcontractorCost: undefined as any,
        equipmentCost: 10000,
        otherExpenses: 0,
      };
      
      expect(calculateTotalCosts(costs)).toBe(60000);
    });
  });

  describe('calculateChangeOrderValue', () => {
    it('should sum approved change orders only', () => {
      const changeOrders: ChangeOrderData[] = [
        { amount: 10000, status: 'APPROVED' },
        { amount: 5000, status: 'PENDING' },
        { amount: 8000, status: 'APPROVED' },
        { amount: 3000, status: 'REJECTED' },
      ];
      
      expect(calculateChangeOrderValue(changeOrders, 'APPROVED')).toBe(18000);
    });

    it('should sum pending change orders', () => {
      const changeOrders: ChangeOrderData[] = [
        { amount: 10000, status: 'APPROVED' },
        { amount: 5000, status: 'PENDING' },
        { amount: 2000, status: 'PENDING' },
      ];
      
      expect(calculateChangeOrderValue(changeOrders, 'PENDING')).toBe(7000);
    });

    it('should sum all change orders when no filter', () => {
      const changeOrders: ChangeOrderData[] = [
        { amount: 10000, status: 'APPROVED' },
        { amount: 5000, status: 'PENDING' },
      ];
      
      expect(calculateChangeOrderValue(changeOrders)).toBe(15000);
    });

    it('should handle empty array', () => {
      expect(calculateChangeOrderValue([], 'APPROVED')).toBe(0);
    });
  });

  describe('calculateAdjustedBudget', () => {
    it('should add approved COs and T&M to base budget', () => {
      expect(calculateAdjustedBudget(500000, 50000, 25000)).toBe(575000);
    });

    it('should handle no change orders', () => {
      expect(calculateAdjustedBudget(500000, 0, 0)).toBe(500000);
    });

    it('should throw for negative base budget', () => {
      expect(() => calculateAdjustedBudget(-1000, 500, 0)).toThrow('Base budget cannot be negative');
    });
  });

  describe('calculateVariance', () => {
    it('should calculate positive variance (under budget)', () => {
      expect(calculateVariance(100000, 85000)).toBe(15000);
    });

    it('should calculate negative variance (over budget)', () => {
      expect(calculateVariance(100000, 115000)).toBe(-15000);
    });

    it('should handle exact budget', () => {
      expect(calculateVariance(100000, 100000)).toBe(0);
    });
  });

  describe('calculateVariancePercent', () => {
    it('should calculate percentage under budget', () => {
      expect(calculateVariancePercent(100000, 90000)).toBe(10);
    });

    it('should calculate percentage over budget', () => {
      expect(calculateVariancePercent(100000, 120000)).toBe(-20);
    });

    it('should handle zero budget', () => {
      expect(calculateVariancePercent(0, 5000)).toBe(0);
    });
  });

  describe('determineProjectStatus', () => {
    it('should return ON_BUDGET for >= 10% variance', () => {
      expect(determineProjectStatus(15)).toBe('ON_BUDGET');
      expect(determineProjectStatus(10)).toBe('ON_BUDGET');
    });

    it('should return MINOR_CONCERN for 0-10% variance', () => {
      expect(determineProjectStatus(9)).toBe('MINOR_CONCERN');
      expect(determineProjectStatus(5)).toBe('MINOR_CONCERN');
      expect(determineProjectStatus(0)).toBe('MINOR_CONCERN');
    });

    it('should return MAJOR_RISK for negative variance', () => {
      expect(determineProjectStatus(-1)).toBe('MAJOR_RISK');
      expect(determineProjectStatus(-20)).toBe('MAJOR_RISK');
    });
  });

  describe('analyzeBudget', () => {
    it('should provide complete budget analysis', () => {
      const changeOrders: ChangeOrderData[] = [
        { amount: 20000, status: 'APPROVED' },
        { amount: 10000, status: 'PENDING' },
      ];
      
      const costs: ProjectCosts = {
        laborCost: 100000,
        materialCost: 150000,
        subcontractorCost: 50000,
        equipmentCost: 20000,
        otherExpenses: 10000,
      };
      
      const result = analyzeBudget(500000, changeOrders, costs);
      
      expect(result.baseBudget).toBe(500000);
      expect(result.approvedChangeOrders).toBe(20000);
      expect(result.adjustedBudget).toBe(520000);
      expect(result.totalActualCost).toBe(330000);
      expect(result.variance).toBe(190000);
      expect(result.variancePercent).toBe(36.54);
      expect(result.status).toBe('ON_BUDGET');
    });

    it('should identify over-budget projects', () => {
      const costs: ProjectCosts = {
        laborCost: 200000,
        materialCost: 250000,
        subcontractorCost: 100000,
        equipmentCost: 50000,
        otherExpenses: 20000,
      };
      
      const result = analyzeBudget(500000, [], costs);
      
      expect(result.totalActualCost).toBe(620000);
      expect(result.variance).toBe(-120000);
      expect(result.status).toBe('MAJOR_RISK');
    });
  });

  describe('calculatePercentComplete', () => {
    it('should calculate timeline percentage', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31');
      const current = new Date('2024-07-01');
      
      const percent = calculatePercentComplete(start, end, current);
      
      expect(percent).toBeCloseTo(50, 0);
    });

    it('should cap at 100%', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-06-30');
      const current = new Date('2024-12-31');
      
      expect(calculatePercentComplete(start, end, current)).toBe(100);
    });

    it('should floor at 0%', () => {
      const start = new Date('2024-06-01');
      const end = new Date('2024-12-31');
      const current = new Date('2024-01-01');
      
      expect(calculatePercentComplete(start, end, current)).toBe(0);
    });

    it('should return 50% for invalid date range', () => {
      const start = new Date('2024-12-31');
      const end = new Date('2024-01-01'); // End before start
      const current = new Date('2024-06-15');
      
      expect(calculatePercentComplete(start, end, current)).toBe(50);
    });
  });

  describe('calculateProjectedCost', () => {
    it('should project cost at completion based on spend rate', () => {
      // Spent $50k at 50% complete = $100k projected
      expect(calculateProjectedCost(50000, 50)).toBe(100000);
    });

    it('should handle early project (10% complete)', () => {
      // Spent $20k at 10% = $200k projected
      expect(calculateProjectedCost(20000, 10)).toBe(200000);
    });

    it('should return actual cost if 100% complete', () => {
      expect(calculateProjectedCost(150000, 100)).toBe(150000);
    });

    it('should return actual cost for invalid percentage', () => {
      expect(calculateProjectedCost(50000, 0)).toBe(50000);
      expect(calculateProjectedCost(50000, -10)).toBe(50000);
    });
  });

  describe('calculateEstimatedMargin', () => {
    it('should calculate positive margin', () => {
      expect(calculateEstimatedMargin(500000, 420000)).toBe(80000);
    });

    it('should calculate negative margin (projected loss)', () => {
      expect(calculateEstimatedMargin(500000, 550000)).toBe(-50000);
    });
  });

  describe('projectFinancials', () => {
    it('should provide complete financial projection', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31');
      const current = new Date('2024-07-01');
      
      const result = projectFinancials(start, end, 500000, 200000, current);
      
      expect(result.percentComplete).toBeCloseTo(50, 0);
      expect(result.actualCostToDate).toBe(200000);
      expect(result.projectedTotalCost).toBeCloseTo(400000, -4);
      expect(result.estimatedMargin).toBeCloseTo(100000, -4);
      expect(result.estimatedMarginPercent).toBeCloseTo(20, 0);
    });

    it('should handle project at 25% completion', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31');
      const current = new Date('2024-04-01');
      
      const result = projectFinancials(start, end, 1000000, 300000, current);
      
      expect(result.percentComplete).toBeCloseTo(25, 0);
      expect(result.projectedTotalCost).toBeCloseTo(1200000, -4);
      expect(result.estimatedMargin).toBeLessThan(0); // Projected loss
    });
  });

  describe('calculateMaterialSpendRate', () => {
    it('should calculate daily spend rate', () => {
      expect(calculateMaterialSpendRate(30000, 30)).toBe('$1,000/day');
    });

    it('should handle partial days', () => {
      expect(calculateMaterialSpendRate(5000, 7)).toBe('$714/day');
    });

    it('should handle zero days', () => {
      expect(calculateMaterialSpendRate(5000, 0)).toBe('$0/day');
    });
  });
});
