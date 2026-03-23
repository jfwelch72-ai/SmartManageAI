import { Router, type Response } from "express";
import { eq, and, or, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  modifiers,
  scopeModifierRules,
  bidModifierSelections,
  type Modifier,
  type ScopeModifierRule,
} from "../shared/schema/features";
import { bids } from "../shared/schema/core";
import { estimates, estimateLineItems } from "../shared/schema/operations";
import { requireAuth, type AuthRequest } from "./auth";

import universalModifiers from "./data/modifiers/universal.json";
import tradeConcreteModifiers from "./data/modifiers/trade-concrete.json";
import tradeEarthworkModifiers from "./data/modifiers/trade-earthwork.json";
import tradeElectricalModifiers from "./data/modifiers/trade-electrical.json";
import tradeRoofingModifiers from "./data/modifiers/trade-roofing.json";
import tradePlumbingModifiers from "./data/modifiers/trade-plumbing.json";
import scopeRulesData from "./data/modifiers/scope-rules.json";

const router = Router();

interface SeedModifier {
  name: string;
  category: string;
  layer: string;
  tradeIds?: string[];
  scopePatterns?: string[];
  uoms?: string[];
  materialFamilies?: string[];
  laborFactorMin?: number;
  laborFactorMax?: number;
  materialFactorMin?: number;
  materialFactorMax?: number;
  durationFactorMin?: number;
  durationFactorMax?: number;
  wasteFactorMin?: number;
  wasteFactorMax?: number;
  effectType?: string;
  aiTags?: string[];
  defaultBehavior?: string;
  displayOrder?: number;
}

interface SeedRule {
  pattern: string;
  matchType: string;
  modifierNames: string[];
  tradeIds: string[];
  priority: number;
}

function isAdminOrManager(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPER_ADMIN";
}

function buildOrgFilter(orgId: string | undefined) {
  if (orgId) {
    return or(isNull(modifiers.organizationId), eq(modifiers.organizationId, orgId));
  }
  return isNull(modifiers.organizationId);
}

async function verifyLineItemOrgOwnership(lineItemId: string, orgId: string): Promise<boolean> {
  const result = await db
    .select({ bidOrgId: bids.organizationId })
    .from(estimateLineItems)
    .innerJoin(estimates, eq(estimateLineItems.estimateId, estimates.id))
    .innerJoin(bids, eq(estimates.bidId, bids.id))
    .where(eq(estimateLineItems.id, lineItemId))
    .limit(1);

  return result.length > 0 && result[0].bidOrgId === orgId;
}

async function seedModifiersIfNeeded() {
  const existing = await db.select({ id: modifiers.id }).from(modifiers).limit(1);
  if (existing.length > 0) return;

  console.log("[Modifiers] Seeding modifier data...");

  const allModifierData: SeedModifier[] = [
    ...(universalModifiers as SeedModifier[]),
    ...(tradeConcreteModifiers as SeedModifier[]),
    ...(tradeEarthworkModifiers as SeedModifier[]),
    ...(tradeElectricalModifiers as SeedModifier[]),
    ...(tradeRoofingModifiers as SeedModifier[]),
    ...(tradePlumbingModifiers as SeedModifier[]),
  ];

  const insertRows = allModifierData.map((m) => ({
    name: m.name,
    category: m.category,
    layer: m.layer,
    tradeIds: m.tradeIds ?? [],
    scopePatterns: m.scopePatterns ?? [],
    uoms: m.uoms ?? [],
    materialFamilies: m.materialFamilies ?? [],
    laborFactorMin: m.laborFactorMin ?? 1.0,
    laborFactorMax: m.laborFactorMax ?? 1.0,
    materialFactorMin: m.materialFactorMin ?? 1.0,
    materialFactorMax: m.materialFactorMax ?? 1.0,
    durationFactorMin: m.durationFactorMin ?? 1.0,
    durationFactorMax: m.durationFactorMax ?? 1.0,
    wasteFactorMin: m.wasteFactorMin ?? 0.0,
    wasteFactorMax: m.wasteFactorMax ?? 0.0,
    effectType: m.effectType ?? "mixed",
    aiTags: m.aiTags ?? [],
    defaultBehavior: m.defaultBehavior ?? "optional",
    isActive: true,
    displayOrder: m.displayOrder ?? 0,
  }));

  for (const row of insertRows) {
    await db.insert(modifiers).values(row);
  }

  console.log(`[Modifiers] Seeded ${insertRows.length} modifiers`);

  const allInserted = await db.select({ id: modifiers.id, name: modifiers.name }).from(modifiers);
  const nameToId = new Map(allInserted.map((m) => [m.name, m.id]));

  const ruleRows = (scopeRulesData as SeedRule[]).map((r) => {
    const resolvedIds = r.modifierNames
      .map((name: string) => nameToId.get(name))
      .filter((id): id is string => id !== undefined);

    return {
      pattern: r.pattern,
      matchType: r.matchType,
      modifierIds: resolvedIds,
      tradeIds: r.tradeIds ?? [],
      priority: r.priority ?? 0,
      isActive: true,
    };
  });

  for (const rule of ruleRows) {
    await db.insert(scopeModifierRules).values(rule);
  }

  console.log(`[Modifiers] Seeded ${ruleRows.length} scope modifier rules`);
}

