/**
 * Production Rate Calculations Module
 * Pure functions for crew efficiency tracking and production benchmarking
 * Used in AI analysis and historical performance tracking
 */

export interface ProductionEntry {
  quantity: number;
  unit: string;
  hours: number;
  crewSize: number;
  date: Date;
}

export interface ProductionRate {
  unitsPerHour: number;
  unitsPerManHour: number;
  hoursPerUnit: number;
  manHoursPerUnit: number;
}

export interface ProductionBenchmark {
  trade: string;
  unit: string;
  averageRate: number;
  minRate: number;
  maxRate: number;
  sampleSize: number;
}

export interface CrewEfficiency {
  crewId: string;
  totalHours: number;
  totalManHours: number;
  unitsCompleted: number;
  averageCrewSize: number;
  productionRate: number;
  efficiencyRating: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'BELOW_AVERAGE' | 'POOR';
}

/**
 * Calculate production rate from a single entry
 * Returns units per hour and units per man-hour
 */
export function calculateProductionRate(entry: ProductionEntry): ProductionRate {
  const { quantity, hours, crewSize } = entry;
  
  if (hours <= 0) {
    throw new Error('Hours must be greater than zero');
  }
  if (crewSize <= 0) {
    throw new Error('Crew size must be greater than zero');
  }
  if (quantity < 0) {
    throw new Error('Quantity cannot be negative');
  }
  
  const manHours = hours * crewSize;
  const unitsPerHour = quantity / hours;
  const unitsPerManHour = quantity / manHours;
  const hoursPerUnit = hours / (quantity || 1);
  const manHoursPerUnit = manHours / (quantity || 1);
  
  return {
    unitsPerHour: Math.round(unitsPerHour * 100) / 100,
    unitsPerManHour: Math.round(unitsPerManHour * 100) / 100,
    hoursPerUnit: Math.round(hoursPerUnit * 100) / 100,
    manHoursPerUnit: Math.round(manHoursPerUnit * 100) / 100,
  };
}

/**
 * Calculate average production rate from multiple entries
 */
export function calculateAverageProductionRate(entries: ProductionEntry[]): ProductionRate {
  if (entries.length === 0) {
    return {
      unitsPerHour: 0,
      unitsPerManHour: 0,
      hoursPerUnit: 0,
      manHoursPerUnit: 0,
    };
  }
  
  let totalQuantity = 0;
  let totalHours = 0;
  let totalManHours = 0;
  
  for (const entry of entries) {
    totalQuantity += Number(entry.quantity) || 0;
    totalHours += Number(entry.hours) || 0;
    totalManHours += (Number(entry.hours) || 0) * (Number(entry.crewSize) || 1);
  }
  
  if (totalHours === 0) {
    return {
      unitsPerHour: 0,
      unitsPerManHour: 0,
      hoursPerUnit: 0,
      manHoursPerUnit: 0,
    };
  }
  
  return {
    unitsPerHour: Math.round((totalQuantity / totalHours) * 100) / 100,
    unitsPerManHour: Math.round((totalQuantity / totalManHours) * 100) / 100,
    hoursPerUnit: Math.round((totalHours / (totalQuantity || 1)) * 100) / 100,
    manHoursPerUnit: Math.round((totalManHours / (totalQuantity || 1)) * 100) / 100,
  };
}

/**
 * Generate production benchmark from historical data
 */
export function generateBenchmark(
  trade: string,
  unit: string,
  entries: ProductionEntry[]
): ProductionBenchmark {
  if (entries.length === 0) {
    return {
      trade,
      unit,
      averageRate: 0,
      minRate: 0,
      maxRate: 0,
      sampleSize: 0,
    };
  }
  
  const rates: number[] = [];
  
  for (const entry of entries) {
    if (entry.hours > 0) {
      const rate = entry.quantity / entry.hours;
      rates.push(rate);
    }
  }
  
  if (rates.length === 0) {
    return {
      trade,
      unit,
      averageRate: 0,
      minRate: 0,
      maxRate: 0,
      sampleSize: 0,
    };
  }
  
  const sum = rates.reduce((a, b) => a + b, 0);
  const avg = sum / rates.length;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  
  return {
    trade,
    unit,
    averageRate: Math.round(avg * 100) / 100,
    minRate: Math.round(min * 100) / 100,
    maxRate: Math.round(max * 100) / 100,
    sampleSize: rates.length,
  };
}

/**
 * Rate crew efficiency against benchmark
 */
