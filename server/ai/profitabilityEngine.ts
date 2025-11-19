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

  // Calculate labor costs
  const laborEntries = await db
    .select({
      hours: timeEntries.hours,
      hourlyRate: timeEntries.hourlyRate,
    })
    .from(timeEntries)
    .where(eq(timeEntries.projectCode, projectCode))
    .limit(5000);

  const totalLaborHours = laborEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  const totalLaborCost = laborEntries.reduce(
    (sum, entry) => sum + Number(entry.hours || 0) * Number(entry.hourlyRate || 0),
    0
  );

  // Calculate material costs
  const materials = await db
    .select({
      actualCost: procurementItems.actualCost,
      estimatedCost: procurementItems.estimatedCost,
      status: procurementItems.status,
    })
    .from(procurementItems)
    .where(eq(procurementItems.projectCode, projectCode))
    .limit(1000);

  const totalMaterialCost = materials.reduce((sum, item) => {
    const cost = Number(item.actualCost || item.estimatedCost || 0);
    return sum + cost;
  }, 0);

  // Calculate other expenses from receipts
  const expenseReceipts = await db
    .select({
      amount: receipts.amount,
    })
    .from(receipts)
    .where(eq(receipts.projectCode, projectCode))
    .limit(1000);

  const totalOtherExpenses = expenseReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  // Calculate change orders
  const projectChangeOrders = await db
    .select({
      amount: changeOrders.amount,
      status: changeOrders.status,
    })
    .from(changeOrders)
    .where(eq(changeOrders.projectCode, projectCode))
    .limit(500);

  const approvedCOs = projectChangeOrders.filter(co => co.status === 'APPROVED');
  const pendingCOs = projectChangeOrders.filter(co => 
    ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED'].includes(co.status)
  );

  const approvedCOValue = approvedCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);
  const pendingCOValue = pendingCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);

  // Calculate totals
  const baseBudget = Number(project.budget || 0);
  const adjustedBudget = baseBudget + approvedCOValue;
  const totalActualCost = totalLaborCost + totalMaterialCost + totalOtherExpenses;
  const variance = adjustedBudget - totalActualCost;
  const variancePercent = adjustedBudget > 0 ? (variance / adjustedBudget) * 100 : 0;

  // Determine status
  let status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  if (variancePercent >= 10) {
    status = 'ON_BUDGET';
  } else if (variancePercent >= 0) {
    status = 'MINOR_CONCERN';
  } else {
    status = 'MAJOR_RISK';
  }

  // Project completion cost (simple heuristic: if we're 50% through timeline, double current spend)
  const startDate = project.startDate ? new Date(project.startDate) : new Date();
  const endDate = project.estimatedCompletion ? new Date(project.estimatedCompletion) : new Date();
  const now = new Date();
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const percentComplete = totalDuration > 0 ? Math.min(100, Math.max(0, (elapsed / totalDuration) * 100)) : 50;
  
  const projectedCompletionCost = percentComplete > 0 
    ? (totalActualCost / percentComplete) * 100 
    : totalActualCost * 2;

  const estimatedMargin = adjustedBudget - projectedCompletionCost;

  // Labor efficiency
  const budgetedLaborHours = baseBudget * 0.4 / 50; // Assume 40% labor at $50/hr
  const laborEfficiency = budgetedLaborHours > 0
    ? `${Math.round((totalLaborHours / budgetedLaborHours) * 100)}% of budgeted hours`
    : 'Unknown';

  // Material spend rate
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
