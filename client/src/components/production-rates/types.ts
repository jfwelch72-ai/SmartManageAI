export interface ProductionRate {
  description: string;
  unit: string;
  totalQuantity: number;
  totalDays: number;
  totalProjects: number;
  avgPerDay: number;
  minPerDay: number;
  maxPerDay: number;
  medianPerDay: number;
  stdDev: number;
  entryCount: number;
}

export interface ProductionRatesResponse {
  rates: ProductionRate[];
  summary: {
    totalSOWTypes: number;
    totalWorkDays: number;
    totalProjects: number;
    totalEntries: number;
  };
  availableUnits: string[];
}

export interface ProductionRateDetail {
  description: string;
  unit: string;
  entries: {
    id: string;
    workDate: string;
    quantity: number;
    notes: string | null;
    projectCode: string;
    projectName: string;
    createdBy: string;
  }[];
  dailyTotals: {
    date: string;
    total: number;
    projectCount: number;
  }[];
  projectStats: {
    code: string;
    name: string;
    totalQuantity: number;
    days: number;
    entries: number;
    avgPerDay: number;
  }[];
}

export interface CostMetric {
  description: string;
  unit: string;
  totalQuantity: number;
  totalLaborHours: number;
  totalLaborCost: number;
  totalMaterialCost: number;
  totalEquipmentCost: number;
  totalCost: number;
  avgQuantityPerDay: number;
  avgCrewSize: number;
  avgLaborHoursPerUnit: number;
  avgLaborCostPerUnit: number;
  avgMaterialCostPerUnit: number;
  avgEquipmentCostPerUnit: number;
  avgTotalCostPerUnit: number;
  avgRevenuePerUnit: number;
  avgProfitPerUnit: number;
  profitMargin: number;
  totalDays: number;
  totalProjects: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  hasLaborData: boolean;
  hasMaterialData: boolean;
}

export interface CostMetricsResponse {
  rates: CostMetric[];
  summary: {
    totalSOWTypes: number;
    totalQuantity: number;
    totalLaborHours: number;
    totalLaborCost: number;
    totalMaterialCost: number;
    totalEquipmentCost: number;
    totalCost: number;
    totalProjects: number;
    ratesWithLaborData: number;
    ratesWithMaterialData: number;
  };
  availableUnits: string[];
}

export type DatePreset = "7d" | "30d" | "90d" | "ytd" | "all";
export type SortField = "description" | "avgPerDay" | "totalQuantity" | "totalDays" | "totalProjects";
export type CostSortField = "description" | "avgLaborCostPerUnit" | "avgMaterialCostPerUnit" | "avgProfitPerUnit" | "totalQuantity";
export type SortDirection = "asc" | "desc";
export type PageTab = "benchmarks" | "cost-analytics";