seedModifiersIfNeeded().catch((err: unknown) => {
  console.error("[Modifiers] Seed failed:", err);
});

function matchesScopePattern(mod: Modifier, pattern: string): boolean {
  if (mod.scopePatterns.length === 0) return false;
  const lowerPattern = pattern.toLowerCase();
  return mod.scopePatterns.some((p) => {
    try {
      return new RegExp(p, "i").test(lowerPattern);
    } catch {
      return lowerPattern.includes(p.toLowerCase());
    }
  });
}

function matchesRule(rule: ScopeModifierRule, scopeName: string): boolean {
  const lowerScope = scopeName.toLowerCase();
  const lowerPattern = rule.pattern.toLowerCase();

  switch (rule.matchType) {
    case "contains":
      return lowerScope.includes(lowerPattern);
    case "startsWith":
      return lowerScope.startsWith(lowerPattern);
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(scopeName);
      } catch {
        return lowerScope.includes(lowerPattern);
      }
    default:
      return false;
  }
}

router.get("/api/modifiers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { layer, category, scopePattern } = req.query;
    const tradeIdsParam = req.query["tradeIds[]"] || req.query.tradeIds;
    const orgId = req.user?.organizationId;

    const conditions = [
      eq(modifiers.isActive, true),
      buildOrgFilter(orgId),
    ];

    if (layer && typeof layer === "string") {
      conditions.push(eq(modifiers.layer, layer));
    }

    if (category && typeof category === "string") {
      conditions.push(eq(modifiers.category, category));
    }

    const results = await db
      .select()
      .from(modifiers)
      .where(and(...conditions))
      .orderBy(asc(modifiers.displayOrder), asc(modifiers.name));

    let filtered = results;

    if (tradeIdsParam) {
      const tradeFilter = Array.isArray(tradeIdsParam)
        ? (tradeIdsParam as string[])
        : [tradeIdsParam as string];
      filtered = filtered.filter(
        (m) =>
          m.tradeIds.length === 0 ||
          m.tradeIds.some((t) => tradeFilter.includes(t))
      );
    }

    if (scopePattern && typeof scopePattern === "string") {
      filtered = filtered.filter((m) => matchesScopePattern(m, scopePattern));
    }

    res.json(filtered);
  } catch (err: unknown) {
    console.error("[Modifiers] List error:", err);
    res.status(500).json({ message: "Failed to list modifiers" });
  }
});

router.get("/api/modifiers/for-scope", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { tradeId, scopeName } = req.query;

    if (!tradeId || !scopeName || typeof tradeId !== "string" || typeof scopeName !== "string") {
      return res.status(400).json({ message: "tradeId and scopeName are required" });
    }

    const orgId = req.user?.organizationId;
    const allActive = await db
      .select()
      .from(modifiers)
      .where(and(
        eq(modifiers.isActive, true),
        buildOrgFilter(orgId),
      ))
      .orderBy(asc(modifiers.displayOrder), asc(modifiers.name));

    const universalMods = allActive.filter((m) => m.layer === "universal");

    const tradeMods = allActive.filter(
      (m) => m.layer === "trade" && m.tradeIds.includes(tradeId)
    );

    const rules = await db
      .select()
      .from(scopeModifierRules)
      .where(eq(scopeModifierRules.isActive, true))
      .orderBy(asc(scopeModifierRules.priority));

    const matchedModifierIds = new Set<string>();

    for (const rule of rules) {
      if (rule.tradeIds.length > 0 && !rule.tradeIds.includes(tradeId)) {
        continue;
      }

      if (matchesRule(rule, scopeName)) {
        for (const id of rule.modifierIds) {
          matchedModifierIds.add(id);
        }
      }
    }

    const universalIds = new Set(universalMods.map((m) => m.id));
    const tradeIds = new Set(tradeMods.map((m) => m.id));

    const scopeMods = allActive.filter(
      (m) => matchedModifierIds.has(m.id) && !universalIds.has(m.id) && !tradeIds.has(m.id)
    );

    res.json({
      universal: universalMods,
      trade: tradeMods,
      scope: scopeMods,
      matchedRuleModifierIds: Array.from(matchedModifierIds),
    });
  } catch (err: unknown) {
    console.error("[Modifiers] for-scope error:", err);
    res.status(500).json({ message: "Failed to get modifiers for scope" });
  }
});

const createModifierSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  layer: z.enum(["universal", "trade", "scope"]),
  tradeIds: z.array(z.string()).optional().default([]),
  scopePatterns: z.array(z.string()).optional().default([]),
  uoms: z.array(z.string()).optional().default([]),
  materialFamilies: z.array(z.string()).optional().default([]),
  laborFactorMin: z.number().optional().default(1.0),
  laborFactorMax: z.number().optional().default(1.0),
  materialFactorMin: z.number().optional().default(1.0),
  materialFactorMax: z.number().optional().default(1.0),
  durationFactorMin: z.number().optional().default(1.0),
  durationFactorMax: z.number().optional().default(1.0),
  wasteFactorMin: z.number().optional().default(0.0),
  wasteFactorMax: z.number().optional().default(0.0),
  effectType: z.enum(["labor", "material", "mixed"]).optional().default("mixed"),
  aiTags: z.array(z.string()).optional().default([]),
  defaultBehavior: z.enum(["optional", "required"]).optional().default("optional"),
  displayOrder: z.number().int().optional().default(0),
});

router.post("/api/modifiers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminOrManager(req.user?.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const parsed = createModifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    }

    const orgId = req.user?.organizationId;
    if (!orgId) {
      return res.status(400).json({ message: "Organization required" });
    }

    const [created] = await db
      .insert(modifiers)
      .values({ ...parsed.data, organizationId: orgId })
      .returning();

    res.status(201).json(created);
  } catch (err: unknown) {
    console.error("[Modifiers] Create error:", err);
    res.status(500).json({ message: "Failed to create modifier" });
  }
});

const updateModifierSchema = createModifierSchema.partial();

router.patch("/api/modifiers/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminOrManager(req.user?.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const { id } = req.params;
    const orgId = req.user?.organizationId;

    const [existing] = await db
      .select()
      .from(modifiers)
      .where(eq(modifiers.id, id));

    if (!existing) {
      return res.status(404).json({ message: "Modifier not found" });
    }

    if (!existing.organizationId || existing.organizationId !== orgId) {
      return res.status(403).json({ message: "Can only edit org-specific modifiers" });
    }

    const parsed = updateModifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    }

    const [updated] = await db
      .update(modifiers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(modifiers.id, id))
      .returning();

    res.json(updated);
  } catch (err: unknown) {
    console.error("[Modifiers] Update error:", err);
    res.status(500).json({ message: "Failed to update modifier" });
  }
});

router.delete("/api/modifiers/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminOrManager(req.user?.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const { id } = req.params;
    const orgId = req.user?.organizationId;

    const [existing] = await db
      .select()
      .from(modifiers)
      .where(eq(modifiers.id, id));

    if (!existing) {
      return res.status(404).json({ message: "Modifier not found" });
    }

    if (!existing.organizationId || existing.organizationId !== orgId) {
      return res.status(403).json({ message: "Can only delete org-specific modifiers" });
    }

    const [updated] = await db
      .update(modifiers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(modifiers.id, id))
      .returning();

    res.json(updated);
  } catch (err: unknown) {
    console.error("[Modifiers] Delete error:", err);
    res.status(500).json({ message: "Failed to delete modifier" });
  }
});

router.get("/api/modifiers/rules", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const results = await db
      .select()
      .from(scopeModifierRules)
      .where(eq(scopeModifierRules.isActive, true))
      .orderBy(asc(scopeModifierRules.priority));

    res.json(results);
  } catch (err: unknown) {
    console.error("[Modifiers] List rules error:", err);
    res.status(500).json({ message: "Failed to list rules" });
  }
});

