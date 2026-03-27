import { db } from "./db";
import {
  timeEntries,
  users,
  purchaseOrders,
  purchaseOrderItems,
  poReceipts,
  poReceiptItems,
  subcontractorContracts,
  subcontractorPayments,
  tmTickets,
  projectEquipmentPlans,
  receipts,
  budgetLineItems,
  forecastAdjustments,
  costLedgerPostings,
} from "@shared/schema";
import { eq, sql, and, inArray } from "drizzle-orm";

export interface CostCodeLedgerRow {
  costCode: string;
  description: string;
  division: string;
  budgetedLabor: number;
  budgetedMaterial: number;
  budgetedSub: number;
  budgetedEquipment: number;
  budgetedOther: number;
  budgetedTotal: number;
  committedPO: number;
  committedSub: number;
  committedTotal: number;
  actualLabor: number;
  actualMaterial: number;
  actualSub: number;
  actualEquipment: number;
  actualTM: number;
  actualOther: number;
  actualTotal: number;
  remainingBudget: number;
  percentUsed: number;
  forecast: number;
  etc: number;
  ffc: number;
  projectedVariance: number;
  forecastAdjustment: number | null;
  forecastAdjustmentNote: string | null;
  alertLevel: string | null;
}

export interface CostLedgerSummary {
  rows: CostCodeLedgerRow[];
  totals: CostCodeLedgerRow;
  projectBudget: number;
  budgetLineTotal: number;
  percentComplete: number;
  budgetAlertThreshold: number;
  budgetCriticalThreshold: number;
}

const DEFAULT_COST_RATE = 50;
const DEFAULT_OT_MULTIPLIER = 1.5;

