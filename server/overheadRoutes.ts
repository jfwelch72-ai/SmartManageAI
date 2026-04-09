import { Router, type Response } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { overheadCostItems, overheadCostHistory } from "../shared/schema/features";
import { organizations, projects } from "../shared/schema/core";
import { requireAuth, type AuthRequest } from "./auth";
import { logWarn } from "./utils/logger";
import { sendValidationError } from "./utils/validation";

const router = Router();

const OVERHEAD_CATEGORIES = ["SALARIES", "INSURANCE", "RENT_LEASE", "LOANS_FINANCING", "SUBSCRIPTIONS", "UTILITIES", "VEHICLES", "MANAGER", "PROFESSIONAL_FEES", "EQUIPMENT", "OTHER", ] as const;

const OVERHEAD_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"] as const;

const MONTHLY_MULTIPLIERS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  ANNUAL: 1 / 12,
  ONE_TIME: 0,
};

const DEFAULT_AMORTIZATION_MONTHS = 12;

function toMonthly(amount: number, frequency: string, amortizationMonths?: number | null): number {
  if (frequency === "ONE_TIME") {
    const months = amortizationMonths && amortizationMonths > 0 ? amortizationMonths : DEFAULT_AMORTIZATION_MONTHS;
    return amount / months;
  }
  return amount * (MONTHLY_MULTIPLIERS[frequency] ?? 1);
}

function requireOverheadRole(req: AuthRequest, res: Response): boolean {
  const role = req.user?.role;
  const allowed = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER"];
  if (!role || !allowed.includes(role)) {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  return true;
}

function canReadBidBenchmark(role?: string): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "HUSTLER" ||
    role === "MANAGER" ||
    role === "SUPERINTENDENT" ||
    role === "ESTIMATOR"
  );
}

const createItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(OVERHEAD_CATEGORIES),
  amount: z.number().nonnegative(),
  frequency: z.enum(OVERHEAD_FREQUENCIES),
  amortizationMonths: z.number().int().min(1).max(120).nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const updateItemSchema = createItemSchema.partial();

const revenueTargetSchema = z.object({
  annualRevenueTarget: z.number().nonnegative().nullable(),
  defaultOverheadPercent: z.number().min(0).max(100).nullable().optional(),
  overheadWarningThreshold: z.number().min(0).max(100).nullable().optional(),
  overheadCriticalThreshold: z.number().min(0).max(100).nullable().optional(),
  overheadCategoryWeights: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  monthlyRevenueTargets: z.record(z.string(), z.number().nonnegative()).nullable().optional(),
});

function itemToJson(item: Record<string, unknown>): string {
  return JSON.stringify({
    name: item.name,
    category: item.category,
    amount: item.amount,
    frequency: item.frequency,
    amortizationMonths: item.amortizationMonths,
    isActive: item.isActive,
    notes: item.notes,
    effectiveDate: item.effectiveDate,
    endDate: item.endDate,
  });
}

// GET /api/overhead/items  (ADMIN | MANAGER)
router.get("/api/overhead/items", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const items = await db
    .select()
    .from(overheadCostItems)
    .where(eq(overheadCostItems.organizationId, orgId))
    .orderBy(overheadCostItems.category, overheadCostItems.name);

  res.json(items);
});

// POST /api/overhead/items
router.post("/api/overhead/items", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const data = parsed.data;
  const [item] = await db
    .insert(overheadCostItems)
    .values({
      organizationId: orgId,
      name: data.name,
      category: data.category,
      amount: String(data.amount),
      frequency: data.frequency,
      amortizationMonths: data.frequency === "ONE_TIME" ? (data.amortizationMonths ?? null) : null,
      effectiveDate: data.effectiveDate ?? null,
      endDate: data.endDate ?? null,
      isActive: data.isActive ?? true,
      notes: data.notes ?? null,
    })
    .returning();

  await db.insert(overheadCostHistory).values({
    organizationId: orgId,
    costItemId: item.id,
    action: "CREATE",
    performedById: req.user!.id,
    itemName: item.name,
    previousData: null,
    newData: itemToJson(item),
  });

  res.status(201).json(item);
});