const createRuleSchema = z.object({
  pattern: z.string().min(1).max(500),
  matchType: z.enum(["contains", "startsWith", "regex"]),
  modifierIds: z.array(z.string()).min(1),
  tradeIds: z.array(z.string()).optional().default([]),
  priority: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

router.post("/api/modifiers/rules", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Only platform admins can create scope rules" });
    }

    const parsed = createRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    }

    const [created] = await db
      .insert(scopeModifierRules)
      .values(parsed.data)
      .returning();

    res.status(201).json(created);
  } catch (err: unknown) {
    console.error("[Modifiers] Create rule error:", err);
    res.status(500).json({ message: "Failed to create rule" });
  }
});

const createSelectionSchema = z.object({
  bidId: z.string().min(1),
  estimateLineItemId: z.string().min(1),
  modifierId: z.string().min(1),
  selectedFactor: z.number(),
  notes: z.string().nullable().optional(),
});

router.post("/api/bid-modifier-selections", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    }

    const orgId = req.user?.organizationId;
    if (!orgId) {
      return res.status(400).json({ message: "Organization required" });
    }

    const [bid] = await db
      .select({ id: bids.id, organizationId: bids.organizationId })
      .from(bids)
      .where(eq(bids.id, parsed.data.bidId));

    if (!bid || bid.organizationId !== orgId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [lineItem] = await db
      .select({ id: estimateLineItems.id, estimateId: estimateLineItems.estimateId })
      .from(estimateLineItems)
      .innerJoin(estimates, eq(estimateLineItems.estimateId, estimates.id))
      .where(
        and(
          eq(estimateLineItems.id, parsed.data.estimateLineItemId),
          eq(estimates.bidId, parsed.data.bidId)
        )
      );

    if (!lineItem) {
      return res.status(400).json({ message: "Line item does not belong to the specified bid" });
    }

    const [modifier] = await db
      .select()
      .from(modifiers)
      .where(eq(modifiers.id, parsed.data.modifierId));

    if (!modifier) {
      return res.status(400).json({ message: "Modifier not found" });
    }

    if (!modifier.isActive) {
      return res.status(400).json({ message: "Modifier is not active" });
    }

    if (modifier.organizationId !== null && modifier.organizationId !== orgId) {
      return res.status(403).json({ message: "Access denied to this modifier" });
    }

    const factor = parsed.data.selectedFactor;
    const ranges: Array<{ min: number; max: number }> = [];

    if (modifier.effectType === "labor" || modifier.effectType === "mixed") {
      ranges.push({ min: modifier.laborFactorMin, max: modifier.laborFactorMax });
    }
    if (modifier.effectType === "material" || modifier.effectType === "mixed") {
      ranges.push({ min: modifier.materialFactorMin, max: modifier.materialFactorMax });
    }
    if (modifier.durationFactorMin !== 1.0 || modifier.durationFactorMax !== 1.0) {
      ranges.push({ min: modifier.durationFactorMin, max: modifier.durationFactorMax });
    }
    if (modifier.wasteFactorMin !== 0.0 || modifier.wasteFactorMax !== 0.0) {
      ranges.push({ min: modifier.wasteFactorMin, max: modifier.wasteFactorMax });
    }

    if (ranges.length === 0) {
      ranges.push({ min: 1.0, max: 1.0 });
    }

    const overallMin = Math.min(...ranges.map((r) => r.min));
    const overallMax = Math.max(...ranges.map((r) => r.max));

    if (factor < overallMin || factor > overallMax) {
      return res.status(400).json({
        message: `Selected factor ${factor} is outside the modifier's allowed range (${overallMin}–${overallMax})`,
      });
    }

    const [created] = await db
      .insert(bidModifierSelections)
      .values(parsed.data)
      .returning();

    res.status(201).json(created);
  } catch (err: unknown) {
    console.error("[Modifiers] Create selection error:", err);
    res.status(500).json({ message: "Failed to save selection" });
  }
});

router.get("/api/bid-modifier-selections/:lineItemId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { lineItemId } = req.params;
    const orgId = req.user?.organizationId;

    if (!orgId) {
      return res.status(400).json({ message: "Organization required" });
    }

    const hasAccess = await verifyLineItemOrgOwnership(lineItemId, orgId);
    if (!hasAccess) {
      return res.json([]);
    }

    const results = await db
      .select()
      .from(bidModifierSelections)
      .where(eq(bidModifierSelections.estimateLineItemId, lineItemId));

    res.json(results);
  } catch (err: unknown) {
    console.error("[Modifiers] Get selections error:", err);
    res.status(500).json({ message: "Failed to get selections" });
  }
});

export default router;
