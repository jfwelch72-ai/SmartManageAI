export interface ProjectProfitability {
  project_code: string;
  project_name: string;
  budget: number;
  total_labor_cost: number;
  total_material_cost: number;
  total_other_expenses: number;
  approved_change_orders_value: number;
  adjusted_budget: number;
  total_actual_cost: number;
  variance: number;
  variance_percent: number;
  status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  projected_completion_cost: number;
  estimated_margin: number;
  texturaDrawDate: string | null;
  drawDayOfMonth: number | null;
  billingUrgency: 'CRITICAL' | 'HIGH' | null;
  daysUntilDraw: number | null;
  key_metrics: {
    labor_hours: number;
    labor_efficiency: string;
    material_spend_rate: string;
    pending_change_orders_value: number;
  };
}

export interface EquipmentMetricsData {
  summary: {
    total_owned_equipment: number;
    active_rentals: number;
    total_rental_cost_mtd: number;
    underutilized_count: number;
  };
  rental_vs_owned: {
    equipment_type: string;
    avg_rental_daily_rate: number;
    avg_owned_daily_rate: number;
    daily_savings: number;
    break_even_days: number;
    recommendation: string;
  }[];
  frequently_rented: {
    equipment_type: string;
    rental_count: number;
    total_rental_cost: number;
    avg_rental_duration_days: number;
    recommendation: string;
  }[];
  underutilized: {
    equipment_code: string;
    equipment_name: string;
    days_since_last_assignment: number;
    purchase_price: number;
    monthly_carrying_cost: number;
  }[];
  project_equipment_costs: {
    project_code: string;
    project_name: string;
    planned_cost: number;
    actual_cost: number;
    total_cost: number;
  }[];
  last_updated: string | null;
}
