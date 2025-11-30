import { describe, it, expect } from 'vitest';
import {
  calculateLineItemTotal,
  calculateMarkup,
  calculateOverhead,
  calculateProfit,
  calculateTax,
  calculateBidSummary,
  calculateProfitMargin,
  calculateBreakEven,
  BidLineItem,
} from './bidCalculations';

describe('Bid Calculations', () => {
  describe('calculateLineItemTotal', () => {
    it('should calculate total from quantity and unit cost', () => {
      const item: BidLineItem = {
        description: 'Concrete Foundation',
        quantity: 100,
        unitCost: 125.50,
      };
      
      expect(calculateLineItemTotal(item)).toBe(12550);
    });

    it('should include additional cost components', () => {
      const item: BidLineItem = {
        description: 'Steel Framing',
        quantity: 50,
        unitCost: 200,
        laborCost: 2500,
        materialCost: 1000,
        equipmentCost: 500,
      };
      
      // (50 * 200) + 2500 + 1000 + 500 = 10000 + 4000 = 14000
      expect(calculateLineItemTotal(item)).toBe(14000);
    });

    it('should handle zero quantities', () => {
      const item: BidLineItem = {
        description: 'Optional Item',
        quantity: 0,
        unitCost: 100,
        laborCost: 500,
      };
      
      expect(calculateLineItemTotal(item)).toBe(500);
    });

    it('should handle null/undefined values', () => {
      const item: BidLineItem = {
        description: 'Basic Item',
        quantity: 10,
        unitCost: 50,
        laborCost: undefined as any,
        materialCost: null as any,
      };
      
      expect(calculateLineItemTotal(item)).toBe(500);
    });
  });

  describe('calculateMarkup', () => {
    it('should calculate standard 15% markup', () => {
      const result = calculateMarkup(10000, 15);
      
      expect(result.baseCost).toBe(10000);
      expect(result.markupPercent).toBe(15);
      expect(result.markupAmount).toBe(1500);
      expect(result.totalWithMarkup).toBe(11500);
    });

    it('should handle zero markup', () => {
      const result = calculateMarkup(5000, 0);
      
      expect(result.markupAmount).toBe(0);
      expect(result.totalWithMarkup).toBe(5000);
    });

    it('should throw for negative base cost', () => {
      expect(() => calculateMarkup(-1000, 10)).toThrow('Base cost cannot be negative');
    });

    it('should throw for negative markup', () => {
      expect(() => calculateMarkup(1000, -5)).toThrow('Markup percent cannot be negative');
    });

    it('should handle large markups correctly', () => {
      const result = calculateMarkup(10000, 100);
      
      expect(result.markupAmount).toBe(10000);
      expect(result.totalWithMarkup).toBe(20000);
    });
  });

  describe('calculateOverhead', () => {
    it('should calculate 15% overhead', () => {
      expect(calculateOverhead(100000, 15)).toBe(15000);
    });

    it('should calculate 10% overhead (industry standard)', () => {
      expect(calculateOverhead(250000, 10)).toBe(25000);
    });

    it('should handle zero overhead', () => {
      expect(calculateOverhead(50000, 0)).toBe(0);
    });

    it('should throw for negative direct cost', () => {
      expect(() => calculateOverhead(-1000, 10)).toThrow('Direct cost cannot be negative');
    });

    it('should throw for overhead over 100%', () => {
      expect(() => calculateOverhead(1000, 150)).toThrow('Overhead percent must be between 0 and 100');
    });
  });

  describe('calculateProfit', () => {
    it('should calculate 12% profit margin', () => {
      expect(calculateProfit(100000, 12)).toBe(12000);
    });

    it('should calculate profit on cost with overhead', () => {
      const costWithOverhead = 115000; // $100k + 15% overhead
      expect(calculateProfit(costWithOverhead, 10)).toBe(11500);
    });

    it('should throw for negative cost', () => {
      expect(() => calculateProfit(-5000, 10)).toThrow('Cost cannot be negative');
    });
  });

  describe('calculateTax', () => {
    it('should calculate standard 8.5% sales tax', () => {
      expect(calculateTax(100000, 8.5)).toBe(8500);
    });

    it('should handle no tax', () => {
      expect(calculateTax(50000, 0)).toBe(0);
    });

    it('should throw for tax rate over 50%', () => {
      expect(() => calculateTax(1000, 75)).toThrow('Tax rate must be between 0 and 50');
    });
  });

  describe('calculateBidSummary', () => {
    it('should calculate complete bid for residential foundation project', () => {
      const lineItems: BidLineItem[] = [
        { description: 'Excavation', quantity: 200, unitCost: 15, laborCost: 800, materialCost: 0 },
        { description: 'Concrete', quantity: 50, unitCost: 125, laborCost: 1500, materialCost: 500 },
        { description: 'Rebar', quantity: 2000, unitCost: 0.75, laborCost: 600, materialCost: 0 },
        { description: 'Forms', quantity: 1, unitCost: 0, laborCost: 800, equipmentCost: 400 },
      ];
      
      const result = calculateBidSummary({
        lineItems,
        overheadPercent: 12,
        profitPercent: 15,
        taxRate: 0, // No tax on labor-heavy project
      });
      
      // Materials: (200*15) + (50*125) + (2000*0.75) + 0 + 500 = 3000 + 6250 + 1500 + 500 = 11250
      // Labor: 800 + 1500 + 600 + 800 = 3700
      // Equipment: 400
      // Direct cost: 11250 + 3700 + 400 = 15350
      expect(result.totalDirectCost).toBe(15350);
      expect(result.laborTotal).toBe(3700);
      expect(result.equipmentTotal).toBe(400);
      
      // Overhead: 15350 * 0.12 = 1842
      expect(result.overheadAmount).toBe(1842);
      
      // Cost with overhead: 15350 + 1842 = 17192
      // Profit: 17192 * 0.15 = 2578.8
      expect(result.profitAmount).toBe(2578.8);
      
      // Final: 17192 + 2578.8 = 19770.80
      expect(result.finalBidAmount).toBe(19770.8);
    });

    it('should calculate bid with sales tax', () => {
      const lineItems: BidLineItem[] = [
        { description: 'HVAC Unit', quantity: 1, unitCost: 15000, materialCost: 2000 },
        { description: 'Installation', quantity: 1, unitCost: 0, laborCost: 3000 },
      ];
      
      const result = calculateBidSummary({
        lineItems,
        overheadPercent: 10,
        profitPercent: 20,
        taxRate: 8,
      });
      
      // Material: 15000 + 2000 = 17000
      // Labor: 3000
      // Direct: 20000
      expect(result.totalDirectCost).toBe(20000);
      
      // Overhead: 20000 * 0.10 = 2000
      // Cost + overhead: 22000
      // Profit: 22000 * 0.20 = 4400
      // Subtotal: 26400
      // Tax: 26400 * 0.08 = 2112
      expect(result.taxAmount).toBe(2112);
      expect(result.finalBidAmount).toBe(28512);
    });

    it('should handle empty line items', () => {
      const result = calculateBidSummary({
        lineItems: [],
        overheadPercent: 15,
        profitPercent: 10,
      });
      
      expect(result.totalDirectCost).toBe(0);
      expect(result.finalBidAmount).toBe(0);
    });

    it('should throw for invalid overhead percent', () => {
      expect(() => calculateBidSummary({
        lineItems: [],
        overheadPercent: -5,
        profitPercent: 10,
      })).toThrow('Overhead percent must be between 0 and 100');
    });

    it('should throw for invalid profit percent', () => {
      expect(() => calculateBidSummary({
        lineItems: [],
        overheadPercent: 10,
        profitPercent: 150,
      })).toThrow('Profit percent must be between 0 and 100');
    });
  });

  describe('calculateProfitMargin', () => {
    it('should calculate margin from cost and revenue', () => {
      // Cost $80k, Revenue $100k = 20% margin
      expect(calculateProfitMargin(80000, 100000)).toBe(20);
    });

    it('should handle break-even scenario', () => {
      expect(calculateProfitMargin(50000, 50000)).toBe(0);
    });

    it('should handle loss scenario', () => {
      // Cost $120k, Revenue $100k = -20% margin
      expect(calculateProfitMargin(120000, 100000)).toBe(-20);
    });

    it('should return 0 for zero revenue', () => {
      expect(calculateProfitMargin(5000, 0)).toBe(0);
    });

    it('should throw for negative cost', () => {
      expect(() => calculateProfitMargin(-1000, 5000)).toThrow('Cost cannot be negative');
    });
  });

  describe('calculateBreakEven', () => {
    it('should calculate break-even point', () => {
      // Fixed costs $50k, variable 40% = $50k / 0.6 = $83,333.33
      expect(calculateBreakEven(50000, 40)).toBe(83333.33);
    });

    it('should handle low variable costs', () => {
      // Fixed $30k, variable 10% = $30k / 0.9 = $33,333.33
      expect(calculateBreakEven(30000, 10)).toBe(33333.33);
    });

    it('should throw for negative fixed costs', () => {
      expect(() => calculateBreakEven(-1000, 30)).toThrow('Fixed costs cannot be negative');
    });

    it('should throw for variable cost at 100%', () => {
      expect(() => calculateBreakEven(1000, 100)).toThrow('Variable cost percent must be between 0 and 99.99');
    });
  });
});
