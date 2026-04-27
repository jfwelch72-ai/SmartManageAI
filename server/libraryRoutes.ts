import { logError } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, ilike, inArray, sql, desc } from "drizzle-orm";
import {
  libraryItems, insertLibraryItemSchema,
  libraryAssemblies, insertLibraryAssemblySchema,
  libraryAssemblyItems, insertLibraryAssemblyItemSchema,
  libraryAssemblyItemGroups, insertLibraryAssemblyItemGroupSchema,
  libraryAssemblyItemGroupMembers, insertLibraryAssemblyItemGroupMemberSchema,
  libraryCategories, insertLibraryCategorySchema,
  customLibraries, insertCustomLibrarySchema,
  savedTakeoffs, insertSavedTakeoffSchema,
  organizations,
} from "@shared/schema";
import {
  getMaterials, getComponentsByTradeId, getScopesByTradeId, getFormulas,
  type MaterialFamily, type TradeComponent, type Scope,
} from "./data/onboarding/index";
import { categoryForMaterial, categoryForComponent, isLaborComponent } from "./data/onboarding/categoryMappings";
import { getLibraryTradeIdsForLegacy } from "../shared/tradeTypeUtils";
import { requireRole, type AuthRequest } from "./auth";
import type { UserRole } from "@shared/schema";
import { logAudit } from "./auditLogger";

const router = Router();

const ESTIMATOR_PLUS: UserRole[] = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"];
// Task #2083 — Reset of the prebuilt catalog is destructive (drops every
// prebuilt item, category, and assembly for the org) so it is restricted to
// org admins. HUSTLERs get owner-equivalent access via effectiveRole.
const PREBUILT_RESET_ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "HUSTLER"];

function getOrgId(req: AuthRequest): string | null {
  return req.user?.organizationId || null;
}

function getUserId(req: AuthRequest): string | null {
  return req.user?.id || null;
}

function checkEstimatorPlus(req: AuthRequest): boolean {
  const role = (req.user as any)?.effectiveRole || req.user?.role;
  return !!role && ESTIMATOR_PLUS.includes(role as UserRole);
}

function checkAdmin(req: AuthRequest): boolean {
  const role = (req.user as any)?.effectiveRole || req.user?.role;
  return !!role && PREBUILT_RESET_ROLES.includes(role as UserRole);
}

router.get("/api/custom-libraries", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  const results = await db.select().from(customLibraries).where(eq(customLibraries.organizationId, orgId));
  res.json(results);
});

router.post("/api/custom-libraries", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const data = insertCustomLibrarySchema.parse({ ...req.body, organizationId: orgId });
  const [result] = await db.insert(customLibraries).values(data).returning();
  res.json(result);
});

router.patch("/api/custom-libraries/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  const { name, description } = req.body;
  const [result] = await db.update(customLibraries)
    .set({ name, description, updatedAt: new Date() })
    .where(and(eq(customLibraries.id, id), eq(customLibraries.organizationId, orgId)))
    .returning();
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result);
});

router.delete("/api/custom-libraries/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  await db.delete(customLibraries)
    .where(and(eq(customLibraries.id, id), eq(customLibraries.organizationId, orgId)));
  res.json({ success: true });
});

router.get("/api/library-items", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  const { search, libraryId, costType, tradeType, categoryId } = req.query;
  const conditions: any[] = [eq(libraryItems.organizationId, orgId)];
  if (libraryId && libraryId !== "all") {
    conditions.push(eq(libraryItems.libraryId, libraryId as string));
  }
  // Task #2068 — three-tier filtering. The picker passes `tradeType` to scope
  // results to a single trade, and `categoryId` to drill into one category.
  if (tradeType && tradeType !== "all") {
    conditions.push(eq(libraryItems.tradeType, tradeType as string));
  }
  if (categoryId && categoryId !== "all") {
    if (categoryId === "uncategorized") {
      conditions.push(sql`${libraryItems.categoryId} IS NULL`);
    } else {
      conditions.push(eq(libraryItems.categoryId, categoryId as string));
    }
  }
  if (search) {
    conditions.push(ilike(libraryItems.name, `%${search}%`));
  }
  const results = await db.select().from(libraryItems).where(and(...conditions)).orderBy(libraryItems.name);
  res.json(results);
});

