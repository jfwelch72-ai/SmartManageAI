import { describe, it, expect } from 'vitest';
import {
  calculateProductionRate,
  calculateAverageProductionRate,
  generateBenchmark,
  rateEfficiency,
  calculateEfficiencyPercent,
  analyzeCrewEfficiency,
  estimateTimeToComplete,
  compareCrewRates,
  calculateLearningCurveFactor,
  ProductionEntry,
} from './productionRates';

describe('Production Rate Calculations', () => {
  describe('calculateProductionRate', () => {
    it('should calculate concrete pour rate', () => {
      const entry: ProductionEntry = {
        quantity: 50, // cubic yards
        unit: 'CY',
        hours: 8,
        crewSize: 6,
        date: new Date(),
      };
      
      const result = calculateProductionRate(entry);
      
      // 50 CY / 8 hours = 6.25 CY/hour
      expect(result.unitsPerHour).toBe(6.25);
      // 50 CY / 48 man-hours = 1.04 CY/man-hour
      expect(result.unitsPerManHour).toBe(1.04);
      // 8 hours / 50 CY = 0.16 hours per CY
      expect(result.hoursPerUnit).toBe(0.16);
      // 48 man-hours / 50 CY = 0.96 man-hours per CY
      expect(result.manHoursPerUnit).toBe(0.96);
    });

    it('should calculate drywall installation rate', () => {
      const entry: ProductionEntry = {
        quantity: 2400, // square feet
        unit: 'SF',
        hours: 8,
        crewSize: 4,
        date: new Date(),
      };
      
      const result = calculateProductionRate(entry);
      
      // 2400 SF / 8 hours = 300 SF/hour
      expect(result.unitsPerHour).toBe(300);
      // 2400 SF / 32 man-hours = 75 SF/man-hour
      expect(result.unitsPerManHour).toBe(75);
    });

    it('should throw for zero hours', () => {
      const entry: ProductionEntry = {
        quantity: 100,
        unit: 'SF',
        hours: 0,
        crewSize: 4,
        date: new Date(),
      };
      
      expect(() => calculateProductionRate(entry)).toThrow('Hours must be greater than zero');
    });

    it('should throw for zero crew size', () => {
      const entry: ProductionEntry = {
        quantity: 100,
        unit: 'SF',
        hours: 8,
        crewSize: 0,
        date: new Date(),
      };
      
      expect(() => calculateProductionRate(entry)).toThrow('Crew size must be greater than zero');
    });

    it('should throw for negative quantity', () => {
      const entry: ProductionEntry = {
        quantity: -50,
        unit: 'SF',
        hours: 8,
        crewSize: 4,
        date: new Date(),
      };
      
      expect(() => calculateProductionRate(entry)).toThrow('Quantity cannot be negative');
    });
  });

  describe('calculateAverageProductionRate', () => {
    it('should calculate average from multiple entries', () => {
      const entries: ProductionEntry[] = [
        { quantity: 100, unit: 'SF', hours: 4, crewSize: 2, date: new Date() },
        { quantity: 150, unit: 'SF', hours: 6, crewSize: 2, date: new Date() },
        { quantity: 80, unit: 'SF', hours: 4, crewSize: 2, date: new Date() },
      ];
      
      const result = calculateAverageProductionRate(entries);
      
      // Total: 330 SF in 14 hours = 23.57 SF/hour
      expect(result.unitsPerHour).toBe(23.57);
      // Total: 330 SF in 28 man-hours = 11.79 SF/man-hour
      expect(result.unitsPerManHour).toBe(11.79);
    });

    it('should handle empty entries', () => {
      const result = calculateAverageProductionRate([]);
      
      expect(result.unitsPerHour).toBe(0);
      expect(result.unitsPerManHour).toBe(0);
    });

    it('should handle varying crew sizes', () => {
      const entries: ProductionEntry[] = [
        { quantity: 100, unit: 'SF', hours: 8, crewSize: 2, date: new Date() },
        { quantity: 200, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
      ];
      
      const result = calculateAverageProductionRate(entries);
      
      // 300 SF / 16 hours = 18.75 SF/hour
      expect(result.unitsPerHour).toBe(18.75);
      // 300 SF / (16 + 32) = 300 / 48 = 6.25 SF/man-hour
      expect(result.unitsPerManHour).toBe(6.25);
    });
  });

  describe('generateBenchmark', () => {
    it('should create benchmark from historical data', () => {
      const entries: ProductionEntry[] = [
        { quantity: 250, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
        { quantity: 280, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
        { quantity: 240, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
        { quantity: 300, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
      ];
      
      const benchmark = generateBenchmark('DRYWALL', 'SF', entries);
      
      expect(benchmark.trade).toBe('DRYWALL');
      expect(benchmark.unit).toBe('SF');
      expect(benchmark.sampleSize).toBe(4);
      // Average: (31.25 + 35 + 30 + 37.5) / 4 = 33.44
      expect(benchmark.averageRate).toBe(33.44);
      expect(benchmark.minRate).toBe(30);
      expect(benchmark.maxRate).toBe(37.5);
    });

    it('should handle empty entries', () => {
      const benchmark = generateBenchmark('CONCRETE', 'CY', []);
      
      expect(benchmark.averageRate).toBe(0);
      expect(benchmark.sampleSize).toBe(0);
    });
  });

  describe('rateEfficiency', () => {
    it('should rate EXCELLENT when 20%+ above benchmark', () => {
      expect(rateEfficiency(36, 30)).toBe('EXCELLENT');
    });

    it('should rate GOOD when at or above benchmark', () => {
      expect(rateEfficiency(30, 30)).toBe('GOOD');
      expect(rateEfficiency(32, 30)).toBe('GOOD');
    });

    it('should rate AVERAGE when 85-100% of benchmark', () => {
      expect(rateEfficiency(27, 30)).toBe('AVERAGE');
    });

    it('should rate BELOW_AVERAGE when 70-85% of benchmark', () => {
      expect(rateEfficiency(24, 30)).toBe('BELOW_AVERAGE');
    });

    it('should rate POOR when below 70% of benchmark', () => {
      expect(rateEfficiency(18, 30)).toBe('POOR');
    });

    it('should return AVERAGE for zero benchmark', () => {
      expect(rateEfficiency(10, 0)).toBe('AVERAGE');
    });
  });

  describe('calculateEfficiencyPercent', () => {
    it('should calculate efficiency as percentage of benchmark', () => {
      expect(calculateEfficiencyPercent(36, 30)).toBe(120);
      expect(calculateEfficiencyPercent(27, 30)).toBe(90);
    });

    it('should handle zero benchmark', () => {
      expect(calculateEfficiencyPercent(10, 0)).toBe(100);
    });
  });

  describe('analyzeCrewEfficiency', () => {
    it('should analyze crew performance', () => {
      const entries: ProductionEntry[] = [
        { quantity: 300, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
        { quantity: 280, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
        { quantity: 320, unit: 'SF', hours: 10, crewSize: 4, date: new Date() },
      ];
      
      const result = analyzeCrewEfficiency('CREW-001', entries, 30);
      
      expect(result.crewId).toBe('CREW-001');
      expect(result.totalHours).toBe(26);
      expect(result.totalManHours).toBe(104);
      expect(result.unitsCompleted).toBe(900);
      expect(result.averageCrewSize).toBe(4);
      // 900 / 26 = 34.62 SF/hour
      expect(result.productionRate).toBe(34.62);
      expect(result.efficiencyRating).toBe('GOOD');
    });

    it('should handle empty entries', () => {
      const result = analyzeCrewEfficiency('CREW-002', [], 30);
      
      expect(result.totalHours).toBe(0);
      expect(result.unitsCompleted).toBe(0);
      expect(result.efficiencyRating).toBe('AVERAGE');
    });

    it('should detect poor performers', () => {
      const entries: ProductionEntry[] = [
        { quantity: 150, unit: 'SF', hours: 8, crewSize: 4, date: new Date() },
      ];
      
      const result = analyzeCrewEfficiency('CREW-003', entries, 30);
      
      // 150 / 8 = 18.75 SF/hour (62.5% of 30 benchmark)
      expect(result.productionRate).toBe(18.75);
      expect(result.efficiencyRating).toBe('POOR');
    });
  });

  describe('estimateTimeToComplete', () => {
    it('should estimate completion time', () => {
      const result = estimateTimeToComplete(500, 25, 4);
      
      // 500 units / 25 units/hour = 20 hours
      expect(result.hours).toBe(20);
      // 20 hours * 4 crew = 80 man-hours
      expect(result.manHours).toBe(80);
      // 20 hours / 8 hours/day = 2.5 days
      expect(result.days).toBe(2.5);
    });

    it('should handle zero production rate', () => {
      const result = estimateTimeToComplete(500, 0, 4);
      
      expect(result.hours).toBe(0);
      expect(result.manHours).toBe(0);
      expect(result.days).toBe(0);
    });

    it('should handle large quantities', () => {
      const result = estimateTimeToComplete(10000, 50, 6);
      
      expect(result.hours).toBe(200);
      expect(result.manHours).toBe(1200);
      expect(result.days).toBe(25);
    });
  });

  describe('compareCrewRates', () => {
    it('should compare two crews', () => {
      const result = compareCrewRates(35, 30);
      
      expect(result.difference).toBe(5);
      expect(result.percentDifference).toBe(14.29);
      expect(result.fasterCrew).toBe(1);
    });

    it('should identify crew 2 as faster', () => {
      const result = compareCrewRates(25, 32);
      
      expect(result.fasterCrew).toBe(2);
    });

    it('should identify equal crews', () => {
      const result = compareCrewRates(30, 30);
      
      expect(result.fasterCrew).toBe('equal');
    });

    it('should handle very close rates as equal', () => {
      const result = compareCrewRates(30.005, 30);
      
      expect(result.fasterCrew).toBe('equal');
    });
  });

  describe('calculateLearningCurveFactor', () => {
    it('should return 1 for first unit', () => {
      expect(calculateLearningCurveFactor(1)).toBe(1);
    });

    it('should decrease factor for subsequent units (85% learning rate)', () => {
      // At unit 2: 2^(log(0.85)/log(2)) = 0.85
      expect(calculateLearningCurveFactor(2, 0.85)).toBe(0.85);
      
      // At unit 4: 4^(log(0.85)/log(2)) = 0.7225
      expect(calculateLearningCurveFactor(4, 0.85)).toBe(0.722);
    });

    it('should calculate factor for larger production runs', () => {
      // At unit 100 with 85% learning curve
      const factor = calculateLearningCurveFactor(100, 0.85);
      
      // Factor should be significantly less than 1
      expect(factor).toBeLessThan(0.5);
    });

    it('should handle unit 0 or negative', () => {
      expect(calculateLearningCurveFactor(0)).toBe(1);
      expect(calculateLearningCurveFactor(-1)).toBe(1);
    });
  });
});
