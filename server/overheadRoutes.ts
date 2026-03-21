import { Router, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { overheadCostItems } from "../shared/schema/features";
import { organizations } from "../shared/schema/core";
import { requireAuth, type AuthRequest } from "./auth";

const router = Router();

const OVERHEAD_CATEGORIES = [
  "SALARIES",
  "INSURANCE",
  "RENT_LEASE",
  "LOANS_FINANCING",
  "SUBSCRIPTIONS",
  "UTILITIES",
  "VEHICLES",
  "MARKETING",
  "PROFESSIONAL_FEES",
  "EQUIPMENT",
  "OTHER",
] as const;

const OVERHEAD_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"] as const;

const MONTHLY_MULTIPLIERS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  ANNUAL: 1 / 12,
  ONE_TIME: 0,
};

function toMonthly(amount: number, frequency: string): number {
  return amount * (MONTHLY_MULTIPLIERS[frequency] ?? 1);
}

function requireOverheadRole(req: AuthRequest, res: Response): boolean {
  const role = req.user?.role;
  if (role !== "ADMIN" && role !== "MANAGER" && role !== "OFFICE_MANAGER") {
    res.status(403).json({ message: "Insufficient permissions" });
    return false;
  }
  return true;
}

function canReadBidBenchmark(role?: string): boolean {
  return (
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "OFFICE_MANAGER" ||
    role === "ESTIMATOR" ||
    role === "SUPERINTENDENT" ||
    role === "HUSTLER" ||
    role === "PROJECT_ENGINEER"
  );
}

const createItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(OVERHEAD_CATEGORIES),
  amount: z.number().nonnegative(),
  frequency: z.enum(OVERHEAD_FREQUENCIES),
  effectiveDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const updateItemSchema = createItemSchema.partial();

const revenueTargetSchema = z.object({
  annualRevenueTarget: z.number().nonnegative().nullable(),
  defaultOverheadPercent: z.number().min(0).max(100).nullable().optional(),
});

// GET /api/overhead/items  (ADMIN | MANAGER | OFFICE_MANAGER)
router.get("/api/overhead/items", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ message: "No organization" });

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
  if (!orgId) return res.status(400).json({ message: "No organization" });

  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });

  const data = parsed.data;
  const [item] = await db
    .insert(overheadCostItems)
    .values({
      organizationId: orgId,
      name: data.name,
      category: data.category,
      amount: String(data.amount),
      frequency: data.frequency,
      effectiveDate: data.effectiveDate ?? null,
      endDate: data.endDate ?? null,
      isActive: data.isActive ?? true,
      notes: data.notes ?? null,
    })
    .returning();

  res.status(201).json(item);
});

// PATCH /api/overhead/items/:id
router.patch("/api/overhead/items/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ message: "No organization" });

  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const data = parsed.data;
  if (data.name !== undefined) updates.name = data.name;
  if (data.category !== undefined) updates.category = data.category;
  if (data.amount !== undefined) updates.amount = String(data.amount);
  if (data.frequency !== undefined) updates.frequency = data.frequency;
  if ("effectiveDate" in data) updates.effectiveDate = data.effectiveDate ?? null;
  if ("endDate" in data) updates.endDate = data.endDate ?? null;
  if (data.isActive !== undefined) updates.isActive = data.isActive;
  if ("notes" in data) updates.notes = data.notes ?? null;

  const [item] = await db
    .update(overheadCostItems)
    .set(updates)
    .where(and(eq(overheadCostItems.id, req.params.id), eq(overheadCostItems.organizationId, orgId)))
    .returning();

  if (!item) return res.status(404).json({ message: "Item not found" });
  res.json(item);
});

// DELETE /api/overhead/items/:id
router.delete("/api/overhead/items/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ message: "No organization" });

  const [deleted] = await db
    .delete(overheadCostItems)
    .where(and(eq(overheadCostItems.id, req.params.id), eq(overheadCostItems.organizationId, orgId)))
    .returning();

  if (!deleted) return res.status(404).json({ message: "Item not found" });
  res.json({ success: true });
});

// GET /api/overhead/summary
// Accessible to ADMIN | MANAGER | OFFICE_MANAGER | ESTIMATOR | SUPERINTENDENT | HUSTLER | PROJECT_ENGINEER
// so the MarkupCalculator benchmark hint is visible to all bid-capable roles.
router.get("/api/overhead/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  const role = req.user?.role;
  if (!canReadBidBenchmark(role)) {
    return res.status(403).json({ message: "Insufficient permissions" });
  }

  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ message: "No organization" });

  const [org, items] = await Promise.all([
    db
      .select({
        annualRevenueTarget: organizations.annualRevenueTarget,
        defaultOverheadPercent: organizations.defaultOverheadPercent,
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
    totalMonthly += toMonthly(Number(item.amount), item.frequency);
  }
  const totalAnnual = totalMonthly * 12;

  const annualRevenue = org?.annualRevenueTarget ? Number(org.annualRevenueTarget) : null;
  const suggestedPercent =
    annualRevenue && annualRevenue > 0
      ? Math.round((totalAnnual / annualRevenue) * 1000) / 10
      : null;

  res.json({
    totalMonthly: Math.round(totalMonthly * 100) / 100,
    totalAnnual: Math.round(totalAnnual * 100) / 100,
    suggestedPercent,
    annualRevenueTarget: annualRevenue,
    defaultOverheadPercent: org?.defaultOverheadPercent != null ? Number(org.defaultOverheadPercent) : 15,
  });
});

// PATCH /api/overhead/revenue-target  (ADMIN | MANAGER | OFFICE_MANAGER)
router.patch("/api/overhead/revenue-target", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!requireOverheadRole(req, res)) return;
  const orgId = req.user!.organizationId;
  if (!orgId) return res.status(400).json({ message: "No organization" });

  const parsed = revenueTargetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if ("annualRevenueTarget" in parsed.data) {
    updates.annualRevenueTarget =
      parsed.data.annualRevenueTarget != null ? String(parsed.data.annualRevenueTarget) : null;
  }
  if (parsed.data.defaultOverheadPercent != null) {
    updates.defaultOverheadPercent = String(parsed.data.defaultOverheadPercent);
  }

  await db.update(organizations).set(updates).where(eq(organizations.id, orgId));
  res.json({ success: true });
});

export default router;