// Task #2068 — CRUD for the new "Category" tier between Trade and Item.
router.get("/api/library-categories", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  const { libraryId, tradeType } = req.query;
  const conditions: any[] = [eq(libraryCategories.organizationId, orgId)];
  if (libraryId && libraryId !== "all") {
    conditions.push(eq(libraryCategories.libraryId, libraryId as string));
  }
  if (tradeType && tradeType !== "all") {
    conditions.push(eq(libraryCategories.tradeType, tradeType as string));
  }
  const results = await db
    .select()
    .from(libraryCategories)
    .where(and(...conditions))
    .orderBy(libraryCategories.displayOrder, libraryCategories.name);
  res.json(results);
});

router.post("/api/library-categories", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const data = insertLibraryCategorySchema.parse({ ...req.body, organizationId: orgId });
  const [result] = await db.insert(libraryCategories).values(data).returning();
  res.json(result);
});

router.patch("/api/library-categories/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  const updateData = { ...req.body, updatedAt: new Date() };
  delete updateData.id;
  delete updateData.organizationId;
  delete updateData.createdAt;
  const [result] = await db.update(libraryCategories)
    .set(updateData)
    .where(and(eq(libraryCategories.id, id), eq(libraryCategories.organizationId, orgId)))
    .returning();
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result);
});

router.delete("/api/library-categories/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  await db.delete(libraryCategories)
    .where(and(eq(libraryCategories.id, id), eq(libraryCategories.organizationId, orgId)));
  res.json({ success: true });
});

router.post("/api/library-items", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const data = insertLibraryItemSchema.parse({ ...req.body, organizationId: orgId });
  const [result] = await db.insert(libraryItems).values(data).returning();
  res.json(result);
});

// Task #2086 — bulk re-bucket many library items into a different category in
// a single round-trip. Limited to a single shared `categoryId` patch (null
// allowed to move items back to "Uncategorized") so the endpoint stays narrow
// and easy to authorize. All ids must belong to the caller's organization.
router.patch("/api/library-items/bulk", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { ids, categoryId } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string" && v.length > 0)) {
    return res.status(400).json({ error: "ids must be a non-empty array of strings" });
  }
  if (categoryId !== null && typeof categoryId !== "string") {
    return res.status(400).json({ error: "categoryId must be a string or null" });
  }
  const MAX_BULK = 500;
  if (ids.length > MAX_BULK) {
    return res.status(400).json({ error: `Cannot bulk-update more than ${MAX_BULK} items at once` });
  }

  // If a destination category was supplied, make sure it belongs to the caller's
  // org so we don't let one tenant park items under another tenant's category.
  if (categoryId) {
    const [cat] = await db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, categoryId), eq(libraryCategories.organizationId, orgId)))
      .limit(1);
    if (!cat) return res.status(404).json({ error: "Destination category not found" });
  }

  const updated = await db.update(libraryItems)
    .set({ categoryId: categoryId ?? null, updatedAt: new Date() })
    .where(and(eq(libraryItems.organizationId, orgId), inArray(libraryItems.id, ids)))
    .returning({ id: libraryItems.id });

  res.json({ updated: updated.length, ids: updated.map((r) => r.id) });
});

router.patch("/api/library-items/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  const updateData = { ...req.body, updatedAt: new Date() };
  delete updateData.id;
  delete updateData.organizationId;
  delete updateData.createdAt;
  const [result] = await db.update(libraryItems)
    .set(updateData)
    .where(and(eq(libraryItems.id, id), eq(libraryItems.organizationId, orgId)))
    .returning();
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result);
});

router.delete("/api/library-items/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  await db.delete(libraryItems)
    .where(and(eq(libraryItems.id, id), eq(libraryItems.organizationId, orgId)));
  res.json({ success: true });
});

router.post("/api/library-items/import", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Items array is required" });
  }
  const parsed = items.map((item: any) =>
    insertLibraryItemSchema.parse({ ...item, organizationId: orgId })
  );
  const results = await db.insert(libraryItems).values(parsed).returning();
  res.json({ imported: results.length, items: results });
});

