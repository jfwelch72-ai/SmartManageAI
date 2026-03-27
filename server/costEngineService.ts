import { db } from "./db";
import { costTransactions } from "@shared/schema";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import type { InsertCostTransaction, CostTransaction } from "@shared/schema";

export type CostSourceCategory = "LABOR" | "MATERIAL" | "EQUIPMENT" | "SUBCONTRACTOR" | "OTHER";
export type CostOriginModule = "ESTIMATE" | "PO" | "PAYROLL" | "TM" | "RECEIPT" | "CHANGE_ORDER" | "EQUIPMENT" | "SUBCONTRACTOR";

export interface PostTransactionInput {
  projectId: string;
  costCode: string;
  sourceCategory: CostSourceCategory;
  originModule: CostOriginModule;
  amount: string | number;
  transactionDate: string;
  referenceId?: string;
  description?: string;
  createdBy?: string;
}

export interface CostSummaryRow {
  groupKey: string;
  totalAmount: number;
  transactionCount: number;
}

export interface CostSummaryFilters {
  projectId: string;
  startDate?: string;
  endDate?: string;
  sourceCategory?: CostSourceCategory;
  originModule?: CostOriginModule;
  costCode?: string;
  groupBy?: "cost_code" | "source_category" | "origin_module" | "month";
}

function normalizeCostCode(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") return "UNASSIGNED";
  const parts = raw.split(" - ");
  return parts[0].trim();
}

export async function postTransaction(input: PostTransactionInput): Promise<CostTransaction> {
  if (input.referenceId) {
    const existing = await db
      .select()
      .from(costTransactions)
      .where(
        and(
          eq(costTransactions.projectId, input.projectId),
          eq(costTransactions.referenceId, input.referenceId),
          eq(costTransactions.sourceCategory, input.sourceCategory),
          eq(costTransactions.costCode, normalizeCostCode(input.costCode)),
          eq(costTransactions.status, "ACTIVE")
        )
      )
      .limit(1);
    if (existing.length > 0) {
      return existing[0];
    }
  }

  const [row] = await db.insert(costTransactions).values({
    projectId: input.projectId,
    costCode: normalizeCostCode(input.costCode),
    sourceCategory: input.sourceCategory,
    originModule: input.originModule,
    amount: String(input.amount),
    transactionDate: input.transactionDate,
    referenceId: input.referenceId || null,
    description: input.description || null,
    createdBy: input.createdBy || null,
    status: "ACTIVE",
  }).returning();
  return row;
}

export async function voidTransaction(
  transactionId: string,
  projectId: string,
  voidedBy: string,
  reason?: string
): Promise<CostTransaction | null> {
  const [row] = await db
    .update(costTransactions)
    .set({
      status: "VOIDED",
      voidedAt: new Date(),
      voidedBy,
      voidReason: reason || null,
    })
    .where(and(
      eq(costTransactions.id, transactionId),
      eq(costTransactions.projectId, projectId),
      eq(costTransactions.status, "ACTIVE")
    ))
    .returning();
  return row || null;
}

export async function bulkPost(inputs: PostTransactionInput[]): Promise<CostTransaction[]> {
  if (inputs.length === 0) return [];

  const results: CostTransaction[] = [];
  const toInsert: typeof inputs = [];

  for (const input of inputs) {
    if (input.referenceId) {
      const existing = await db
        .select()
        .from(costTransactions)
        .where(
          and(
            eq(costTransactions.projectId, input.projectId),
            eq(costTransactions.referenceId, input.referenceId),
            eq(costTransactions.sourceCategory, input.sourceCategory),
            eq(costTransactions.costCode, normalizeCostCode(input.costCode)),
            eq(costTransactions.status, "ACTIVE")
          )
        )
        .limit(1);
      if (existing.length > 0) {
        results.push(existing[0]);
        continue;
      }
    }
    toInsert.push(input);
  }

  if (toInsert.length > 0) {
    const inserted = [];
    for (const input of toInsert) {
      const [row] = await db.insert(costTransactions).values({
        projectId: input.projectId,
        costCode: normalizeCostCode(input.costCode),
        sourceCategory: input.sourceCategory,
        originModule: input.originModule,
        amount: String(input.amount),
        transactionDate: input.transactionDate,
        referenceId: input.referenceId || null,
        description: input.description || null,
        createdBy: input.createdBy || null,
        status: "ACTIVE",
      }).returning();
      inserted.push(row);
    }
    results.push(...inserted);
  }

  return results;
}

export async function getByProject(
  projectId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    sourceCategory?: CostSourceCategory;
    originModule?: CostOriginModule;
    costCode?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ transactions: CostTransaction[]; total: number }> {
  const conditions = [
    eq(costTransactions.projectId, projectId),
    eq(costTransactions.status, "ACTIVE"),
  ];

  if (options?.startDate) {
    conditions.push(gte(costTransactions.transactionDate, options.startDate));
  }
  if (options?.endDate) {
    conditions.push(lte(costTransactions.transactionDate, options.endDate));
  }
  if (options?.sourceCategory) {
    conditions.push(eq(costTransactions.sourceCategory, options.sourceCategory));
  }
  if (options?.originModule) {
    conditions.push(eq(costTransactions.originModule, options.originModule));
  }
  if (options?.costCode) {
    conditions.push(eq(costTransactions.costCode, options.costCode));
  }

  const whereClause = and(...conditions);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(costTransactions)
    .where(whereClause!);

  const transactions = await db
    .select()
    .from(costTransactions)
    .where(whereClause!)
    .orderBy(desc(costTransactions.transactionDate), desc(costTransactions.createdAt))
    .limit(options?.limit || 100)
    .offset(options?.offset || 0);

  return { transactions, total: countResult?.count || 0 };
}