export function rateEfficiency(
  actualRate: number,
  benchmarkRate: number
): 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'BELOW_AVERAGE' | 'POOR' {
  if (benchmarkRate <= 0) {
    return 'AVERAGE';
  }
  
  const ratio = actualRate / benchmarkRate;
  
  if (ratio >= 1.2) {
    return 'EXCELLENT';
  } else if (ratio >= 1.0) {
    return 'GOOD';
  } else if (ratio >= 0.85) {
    return 'AVERAGE';
  } else if (ratio >= 0.7) {
    return 'BELOW_AVERAGE';
  } else {
    return 'POOR';
  }
}

/**
 * Calculate efficiency percentage
 */
export function calculateEfficiencyPercent(
  actualRate: number,
  benchmarkRate: number
): number {
  if (benchmarkRate <= 0) {
    return 100;
  }
  
  const percent = (actualRate / benchmarkRate) * 100;
  return Math.round(percent * 100) / 100;
}

/**
 * Analyze crew efficiency from production entries
 */
export function analyzeCrewEfficiency(
  crewId: string,
  entries: ProductionEntry[],
  benchmarkRate: number
): CrewEfficiency {
  if (entries.length === 0) {
    return {
      crewId,
      totalHours: 0,
      totalManHours: 0,
      unitsCompleted: 0,
      averageCrewSize: 0,
      productionRate: 0,
      efficiencyRating: 'AVERAGE',
    };
  }
  
  let totalHours = 0;
  let totalManHours = 0;
  let totalUnits = 0;
  let totalCrewSize = 0;
  
  for (const entry of entries) {
    totalHours += Number(entry.hours) || 0;
    totalManHours += (Number(entry.hours) || 0) * (Number(entry.crewSize) || 1);
    totalUnits += Number(entry.quantity) || 0;
    totalCrewSize += Number(entry.crewSize) || 0;
  }
  
  const avgCrewSize = entries.length > 0 ? totalCrewSize / entries.length : 0;
  const productionRate = totalHours > 0 ? totalUnits / totalHours : 0;
  const efficiencyRating = rateEfficiency(productionRate, benchmarkRate);
  
  return {
    crewId,
    totalHours: Math.round(totalHours * 100) / 100,
    totalManHours: Math.round(totalManHours * 100) / 100,
    unitsCompleted: Math.round(totalUnits * 100) / 100,
    averageCrewSize: Math.round(avgCrewSize * 10) / 10,
    productionRate: Math.round(productionRate * 100) / 100,
    efficiencyRating,
  };
}

/**
 * Estimate time to complete remaining work
 */
export function estimateTimeToComplete(
  remainingQuantity: number,
  productionRate: number,
  crewSize: number = 1
): { hours: number; manHours: number; days: number } {
  if (productionRate <= 0) {
    return { hours: 0, manHours: 0, days: 0 };
  }
  
  const hours = remainingQuantity / productionRate;
  const manHours = hours * crewSize;
  const days = hours / 8; // Assuming 8-hour workdays
  
  return {
    hours: Math.round(hours * 100) / 100,
    manHours: Math.round(manHours * 100) / 100,
    days: Math.round(days * 100) / 100,
  };
}

/**
 * Compare production rates between crews
 */
export function compareCrewRates(
  crew1Rate: number,
  crew2Rate: number
): { difference: number; percentDifference: number; fasterCrew: 1 | 2 | 'equal' } {
  const difference = Math.abs(crew1Rate - crew2Rate);
  const baseRate = Math.max(crew1Rate, crew2Rate) || 1;
  const percentDifference = (difference / baseRate) * 100;
  
  let fasterCrew: 1 | 2 | 'equal';
  if (Math.abs(crew1Rate - crew2Rate) < 0.01) {
    fasterCrew = 'equal';
  } else if (crew1Rate > crew2Rate) {
    fasterCrew = 1;
  } else {
    fasterCrew = 2;
  }
  
  return {
    difference: Math.round(difference * 100) / 100,
    percentDifference: Math.round(percentDifference * 100) / 100,
    fasterCrew,
  };
}

/**
 * Calculate learning curve factor
 * Production typically improves as crew gains experience
 * Based on Crawford's learning curve model
 */
export function calculateLearningCurveFactor(
  unitNumber: number,
  learningRate: number = 0.85
): number {
  if (unitNumber < 1) {
    return 1;
  }
  
  const exponent = Math.log(learningRate) / Math.log(2);
  const factor = Math.pow(unitNumber, exponent);
  
  return Math.round(factor * 1000) / 1000;
}