router.get("/api/library-assemblies", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  const { search, libraryId } = req.query;
  const conditions: any[] = [eq(libraryAssemblies.organizationId, orgId)];
  if (libraryId && libraryId !== "all") {
    conditions.push(eq(libraryAssemblies.libraryId, libraryId as string));
  }
  if (search) {
    conditions.push(ilike(libraryAssemblies.name, `%${search}%`));
  }
  const assemblies = await db.select().from(libraryAssemblies).where(and(...conditions)).orderBy(libraryAssemblies.name);
  if (assemblies.length === 0) return res.json([]);

  const assemblyIds = assemblies.map(a => a.id);
  const [allItems, allGroups] = await Promise.all([
    db.select().from(libraryAssemblyItems)
      .where(inArray(libraryAssemblyItems.assemblyId, assemblyIds))
      .orderBy(libraryAssemblyItems.displayOrder),
    db.select().from(libraryAssemblyItemGroups)
      .where(inArray(libraryAssemblyItemGroups.assemblyId, assemblyIds))
      .orderBy(libraryAssemblyItemGroups.displayOrder),
  ]);

  const groupIds = allGroups.map(g => g.id);
  const allMembers = groupIds.length > 0
    ? await db.select().from(libraryAssemblyItemGroupMembers)
        .where(inArray(libraryAssemblyItemGroupMembers.groupId, groupIds))
        .orderBy(libraryAssemblyItemGroupMembers.displayOrder)
    : [];

  const membersByGroup = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    const arr = membersByGroup.get(m.groupId) || [];
    arr.push(m);
    membersByGroup.set(m.groupId, arr);
  }
  const itemsByAssembly = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const arr = itemsByAssembly.get(item.assemblyId) || [];
    arr.push(item);
    itemsByAssembly.set(item.assemblyId, arr);
  }
  const groupsByAssembly = new Map<string, any[]>();
  for (const group of allGroups) {
    const enriched = { ...group, members: membersByGroup.get(group.id) || [] };
    const arr = groupsByAssembly.get(group.assemblyId) || [];
    arr.push(enriched);
    groupsByAssembly.set(group.assemblyId, arr);
  }

  const result = assemblies.map(a => ({
    ...a,
    items: itemsByAssembly.get(a.id) || [],
    groups: groupsByAssembly.get(a.id) || [],
  }));
  res.json(result);
});

router.post("/api/library-assemblies", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { items: assemblyItems, groups: assemblyGroups, ...assemblyData } = req.body;
  const data = insertLibraryAssemblySchema.parse({ ...assemblyData, organizationId: orgId });
  const [assembly] = await db.insert(libraryAssemblies).values(data).returning();

  if (assemblyItems?.length) {
    for (const item of assemblyItems) {
      await db.insert(libraryAssemblyItems).values({
        ...item,
        assemblyId: assembly.id,
      });
    }
  }

  if (assemblyGroups?.length) {
    for (const group of assemblyGroups) {
      const { members, ...groupData } = group;
      const [newGroup] = await db.insert(libraryAssemblyItemGroups).values({
        ...groupData,
        assemblyId: assembly.id,
      }).returning();
      if (members?.length) {
        for (const member of members) {
          await db.insert(libraryAssemblyItemGroupMembers).values({
            ...member,
            groupId: newGroup.id,
          });
        }
      }
    }
  }

  res.json(assembly);
});

router.patch("/api/library-assemblies/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  const { items: assemblyItems, groups: assemblyGroups, ...updateData } = req.body;
  delete updateData.id;
  delete updateData.organizationId;
  delete updateData.createdAt;

  const [result] = await db.update(libraryAssemblies)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(libraryAssemblies.id, id), eq(libraryAssemblies.organizationId, orgId)))
    .returning();
  if (!result) return res.status(404).json({ error: "Not found" });

  if (assemblyItems !== undefined) {
    await db.delete(libraryAssemblyItems).where(eq(libraryAssemblyItems.assemblyId, id));
    if (assemblyItems.length) {
      for (const item of assemblyItems) {
        await db.insert(libraryAssemblyItems).values({ ...item, assemblyId: id });
      }
    }
  }

  if (assemblyGroups !== undefined) {
    const existingGroups = await db.select().from(libraryAssemblyItemGroups).where(eq(libraryAssemblyItemGroups.assemblyId, id));
    for (const g of existingGroups) {
      await db.delete(libraryAssemblyItemGroupMembers).where(eq(libraryAssemblyItemGroupMembers.groupId, g.id));
    }
    await db.delete(libraryAssemblyItemGroups).where(eq(libraryAssemblyItemGroups.assemblyId, id));
    if (assemblyGroups.length) {
      for (const group of assemblyGroups) {
        const { members, ...groupData } = group;
        const [newGroup] = await db.insert(libraryAssemblyItemGroups).values({ ...groupData, assemblyId: id }).returning();
        if (members?.length) {
          for (const member of members) {
            await db.insert(libraryAssemblyItemGroupMembers).values({ ...member, groupId: newGroup.id });
          }
        }
      }
    }
  }

  res.json(result);
});