export async function getByCostCode(
  projectId: string,
  costCode: string
): Promise<CostTransaction[]> {
  return db
    .select()
    .from(costTransactions)
    .where(
      and(
        eq(costTransactions.projectId, projectId),
        eq(costTransactions.costCode, costCode),
        eq(costTransactions.status, "ACTIVE")
      )
    )
    .orderBy(desc(costTransactions.transactionDate));
}

export async function getSummary(filters: CostSummaryFilters): Promise<CostSummaryRow[]> {
  const conditions = [
    eq(costTransactions.projectId, filters.projectId),
    eq(costTransactions.status, "ACTIVE"),
  ];

  if (filters.startDate) {
    conditions.push(gte(costTransactions.transactionDate, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(costTransactions.transactionDate, filters.endDate));
  }
  if (filters.sourceCategory) {
    conditions.push(eq(costTransactions.sourceCategory, filters.sourceCategory));
  }
  if (filters.originModule) {
    conditions.push(eq(costTransactions.originModule, filters.originModule));
  }
  if (filters.costCode) {
    conditions.push(eq(costTransactions.costCode, filters.costCode));
  }

  const whereClause = and(...conditions);
  const groupBy = filters.groupBy || "cost_code";

  let groupExpr;
  switch (groupBy) {
    case "source_category":
      groupExpr = sql<string>`${costTransactions.sourceCategory}`;
      break;
    case "origin_module":
      groupExpr = sql<string>`${costTransactions.originModule}`;
      break;
    case "month":
      groupExpr = sql<string>`to_char(${costTransactions.transactionDate}::date, 'YYYY-MM')`;
      break;
    default:
      groupExpr = sql<string>`${costTransactions.costCode}`;
  }

  const rows = await db
    .select({
      groupKey: groupExpr,
      totalAmount: sql<number>`sum(${costTransactions.amount}::numeric)::float`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(costTransactions)
    .where(whereClause!)
    .groupBy(groupExpr)
    .orderBy(groupExpr);

  return rows.map(r => ({
    groupKey: String(r.groupKey),
    totalAmount: Math.round((r.totalAmount || 0) * 100) / 100,
    transactionCount: r.transactionCount || 0,
  }));
}

export async function getActualsByProject(projectId: string): Promise<{
  labor: number;
  material: number;
  equipment: number;
  subcontractor: number;
  other: number;
  total: number;
  byCostCode: Map<string, { labor: number; material: number; equipment: number; subcontractor: number; other: number; tm: number; total: number }>;
}> {
  const rows = await db
    .select({
      costCode: costTransactions.costCode,
      sourceCategory: costTransactions.sourceCategory,
      originModule: costTransactions.originModule,
      totalAmount: sql<number>`sum(${costTransactions.amount}::numeric)::float`,
    })
    .from(costTransactions)
    .where(
      and(
        eq(costTransactions.projectId, projectId),
        eq(costTransactions.status, "ACTIVE")
      )
    )
    .groupBy(costTransactions.costCode, costTransactions.sourceCategory, costTransactions.originModule);

  let labor = 0, material = 0, equipment = 0, subcontractor = 0, other = 0;
  const byCostCode = new Map<string, { labor: number; material: number; equipment: number; subcontractor: number; other: number; tm: number; total: number }>();

  for (const row of rows) {
    const amount = row.totalAmount || 0;
    const cc = row.costCode || "UNASSIGNED";

    if (!byCostCode.has(cc)) {
      byCostCode.set(cc, { labor: 0, material: 0, equipment: 0, subcontractor: 0, other: 0, tm: 0, total: 0 });
    }
    const entry = byCostCode.get(cc)!;

    if (row.originModule === "TM") {
      entry.tm += amount;
    }

    switch (row.sourceCategory) {
      case "LABOR":
        labor += amount;
        entry.labor += amount;
        break;
      case "MATERIAL":
        material += amount;
        entry.material += amount;
        break;
      case "EQUIPMENT":
        equipment += amount;
        entry.equipment += amount;
        break;
      case "SUBCONTRACTOR":
        subcontractor += amount;
        entry.subcontractor += amount;
        break;
      case "OTHER":
        other += amount;
        entry.other += amount;
        break;
    }
    entry.total += amount;
  }

  const total = labor + material + equipment + subcontractor + other;
  return { labor, material, equipment, subcontractor, other, total, byCostCode };
}

export async function hasTransactions(projectId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(costTransactions)
    .where(
      and(
        eq(costTransactions.projectId, projectId),
        eq(costTransactions.status, "ACTIVE")
      )
    )
    .limit(1);
  return (result?.count || 0) > 0;
}

export async function voidByReference(referenceId: string, voidedBy: string, reason?: string): Promise<number> {
  const voided = await db
    .update(costTransactions)
    .set({
      status: "VOIDED",
      voidedAt: new Date(),
      voidedBy,
      voidReason: reason || null,
    })
    .where(and(eq(costTransactions.referenceId, referenceId), eq(costTransactions.status, "ACTIVE")))
    .returning();
  return voided.length;
}