// PATCH /api/overhead/items/:id
router.patch("/api/overhead/items/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const [existing] = await db
    .select()
    .from(overheadCostItems)
    .where(and(eq(overheadCostItems.id, req.params.id), eq(overheadCostItems.organizationId, orgId)));

  if (!existing) return res.status(404).json({ error: "Item not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const data = parsed.data;
  if (data.name !== undefined) updates.name = data.name;
  if (data.category !== undefined) updates.category = data.category;
  if (data.amount !== undefined) updates.amount = String(data.amount);
  if (data.frequency !== undefined) updates.frequency = data.frequency;
  if ("amortizationMonths" in data) updates.amortizationMonths = data.amortizationMonths ?? null;
  if ("effectiveDate" in data) updates.effectiveDate = data.effectiveDate ?? null;
  if ("endDate" in data) updates.endDate = data.endDate ?? null;
  if (data.isActive !== undefined) updates.isActive = data.isActive;
  if ("notes" in data) updates.notes = data.notes ?? null;

  const freq = data.frequency ?? existing.frequency;
  if (freq !== "ONE_TIME") {
    updates.amortizationMonths = null;
  }

  const [item] = await db
    .update(overheadCostItems)
    .set(updates)
    .where(and(eq(overheadCostItems.id, req.params.id), eq(overheadCostItems.organizationId, orgId)))
    .returning();

  if (!item) return res.status(404).json({ error: "Item not found" });

  await db.insert(overheadCostHistory).values({
    organizationId: orgId,
    costItemId: item.id,
    action: "UPDATE",
    performedById: req.user!.id,
    itemName: item.name,
    previousData: itemToJson(existing),
    newData: itemToJson(item),
  });

  res.json(item);
});

// DELETE /api/overhead/items/:id
router.delete("/api/overhead/items/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const [deleted] = await db
    .delete(overheadCostItems)
    .where(and(eq(overheadCostItems.id, req.params.id), eq(overheadCostItems.organizationId, orgId)))
    .returning();

  if (!deleted) return res.status(404).json({ error: "Item not found" });

  await db.insert(overheadCostHistory).values({
    organizationId: orgId,
    costItemId: deleted.id,
    action: "DELETE",
    performedById: req.user!.id,
    itemName: deleted.name,
    previousData: itemToJson(deleted),
    newData: null,
  });

  res.json({ success: true });
});

// GET /api/overhead/history
router.get("/api/overhead/history", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const history = await db
    .select()
    .from(overheadCostHistory)
    .where(eq(overheadCostHistory.organizationId, orgId))
    .orderBy(desc(overheadCostHistory.createdAt))
    .limit(limit);

  res.json(history);
});