router.delete("/api/library-assemblies/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  await db.delete(libraryAssemblies)
    .where(and(eq(libraryAssemblies.id, id), eq(libraryAssemblies.organizationId, orgId)));
  res.json({ success: true });
});

router.get("/api/saved-takeoffs", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  const { libraryId } = req.query;
  const conditions: any[] = [eq(savedTakeoffs.organizationId, orgId)];
  if (libraryId && libraryId !== "all") {
    conditions.push(eq(savedTakeoffs.libraryId, libraryId as string));
  }
  const results = await db.select().from(savedTakeoffs).where(and(...conditions)).orderBy(desc(savedTakeoffs.createdAt));
  res.json(results);
});

router.post("/api/saved-takeoffs", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const data = insertSavedTakeoffSchema.parse({ ...req.body, organizationId: orgId });
  const [result] = await db.insert(savedTakeoffs).values(data).returning();
  res.json(result);
});

router.delete("/api/saved-takeoffs/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });
  const { id } = req.params;
  await db.delete(savedTakeoffs)
    .where(and(eq(savedTakeoffs.id, id), eq(savedTakeoffs.organizationId, orgId)));
  res.json({ success: true });
});

// Task #2083 — Extracted from the original `seed-from-onboarding` route so the
// admin "reset prebuilt catalog" route can re-run the same seeding flow after
// wiping the existing prebuilt rows. Returns the counts the caller needs to
// surface in API responses and audit log entries.
async function runPrebuiltSeed(orgId: string, tradeType: string): Promise<{
  itemsCreated: number;
  assembliesCreated: number;
  categoriesCreated: number;
  tradeIds: string[];
}> {
  const tradeIds = getLibraryTradeIdsForLegacy(tradeType);

  const allMaterials = getMaterials();
  const allFormulas = getFormulas();

  // Task #2068 — collect items along with the category bucket they belong to
  // so we can create the per-trade categories first and stamp items with the
  // resulting category id.
  // Task #2071 — friendly category names come from the per-trade mapping in
  // ./data/onboarding/categoryMappings instead of the raw `group` slug.
  const materialItems: Array<{ item: any; categoryName: string }> = [];
  const seenMaterialIds = new Set<string>();

  for (const tradeId of tradeIds) {
    const scopes = getScopesByTradeId(tradeId);
    for (const scope of scopes) {
      for (const matFamilyId of scope.material_families) {
        if (seenMaterialIds.has(matFamilyId)) continue;
        seenMaterialIds.add(matFamilyId);
        const mat = allMaterials.find(m => m.material_family_id === matFamilyId);
        if (mat) {
          materialItems.push({
            categoryName: categoryForMaterial(tradeType, mat.group),
            item: {
              organizationId: orgId,
              name: mat.display_name,
              itemNumber: mat.material_family_id,
              measuredCoverage: 1,
              unitOfMeasure: mat.canonical_uom,
              purchaseCoverage: 1,
              purchaseUnit: mat.canonical_uom,
              description: mat.group ? `${mat.group} material` : undefined,
              costTypes: ["material"],
              unitCosts: { material: 0 },
              sourceId: `onboarding:material:${mat.material_family_id}`,
              isPrebuilt: true,
              tradeType,
            },
          });
        }
      }
    }

    const components = getComponentsByTradeId(tradeId);
    for (const comp of components) {
      const compSourceId = `onboarding:component:${comp.component_id}`;
      if (materialItems.some(m => m.item.sourceId === compSourceId)) continue;
      const isLabor = isLaborComponent(comp.display_name);
      materialItems.push({
        categoryName: categoryForComponent(tradeType, comp.display_name),
        item: {
          organizationId: orgId,
          name: comp.display_name,
          itemNumber: comp.component_id,
          measuredCoverage: 1,
          unitOfMeasure: "EA",
          purchaseCoverage: 1,
          purchaseUnit: "EA",
          description: comp.description?.substring(0, 255) || undefined,
          costTypes: [isLabor ? "labor" : "material"],
          unitCosts: isLabor ? { labor: 0 } : { material: 0 },
          sourceId: compSourceId,
          isPrebuilt: true,
          tradeType,
        },
      });
    }
  }

  if (materialItems.length === 0) {
    for (const mat of allMaterials.slice(0, 50)) {
      materialItems.push({
        categoryName: categoryForMaterial(tradeType, mat.group),
        item: {
          organizationId: orgId,
          name: mat.display_name,
          itemNumber: mat.material_family_id,
          measuredCoverage: 1,
          unitOfMeasure: mat.canonical_uom,
          purchaseCoverage: 1,
          purchaseUnit: mat.canonical_uom,
          description: mat.group ? `${mat.group} material` : undefined,
          costTypes: ["material"],
          unitCosts: { material: 0 },
          sourceId: `onboarding:material:${mat.material_family_id}`,
          isPrebuilt: true,
          tradeType,
        },
      });
    }
  }

  // Task #2068 — create / reuse one category per (trade, name) bucket so the
  // seeded items land under the correct middle tier.
  const categoryIdByName = new Map<string, string>();
  let categoriesCreated = 0;
  const uniqueCategoryNames = Array.from(new Set(materialItems.map(m => m.categoryName)));
  for (const catName of uniqueCategoryNames) {
    const sourceId = `onboarding:category:${tradeType}:${catName}`;
    const existing = await db.select().from(libraryCategories)
      .where(and(eq(libraryCategories.organizationId, orgId), eq(libraryCategories.sourceId, sourceId)))
      .limit(1);
    if (existing.length > 0) {
      categoryIdByName.set(catName, existing[0].id);
    } else {
      const [created] = await db.insert(libraryCategories).values({
        organizationId: orgId,
        name: catName,
        tradeType,
        sourceId,
        isPrebuilt: true,
      }).returning();
      categoryIdByName.set(catName, created.id);
      categoriesCreated++;
    }
  }

  const itemsToInsert = materialItems.map(({ item, categoryName }) => ({
    ...item,
    categoryId: categoryIdByName.get(categoryName) ?? null,
  }));

  const batchSize = 50;
  const createdItems: any[] = [];
  for (let i = 0; i < itemsToInsert.length; i += batchSize) {
    const batch = itemsToInsert.slice(i, i + batchSize);
    const results = await db.insert(libraryItems).values(batch).returning();
    createdItems.push(...results);
  }

  const itemsBySourceId = new Map<string, any>();
  createdItems.forEach(item => {
    if (item.sourceId) itemsBySourceId.set(item.sourceId, item);
  });

  const prebuiltAssemblies = getPrebuiltAssemblies(tradeType, itemsBySourceId, orgId);
  let assembliesCreated = 0;
  for (const asmDef of prebuiltAssemblies) {
    const { items: asmItems, ...asmData } = asmDef;
    const [assembly] = await db.insert(libraryAssemblies).values(asmData).returning();
    if (asmItems?.length) {
      for (let i = 0; i < asmItems.length; i++) {
        await db.insert(libraryAssemblyItems).values({
          assemblyId: assembly.id,
          name: asmItems[i].name,
          formula: asmItems[i].formula || "1",
          wasteFactor: asmItems[i].wasteFactor || 0,
          unitCost: asmItems[i].unitCost,
          unit: asmItems[i].unit,
          itemId: asmItems[i].itemId || null,
          displayOrder: i,
        });
      }
    }
    assembliesCreated++;
  }

  return {
    itemsCreated: createdItems.length,
    assembliesCreated,
    categoriesCreated,
    tradeIds,
  };
}