export async function calculateCostLedger(
  projectId: string,
  projectBudget: number,
  projectStartDate?: Date | null,
  projectEndDate?: Date | null,
  alertThreshold: number = 80,
  criticalThreshold: number = 95
): Promise<CostLedgerSummary> {
  const costMap = new Map<string, CostCodeLedgerRow>();

  const ensureRow = (costCode: string, description?: string, division?: string): CostCodeLedgerRow => {
    if (!costMap.has(costCode)) {
      costMap.set(costCode, {
        costCode,
        description: description || costCode,
        division: division || "Unassigned",
        budgetedLabor: 0, budgetedMaterial: 0, budgetedSub: 0, budgetedEquipment: 0, budgetedOther: 0, budgetedTotal: 0,
        committedPO: 0, committedSub: 0, committedTotal: 0,
        actualLabor: 0, actualMaterial: 0, actualSub: 0, actualEquipment: 0, actualTM: 0, actualOther: 0, actualTotal: 0,
        remainingBudget: 0, percentUsed: 0, forecast: 0,
        etc: 0, ffc: 0, projectedVariance: 0,
        forecastAdjustment: null, forecastAdjustmentNote: null,
        alertLevel: null,
      });
    }
    return costMap.get(costCode)!;
  };

  const lines = await db.select().from(budgetLineItems).where(eq(budgetLineItems.projectId, projectId));
  for (const line of lines) {
    const row = ensureRow(normalizeCostCode(line.costCode) || line.costCode, line.description, line.division);
    row.budgetedLabor = Number(line.laborBudget);
    row.budgetedMaterial = Number(line.materialBudget);
    row.budgetedSub = Number(line.subcontractorBudget);
    row.budgetedEquipment = Number(line.equipmentBudget);
    row.budgetedOther = Number(line.otherBudget);
    row.budgetedTotal = row.budgetedLabor + row.budgetedMaterial + row.budgetedSub + row.budgetedEquipment + row.budgetedOther;
  }

  const laborEntries = await db
    .select({
      costCode: timeEntries.costCode,
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
      costRateRegular: users.costRateRegular,
      costRateOvertime: users.costRateOvertime,
      approvalStatus: timeEntries.approvalStatus,
    })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.userId, users.id))
    .where(eq(timeEntries.projectId, projectId))
    .limit(10000);

  const payrollPostings = await db
    .select({
      costCode: costLedgerPostings.costCode,
      totalAmount: costLedgerPostings.totalAmount,
      burdenedTotalAmount: costLedgerPostings.burdenedTotalAmount,
    })
    .from(costLedgerPostings)
    .where(eq(costLedgerPostings.projectId, projectId))
    .limit(10000);

  const payrollCostByCode = new Map<string, number>();
  for (const posting of payrollPostings) {
    const cc = normalizeCostCode(posting.costCode);
    const amount = Number(posting.burdenedTotalAmount) > 0 ? Number(posting.burdenedTotalAmount) : Number(posting.totalAmount);
    payrollCostByCode.set(cc, (payrollCostByCode.get(cc) || 0) + amount);
  }

  if (payrollPostings.length > 0) {
    for (const [cc, amount] of payrollCostByCode) {
      const row = ensureRow(cc);
      row.actualLabor += amount;
    }
  } else {
    for (const entry of laborEntries) {
      if (entry.approvalStatus !== "APPROVED") continue;
      const cc = normalizeCostCode(entry.costCode);
      const row = ensureRow(cc);
      const regRate = entry.costRateRegular ? Number(entry.costRateRegular) : DEFAULT_COST_RATE;
      const otRate = entry.costRateOvertime ? Number(entry.costRateOvertime) : regRate * DEFAULT_OT_MULTIPLIER;
      const cost = Number(entry.hoursRegular || 0) * regRate + Number(entry.hoursOvertime || 0) * otRate;
      row.actualLabor += cost;
    }
  }

  const poItems = await db
    .select({
      poItemId: purchaseOrderItems.id,
      costCode: purchaseOrderItems.costCode,
      quantity: purchaseOrderItems.quantity,
      unitCost: purchaseOrderItems.unitCost,
      poStatus: purchaseOrders.status,
      poId: purchaseOrders.id,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.poId, purchaseOrders.id))
    .where(eq(purchaseOrders.projectId, projectId))
    .limit(10000);

  for (const item of poItems) {
    const cc = normalizeCostCode(item.costCode);
    const row = ensureRow(cc);
    const lineCost = Number(item.quantity || 0) * Number(item.unitCost || 0);
    const status = item.poStatus as string;
    if (["APPROVED", "SENT", "PARTIAL", "FULFILLED"].includes(status)) {
      row.committedPO += lineCost;
    }
  }

  const receivablePoIds = poItems
    .filter(i => ["PARTIAL", "FULFILLED"].includes(i.poStatus as string))
    .map(i => i.poId);

  if (receivablePoIds.length > 0) {
    const uniquePoIds = [...new Set(receivablePoIds)];
    const receiptRows = await db
      .select({
        poItemId: poReceiptItems.poItemId,
        quantityReceived: poReceiptItems.quantityReceived,
      })
      .from(poReceiptItems)
      .innerJoin(poReceipts, eq(poReceiptItems.receiptId, poReceipts.id))
      .where(inArray(poReceipts.poId, uniquePoIds))
      .limit(10000);

    const receivedQtyMap = new Map<string, number>();
    for (const r of receiptRows) {
      receivedQtyMap.set(r.poItemId, (receivedQtyMap.get(r.poItemId) || 0) + Number(r.quantityReceived));
    }

    for (const item of poItems) {
      if (!["PARTIAL", "FULFILLED"].includes(item.poStatus as string)) continue;
      const cc = normalizeCostCode(item.costCode);
      const row = ensureRow(cc);
      const receivedQty = receivedQtyMap.get(item.poItemId) || 0;
      if (receivedQty > 0) {
        row.actualMaterial += receivedQty * Number(item.unitCost || 0);
      }
    }
  }

  const subContracts = await db
    .select({
      id: subcontractorContracts.id,
      contractAmount: subcontractorContracts.contractAmount,
      status: subcontractorContracts.status,
      scopeOfWork: subcontractorContracts.scopeOfWork,
      costCode: subcontractorContracts.costCode,
    })
    .from(subcontractorContracts)
    .where(eq(subcontractorContracts.projectId, projectId))
    .limit(1000);

  const contractCostCodeMap = new Map<string, string | null>();
  for (const contract of subContracts) {
    const cc = normalizeCostCode(contract.costCode || "UNASSIGNED");
    contractCostCodeMap.set(contract.id, contract.costCode);
    const row = ensureRow(cc, cc === "UNASSIGNED" ? "Subcontractors" : undefined, cc === "UNASSIGNED" ? "Unassigned" : undefined);
    const amount = Number(contract.contractAmount);
    if (["ACTIVE", "PENDING", "APPROVED"].includes(contract.status)) {
      row.committedSub += amount;
    }
  }

  if (subContracts.length > 0) {
    const contractIds = subContracts.map(c => c.id);
    const payments = await db
      .select({
        contractId: subcontractorPayments.contractId,
        amount: subcontractorPayments.amount,
        status: subcontractorPayments.status,
      })
      .from(subcontractorPayments)
      .where(inArray(subcontractorPayments.contractId, contractIds))
      .limit(5000);

    for (const payment of payments) {
      if (payment.status !== "APPROVED" && payment.status !== "PAID") continue;
      const parentCostCode = contractCostCodeMap.get(payment.contractId) || "UNASSIGNED";
      const cc = normalizeCostCode(parentCostCode);
      const row = ensureRow(cc, cc === "UNASSIGNED" ? "Subcontractors" : undefined, cc === "UNASSIGNED" ? "Unassigned" : undefined);
      row.actualSub += Number(payment.amount);
    }
  }

  const equipPlans = await db
    .select({
      plannedCost: projectEquipmentPlans.plannedCost,
      actualCost: projectEquipmentPlans.actualCost,
      costCode: projectEquipmentPlans.costCode,
    })
    .from(projectEquipmentPlans)
    .where(eq(projectEquipmentPlans.projectId, projectId))
    .limit(500);

  for (const plan of equipPlans) {
    const cc = normalizeCostCode(plan.costCode || "UNASSIGNED");
    const row = ensureRow(cc, cc === "UNASSIGNED" ? "Equipment (unassigned)" : undefined, cc === "UNASSIGNED" ? "Unassigned" : undefined);
    const cost = Number(plan.actualCost || 0) > 0 ? Number(plan.actualCost) : Number(plan.plannedCost || 0);
    row.actualEquipment += cost;
  }

  const tmTicketRows = await db
    .select({
      grandTotal: tmTickets.grandTotal,
      status: tmTickets.status,
      costCode: tmTickets.costCode,
    })
    .from(tmTickets)
    .where(eq(tmTickets.projectId, projectId))
    .limit(1000);

  for (const ticket of tmTicketRows) {
    if (ticket.status === "APPROVED") {
      const cc = normalizeCostCode(ticket.costCode || "UNASSIGNED");
      const row = ensureRow(cc, cc === "UNASSIGNED" ? "T&M Tickets" : undefined, cc === "UNASSIGNED" ? "Unassigned" : undefined);
      row.actualTM += Number(ticket.grandTotal || 0);
    }
  }

  const expenseReceipts = await db
    .select({
      amount: receipts.amount,
      category: receipts.category,
      costCode: receipts.costCode,
    })
    .from(receipts)
    .where(eq(receipts.projectId, projectId))
    .limit(5000);

  for (const receipt of expenseReceipts) {
    const cc = normalizeCostCode(receipt.costCode || "UNASSIGNED");
    const row = ensureRow(cc, cc === "UNASSIGNED" ? "Other Expenses" : undefined, cc === "UNASSIGNED" ? "Unassigned" : undefined);
    row.actualOther += Number(receipt.amount || 0);
  }

  const adjustments = await db.select().from(forecastAdjustments).where(eq(forecastAdjustments.projectId, projectId));
  const adjustmentMap = new Map<string, { adjustedETC: number; note: string | null }>();
  for (const adj of adjustments) {
    adjustmentMap.set(normalizeCostCode(adj.costCode), { adjustedETC: Number(adj.adjustedETC), note: adj.note });
  }

  let percentComplete = 0;
  if (projectStartDate && projectEndDate) {
    const start = new Date(projectStartDate).getTime();
    const end = new Date(projectEndDate).getTime();
    const now = Date.now();
    const total = end - start;
    if (total > 0) {
      percentComplete = Math.min(100, Math.max(1, ((now - start) / total) * 100));
    }
  }

  const rows: CostCodeLedgerRow[] = [];
  for (const row of costMap.values()) {
    row.committedTotal = row.committedPO + row.committedSub;
    row.actualTotal = row.actualLabor + row.actualMaterial + row.actualSub + row.actualEquipment + row.actualTM + row.actualOther;
    row.remainingBudget = row.budgetedTotal - row.actualTotal;
    row.percentUsed = row.budgetedTotal > 0 ? (row.actualTotal / row.budgetedTotal) * 100 : (row.actualTotal > 0 ? 100 : 0);

    if (percentComplete > 0 && percentComplete < 100) {
      row.forecast = row.actualTotal / (percentComplete / 100);
    } else if (row.budgetedTotal > 0 && row.actualTotal > 0) {
      const budgetRatio = row.actualTotal / row.budgetedTotal;
      row.forecast = budgetRatio > 0 ? row.budgetedTotal * Math.max(1, budgetRatio) : row.actualTotal;
    } else {
      row.forecast = row.actualTotal;
    }

    const adj = adjustmentMap.get(row.costCode);
    if (adj) {
      row.forecastAdjustment = adj.adjustedETC;
      row.forecastAdjustmentNote = adj.note;
    }

    const committedActuals = row.actualMaterial + row.actualSub;
    const remainingCommitted = Math.max(0, row.committedTotal - committedActuals);

    let estimatedOpenRemaining = 0;
    if (row.budgetedTotal > 0) {
      const coveredByActualsAndCommitted = row.actualTotal + remainingCommitted;
      estimatedOpenRemaining = Math.max(0, row.budgetedTotal - coveredByActualsAndCommitted);
    }

    if (adj && adj.adjustedETC !== null) {
      row.etc = adj.adjustedETC;
    } else {
      row.etc = remainingCommitted + estimatedOpenRemaining;
    }

    row.ffc = row.actualTotal + row.etc;
    row.projectedVariance = row.budgetedTotal - row.ffc;

    if (row.budgetedTotal > 0) {
      if (row.percentUsed >= criticalThreshold) {
        row.alertLevel = "CRITICAL";
      } else if (row.percentUsed >= alertThreshold) {
        row.alertLevel = "WARNING";
      }
    }

    row.actualLabor = round2(row.actualLabor);
    row.actualMaterial = round2(row.actualMaterial);
    row.actualSub = round2(row.actualSub);
    row.actualEquipment = round2(row.actualEquipment);
    row.actualTM = round2(row.actualTM);
    row.actualOther = round2(row.actualOther);
    row.actualTotal = round2(row.actualTotal);
    row.committedPO = round2(row.committedPO);
    row.committedSub = round2(row.committedSub);
    row.committedTotal = round2(row.committedTotal);
    row.remainingBudget = round2(row.remainingBudget);
    row.percentUsed = round2(row.percentUsed);
    row.forecast = round2(row.forecast);
    row.etc = round2(row.etc);
    row.ffc = round2(row.ffc);
    row.projectedVariance = round2(row.projectedVariance);

    rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.costCode === "UNASSIGNED") return 1;
    if (b.costCode === "UNASSIGNED") return -1;
    return a.costCode.localeCompare(b.costCode);
  });

  const totals: CostCodeLedgerRow = {
    costCode: "TOTAL",
    description: "Project Total",
    division: "",
    budgetedLabor: 0, budgetedMaterial: 0, budgetedSub: 0, budgetedEquipment: 0, budgetedOther: 0, budgetedTotal: 0,
    committedPO: 0, committedSub: 0, committedTotal: 0,
    actualLabor: 0, actualMaterial: 0, actualSub: 0, actualEquipment: 0, actualTM: 0, actualOther: 0, actualTotal: 0,
    remainingBudget: 0, percentUsed: 0, forecast: 0,
    etc: 0, ffc: 0, projectedVariance: 0,
    forecastAdjustment: null, forecastAdjustmentNote: null,
    alertLevel: null,
  };

  for (const row of rows) {
    totals.budgetedLabor += row.budgetedLabor;
    totals.budgetedMaterial += row.budgetedMaterial;
    totals.budgetedSub += row.budgetedSub;
    totals.budgetedEquipment += row.budgetedEquipment;
    totals.budgetedOther += row.budgetedOther;
    totals.budgetedTotal += row.budgetedTotal;
    totals.committedPO += row.committedPO;
    totals.committedSub += row.committedSub;
    totals.committedTotal += row.committedTotal;
    totals.actualLabor += row.actualLabor;
    totals.actualMaterial += row.actualMaterial;
    totals.actualSub += row.actualSub;
    totals.actualEquipment += row.actualEquipment;
    totals.actualTM += row.actualTM;
    totals.actualOther += row.actualOther;
    totals.actualTotal += row.actualTotal;
    totals.etc += row.etc;
    totals.ffc += row.ffc;
  }

  totals.budgetedLabor = round2(totals.budgetedLabor);
  totals.budgetedMaterial = round2(totals.budgetedMaterial);
  totals.budgetedSub = round2(totals.budgetedSub);
  totals.budgetedEquipment = round2(totals.budgetedEquipment);
  totals.budgetedOther = round2(totals.budgetedOther);
  totals.budgetedTotal = round2(totals.budgetedTotal);
  totals.committedPO = round2(totals.committedPO);
  totals.committedSub = round2(totals.committedSub);
  totals.committedTotal = round2(totals.committedTotal);
  totals.actualLabor = round2(totals.actualLabor);
  totals.actualMaterial = round2(totals.actualMaterial);
  totals.actualSub = round2(totals.actualSub);
  totals.actualEquipment = round2(totals.actualEquipment);
  totals.actualTM = round2(totals.actualTM);
  totals.actualOther = round2(totals.actualOther);
  totals.actualTotal = round2(totals.actualTotal);
  totals.remainingBudget = round2(totals.budgetedTotal - totals.actualTotal);
  totals.percentUsed = totals.budgetedTotal > 0 ? round2((totals.actualTotal / totals.budgetedTotal) * 100) : 0;
  totals.etc = round2(totals.etc);
  totals.ffc = round2(totals.ffc);
  totals.projectedVariance = round2(totals.budgetedTotal - totals.ffc);

  if (percentComplete > 0 && percentComplete < 100) {
    totals.forecast = round2(totals.actualTotal / (percentComplete / 100));
  } else if (totals.budgetedTotal > 0 && totals.actualTotal > 0) {
    const budgetRatio = totals.actualTotal / totals.budgetedTotal;
    totals.forecast = round2(totals.budgetedTotal * Math.max(1, budgetRatio));
  } else {
    totals.forecast = round2(totals.actualTotal);
  }

  if (totals.budgetedTotal > 0) {
    if (totals.percentUsed >= criticalThreshold) {
      totals.alertLevel = "CRITICAL";
    } else if (totals.percentUsed >= alertThreshold) {
      totals.alertLevel = "WARNING";
    }
  }

  const budgetLineTotal = round2(totals.budgetedTotal);

  return {
    rows,
    totals,
    projectBudget: projectBudget,
    budgetLineTotal,
    percentComplete: round2(percentComplete),
    budgetAlertThreshold: alertThreshold,
    budgetCriticalThreshold: criticalThreshold,
  };
}

function normalizeCostCode(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") return "UNASSIGNED";
  const parts = raw.split(" - ");
  return parts[0].trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