// GET /api/overhead/summary
router.get("/api/overhead/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  const role = req.user?.role;
  if (!canReadBidBenchmark(role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const [org, items] = await Promise.all([
    db
      .select({
        annualRevenueTarget: organizations.annualRevenueTarget,
        defaultOverheadPercent: organizations.defaultOverheadPercent,
        overheadWarningThreshold: organizations.overheadWarningThreshold,
        overheadCriticalThreshold: organizations.overheadCriticalThreshold,
        overheadCategoryWeights: organizations.overheadCategoryWeights,
        monthlyRevenueTargets: organizations.monthlyRevenueTargets,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(overheadCostItems)
      .where(and(eq(overheadCostItems.organizationId, orgId), eq(overheadCostItems.isActive, true))),
  ]);

  let totalMonthly = 0;
  const categoryBreakdown: Record<string, number> = {};
  for (const item of items) {
    const monthly = toMonthly(Number(item.amount), item.frequency, item.amortizationMonths);
    totalMonthly += monthly;
    const cat = item.category ?? "OTHER";
    categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + monthly;
  }
  const totalAnnual = totalMonthly * 12;

  const annualRevenue = org?.annualRevenueTarget ? Number(org.annualRevenueTarget) : null;

  let monthlyRevTargets: Record<string, number> | null = null;
  try {
    if ((org as any)?.monthlyRevenueTargets) {
      monthlyRevTargets = JSON.parse((org as any).monthlyRevenueTargets);
    }
  } catch { logWarn("Non-critical operation failed"); }

  const currentMonthKey = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"][new Date().getMonth()];
  const currentMonthTarget = monthlyRevTargets?.[currentMonthKey] ?? null;
  const effectiveMonthlyRevenue = currentMonthTarget ?? (annualRevenue ? annualRevenue / 12 : null);

  const suggestedPercent =
    effectiveMonthlyRevenue && effectiveMonthlyRevenue > 0
      ? Math.round((totalMonthly / effectiveMonthlyRevenue) * 1000) / 10
      : null;

  let categoryWeights: Record<string, number> | null = null;
  try {
    categoryWeights = org?.overheadCategoryWeights ? JSON.parse(org.overheadCategoryWeights) : null;
  } catch { logWarn("Non-critical operation failed"); }

  let monthlyRevenueTargets: Record<string, number> | null = null;
  try {
    monthlyRevenueTargets = org?.monthlyRevenueTargets ? JSON.parse(org.monthlyRevenueTargets) : null;
  } catch { logWarn("Non-critical operation failed"); }

  const weightedCategoryBreakdown: Record<string, { monthly: number; weight: number; weighted: number }> = {};
  if (categoryWeights && Object.keys(categoryWeights).length > 0) {
    for (const [cat, monthly] of Object.entries(categoryBreakdown)) {
      const weight = categoryWeights[cat] ?? (org?.defaultOverheadPercent != null ? Number(org.defaultOverheadPercent) : 15);
      weightedCategoryBreakdown[cat] = {
        monthly,
        weight,
        weighted: monthly * (weight / 100),
      };
    }
  }

  res.json({
    totalMonthly: Math.round(totalMonthly * 100) / 100,
    totalAnnual: Math.round(totalAnnual * 100) / 100,
    suggestedPercent,
    annualRevenueTarget: annualRevenue,
    defaultOverheadPercent: org?.defaultOverheadPercent != null ? Number(org.defaultOverheadPercent) : 15,
    overheadWarningThreshold: org?.overheadWarningThreshold != null ? Number(org.overheadWarningThreshold) : null,
    overheadCriticalThreshold: org?.overheadCriticalThreshold != null ? Number(org.overheadCriticalThreshold) : null,
    categoryBreakdown,
    categoryWeights: categoryWeights ?? {},
    weightedCategoryBreakdown,
    monthlyRevenueTargets: monthlyRevenueTargets ?? {},
  });
});

// PATCH /api/overhead/revenue-target  (ADMIN | MANAGER)
router.patch("/api/overhead/revenue-target", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const parsed = revenueTargetSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if ("annualRevenueTarget" in parsed.data) {
    updates.annualRevenueTarget =
      parsed.data.annualRevenueTarget != null ? String(parsed.data.annualRevenueTarget) : null;
  }
  if (parsed.data.defaultOverheadPercent != null) {
    updates.defaultOverheadPercent = String(parsed.data.defaultOverheadPercent);
  }
  if ("overheadWarningThreshold" in parsed.data) {
    updates.overheadWarningThreshold =
      parsed.data.overheadWarningThreshold != null ? String(parsed.data.overheadWarningThreshold) : null;
  }
  if ("overheadCriticalThreshold" in parsed.data) {
    updates.overheadCriticalThreshold =
      parsed.data.overheadCriticalThreshold != null ? String(parsed.data.overheadCriticalThreshold) : null;
  }
  if ("overheadCategoryWeights" in parsed.data) {
    updates.overheadCategoryWeights =
      parsed.data.overheadCategoryWeights != null ? JSON.stringify(parsed.data.overheadCategoryWeights) : null;
  }
  if ("monthlyRevenueTargets" in parsed.data) {
    updates.monthlyRevenueTargets =
      parsed.data.monthlyRevenueTargets != null ? JSON.stringify(parsed.data.monthlyRevenueTargets) : null;
  }

  await db.update(organizations).set(updates).where(eq(organizations.id, orgId));
  res.json({ success: true });
});

// GET /api/overhead/project-allocation
router.get("/api/overhead/project-allocation", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const [activeProjects, items] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        budget: projects.budget,
        contractAmount: projects.contractAmount,
        status: projects.status,
      })
      .from(projects)
      .where(
        and(
          eq(projects.gcOrganizationId, orgId),
          inArray(projects.status, ["ACTIVE", "PLANNING"])
        )
      ),
    db
      .select()
      .from(overheadCostItems)
      .where(and(eq(overheadCostItems.organizationId, orgId), eq(overheadCostItems.isActive, true))),
  ]);

  let totalMonthly = 0;
  for (const item of items) {
    totalMonthly += toMonthly(Number(item.amount), item.frequency, item.amortizationMonths);
  }
  const totalAnnual = totalMonthly * 12;

  let totalDirectCosts = 0;
  const projectData = activeProjects.map((p) => {
    const directCost = Number(p.budget ?? p.contractAmount ?? 0);
    totalDirectCosts += directCost;
    return { ...p, directCost };
  });

  const allocations = projectData.map((p) => {
    const share = totalDirectCosts > 0 ? p.directCost / totalDirectCosts : 0;
    return {
      projectId: p.id,
      projectName: p.name,
      projectCode: p.code,
      status: p.status,
      directCost: Math.round(p.directCost * 100) / 100,
      sharePercent: Math.round(share * 1000) / 10,
      monthlyOverheadAllocation: Math.round(totalMonthly * share * 100) / 100,
      annualOverheadAllocation: Math.round(totalAnnual * share * 100) / 100,
    };
  });

  allocations.sort((a, b) => b.directCost - a.directCost);

  res.json({
    totalMonthlyOverhead: Math.round(totalMonthly * 100) / 100,
    totalAnnualOverhead: Math.round(totalAnnual * 100) / 100,
    totalDirectCosts: Math.round(totalDirectCosts * 100) / 100,
    allocations,
  });
});