router.post("/api/library-items/seed-from-onboarding", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkEstimatorPlus(req)) return res.status(403).json({ error: "Insufficient permissions" });

  try {
    const existing = await db.select({ id: libraryItems.id }).from(libraryItems)
      .where(and(eq(libraryItems.organizationId, orgId), eq(libraryItems.isPrebuilt, true)))
      .limit(1);

    if (existing.length > 0) {
      return res.json({ message: "Already seeded", seeded: false });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const tradeType = (org as any).tradeType || "OTHER";
    const result = await runPrebuiltSeed(orgId, tradeType);

    res.json({
      seeded: true,
      itemsCreated: result.itemsCreated,
      assembliesCreated: result.assembliesCreated,
      tradeType,
      tradeIds: result.tradeIds,
    });
  } catch (error: any) {
    next(error);
  }
});

// Task #2083 — Admin-only "reset prebuilt catalog" action. The
// `seed-from-onboarding` route bails out as soon as any prebuilt item exists
// for the org, which means orgs seeded before category-mapping improvements
// (e.g. Task #2071) keep their stale "concrete misc" / generic "Components"
// buckets forever. This endpoint deletes every prebuilt item, prebuilt
// assembly, and prebuilt category for the org and then re-runs the seed so
// the catalog picks up current mappings. Custom (non-prebuilt) items and
// assemblies are preserved — the FK from custom rows to prebuilt categories
// is `ON DELETE SET NULL`, so any custom item that was filed under a deleted
// prebuilt category simply becomes uncategorized rather than being deleted.
router.post("/api/library-items/reset-prebuilt-catalog", async (req: AuthRequest, res: Response, next: NextFunction) => {
  const orgId = getOrgId(req);
  const userId = getUserId(req);
  if (!orgId || !userId) return res.status(401).json({ error: "Unauthorized" });
  if (!checkAdmin(req)) return res.status(403).json({ error: "Admin access required to reset the prebuilt catalog" });

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const tradeType = (org as any).tradeType || "OTHER";

    // Task #2095 — Before we drop the prebuilt categories, capture which
    // custom (user-created) items currently live under one. The FK from
    // library_items.category_id to library_categories is `ON DELETE SET
    // NULL`, so without this snapshot any custom item filed under a prebuilt
    // category would silently lose its categorization the moment we delete
    // its parent category. We remember each affected item alongside the old
    // category's sourceId / name + tradeType so we can re-attach them after
    // the reseed produces fresh categories with stable sourceIds.
    const oldPrebuiltCategories = await db
      .select({
        id: libraryCategories.id,
        sourceId: libraryCategories.sourceId,
        name: libraryCategories.name,
        tradeType: libraryCategories.tradeType,
      })
      .from(libraryCategories)
      .where(and(
        eq(libraryCategories.organizationId, orgId),
        eq(libraryCategories.isPrebuilt, true),
      ));

    type RelinkPlan = {
      itemId: string;
      sourceId: string | null;
      name: string;
      tradeType: string | null;
    };
    let customItemsToRelink: RelinkPlan[] = [];
    if (oldPrebuiltCategories.length > 0) {
      const oldPrebuiltCategoryIds = oldPrebuiltCategories.map(c => c.id);
      const customItems = await db
        .select({
          id: libraryItems.id,
          categoryId: libraryItems.categoryId,
        })
        .from(libraryItems)
        .where(and(
          eq(libraryItems.organizationId, orgId),
          eq(libraryItems.isPrebuilt, false),
          inArray(libraryItems.categoryId, oldPrebuiltCategoryIds),
        ));
      const oldCatById = new Map(oldPrebuiltCategories.map(c => [c.id, c]));
      customItemsToRelink = customItems
        .map((item) => {
          const cat = item.categoryId ? oldCatById.get(item.categoryId) : undefined;
          if (!cat) return null;
          return {
            itemId: item.id,
            sourceId: cat.sourceId ?? null,
            name: cat.name,
            tradeType: cat.tradeType ?? null,
          } satisfies RelinkPlan;
        })
        .filter((x): x is RelinkPlan => x !== null);
    }

    // Delete prebuilt assemblies first; their child rows in
    // library_assembly_items / *_groups / *_group_members cascade automatically
    // via the schema's `onDelete: cascade` FK.
    const deletedAssemblies = await db.delete(libraryAssemblies)
      .where(and(eq(libraryAssemblies.organizationId, orgId), eq(libraryAssemblies.isPrebuilt, true)))
      .returning({ id: libraryAssemblies.id });

    // Delete prebuilt items. Custom assemblies that referenced these items
    // have `itemId` set to NULL (FK is `onDelete: set null`).
    const deletedItems = await db.delete(libraryItems)
      .where(and(eq(libraryItems.organizationId, orgId), eq(libraryItems.isPrebuilt, true)))
      .returning({ id: libraryItems.id });

    // Delete prebuilt categories last. Any custom item that was assigned to a
    // prebuilt category now has `categoryId` set to NULL via the FK's
    // `onDelete: set null`. We captured those rows above and will re-attach
    // them to the freshly seeded category once the reseed completes.
    const deletedCategories = await db.delete(libraryCategories)
      .where(and(eq(libraryCategories.organizationId, orgId), eq(libraryCategories.isPrebuilt, true)))
      .returning({ id: libraryCategories.id });

    const seedResult = await runPrebuiltSeed(orgId, tradeType);

    // Task #2095 — Re-attach the custom items we captured pre-delete to the
    // newly seeded prebuilt categories. We match primarily by sourceId
    // (stable across reseeds — see the `onboarding:category:<trade>:<name>`
    // format in runPrebuiltSeed). For categories created before we started
    // stamping a sourceId, fall back to (tradeType, name). Items whose old
    // category has no equivalent in the new catalog stay uncategorized,
    // matching the previous behaviour.
    let customItemsRelinked = 0;
    if (customItemsToRelink.length > 0) {
      const newPrebuiltCategories = await db
        .select({
          id: libraryCategories.id,
          sourceId: libraryCategories.sourceId,
          name: libraryCategories.name,
          tradeType: libraryCategories.tradeType,
        })
        .from(libraryCategories)
        .where(and(
          eq(libraryCategories.organizationId, orgId),
          eq(libraryCategories.isPrebuilt, true),
        ));
      const newBySourceId = new Map<string, string>();
      const newByNameTrade = new Map<string, string>();
      for (const c of newPrebuiltCategories) {
        if (c.sourceId) newBySourceId.set(c.sourceId, c.id);
        newByNameTrade.set(`${c.tradeType ?? ""}::${c.name}`, c.id);
      }
      for (const plan of customItemsToRelink) {
        let newCategoryId: string | undefined;
        if (plan.sourceId) newCategoryId = newBySourceId.get(plan.sourceId);
        if (!newCategoryId) {
          newCategoryId = newByNameTrade.get(`${plan.tradeType ?? ""}::${plan.name}`);
        }
        if (newCategoryId) {
          await db.update(libraryItems)
            .set({ categoryId: newCategoryId, updatedAt: new Date() })
            .where(and(
              eq(libraryItems.id, plan.itemId),
              eq(libraryItems.organizationId, orgId),
            ));
          customItemsRelinked++;
        }
      }
    }

    await logAudit({
      userId,
      action: "RESET",
      entityType: "libraryPrebuiltCatalog",
      entityId: orgId,
      oldValue: JSON.stringify({
        itemsDeleted: deletedItems.length,
        assembliesDeleted: deletedAssemblies.length,
        categoriesDeleted: deletedCategories.length,
      }),
      newValue: JSON.stringify({
        tradeType,
        itemsCreated: seedResult.itemsCreated,
        assembliesCreated: seedResult.assembliesCreated,
        categoriesCreated: seedResult.categoriesCreated,
        customItemsRelinked,
      }),
    }, req);

    res.json({
      reset: true,
      tradeType,
      tradeIds: seedResult.tradeIds,
      deleted: {
        items: deletedItems.length,
        assemblies: deletedAssemblies.length,
        categories: deletedCategories.length,
      },
      created: {
        items: seedResult.itemsCreated,
        assemblies: seedResult.assembliesCreated,
        categories: seedResult.categoriesCreated,
      },
      customItemsRelinked,
    });
  } catch (error: any) {
    next(error);
  }
});


