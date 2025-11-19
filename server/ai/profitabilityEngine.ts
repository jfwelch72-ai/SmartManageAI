import { db } from "../db";
import { 
  projects, 
  timeEntries, 
  procurementItems, 
  changeOrders, 
  receipts 
} from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

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
  key_metrics: {
    labor_hours: number;
    labor_efficiency: string;
    material_spend_rate: string;
    pending_change_orders_value: number;
  };
}

export async function calculateProjectProfitability(projectCode: string): Promise<ProjectProfitability> {
  // Fetch project
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.code, projectCode))
    .limit(1);

  if (!project) {
    throw new Error(`Project ${projectCode} not found`);
  }

  // Calculate labor costs - using time entries with estimated hourly rate
  const laborEntries = await db
    .select({
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
    })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, project.id))
    .limit(5000);

  const ASSUMED_HOURLY_RATE = 50;
  const OVERTIME_MULTIPLIER = 1.5;

  const totalLaborHours = laborEntries.reduce(
    (sum, entry) => 
      sum + Number(entry.hoursRegular || 0) + Number(entry.hoursOvertime || 0),
    0
  );
  
  const totalLaborCost = laborEntries.reduce((sum, entry) => {
    const regularCost = Number(entry.hoursRegular || 0) * ASSUMED_HOURLY_RATE;
    const overtimeCost = Number(entry.hoursOvertime || 0) * ASSUMED_HOURLY_RATE * OVERTIME_MULTIPLIER;
    return sum + regularCost + overtimeCost;
  }, 0);

  // Calculate material costs - using unit cost × quantity for procurement items
  const materials = await db
    .select({
      unitCost: procurementItems.unitCost,
      quantity: procurementItems.quantity,
      status: procurementItems.status,
    })
    .from(procurementItems)
    .where(eq(procurementItems.projectId, project.id))
    .limit(1000);

  const totalMaterialCost = materials.reduce((sum, item) => {
    const cost = Number(item.unitCost || 0) * Number(item.quantity || 0);
    return sum + cost;
  }, 0);

  // Calculate other expenses from receipts
  const expenseReceipts = await db
    .select({
      amount: receipts.amount,
    })
    .from(receipts)
    .where(eq(receipts.projectId, project.id))
    .limit(1000);

  const totalOtherExpenses = expenseReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  // Calculate change orders
  const projectChangeOrders = await db
    .select({
      amount: changeOrders.amount,
      status: changeOrders.status,
    })
    .from(changeOrders)
    .where(eq(changeOrders.projectId, project.id))
    .limit(500);

  const approvedCOs = projectChangeOrders.filter(co => co.status === 'APPROVED');
  const pendingCOs = projectChangeOrders.filter(co => 
    ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED'].includes(co.status)
  );

  const approvedCOValue = approvedCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);
  const pendingCOValue = pendingCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);

  // Calculate totals - use contractAmount as primary, fallback to budget
  const baseBudget = Number(project.contractAmount || project.budget || 0);
  const adjustedBudget = baseBudget + approvedCOValue;
  const totalActualCost = totalLaborCost + totalMaterialCost + totalOtherExpenses;
  const variance = adjustedBudget - totalActualCost;
  const variancePercent = adjustedBudget > 0 ? (variance / adjustedBudget) * 100 : 0;

  // Determine status based on variance percentage
  let status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  if (variancePercent >= 10) {
    status = 'ON_BUDGET';
  } else if (variancePercent >= 0) {
    status = 'MINOR_CONCERN';
  } else {
    status = 'MAJOR_RISK';
  }

  // Project completion cost based on timeline percentage complete
  const startDate = project.startDate ? new Date(project.startDate) : new Date();
  const endDate = project.estimatedCompletionDate ? new Date(project.estimatedCompletionDate) : new Date();
  const now = new Date();
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  
  // Guard against invalid date ranges
  let percentComplete = 50; // Default to 50% if dates are invalid
  if (totalDuration > 0 && elapsed >= 0) {
    percentComplete = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  }
  
  const projectedCompletionCost = percentComplete > 0 && percentComplete < 100
    ? (totalActualCost / (percentComplete / 100))
    : totalActualCost;

  const estimatedMargin = adjustedBudget - projectedCompletionCost;

  // Labor efficiency - compare actual hours to budgeted hours (assume 40% of budget is labor)
  const budgetedLaborHours = baseBudget * 0.4 / ASSUMED_HOURLY_RATE;
  const laborEfficiency = budgetedLaborHours > 0
    ? `${Math.round((totalLaborHours / budgetedLaborHours) * 100)}% of budgeted hours`
    : 'Unknown';

  // Material spend rate - compare actual material costs to budgeted (assume 45% of budget)
  const budgetedMaterials = baseBudget * 0.45;
  const materialSpendRate = budgetedMaterials > 0
    ? `${Math.round((totalMaterialCost / budgetedMaterials) * 100)}% of budget`
    : 'Unknown';

  return {
    project_code: projectCode,
    project_name: project.name,
    budget: baseBudget,
    total_labor_cost: Math.round(totalLaborCost * 100) / 100,
    total_material_cost: Math.round(totalMaterialCost * 100) / 100,
    total_other_expenses: Math.round(totalOtherExpenses * 100) / 100,
    approved_change_orders_value: Math.round(approvedCOValue * 100) / 100,
    adjusted_budget: Math.round(adjustedBudget * 100) / 100,
    total_actual_cost: Math.round(totalActualCost * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    variance_percent: Math.round(variancePercent * 100) / 100,
    status,
    projected_completion_cost: Math.round(projectedCompletionCost * 100) / 100,
    estimated_margin: Math.round(estimatedMargin * 100) / 100,
    key_metrics: {
      labor_hours: Math.round(totalLaborHours * 100) / 100,
      labor_efficiency: laborEfficiency,
      material_spend_rate: materialSpendRate,
      pending_change_orders_value: Math.round(pendingCOValue * 100) / 100,
    },
  };
}

export async function calculateAllProjectsProfitability(): Promise<ProjectProfitability[]> {
  // Get all active projects
  const activeProjects = await db
    .select({ code: projects.code })
    .from(projects)
    .where(sql`${projects.status} IN ('ACTIVE', 'PLANNING')`)
    .limit(100);

  const results: ProjectProfitability[] = [];

  for (const project of activeProjects) {
    try {
      const profitability = await calculateProjectProfitability(project.code);
      results.push(profitability);
    } catch (error) {
      console.error(`Error calculating profitability for ${project.code}:`, error);
    }
  }

  return results.sort((a, b) => {
    const statusOrder = { 'MAJOR_RISK': 0, 'MINOR_CONCERN': 1, 'ON_BUDGET': 2 };
    return statusOrder[a.status] - statusOrder[b.status];
  });
}