// GET /api/overhead/monthly-breakdown
router.get("/api/overhead/monthly-breakdown", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization" });

  const [org, items] = await Promise.all([
    db
      .select({
        annualRevenueTarget: organizations.annualRevenueTarget,
        monthlyRevenueTargets: organizations.monthlyRevenueTargets,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(overheadCostItems)
      .where(and(eq(overheadCostItems.organizationId, orgId), eq(overheadCostItems.isActive, true))),
  ]);

  let totalMonthly = 0;
  for (const item of items) {
    totalMonthly += toMonthly(Number(item.amount), item.frequency, item.amortizationMonths);
  }

  const annualRevenue = org?.annualRevenueTarget ? Number(org.annualRevenueTarget) : null;
  const fallbackMonthlyRevenue = annualRevenue ? annualRevenue / 12 : null;

  let storedTargets: Record<string, number> = {};
  try {
    storedTargets = org?.monthlyRevenueTargets ? JSON.parse(org.monthlyRevenueTargets) : {};
  } catch { logWarn("Non-critical operation failed"); }

  const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  const months: { month: string; monthKey: string; overhead: number; revenueTarget: number | null; overheadPercent: number | null }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const monthLabel = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const monthKey = MONTH_KEYS[d.getMonth()];
    const overhead = Math.round(totalMonthly * 100) / 100;

    const monthlyRevTarget = storedTargets[monthKey] != null
      ? storedTargets[monthKey]
      : fallbackMonthlyRevenue;

    const pct = monthlyRevTarget && monthlyRevTarget > 0
      ? Math.round((totalMonthly / monthlyRevTarget) * 1000) / 10
      : null;

    months.push({
      month: monthLabel,
      monthKey,
      overhead,
      revenueTarget: monthlyRevTarget ? Math.round(monthlyRevTarget * 100) / 100 : null,
      overheadPercent: pct,
    });
  }

  res.json({ months });
});

export default router;