function getPrebuiltAssemblies(tradeType: string, itemsBySourceId: Map<string, any>, orgId: string) {
  const assemblies: any[] = [];

  const findItem = (keyword: string) => {
    const entries = Array.from(itemsBySourceId.entries());
    for (const [, item] of entries) {
      if (item.name.toLowerCase().includes(keyword.toLowerCase())) return item;
    }
    return null;
  };

  if (tradeType === "CONCRETE" || tradeType === "GENERAL_CONTRACTOR" || tradeType === "OTHER") {
    const readyMix = findItem("Ready Mix");
    const rebar = findItem("Rebar");
    const formwork = findItem("Form");
    const curing = findItem("Curing");
    assemblies.push({
      organizationId: orgId,
      name: "Standard Concrete Foundation",
      assemblyNumber: "ASM-CONC-001",
      unitOfMeasure: "CY",
      description: "Standard concrete foundation assembly with mix, rebar, forms, and curing",
      sourceId: "prebuilt:concrete-foundation",
      isPrebuilt: true,
      items: [
        { name: "Ready Mix Concrete", formula: "volume", unit: "CY", wasteFactor: 5, itemId: readyMix?.id },
        { name: "Rebar", formula: "volume * 100", unit: "LF", wasteFactor: 10, itemId: rebar?.id },
        { name: "Formwork", formula: "area", unit: "SF", wasteFactor: 5, itemId: formwork?.id },
        { name: "Curing Compound", formula: "area * 0.05", unit: "GAL", wasteFactor: 0, itemId: curing?.id },
        { name: "Finishing Labor", formula: "area", unit: "SF", wasteFactor: 0, unitCost: "2.50" },
      ],
    });
  }

  if (tradeType === "DRYWALL" || tradeType === "GENERAL_CONTRACTOR" || tradeType === "OTHER") {
    const drywall = findItem("Drywall") || findItem("Gypsum");
    const compound = findItem("Joint Compound") || findItem("Compound");
    const tape = findItem("Tape");
    assemblies.push({
      organizationId: orgId,
      name: "Drywall Wall Assembly",
      assemblyNumber: "ASM-DRY-001",
      unitOfMeasure: "SF",
      description: "Standard drywall installation with board, tape, mud, and finishing",
      sourceId: "prebuilt:drywall-wall",
      isPrebuilt: true,
      items: [
        { name: "Drywall Board (4x8)", formula: "area / 32", unit: "SHEET", wasteFactor: 10, itemId: drywall?.id },
        { name: "Joint Tape", formula: "area * 0.5", unit: "LF", wasteFactor: 5, itemId: tape?.id },
        { name: "Joint Compound", formula: "area * 0.01", unit: "GAL", wasteFactor: 10, itemId: compound?.id },
        { name: "Drywall Screws", formula: "area * 0.5", unit: "EA", wasteFactor: 5 },
        { name: "Hang & Finish Labor", formula: "area", unit: "SF", wasteFactor: 0, unitCost: "1.75" },
      ],
    });
  }

  if (tradeType === "ROOFING" || tradeType === "GENERAL_CONTRACTOR" || tradeType === "OTHER") {
    const shingles = findItem("Shingle");
    const underlayment = findItem("Underlayment") || findItem("Felt");
    const starter = findItem("Starter");
    const ridge = findItem("Ridge");
    assemblies.push({
      organizationId: orgId,
      name: "Basic Roofing Assembly",
      assemblyNumber: "ASM-ROOF-001",
      unitOfMeasure: "SQ",
      description: "Standard roofing with shingles, underlayment, starter strip, and ridge cap",
      sourceId: "prebuilt:basic-roofing",
      isPrebuilt: true,
      items: [
        { name: "Shingles (3-tab)", formula: "area / 100", unit: "SQ", wasteFactor: 10, itemId: shingles?.id },
        { name: "Underlayment", formula: "area", unit: "SF", wasteFactor: 5, itemId: underlayment?.id },
        { name: "Starter Strip", formula: "perimeter", unit: "LF", wasteFactor: 5, itemId: starter?.id },
        { name: "Ridge Cap", formula: "ridge_length", unit: "LF", wasteFactor: 5, itemId: ridge?.id },
        { name: "Roofing Nails", formula: "area * 4", unit: "EA", wasteFactor: 5 },
        { name: "Installation Labor", formula: "area / 100", unit: "SQ", wasteFactor: 0, unitCost: "65.00" },
      ],
    });
  }

  return assemblies;
}

export default router;
