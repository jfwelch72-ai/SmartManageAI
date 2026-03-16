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
}

export interface CostLedgerSummary {
  rows: CostCodeLedgerRow[];
  totals: CostCodeLedgerRow;
  projectBudget: number;
  budgetLineTotal: number;
  percentComplete: number;
}

const DEFAULT_COST_RATE = 50;
const DEFAULT_OT_MULTIPLIER = 1.5;

export async function calculateCostLedger(projectId: string, projectBudget: number, projectStartDate?: Date | null, projectEndDate?: Date | null): Promise<CostLedgerSummary> {
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
      });
    }
    return costMap.get(costCode)!;
  };

  const lines = await db.select().from(budgetLineItems).where(eq(budgetLineItems.projectId, projectId));
  for (const line of lines) {
    const row = ensureRow(line.costCode, line.description, line.division);
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

  for (const entry of laborEntries) {
    if (entry.approvalStatus !== "APPROVED") continue;
    const cc = normalizeCostCode(entry.costCode);
    const row = ensureRow(cc);
    const regRate = entry.costRateRegular ? Number(entry.costRateRegular) : DEFAULT_COST_RATE;
    const otRate = entry.costRateOvertime ? Number(entry.costRateOvertime) : regRate * DEFAULT_OT_MULTIPLIER;
    const cost = Number(entry.hoursRegular || 0) * regRate + Number(entry.hoursOvertime || 0) * otRate;
    row.actualLabor += cost;
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
    if (["APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED"].includes(status)) {
      row.committedPO += lineCost;
    }
    if (["RECEIVED"].includes(status)) {
      row.actualMaterial += lineCost;
    }
  }

  const receivedPoIds = poItems
    .filter(i => ["PARTIALLY_RECEIVED"].includes(i.poStatus as string))
    .map(i => i.poId);

  if (receivedPoIds.length > 0) {
    const uniquePoIds = [...new Set(receivedPoIds)];
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
      if (!["PARTIALLY_RECEIVED"].includes(item.poStatus as string)) continue;
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
    })
    .from(subcontractorContracts)
    .where(eq(subcontractorContracts.projectId, projectId))
    .limit(1000);

  for (const contract of subContracts) {
    const cc = normalizeCostCode(contract.scopeOfWork);
    const row = ensureRow(cc, cc === "UNASSIGNED" ? "Subcontractor (unassigned)" : cc, cc === "UNASSIGNED" ? "Unassigned" : "Subcontractor");
    const amount = Number(contract.contractAmount);
    if (["ACTIVE", "PENDING", "APPROVED"].includes(contract.status)) {
      row.committedSub += amount;
    }
  }

  if (subContracts.length > 0) {
    const contractIds = subContracts.map(c => c.id);
    const contractScopeMap = new Map(subContracts.map(c => [c.id, c.scopeOfWork]));
    const payments = await db
      .select({
        contractId: subcontractorPayments.contractId,
        amount: subcontractorPayments.amount,
      })
      .from(subcontractorPayments)
      .where(inArray(subcontractorPayments.contractId, contractIds))
      .limit(5000);

    for (const payment of payments) {
      const scope = contractScopeMap.get(payment.contractId) || null;
      const cc = normalizeCostCode(scope);
      const row = ensureRow(cc, cc === "UNASSIGNED" ? "Subcontractor (unassigned)" : cc, cc === "UNASSIGNED" ? "Unassigned" : "Subcontractor");
      row.actualSub += Number(payment.amount);
    }
  }

  const equipPlans = await db
    .select({
      plannedCost: projectEquipmentPlans.plannedCost,
      actualCost: projectEquipmentPlans.actualCost,
    })
    .from(projectEquipmentPlans)
    .where(eq(projectEquipmentPlans.projectId, projectId))
    .limit(500);

  for (const plan of equipPlans) {
    const row = ensureRow("UNASSIGNED", "Equipment (unassigned)", "Unassigned");
    const cost = Number(plan.actualCost || 0) > 0 ? Number(plan.actualCost) : Number(plan.plannedCost || 0);
    row.actualEquipment += cost;
  }

  const tmTicketRows = await db
    .select({
      grandTotal: tmTickets.grandTotal,
      status: tmTickets.status,
      workTypeCode: tmTickets.workTypeCode,
      workTypeName: tmTickets.workTypeName,
    })
    .from(tmTickets)
    .where(eq(tmTickets.projectId, projectId))
    .limit(1000);

  for (const ticket of tmTicketRows) {
    if (ticket.status === "APPROVED") {
      const cc = normalizeCostCode(ticket.workTypeCode);
      const desc = ticket.workTypeName || (cc === "UNASSIGNED" ? "T&M (unassigned)" : cc);
      const row = ensureRow(cc, desc, cc === "UNASSIGNED" ? "Unassigned" : "T&M");
      row.actualTM += Number(ticket.grandTotal || 0);
    }
  }

  const expenseReceipts = await db
    .select({
      amount: receipts.amount,
      category: receipts.category,
    })
    .from(receipts)
    .where(eq(receipts.projectId, projectId))
    .limit(5000);

  for (const receipt of expenseReceipts) {
    const cc = normalizeCostCode(receipt.category);
    const row = ensureRow(cc, cc === "UNASSIGNED" ? "Other Expenses" : cc, cc === "UNASSIGNED" ? "Unassigned" : "Expenses");
    row.actualOther += Number(receipt.amount || 0);
  }

  let percentComplete = 50;
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
    row.forecast = percentComplete > 0 && percentComplete < 100
      ? row.actualTotal / (percentComplete / 100)
      : row.actualTotal;

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
  totals.forecast = percentComplete > 0 && percentComplete < 100
    ? round2(totals.actualTotal / (percentComplete / 100))
    : round2(totals.actualTotal);

  const budgetLineTotal = round2(totals.budgetedTotal);

  return {
    rows,
    totals,
    projectBudget: projectBudget,
    budgetLineTotal,
    percentComplete: round2(percentComplete),
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
