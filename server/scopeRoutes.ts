import {logError, logWarn } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { organizations, organizationSowItems, masterSowItems, masterModifierCategories, masterModifiers, scopeWorkTypeCategories, scopeWorkTypes, scopeModifierCategories, scopeModifiers, insertScopeWorkTypeCategorySchema, insertScopeWorkTypeSchema, insertScopeModifierCategorySchema, insertScopeModifierSchema, tradeTypeEnum, bids, bidModifierSelections, estimateLineItems, estimates, modifiers as modifiersTable, projects, users, scopeItems, insertScopeItemSchema, dailyScopeProgress, insertDailyScopeProgressSchema, projectMaterialBudgets, notifications } from "@shared/schema";
import { insertNotifications } from "./services/notificationService";
import { eq, and, or, sql, desc, type SQL, asc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess, getOrgIdForFilter } from "./orgFilter";
import { sanitizeText, sanitizeShortText } from "./sanitization";

const router = Router();

// ========================================
// Routes from scopeConfigRoutes.ts
// ========================================

type TradeType = (typeof tradeTypeEnum.enumValues)[number];


// ====================
// Scope Standardization Routes
// ====================

// Get all work type categories with their work types - organization-specific
router.get("/api/scope/work-types", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    // Get organization to determine trade type
    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    // First try to get organization-specific SOW items
    let sowItems = await db
      .select()
      .from(organizationSowItems)
      .where(
        and(
          eq(organizationSowItems.organizationId, organizationId),
          eq(organizationSowItems.isActive, true)
        )
      )
      .orderBy(organizationSowItems.displayOrder);

    // If no org-specific items, fall back to master SOW items for this trade
    if (sowItems.length === 0) {
      const masterItems = await db
        .select()
        .from(masterSowItems)
        .where(
          and(
            eq(masterSowItems.tradeType, org.tradeType),
            eq(masterSowItems.isActive, true)
          )
        )
        .orderBy(masterSowItems.sortOrder);

      // Convert master items to the expected format
      sowItems = masterItems.map((item, index) => ({
        id: item.id,
        organizationId: organizationId,
        categoryName: item.categoryName,
        name: item.name,
        code: item.code,
        description: item.description,
        unit: item.defaultUomCode,
        requiresDimensions: item.requiresDimensions,
        dimensionLabel: item.dimensionLabel,
        defaultCostCode: null,
        displayOrder: item.sortOrder,
        isFromTemplate: true,
        isActive: true,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
      }));
    }

    // If still no org-specific or trade-specific items, return empty array
    // Note: Legacy fallback to shared scope tables removed for multi-tenant isolation
    if (sowItems.length === 0) {
      console.log(`[WorkTypes] No SOW items found for organization ${organizationId} (trade: ${org.tradeType})`);
      res.json([]);
      return;
    }

    // Group SOW items by category name
    const categoryMap = new Map<string, {
      id: string;
      name: string;
      displayOrder: number;
      isActive: boolean;
      workTypes: Array<{
        id: string;
        categoryId: string;
        name: string;
        code: string;
        defaultUnit: string;
        requiresDimensions: boolean;
        dimensionType: string | null;
        displayOrder: number;
        isCustom: boolean;
        isActive: boolean;
        defaultCostCode: string | null;
      }>;
    }>();

    let categoryIndex = 0;
    for (const item of sowItems) {
      const categoryKey = item.categoryName;
      
      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, {
          id: `cat-${categoryIndex++}`,
          name: item.categoryName,
          displayOrder: categoryIndex,
          isActive: true,
          workTypes: []
        });
      }

      const category = categoryMap.get(categoryKey)!;
      category.workTypes.push({
        id: item.id,
        categoryId: category.id,
        name: item.name,
        code: item.code,
        defaultUnit: item.unit || "EA",
        requiresDimensions: item.requiresDimensions,
        dimensionType: item.dimensionLabel ? "length_width_depth" : null,
        displayOrder: item.displayOrder,
        isCustom: !item.isFromTemplate,
        isActive: item.isActive,
        defaultCostCode: item.defaultCostCode || null,
      });
    }

    // Convert map to array
    const categoriesWithTypes = Array.from(categoryMap.values());
    res.json(categoriesWithTypes);
  } catch (error) {
    logError("Get scope work types error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all modifier categories with their modifiers - organization trade-specific
router.get("/api/scope/modifiers", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    // Get organization to determine trade type
    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    // Try to get trade-specific modifiers from master tables
    const masterCategories = await db
      .select()
      .from(masterModifierCategories)
      .where(
        and(
          eq(masterModifierCategories.tradeType, org.tradeType),
          eq(masterModifierCategories.isActive, true)
        )
      )
      .orderBy(masterModifierCategories.displayOrder);

    if (masterCategories.length > 0) {
      // Get all modifiers for this trade
      const masterMods = await db
        .select()
        .from(masterModifiers)
        .where(
          and(
            eq(masterModifiers.tradeType, org.tradeType),
            eq(masterModifiers.isActive, true)
          )
        )
        .orderBy(masterModifiers.displayOrder);

      // Group modifiers by category and format response
      const categoriesWithModifiers = masterCategories.map(cat => ({
        id: cat.id,
        name: cat.name,
        displayOrder: cat.displayOrder,
        isActive: cat.isActive,
        modifiers: masterMods
          .filter(m => m.categoryId === cat.id)
          .map(m => ({
            id: m.id,
            categoryId: m.categoryId,
            name: m.name,
            code: m.code,
            displayOrder: m.displayOrder,
            isActive: m.isActive,
            isCustom: false
          }))
      }));

      res.json(categoriesWithModifiers);
      return;
    }

    // No trade-specific modifiers found - return empty array for multi-tenant isolation
    // Note: Legacy fallback to shared tables removed to prevent cross-trade data leakage
    console.log(`[Modifiers] No trade-specific modifiers found for trade: ${org.tradeType}`);
    res.json([]);
  } catch (error) {
    logError("Get scope modifiers error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Create work type category
router.post("/api/scope/work-type-categories", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertScopeWorkTypeCategorySchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newCategory] = await db
      .insert(scopeWorkTypeCategories)
      .values(validationResult.data)
      .returning();

    res.status(201).json(newCategory);
  } catch (error) {
    logError("Create work type category error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Create work type (creates in organizationSowItems for multi-tenant support)
router.post("/api/scope/work-types", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    // Validate input shape with Zod
    const inputSchema = z.object({
      name: z.string().min(1, "Name is required"),
      code: z.string().min(1, "Code is required").regex(/^[a-zA-Z0-9_-]+$/, "Code must contain only letters, numbers, underscores, and dashes"),
      defaultUnit: z.string().optional().default("EA"),
      requiresDimensions: z.boolean().optional().default(false),
      dimensionType: z.string().optional().nullable(),
      defaultCostCode: z.string().optional().nullable(),
      tradeName: z.string().optional(),
      categoryName: z.string().optional(),
      displayOrder: z.number().optional(),
      categoryId: z.string().optional(),
    });

    const validationResult = inputSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { name, code, defaultUnit, requiresDimensions, dimensionType, defaultCostCode, tradeName, categoryName: inputCategoryName, displayOrder } = validationResult.data;

    // Sanitize text fields
    const sanitizedName = sanitizeShortText(name);
    const sanitizedCode = sanitizeShortText(code);

    // Use categoryName directly from frontend (robust approach - no index-based mapping)
    // Frontend sends the actual category name, either from existing category or generated
    const categoryName = sanitizeShortText(inputCategoryName) || sanitizeShortText(tradeName?.replace(/_/g, " ")) || "Custom";

    // Get max display order for this organization
    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(display_order), 0)` })
      .from(organizationSowItems)
      .where(eq(organizationSowItems.organizationId, organizationId));

    const newDisplayOrder = displayOrder || (maxOrder?.max || 0) + 1;

    // Create the work type in organizationSowItems
    const [newWorkType] = await db
      .insert(organizationSowItems)
      .values({
        organizationId,
        categoryName,
        name: sanitizedName,
        code: sanitizedCode,
        unit: sanitizeShortText(defaultUnit) || "EA",
        requiresDimensions: requiresDimensions || false,
        dimensionLabel: dimensionType ? sanitizeShortText(dimensionType) : null,
        defaultCostCode: defaultCostCode ? sanitizeShortText(defaultCostCode) : null,
        displayOrder: newDisplayOrder,
        isFromTemplate: false,
        isActive: true,
      })
      .returning();

    // Calculate the actual categoryId by getting updated category list
    const updatedItems = await db
      .select({ categoryName: organizationSowItems.categoryName })
      .from(organizationSowItems)
      .where(
        and(
          eq(organizationSowItems.organizationId, organizationId),
          eq(organizationSowItems.isActive, true)
        )
      )
      .orderBy(organizationSowItems.displayOrder);
    
    const catMap = new Map<string, number>();
    let catIndex = 0;
    for (const item of updatedItems) {
      if (!catMap.has(item.categoryName)) {
        catMap.set(item.categoryName, catIndex++);
      }
    }
    const actualCategoryId = `cat-${catMap.get(categoryName) ?? 0}`;

    res.status(201).json({
      id: newWorkType.id,
      categoryId: actualCategoryId,
      name: newWorkType.name,
      code: newWorkType.code,
      defaultUnit: newWorkType.unit,
      requiresDimensions: newWorkType.requiresDimensions,
      dimensionType: newWorkType.dimensionLabel,
      displayOrder: newWorkType.displayOrder,
      isCustom: true,
      isActive: newWorkType.isActive,
      defaultCostCode: newWorkType.defaultCostCode || null,
    });
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(400).json({ error: "A work type with this code already exists in your organization" });
      return;
    }
    logError("Create work type error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Update work type
router.put("/api/scope/work-types/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const [existingSow] = await db
      .select()
      .from(organizationSowItems)
      .where(
        and(
          eq(organizationSowItems.id, req.params.id),
          eq(organizationSowItems.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existingSow) {
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (req.body.name !== undefined) updateData.name = sanitizeShortText(req.body.name);
      if (req.body.defaultUnit !== undefined) updateData.unit = sanitizeShortText(req.body.defaultUnit);
      if (req.body.requiresDimensions !== undefined) updateData.requiresDimensions = req.body.requiresDimensions;
      if (req.body.dimensionType !== undefined) updateData.dimensionLabel = req.body.dimensionType || null;
      if (req.body.defaultCostCode !== undefined) updateData.defaultCostCode = req.body.defaultCostCode || null;
      if (req.body.displayOrder !== undefined) updateData.displayOrder = req.body.displayOrder;

      const [updated] = await db
        .update(organizationSowItems)
        .set(updateData)
        .where(eq(organizationSowItems.id, req.params.id))
        .returning();

      res.json(updated);
      return;
    }

    const [existing] = await db
      .select()
      .from(scopeWorkTypes)
      .where(eq(scopeWorkTypes.id, req.params.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Work type not found" });
      return;
    }

    const [updated] = await db
      .update(scopeWorkTypes)
      .set({
        ...req.body,
        updatedAt: new Date()
      })
      .where(eq(scopeWorkTypes.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Update work type error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Soft delete work type (set inactive)
router.delete("/api/scope/work-types/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(scopeWorkTypes)
      .where(eq(scopeWorkTypes.id, req.params.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Work type not found" });
      return;
    }

    // Soft delete - set inactive instead of hard delete
    await db
      .update(scopeWorkTypes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(scopeWorkTypes.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    logError("Delete work type error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Create modifier category
router.post("/api/scope/modifier-categories", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertScopeModifierCategorySchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newCategory] = await db
      .insert(scopeModifierCategories)
      .values(validationResult.data)
      .returning();

    res.status(201).json(newCategory);
  } catch (error) {
    logError("Create modifier category error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Create modifier
router.post("/api/scope/modifiers", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertScopeModifierSchema.safeParse({
      ...req.body,
      isCustom: true // Admin-added modifiers are marked as custom
    });
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newModifier] = await db
      .insert(scopeModifiers)
      .values(validationResult.data)
      .returning();

    res.status(201).json(newModifier);
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(400).json({ error: "A modifier with this code already exists" });
      return;
    }
    logError("Create modifier error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Update modifier
router.put("/api/scope/modifiers/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(scopeModifiers)
      .where(eq(scopeModifiers.id, req.params.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Modifier not found" });
      return;
    }

    const [updated] = await db
      .update(scopeModifiers)
      .set({
        ...req.body,
        updatedAt: new Date()
      })
      .where(eq(scopeModifiers.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Update modifier error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: Soft delete modifier (set inactive)
router.delete("/api/scope/modifiers/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(scopeModifiers)
      .where(eq(scopeModifiers.id, req.params.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Modifier not found" });
      return;
    }

    // Soft delete - set inactive instead of hard delete
    await db
      .update(scopeModifiers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(scopeModifiers.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    logError("Delete modifier error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Hierarchical Scope Selection for Line Items
// Returns Trade → Subcategory → Work Types structure for GC and specialty trades
// ====================

router.get("/api/scope/hierarchical", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    // Get organization trade type
    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    const isGC = org.tradeType === "GENERAL_CONTRACTOR";

    // Get organization SOW items
    const sowItems = await db
      .select()
      .from(organizationSowItems)
      .where(
        and(
          eq(organizationSowItems.organizationId, organizationId),
          eq(organizationSowItems.isActive, true)
        )
      )
      .orderBy(organizationSowItems.displayOrder);

    // Build hierarchical structure
    // For GC: Trade → Subcategory → Work Types
    // For specialty: Single Trade → Category → Work Types
    const hierarchyMap = new Map<string, Map<string, typeof sowItems>>();

    for (const item of sowItems) {
      let tradeName: string;
      let subcategoryName: string;

      if (isGC && item.categoryName.includes(" - ")) {
        // Parse "TRADE_TYPE - Subcategory" format
        const parts = item.categoryName.split(" - ");
        tradeName = parts[0].replace(/_/g, " ");
        subcategoryName = parts.slice(1).join(" - ");
      } else {
        // Specialty trade: use org trade type as the trade
        tradeName = org.tradeType.replace(/_/g, " ");
        subcategoryName = item.categoryName;
      }

      if (!hierarchyMap.has(tradeName)) {
        hierarchyMap.set(tradeName, new Map());
      }
      const tradeMap = hierarchyMap.get(tradeName)!;

      if (!tradeMap.has(subcategoryName)) {
        tradeMap.set(subcategoryName, []);
      }
      tradeMap.get(subcategoryName)!.push(item);
    }

    // Convert to array structure for frontend
    const hierarchy = Array.from(hierarchyMap.entries()).map(([tradeName, subcategoryMap]) => {
      // Derive category code from trade name for reliable form mapping
      const categoryCode = tradeName.toUpperCase().replace(/ /g, "_");
      
      return {
        tradeName,
        categoryCode, // Include reliable category code for form mapping
        subcategories: Array.from(subcategoryMap.entries()).map(([subcategoryName, items]) => ({
          subcategoryName,
          workTypes: items.map(item => ({
            id: item.id,
            name: item.name,
            code: item.code,
            description: item.description,
            unit: item.unit,
            categoryName: item.categoryName,
            requiresDimensions: item.requiresDimensions,
            dimensionLabel: item.dimensionLabel,
            defaultCostCode: item.defaultCostCode || null,
          })),
        })).sort((a, b) => a.subcategoryName.localeCompare(b.subcategoryName)),
      };
    }).sort((a, b) => a.tradeName.localeCompare(b.tradeName));

    res.json({
      isGC,
      tradeType: org.tradeType,
      hierarchy,
    });
  } catch (error) {
    logError("Get hierarchical scope error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/scope/work-types-by-cost-code", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const items = await db
      .select({
        id: organizationSowItems.id,
        name: organizationSowItems.name,
        code: organizationSowItems.code,
        categoryName: organizationSowItems.categoryName,
        defaultCostCode: organizationSowItems.defaultCostCode,
      })
      .from(organizationSowItems)
      .where(
        and(
          eq(organizationSowItems.organizationId, organizationId),
          eq(organizationSowItems.isActive, true),
          sql`${organizationSowItems.defaultCostCode} IS NOT NULL AND ${organizationSowItems.defaultCostCode} != ''`
        )
      )
      .orderBy(organizationSowItems.name);

    const mapping: Record<string, Array<{ id: string; name: string; code: string; categoryName: string }>> = {};
    for (const item of items) {
      const costCode = item.defaultCostCode!;
      if (!mapping[costCode]) {
        mapping[costCode] = [];
      }
      mapping[costCode].push({
        id: item.id,
        name: item.name,
        code: item.code,
        categoryName: item.categoryName,
      });
    }

    res.json(mapping);
  } catch (error) {
    logError("Get work types by cost code error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Material Calculator Presets
// Save and load dimension configurations for work types
// ====================

// Get all presets for the organization
router.get("/api/material-calculator/presets", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    const result = await db.execute(sql`
      SELECT * FROM material_calculator_presets 
      WHERE organization_id = ${organizationId}
      ORDER BY is_default DESC, name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    logError("Get material calculator presets error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get presets for a specific work type code
router.get("/api/material-calculator/presets/by-work-type/:workTypeCode", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    const result = await db.execute(sql`
      SELECT * FROM material_calculator_presets 
      WHERE organization_id = ${organizationId}
        AND (work_type_code = ${req.params.workTypeCode} OR work_type_code IS NULL)
      ORDER BY 
        CASE WHEN work_type_code = ${req.params.workTypeCode} THEN 0 ELSE 1 END,
        is_default DESC, 
        name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    logError("Get presets by work type error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new preset
router.post("/api/material-calculator/presets", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;
    if (!organizationId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    const { name, workTypeCode, unit, ...dimensions } = req.body;

    if (!name || !unit) {
      res.status(400).json({ error: "Name and unit are required" });
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO material_calculator_presets (
        organization_id, name, work_type_code, unit,
        concrete_depth_inches, dimension_width_inches, dimension_height_inches, concrete_waste_factor,
        requires_stone_base, stone_type, stone_size, stone_depth_inches, stone_waste_factor,
        requires_excavation, excavation_depth_inches, excavation_width_inches, excavation_swell_factor,
        requires_wire_mesh, wire_mesh_type, wire_mesh_waste_factor,
        requires_rebar, rebar_size, rebar_fab_type, rebar_spacing_inches, rebar_waste_factor,
        requires_dowels, dowel_spacing_inches, joint_length_feet,
        requires_sealer, sealer_type, sealer_coats, sealer_waste_factor,
        requires_underlayment, underlayment_type, underlayment_overlap_inches, underlayment_waste_factor,
        is_default, created_by_id
      ) VALUES (
        ${organizationId}, ${name}, ${workTypeCode || null}, ${unit},
        ${dimensions.concreteDepthInches || null}, ${dimensions.dimensionWidthInches || null}, 
        ${dimensions.dimensionHeightInches || null}, ${dimensions.concreteWasteFactor || '10'},
        ${dimensions.requiresStoneBase || false}, ${dimensions.stoneType || null}, 
        ${dimensions.stoneSize || null}, ${dimensions.stoneDepthInches || null}, ${dimensions.stoneWasteFactor || '10'},
        ${dimensions.requiresExcavation || false}, ${dimensions.excavationDepthInches || null}, 
        ${dimensions.excavationWidthInches || null}, ${dimensions.excavationSwellFactor || '25'},
        ${dimensions.requiresWireMesh || false}, ${dimensions.wireMeshType || null}, 
        ${dimensions.wireMeshWasteFactor || '10'},
        ${dimensions.requiresRebar || false}, ${dimensions.rebarSize || null}, 
        ${dimensions.rebarFabType || null}, ${dimensions.rebarSpacingInches || null}, ${dimensions.rebarWasteFactor || '10'},
        ${dimensions.requiresDowels || false}, ${dimensions.dowelSpacingInches || null},
        ${dimensions.jointLengthFeet || null},
        ${dimensions.requiresSealer || false}, ${dimensions.sealerType || null}, 
        ${dimensions.sealerCoats || 1}, ${dimensions.sealerWasteFactor || '10'},
        ${dimensions.requiresUnderlayment || false}, ${dimensions.underlaymentType || null}, 
        ${dimensions.underlaymentOverlapInches || null}, ${dimensions.underlaymentWasteFactor || '10'},
        ${dimensions.isDefault || false}, ${userId}
      )
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError("Create material calculator preset error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update a preset
router.put("/api/material-calculator/presets/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    // Verify ownership
    const existing = await db.execute(sql`
      SELECT id FROM material_calculator_presets 
      WHERE id = ${req.params.id} AND organization_id = ${organizationId}
    `);

    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Preset not found" });
      return;
    }

    const { name, workTypeCode, unit, ...dimensions } = req.body;

    const result = await db.execute(sql`
      UPDATE material_calculator_presets SET
        name = COALESCE(${name}, name),
        work_type_code = ${workTypeCode || null},
        unit = COALESCE(${unit}, unit),
        concrete_depth_inches = ${dimensions.concreteDepthInches || null},
        dimension_width_inches = ${dimensions.dimensionWidthInches || null},
        dimension_height_inches = ${dimensions.dimensionHeightInches || null},
        concrete_waste_factor = COALESCE(${dimensions.concreteWasteFactor}, '10'),
        requires_stone_base = COALESCE(${dimensions.requiresStoneBase}, false),
        stone_type = ${dimensions.stoneType || null},
        stone_size = ${dimensions.stoneSize || null},
        stone_depth_inches = ${dimensions.stoneDepthInches || null},
        stone_waste_factor = COALESCE(${dimensions.stoneWasteFactor}, '10'),
        requires_excavation = COALESCE(${dimensions.requiresExcavation}, false),
        excavation_depth_inches = ${dimensions.excavationDepthInches || null},
        excavation_width_inches = ${dimensions.excavationWidthInches || null},
        excavation_swell_factor = COALESCE(${dimensions.excavationSwellFactor}, '25'),
        requires_wire_mesh = COALESCE(${dimensions.requiresWireMesh}, false),
        wire_mesh_type = ${dimensions.wireMeshType || null},
        wire_mesh_waste_factor = COALESCE(${dimensions.wireMeshWasteFactor}, '10'),
        requires_rebar = COALESCE(${dimensions.requiresRebar}, false),
        rebar_size = ${dimensions.rebarSize || null},
        rebar_fab_type = ${dimensions.rebarFabType || null},
        rebar_spacing_inches = ${dimensions.rebarSpacingInches || null},
        rebar_waste_factor = COALESCE(${dimensions.rebarWasteFactor}, '10'),
        requires_dowels = COALESCE(${dimensions.requiresDowels}, false),
        dowel_spacing_inches = ${dimensions.dowelSpacingInches || null},
        joint_length_feet = ${dimensions.jointLengthFeet || null},
        requires_sealer = COALESCE(${dimensions.requiresSealer}, false),
        sealer_type = ${dimensions.sealerType || null},
        sealer_coats = COALESCE(${dimensions.sealerCoats}, 1),
        sealer_waste_factor = COALESCE(${dimensions.sealerWasteFactor}, '10'),
        requires_underlayment = COALESCE(${dimensions.requiresUnderlayment}, false),
        underlayment_type = ${dimensions.underlaymentType || null},
        underlayment_overlap_inches = ${dimensions.underlaymentOverlapInches || null},
        underlayment_waste_factor = COALESCE(${dimensions.underlaymentWasteFactor}, '10'),
        is_default = COALESCE(${dimensions.isDefault}, false),
        updated_at = NOW()
      WHERE id = ${req.params.id} AND organization_id = ${organizationId}
      RETURNING *
    `);

    res.json(result.rows[0]);
  } catch (error) {
    logError("Update material calculator preset error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a preset
router.delete("/api/material-calculator/presets/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "Organization required" });
      return;
    }

    // Verify ownership and delete
    const result = await db.execute(sql`
      DELETE FROM material_calculator_presets 
      WHERE id = ${req.params.id} AND organization_id = ${organizationId}
      RETURNING id
    `);

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Preset not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logError("Delete material calculator preset error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Organization-Specific Work Categories
// Get work categories based on organization's SOW items (trade-specific)
// ====================

// Legacy enum values that exist in the system for backward compatibility
// These are the only valid category values for catalog lookups and estimate persistence
const VALID_LEGACY_ENUMS = [
  "CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", 
  "STRIPING", "SIGNAGE", "LANDSCAPING", "ELECTRICAL",
  "PLUMBING", "HVAC", "ROOFING", "STRUCTURAL_STEEL", "MASONRY",
  "DRYWALL", "PAINTING", "FLOORING", "FIRE_PROTECTION", "DEMOLITION",
  "CARPENTRY", "INSULATION", "WINDOWS_DOORS", "ELEVATOR", "GRADING",
  "PAVING", "SITEWORK", "WATERPROOFING", "MECHANICAL", "FRAMING",
  "OTHER"
] as const;

// Comprehensive mapping from category name keywords to legacy enum values
// Uses tokenized matching to avoid false positives
// Priority order matters - more specific keywords should be checked first
type CategoryMapping = {
  legacyEnum: string;
  priority: number;
  // Multi-word phrases that must appear as word sequences (not substrings)
  phrases: string[];
  // Single words that must match as complete tokens
  words: string[];
};

const categoryMappings: CategoryMapping[] = [
  // Striping/Markings (high priority)
  { legacyEnum: "STRIPING", priority: 1,
    phrases: ["pavement marking", "traffic paint", "cross walk", "stop bar", 
              "parking stall", "handicap space", "lane marking", "street marking", 
              "paint striping"],
    words: ["striping", "thermoplastic", "crosswalk"] },
  // Signage (high priority - avoid matching "design", "post-tension" etc.)
  { legacyEnum: "SIGNAGE", priority: 1,
    phrases: ["traffic sign", "street sign", "parking sign", "ada sign",
              "directional sign", "way finding", "sign installation",
              "monument sign", "regulatory sign"],
    words: ["signage", "wayfinding"] },
  // Bollards/Safety
  { legacyEnum: "BOLLARDS", priority: 2,
    phrases: ["guard rail", "safety barrier", "wheel stop", "parking barrier", 
              "crash barrier", "bumper post", "pipe bollard"],
    words: ["bollard", "guardrail"] },
  // Electrical
  { legacyEnum: "ELECTRICAL", priority: 2,
    phrases: ["electric work", "light fixture", "junction box", "pole light", 
              "area light", "parking lot lighting", "electrical conduit"],
    words: ["electrical", "lighting", "conduit", "transformer", "photocell"] },
  // Landscaping 
  { legacyEnum: "LANDSCAPING", priority: 2,
    phrases: ["erosion control", "silt fence", "fiber roll", "stormwater prevention", 
              "bmp installation", "sprinkler system", "drip line"],
    words: ["landscaping", "landscape", "irrigation", "hydroseed", "topsoil", 
            "swppp", "mulch", "sod", "turf", "shrub", "planting"] },
  // Concrete-related (flatwork, structural, decorative)
  { legacyEnum: "CONCRETE", priority: 3,
    phrases: ["curb and gutter", "curb & gutter", "stem wall", "retaining wall",
              "exposed aggregate", "stamped concrete", "colored concrete", 
              "expansion joint", "control joint", "post-tension", "post tension", 
              "pt slab"],
    words: ["concrete", "sidewalk", "driveway", "foundation", "patio", "flatwork",
            "footing", "slab", "pier", "rebar", "reinforcing", "dowel", "curb", 
            "gutter", "sawcut", "sawcutting"] },
  // Paving/Asphalt
  { legacyEnum: "PAVERS", priority: 3,
    phrases: ["ac paving", "hot mix", "cold patch", "base rock", "base course", 
              "seal coat", "slurry seal", "crack seal", "pothole repair", 
              "mill and overlay", "grind and overlay"],
    words: ["asphalt", "blacktop", "overlay", "paver"] },
  // Plumbing
  { legacyEnum: "PLUMBING", priority: 2,
    phrases: ["water heater", "drain line", "waste line", "water supply", "sewer pipe",
              "plumbing fixture", "gas line", "backflow preventer"],
    words: ["plumbing", "faucet", "toilet", "sink", "piping"] },
  // HVAC
  { legacyEnum: "HVAC", priority: 2,
    phrases: ["air conditioning", "air handler", "heat pump", "duct work", "hvac system",
              "mechanical ventilation", "chilled water"],
    words: ["hvac", "ductwork", "furnace", "thermostat", "ventilation"] },
  // Roofing
  { legacyEnum: "ROOFING", priority: 2,
    phrases: ["roof membrane", "roof deck", "built up roof", "standing seam",
              "roof flashing", "roof drain"],
    words: ["roofing", "shingle", "soffit", "fascia"] },
  // Structural Steel
  { legacyEnum: "STRUCTURAL_STEEL", priority: 2,
    phrases: ["steel beam", "steel column", "steel joist", "metal deck",
              "structural steel", "steel erection", "steel framing"],
    words: ["steelwork", "ironwork"] },
  // Masonry
  { legacyEnum: "MASONRY", priority: 2,
    phrases: ["brick wall", "block wall", "stone veneer", "masonry wall",
              "brick veneer", "concrete block"],
    words: ["masonry", "brick", "mortar", "tuckpointing", "stonework", "cmu"] },
  // Drywall
  { legacyEnum: "DRYWALL", priority: 2,
    phrases: ["drywall finish", "gypsum board", "metal stud", "drywall partition"],
    words: ["drywall", "sheetrock", "gypsum", "taping"] },
  // Painting
  { legacyEnum: "PAINTING", priority: 2,
    phrases: ["interior painting", "exterior painting", "wall coating",
              "paint prep", "surface preparation"],
    words: ["painting", "primer", "staining", "wallcovering"] },
  // Flooring
  { legacyEnum: "FLOORING", priority: 2,
    phrases: ["vinyl tile", "ceramic tile", "hardwood floor", "carpet tile",
              "epoxy floor", "polished concrete floor"],
    words: ["flooring", "carpet", "tile", "terrazzo", "laminate", "vinyl"] },
  // Fire Protection
  { legacyEnum: "FIRE_PROTECTION", priority: 2,
    phrases: ["fire sprinkler", "fire alarm", "fire suppression", "fire stopping",
              "fire rated", "fire extinguisher", "smoke detector"],
    words: ["sprinkler", "firestop", "firestopping"] },
  // Demolition
  { legacyEnum: "DEMOLITION", priority: 2,
    phrases: ["selective demolition", "interior demolition", "structural demolition",
              "concrete removal", "asbestos abatement"],
    words: ["demolition", "abatement", "hazmat"] },
  // Carpentry
  { legacyEnum: "CARPENTRY", priority: 2,
    phrases: ["rough carpentry", "finish carpentry", "cabinet install",
              "millwork installation", "wood blocking"],
    words: ["carpentry", "cabinetry", "millwork", "casework", "woodwork"] },
  // Insulation
  { legacyEnum: "INSULATION", priority: 2,
    phrases: ["spray foam", "batt insulation", "rigid insulation", "pipe insulation",
              "blown in insulation", "thermal insulation"],
    words: ["insulation", "fiberglass", "rockwool"] },
  // Windows & Doors
  { legacyEnum: "WINDOWS_DOORS", priority: 2,
    phrases: ["window installation", "door installation", "curtain wall",
              "storefront glazing", "overhead door", "hollow metal"],
    words: ["windows", "doors", "glazing", "skylight"] },
  // Elevator
  { legacyEnum: "ELEVATOR", priority: 2,
    phrases: ["elevator installation", "elevator modernization", "elevator cab"],
    words: ["elevator", "escalator", "conveyor"] },
  // Grading
  { legacyEnum: "GRADING", priority: 3,
    phrases: ["rough grading", "fine grading", "finish grading", "site grading"],
    words: ["grading"] },
  // Paving
  { legacyEnum: "PAVING", priority: 3,
    phrases: ["ac paving", "concrete paving"],
    words: ["paving"] },
  // Sitework
  { legacyEnum: "SITEWORK", priority: 4,
    phrases: ["site work", "site clearing", "construction entrance",
              "temporary fencing", "stabilized entrance"],
    words: ["sitework"] },
  // Waterproofing
  { legacyEnum: "WATERPROOFING", priority: 2,
    phrases: ["below grade waterproofing", "foundation waterproofing",
              "deck coating", "traffic coating", "moisture barrier"],
    words: ["waterproofing", "dampproofing", "membrane"] },
  // Mechanical
  { legacyEnum: "MECHANICAL", priority: 3,
    phrases: ["mechanical system", "mechanical piping", "process piping"],
    words: ["mechanical"] },
  // Framing
  { legacyEnum: "FRAMING", priority: 3,
    phrases: ["wood framing", "steel framing", "metal framing", "wall framing"],
    words: ["framing"] },
  // Excavation/Earthwork-related (lowest priority - catches remaining site work)
  { legacyEnum: "EXCAVATION", priority: 4,
    phrases: ["haul off", "import fill",
              "storm drain", "sewer line", "underground utilities", "catch basin",
              "traffic control", "jack and bore", 
              "pipe installation", "utility install",
              "directional drill"],
    words: ["excavation", "earthwork", "trenching", "backfill",
            "compaction", "subgrade", "manhole", "survey", "layout",
            "barricade", "flagging", "dewatering", "shoring", "boring", "grubbing",
            "stockpile", "stripping", "trench", "export"] },
].sort((a, b) => a.priority - b.priority);

// Tokenize a string into words, handling hyphens and special characters
function tokenize(input: string): string[] {
  // Replace hyphens/underscores with spaces, then split on non-alphanumeric
  return input.toLowerCase()
    .replace(/[-_]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 0);
}

// Check if phrase tokens appear in sequence within input tokens
function containsPhrase(inputTokens: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0) return false;
  
  for (let i = 0; i <= inputTokens.length - phraseTokens.length; i++) {
    let match = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (inputTokens[i + j] !== phraseTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function mapCategoryToLegacyEnum(categoryName: string): { legacyEnum: string; isInferred: boolean } {
  const inputTokens = tokenize(categoryName);
  
  // Check each mapping for matches (in priority order)
  for (const mapping of categoryMappings) {
    // Check multi-word phrases first (more specific)
    for (const phrase of mapping.phrases) {
      const phraseTokens = tokenize(phrase);
      if (containsPhrase(inputTokens, phraseTokens)) {
        return { legacyEnum: mapping.legacyEnum, isInferred: true };
      }
    }
    
    // Then check single words (must be exact token match)
    for (const word of mapping.words) {
      if (inputTokens.includes(word.toLowerCase())) {
        return { legacyEnum: mapping.legacyEnum, isInferred: true };
      }
    }
  }
  
  // Fallback to OTHER for unmatched categories
  const partCount = inputTokens.length;
  console.log(`[WorkCategories] Unmapped category: "${categoryName}" (${partCount} parts) -> defaulting to OTHER`);
  return { legacyEnum: "OTHER", isInferred: true };
}

// Get organization-specific work categories from their SOW items
router.get("/api/organization/work-categories", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }

    // Get organization's trade type first for context
    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    // Default fallback categories based on valid legacy enums only
    // These match the enums used in vendor pricing, estimates, and analytics
    const defaultCategories = [
      { value: "CONCRETE", label: "Concrete", itemCount: 0, items: [], isDefault: false },
      { value: "EXCAVATION", label: "Excavation", itemCount: 0, items: [], isDefault: false },
      { value: "GRADING", label: "Grading", itemCount: 0, items: [], isDefault: false },
      { value: "PAVING", label: "Paving", itemCount: 0, items: [], isDefault: false },
      { value: "PAVERS", label: "Pavers", itemCount: 0, items: [], isDefault: false },
      { value: "DEMOLITION", label: "Demolition", itemCount: 0, items: [], isDefault: false },
      { value: "SITEWORK", label: "Sitework", itemCount: 0, items: [], isDefault: false },
      { value: "STRUCTURAL_STEEL", label: "Structural Steel", itemCount: 0, items: [], isDefault: false },
      { value: "MASONRY", label: "Masonry", itemCount: 0, items: [], isDefault: false },
      { value: "FRAMING", label: "Framing", itemCount: 0, items: [], isDefault: false },
      { value: "CARPENTRY", label: "Carpentry", itemCount: 0, items: [], isDefault: false },
      { value: "ROOFING", label: "Roofing", itemCount: 0, items: [], isDefault: false },
      { value: "WATERPROOFING", label: "Waterproofing", itemCount: 0, items: [], isDefault: false },
      { value: "INSULATION", label: "Insulation", itemCount: 0, items: [], isDefault: false },
      { value: "DRYWALL", label: "Drywall", itemCount: 0, items: [], isDefault: false },
      { value: "PAINTING", label: "Painting", itemCount: 0, items: [], isDefault: false },
      { value: "FLOORING", label: "Flooring", itemCount: 0, items: [], isDefault: false },
      { value: "WINDOWS_DOORS", label: "Windows & Doors", itemCount: 0, items: [], isDefault: false },
      { value: "PLUMBING", label: "Plumbing", itemCount: 0, items: [], isDefault: false },
      { value: "HVAC", label: "HVAC", itemCount: 0, items: [], isDefault: false },
      { value: "MECHANICAL", label: "Mechanical", itemCount: 0, items: [], isDefault: false },
      { value: "ELECTRICAL", label: "Electrical", itemCount: 0, items: [], isDefault: false },
      { value: "FIRE_PROTECTION", label: "Fire Protection", itemCount: 0, items: [], isDefault: false },
      { value: "ELEVATOR", label: "Elevator", itemCount: 0, items: [], isDefault: false },
      { value: "BOLLARDS", label: "Bollards", itemCount: 0, items: [], isDefault: false },
      { value: "STRIPING", label: "Striping", itemCount: 0, items: [], isDefault: false },
      { value: "SIGNAGE", label: "Signage", itemCount: 0, items: [], isDefault: false },
      { value: "LANDSCAPING", label: "Landscaping", itemCount: 0, items: [], isDefault: false },
      { value: "OTHER", label: "Other", itemCount: 0, items: [], isDefault: true }
    ];

    // Fetch organization's SOW items grouped by category
    const orgSowItems = await db
      .select()
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, orgId),
        eq(organizationSowItems.isActive, true)
      ))
      .orderBy(organizationSowItems.displayOrder);

    // Group by legacy enum value to maintain backward compatibility
    const categoriesMap = new Map<string, { 
      legacyEnum: string; 
      displayLabels: Set<string>;
      items: typeof orgSowItems;
      sortOrder: number;
    }>();

    for (const item of orgSowItems) {
      const { legacyEnum } = mapCategoryToLegacyEnum(item.categoryName);
      if (!categoriesMap.has(legacyEnum)) {
        categoriesMap.set(legacyEnum, {
          legacyEnum,
          displayLabels: new Set(),
          items: [],
          sortOrder: item.displayOrder || 0
        });
      }
      const cat = categoriesMap.get(legacyEnum)!;
      cat.displayLabels.add(item.categoryName);
      cat.items.push(item);
    }

    // Convert to array using legacy enum as value for backward compatibility
    if (categoriesMap.size > 0) {
      const categories = Array.from(categoriesMap.values())
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(cat => {
          // Create display label from unique category names
          const labelsArray = Array.from(cat.displayLabels);
          const displayLabel = labelsArray.length === 1 
            ? labelsArray[0] 
            : labelsArray.slice(0, 2).join(' / ') + (labelsArray.length > 2 ? ' +' : '');
          
          return {
            value: cat.legacyEnum, // Use legacy enum for backward compatibility
            label: displayLabel,
            itemCount: cat.items.length,
            isDefault: cat.legacyEnum === 'OTHER', // Mark OTHER as default fallback
            items: cat.items.map(i => ({
              id: i.id,
              name: i.name,
              code: i.code,
              unit: i.unit,
              description: i.description
            }))
          };
        });

      // Always ensure OTHER is available as catch-all
      if (!categories.find(c => c.value === 'OTHER')) {
        categories.push({ value: "OTHER", label: "Other", itemCount: 0, items: [], isDefault: true });
      }

      return res.json(categories);
    }

    // If no organization SOW items exist, get master SOW items based on trade type
    if (org?.tradeType) {
      const isGC = org.tradeType === 'GENERAL_CONTRACTOR';
      
      const masterItemsList = await db
        .select()
        .from(masterSowItems)
        .where(isGC 
          ? eq(masterSowItems.isActive, true)
          : and(
              eq(masterSowItems.tradeType, org.tradeType as any),
              eq(masterSowItems.isActive, true)
            )
        )
        .orderBy(masterSowItems.sortOrder);

      if (masterItemsList.length > 0) {
        // Group master items by legacy enum
        const masterCategoriesMap = new Map<string, { 
          legacyEnum: string; 
          displayLabels: Set<string>;
          items: typeof masterItemsList;
          sortOrder: number;
        }>();

        for (const item of masterItemsList) {
          const { legacyEnum } = mapCategoryToLegacyEnum(item.categoryName || 'General');
          if (!masterCategoriesMap.has(legacyEnum)) {
            masterCategoriesMap.set(legacyEnum, {
              legacyEnum,
              displayLabels: new Set(),
              items: [],
              sortOrder: item.sortOrder || 0
            });
          }
          const cat = masterCategoriesMap.get(legacyEnum)!;
          cat.displayLabels.add(item.categoryName || 'General');
          cat.items.push(item);
        }

        const masterCategoriesList = Array.from(masterCategoriesMap.values())
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(cat => {
            const labelsArray = Array.from(cat.displayLabels);
            const displayLabel = labelsArray.length === 1 
              ? labelsArray[0] 
              : labelsArray.slice(0, 2).join(' / ') + (labelsArray.length > 2 ? ' +' : '');
            
            return {
              value: cat.legacyEnum,
              label: displayLabel,
              itemCount: cat.items.length,
              isDefault: cat.legacyEnum === 'OTHER',
              items: cat.items.map(i => ({
                id: i.id,
                name: i.name,
                code: i.code,
                unit: i.defaultUomCode,
                description: i.description
              }))
            };
          });

        // Always ensure OTHER is available
        if (!masterCategoriesList.find(c => c.value === 'OTHER')) {
          masterCategoriesList.push({ value: "OTHER", label: "Other", itemCount: 0, items: [], isDefault: true });
        }

        return res.json(masterCategoriesList);
      }
    }

    // Ultimate fallback - return default construction categories using legacy enums
    return res.json(defaultCategories);
  } catch (error) {
    logError("Get organization work categories error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Trade Configuration Routes
// ====================

// Get organization trade configuration
router.get("/api/organization/trade-config", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }

    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        tradeType: organizations.tradeType,
        tradeName: organizations.tradeName,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    // Get SOW item count
    const sowItemsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, orgId),
        eq(organizationSowItems.isActive, true)
      ));

    const sowItemCount = sowItemsResult[0]?.count || 0;

    // Get available trade types from enum
    const tradeTypes = tradeTypeEnum.enumValues.map(t => ({
      value: t,
      label: t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }));

    res.json({
      organization: org,
      sowItemCount,
      tradeTypes
    });
  } catch (error) {
    logError("Get trade config error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update organization trade type
router.post("/api/organization/update-trade-type", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "HUSTLER"), async (req: AuthRequest, res) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }

    const { tradeType: newTradeType, tradeName } = req.body;

    // Validate trade type
    if (!tradeTypeEnum.enumValues.includes(newTradeType)) {
      return res.status(400).json({ 
        error: "Invalid trade type",
        message: `Trade type "${newTradeType}" is not valid. Valid options: ${tradeTypeEnum.enumValues.join(', ')}`
      });
    }

    // Get current organization
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const previousTradeType = org.tradeType;

    const { sowAuditLog } = await import("@shared/schema");

    // Update organization trade type
    await db
      .update(organizations)
      .set({ 
        tradeType: newTradeType,
        tradeName: newTradeType === 'OTHER' ? tradeName : null
      })
      .where(eq(organizations.id, orgId));

    // Log the change
    await db.insert(sowAuditLog).values({
      organizationId: orgId,
      userId: req.user!.id,
      action: "UPDATE",
      details: `Trade type changed from ${previousTradeType} to ${newTradeType}`,
      previousTradeType: previousTradeType,
      newTradeType: newTradeType,
    });

    console.log(`[TradeConfig] Trade type updated for org ${orgId}: ${previousTradeType} -> ${newTradeType}`);

    res.json({ 
      success: true, 
      message: "Trade type updated successfully",
      previousTradeType,
      newTradeType
    });
  } catch (error) {
    logError("Update trade type error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reinitialize SOW items based on current trade type
router.post("/api/organization/reinitialize-sow", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "HUSTLER"), async (req: AuthRequest, res) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }

    // Get organization
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const tradeType = org.tradeType;
    const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
    const isCustomTrade = tradeType === 'OTHER';

    // Count existing active SOW items
    const existingCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationSowItems)
      .where(and(
        eq(organizationSowItems.organizationId, orgId),
        eq(organizationSowItems.isActive, true)
      ));
    const existingCount = existingCountResult[0]?.count || 0;

    // Deactivate existing template-based SOW items (preserve custom items)
    const deactivatedResult = await db
      .update(organizationSowItems)
      .set({ isActive: false })
      .where(and(
        eq(organizationSowItems.organizationId, orgId),
        eq(organizationSowItems.isFromTemplate, true),
        eq(organizationSowItems.isActive, true)
      ))
      .returning({ id: organizationSowItems.id });

    const deactivatedCount = deactivatedResult.length;

    const { sowAuditLog, masterSowItems: masterSowItemsTable } = await import("@shared/schema");

    // Log deactivation
    await db.insert(sowAuditLog).values({
      organizationId: orgId,
      userId: req.user!.id,
      action: "DEACTIVATE",
      details: `Deactivated ${deactivatedCount} template-based SOW items for regeneration`,
      itemCount: deactivatedCount,
    });

    let newItemsCreated = 0;
    const newCategories: string[] = [];

    // Don't load new items for custom trades (OTHER) - they define their own
    if (!isCustomTrade) {
      // Load master SOW items based on trade type
      let masterItems;
      if (isGeneralContractor) {
        masterItems = await db
          .select()
          .from(masterSowItemsTable)
          .where(eq(masterSowItemsTable.isActive, true))
          .orderBy(asc(masterSowItemsTable.tradeType), asc(masterSowItemsTable.sortOrder));
      } else {
        masterItems = await db
          .select()
          .from(masterSowItemsTable)
          .where(and(
            eq(masterSowItemsTable.tradeType, tradeType as any),
            eq(masterSowItemsTable.isActive, true)
          ))
          .orderBy(asc(masterSowItemsTable.sortOrder));
      }

      // Safety check: Abort if no master items found for this trade type
      if (masterItems.length === 0) {
        console.warn(`[SOW] No master SOW items found for trade type ${tradeType} - reactivating deactivated items`);
        
        // Reactivate the items we just deactivated
        await db
          .update(organizationSowItems)
          .set({ isActive: true })
          .where(and(
            eq(organizationSowItems.organizationId, orgId),
            eq(organizationSowItems.isFromTemplate, true),
            eq(organizationSowItems.isActive, false)
          ));
        
        return res.status(400).json({ 
          error: "No templates available",
          message: `No master SOW items are configured for trade type ${tradeType}. Your existing items have been preserved.`
        });
      }

      // Create new organization SOW items
      for (const item of masterItems) {
        const categoryName = isGeneralContractor 
          ? `${item.tradeType} - ${item.categoryName || 'General'}`
          : item.categoryName || 'General';
        
        const itemCode = isGeneralContractor
          ? `${item.tradeType}_${item.code}`
          : item.code;

        // Check if this code already exists (even if inactive)
        const [existing] = await db
          .select()
          .from(organizationSowItems)
          .where(and(
            eq(organizationSowItems.organizationId, orgId),
            eq(organizationSowItems.code, itemCode)
          ))
          .limit(1);

        if (existing) {
          // Reactivate existing item
          await db
            .update(organizationSowItems)
            .set({ isActive: true })
            .where(eq(organizationSowItems.id, existing.id));
        } else {
          // Create new item
          await db.insert(organizationSowItems).values({
            organizationId: orgId,
            categoryName: categoryName,
            name: item.name,
            code: itemCode,
            description: item.description,
            unit: item.defaultUomCode,
            requiresDimensions: item.requiresDimensions || false,
            dimensionLabel: item.dimensionLabel,
            displayOrder: item.sortOrder || 0,
            isFromTemplate: true,
            isActive: true,
          });
          newItemsCreated++;
        }

        if (!newCategories.includes(categoryName)) {
          newCategories.push(categoryName);
        }
      }
    }

    // Log regeneration
    await db.insert(sowAuditLog).values({
      organizationId: orgId,
      userId: req.user!.id,
      action: "REGENERATE",
      details: `Regenerated SOW items for trade type ${tradeType}. Created ${newItemsCreated} new items across ${newCategories.length} categories.`,
      newTradeType: tradeType,
      itemCount: newItemsCreated,
    });

    console.log(`[SOW] Reinitialized SOW for org ${orgId}: ${deactivatedCount} deactivated, ${newItemsCreated} created, ${newCategories.length} categories`);

    res.json({
      success: true,
      message: isCustomTrade 
        ? "Template items deactivated. Add custom scope items for your trade."
        : "SOW items regenerated from trade templates",
      tradeType,
      isCustomTrade,
      deactivatedCount,
      newItemsCreated,
      categories: newCategories,
    });
  } catch (error) {
    logError("Reinitialize SOW error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get SOW preview for a trade type (for onboarding review)
router.get("/api/organization/sow-preview/:tradeType", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { tradeType } = req.params;

    // Validate trade type
    if (!tradeTypeEnum.enumValues.includes(tradeType as any)) {
      return res.status(400).json({ 
        error: "Invalid trade type",
        message: `Trade type "${tradeType}" is not valid.`
      });
    }

    const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
    const isCustomTrade = tradeType === 'OTHER';

    if (isCustomTrade) {
      return res.json({
        tradeType,
        isCustomTrade: true,
        categories: [],
        message: "Custom trades allow you to define your own scope of work items."
      });
    }

    const { masterSowItems: masterSowItemsTable } = await import("@shared/schema");

    // Get master SOW items
    let masterItems;
    if (isGeneralContractor) {
      masterItems = await db
        .select()
        .from(masterSowItemsTable)
        .where(eq(masterSowItemsTable.isActive, true))
        .orderBy(asc(masterSowItemsTable.tradeType), asc(masterSowItemsTable.sortOrder));
    } else {
      masterItems = await db
        .select()
        .from(masterSowItemsTable)
        .where(and(
          eq(masterSowItemsTable.tradeType, tradeType as any),
          eq(masterSowItemsTable.isActive, true)
        ))
        .orderBy(asc(masterSowItemsTable.sortOrder));
    }

    // Group by category
    const categoriesMap = new Map<string, { name: string; items: string[] }>();
    
    for (const item of masterItems) {
      const categoryName = isGeneralContractor 
        ? `${item.tradeType} - ${item.categoryName || 'General'}`
        : item.categoryName || 'General';
      
      if (!categoriesMap.has(categoryName)) {
        categoriesMap.set(categoryName, { name: categoryName, items: [] });
      }
      categoriesMap.get(categoryName)!.items.push(item.name);
    }

    const categories = Array.from(categoriesMap.values());

    res.json({
      tradeType,
      isCustomTrade: false,
      totalItems: masterItems.length,
      categories
    });
  } catch (error) {
    logError("Get SOW preview error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// 3-Layer Modifier API for Scope Selection
// Returns Universal + Trade + Scope-Suggested modifiers merged
// ====================

router.get("/api/modifiers/for-scope", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const trade = (req.query.trade as string) || "";
    const scopeName = (req.query.scopeName as string) || "";

    const [org] = await db
      .select({ tradeType: organizations.tradeType })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    const effectiveTrade = trade || org.tradeType;

    interface ModItem { id: string; categoryId: string; categoryName: string; name: string; code: string; displayOrder: number; isCustom?: boolean; description?: string; factorMin?: number; factorMax?: number; effectType?: string; }
    interface CatGroup { id: string; name: string; displayOrder: number; description?: string; modifiers: ModItem[]; }
    interface FlatMod { id: string; name: string; code: string; categoryName: string; sourceLayer: string; }

    let universalLayer: CatGroup[] = [];
    let tradeLayer: CatGroup[] = [];
    let allFlatMods: FlatMod[] = [];
    let usedModifiersTable = false;

    try {
      const modRows = await db
        .select()
        .from(modifiersTable)
        .where(eq(modifiersTable.isActive, true))
        .orderBy(modifiersTable.displayOrder);

      if (modRows.length > 0) {
        usedModifiersTable = true;

        const universalMods = modRows.filter(m => m.layer === "universal");
        const tradeMods = modRows.filter(m =>
          m.layer === "trade" && (m.tradeIds.length === 0 || m.tradeIds.includes(effectiveTrade))
        );

        const groupByCategory = (mods: typeof modRows): CatGroup[] => {
          const cats = new Map<string, CatGroup>();
          for (const m of mods) {
            if (!cats.has(m.category)) {
              cats.set(m.category, {
                id: m.category,
                name: m.category,
                displayOrder: cats.size,
                modifiers: [],
              });
            }
            cats.get(m.category)!.modifiers.push({
              id: m.id,
              categoryId: m.category,
              categoryName: m.category,
              name: m.name,
              code: m.id.slice(0, 8),
              displayOrder: m.displayOrder,
              isCustom: false,
              factorMin: Math.min(m.laborFactorMin, m.materialFactorMin, m.durationFactorMin),
              factorMax: Math.max(m.laborFactorMax, m.materialFactorMax, m.durationFactorMax),
              effectType: m.effectType,
            });
          }
          return Array.from(cats.values());
        };

        universalLayer = groupByCategory(universalMods);
        tradeLayer = groupByCategory(tradeMods);

        allFlatMods = [...universalMods.map(m => ({
          id: m.id, name: m.name, code: m.id.slice(0, 8), categoryName: m.category, sourceLayer: "universal",
        })), ...tradeMods.map(m => ({
          id: m.id, name: m.name, code: m.id.slice(0, 8), categoryName: m.category, sourceLayer: "trade",
        }))];
      }
    } catch {
      logWarn("Non-critical operation failed");
      usedModifiersTable = false;
    }

    if (!usedModifiersTable) {
      const universalCategories = await db
        .select()
        .from(scopeModifierCategories)
        .where(eq(scopeModifierCategories.isActive, true))
        .orderBy(scopeModifierCategories.displayOrder);

      let universalMods: (typeof scopeModifiers.$inferSelect)[] = [];
      if (universalCategories.length > 0) {
        universalMods = await db
          .select()
          .from(scopeModifiers)
          .where(eq(scopeModifiers.isActive, true))
          .orderBy(scopeModifiers.displayOrder);
      }

      universalLayer = universalCategories.map(cat => ({
        id: cat.id,
        name: cat.name,
        displayOrder: cat.displayOrder,
        modifiers: universalMods
          .filter(m => m.categoryId === cat.id)
          .map(m => ({
            id: m.id,
            categoryId: m.categoryId,
            categoryName: cat.name,
            name: m.name,
            code: m.code,
            displayOrder: m.displayOrder,
            isCustom: m.isCustom,
          }))
      }));

      const tradeCategories = await db
        .select()
        .from(masterModifierCategories)
        .where(
          and(
            eq(masterModifierCategories.tradeType, effectiveTrade as TradeType),
            eq(masterModifierCategories.isActive, true)
          )
        )
        .orderBy(masterModifierCategories.displayOrder);

      let tradeMods: (typeof masterModifiers.$inferSelect)[] = [];
      if (tradeCategories.length > 0) {
        tradeMods = await db
          .select()
          .from(masterModifiers)
          .where(
            and(
              eq(masterModifiers.tradeType, effectiveTrade as TradeType),
              eq(masterModifiers.isActive, true)
            )
          )
          .orderBy(masterModifiers.displayOrder);
      }

      tradeLayer = tradeCategories.map(cat => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        displayOrder: cat.displayOrder,
        modifiers: tradeMods
          .filter(m => m.categoryId === cat.id)
          .map(m => ({
            id: m.id,
            categoryId: m.categoryId,
            categoryName: cat.name,
            name: m.name,
            code: m.code,
            description: m.description,
            displayOrder: m.displayOrder,
          }))
      }));

      allFlatMods = [
        ...universalMods.map(m => {
          const cat = universalCategories.find(c => c.id === m.categoryId);
          return { id: m.id, name: m.name, code: m.code, categoryName: cat?.name || "", sourceLayer: "universal" };
        }),
        ...tradeMods.map(m => {
          const cat = tradeCategories.find(c => c.id === m.categoryId);
          return { id: m.id, name: m.name, code: m.code, categoryName: cat?.name || "", sourceLayer: "trade" };
        }),
      ];
    }

    interface SuggestedMod { id: string; name: string; code: string; categoryName: string; matchPattern: string; layer: string; }
    const suggestedModifiers: SuggestedMod[] = [];
    if (scopeName && allFlatMods.length > 0) {
      const scopeLower = scopeName.toLowerCase();
      for (const mod of allFlatMods) {
        const modLower = mod.name.toLowerCase();
        const codeLower = (mod.code || "").toLowerCase();
        if (scopeLower.includes(modLower) || scopeLower.includes(codeLower) ||
            modLower.includes(scopeLower.split(" ")[0])) {
          suggestedModifiers.push({
            id: mod.id,
            name: mod.name,
            code: mod.code,
            categoryName: mod.categoryName,
            matchPattern: `Scope name contains "${mod.name}"`,
            layer: mod.sourceLayer,
          });
        }
      }
    }

    res.json({
      universal: universalLayer,
      trade: tradeLayer,
      suggested: suggestedModifiers,
      tradeType: effectiveTrade,
      persistenceEnabled: usedModifiersTable,
    });
  } catch (error) {
    logError("Get modifiers for scope error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get saved modifier selections for a line item
router.get("/api/bid-modifier-selections/:lineItemId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const { lineItemId } = req.params;

    const lineItemRows = await db
      .select({
        id: estimateLineItems.id,
        bidId: estimates.bidId,
        projectId: estimates.projectId,
      })
      .from(estimateLineItems)
      .innerJoin(estimates, eq(estimates.id, estimateLineItems.estimateId))
      .where(eq(estimateLineItems.id, lineItemId))
      .limit(1);

    if (lineItemRows.length === 0) {
      res.status(404).json({ error: "Line item not found" });
      return;
    }

    const lineItem = lineItemRows[0];

    let hasAccess = false;
    if (lineItem.bidId) {
      const [bid] = await db.select({ id: bids.id }).from(bids)
        .where(and(eq(bids.id, lineItem.bidId), eq(bids.gcOrganizationId, organizationId))).limit(1);
      hasAccess = !!bid;
    }
    if (!hasAccess && lineItem.projectId) {
      const [proj] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, lineItem.projectId), eq(projects.organizationId, organizationId))).limit(1);
      hasAccess = !!proj;
    }

    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const selections = await db
      .select({
        id: bidModifierSelections.id,
        bidId: bidModifierSelections.bidId,
        estimateLineItemId: bidModifierSelections.estimateLineItemId,
        modifierId: bidModifierSelections.modifierId,
        selectedFactor: bidModifierSelections.selectedFactor,
        notes: bidModifierSelections.notes,
        modifierName: modifiersTable.name,
        modifierCategory: modifiersTable.category,
        modifierLayer: modifiersTable.layer,
        modifierEffectType: modifiersTable.effectType,
      })
      .from(bidModifierSelections)
      .innerJoin(modifiersTable, eq(modifiersTable.id, bidModifierSelections.modifierId))
      .where(eq(bidModifierSelections.estimateLineItemId, lineItemId));

    res.json(selections);
  } catch (error) {
    logError("Get bid modifier selections error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bid-modifier-selections/by-bid/:bidId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const { bidId } = req.params;

    const [bid] = await db
      .select({ id: bids.id })
      .from(bids)
      .where(
        and(
          eq(bids.id, bidId),
          eq(bids.gcOrganizationId, organizationId)
        )
      )
      .limit(1);

    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    const selections = await db
      .select({
        id: bidModifierSelections.id,
        estimateLineItemId: bidModifierSelections.estimateLineItemId,
        modifierId: bidModifierSelections.modifierId,
        selectedFactor: bidModifierSelections.selectedFactor,
        modifierName: modifiersTable.name,
      })
      .from(bidModifierSelections)
      .innerJoin(modifiersTable, eq(modifiersTable.id, bidModifierSelections.modifierId))
      .where(eq(bidModifierSelections.bidId, bidId));

    res.json({ selections });
  } catch (error) {
    logError("Get bid modifier selections by bid error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Save modifier selections for a line item
router.post("/api/bid-modifier-selections", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }

    const bodySchema = z.object({
      lineItemId: z.string(),
      bidId: z.string().optional(),
      selections: z.array(z.object({
        modifierId: z.string(),
        selectedFactor: z.number().default(1.0),
        notes: z.string().optional(),
      })),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
      return;
    }

    const { lineItemId, bidId, selections } = parsed.data;

    const lineItemRows = await db
      .select({
        id: estimateLineItems.id,
        estimateId: estimateLineItems.estimateId,
        estimateBidId: estimates.bidId,
        estimateProjectId: estimates.projectId,
      })
      .from(estimateLineItems)
      .innerJoin(estimates, eq(estimates.id, estimateLineItems.estimateId))
      .where(eq(estimateLineItems.id, lineItemId))
      .limit(1);

    if (lineItemRows.length === 0) {
      res.status(404).json({ error: "Line item not found" });
      return;
    }

    const lineItem = lineItemRows[0];

    let hasAccess = false;
    if (lineItem.estimateBidId) {
      const [bid] = await db.select({ id: bids.id }).from(bids)
        .where(and(eq(bids.id, lineItem.estimateBidId), eq(bids.gcOrganizationId, organizationId))).limit(1);
      hasAccess = !!bid;
    }
    if (!hasAccess && lineItem.estimateProjectId) {
      const [proj] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, lineItem.estimateProjectId), eq(projects.organizationId, organizationId))).limit(1);
      hasAccess = !!proj;
    }

    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const effectiveBidId = bidId || lineItem.estimateBidId;
    if (!effectiveBidId) {
      res.status(400).json({ error: "No bid associated with this estimate. Cannot save modifier selections without a bid." });
      return;
    }

    await db
      .delete(bidModifierSelections)
      .where(eq(bidModifierSelections.estimateLineItemId, lineItemId));

    if (selections.length > 0) {
      await db.insert(bidModifierSelections).values(
        selections.map(sel => ({
          bidId: effectiveBidId,
          estimateLineItemId: lineItemId,
          modifierId: sel.modifierId,
          selectedFactor: sel.selectedFactor,
          notes: sel.notes || null,
        }))
      );
    }

    const saved = await db
      .select({
        id: bidModifierSelections.id,
        bidId: bidModifierSelections.bidId,
        estimateLineItemId: bidModifierSelections.estimateLineItemId,
        modifierId: bidModifierSelections.modifierId,
        selectedFactor: bidModifierSelections.selectedFactor,
        notes: bidModifierSelections.notes,
        modifierName: modifiersTable.name,
        modifierCategory: modifiersTable.category,
        modifierLayer: modifiersTable.layer,
      })
      .from(bidModifierSelections)
      .innerJoin(modifiersTable, eq(modifiersTable.id, bidModifierSelections.modifierId))
      .where(eq(bidModifierSelections.estimateLineItemId, lineItemId));

    res.json(saved);
  } catch (error) {
    logError("Save bid modifier selections error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from scopeItemRoutes.ts
// ========================================

const updateScopeItemSchema = insertScopeItemSchema.omit({ projectId: true }).partial();

function calculateBillingStatus(progressEntries: { billingStatus: string }[]): "NOT_READY" | "READY_TO_BILL" | "BILLED" {
  if (progressEntries.length === 0) {
    return "NOT_READY";
  }
  
  const hasNotReady = progressEntries.some(p => p.billingStatus === "NOT_READY");
  const hasReadyToBill = progressEntries.some(p => p.billingStatus === "READY_TO_BILL");
  const allBilled = progressEntries.every(p => p.billingStatus === "BILLED");
  
  if (allBilled) {
    return "BILLED";
  } else if (hasNotReady) {
    return "NOT_READY";
  } else if (hasReadyToBill) {
    return "READY_TO_BILL";
  } else {
    return "NOT_READY";
  }
}

async function syncMaterialBudgetsFromScopeItem(scopeItemId: string, completedQuantity: number) {
  try {
    const [scopeItem] = await db
      .select({ unit: scopeItems.unit })
      .from(scopeItems)
      .where(eq(scopeItems.id, scopeItemId))
      .limit(1);

    if (!scopeItem) return;

    const scopeUnit = (scopeItem.unit || "").toLowerCase().trim();

    const materialBudgets = await db
      .select()
      .from(projectMaterialBudgets)
      .where(eq(projectMaterialBudgets.scopeItemId, scopeItemId));

    for (const materialBudget of materialBudgets) {
      const materialUnit = (materialBudget.unit || "").toLowerCase().trim();
      
      if (scopeUnit !== materialUnit) {
        continue;
      }

      const budgetedQty = Number(materialBudget.budgetedQuantity || 0);
      const budgetedUnitCost = Number(materialBudget.budgetedUnitCost || 0);
      
      const actualQtyUsed = completedQuantity;
      const actualTotalCost = actualQtyUsed * budgetedUnitCost;
      
      const varianceQty = actualQtyUsed - budgetedQty;
      const variancePercent = budgetedQty > 0 ? (actualQtyUsed / budgetedQty) * 100 : 0;
      const shouldAlert = variancePercent >= Number(materialBudget.alertThresholdPercent || 90);
      const alertJustTriggered = shouldAlert && !materialBudget.alertTriggered;

      await db
        .update(projectMaterialBudgets)
        .set({
          actualQuantityUsed: actualQtyUsed.toString(),
          actualTotalCost: actualTotalCost.toFixed(2),
          varianceQuantity: varianceQty.toString(),
          variancePercent: variancePercent.toFixed(2),
          alertTriggered: shouldAlert,
          alertTriggeredAt: alertJustTriggered ? new Date() : materialBudget.alertTriggeredAt,
          updatedAt: new Date(),
        })
        .where(eq(projectMaterialBudgets.id, materialBudget.id));
    }
  } catch (error) {
    logError("Error syncing material budgets:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

router.get("/api/projects/:code/scope", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const items = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));

    const enrichedItems = await Promise.all(items.map(async (item) => {
      let sourceEstimate = null;
      
      if (item.estimateLineItemId) {
        const [lineItem] = await db
          .select({ estimateId: estimateLineItems.estimateId })
          .from(estimateLineItems)
          .where(eq(estimateLineItems.id, item.estimateLineItemId))
          .limit(1);
        
        if (lineItem?.estimateId) {
          const [estimate] = await db
            .select({ id: estimates.id, status: estimates.status, versionNumber: estimates.versionNumber })
            .from(estimates)
            .where(eq(estimates.id, lineItem.estimateId))
            .limit(1);
          
          if (estimate) {
            sourceEstimate = {
              id: estimate.id,
              status: estimate.status,
              versionNumber: estimate.versionNumber,
            };
          }
        }
      }
      
      return {
        ...item,
        sourceEstimate,
      };
    }));

    res.json(enrichedItems);
  } catch (error) {
    logError("Get scope items error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/projects/:code/scope", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const sanitizedBody = {
      ...req.body,
      description: sanitizeText(req.body.description),
    };

    const validationResult = insertScopeItemSchema.extend({
      projectId: z.string().optional(),
    }).safeParse({ ...sanitizedBody, projectId: project.id });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const insertData = { ...validationResult.data, projectId: project.id };
    const [newScopeItem] = await db.insert(scopeItems).values([insertData]).returning();
    res.status(201).json(newScopeItem);
  } catch (error: any) {
    logError("Create scope item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validationResult = updateScopeItemSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [oldItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.id));

    if (!oldItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const [parentProject] = await db.select().from(projects).where(eq(projects.id, oldItem.projectId)).limit(1);
    if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedItem] = await db
      .update(scopeItems)
      .set(updateData)
      .where(eq(scopeItems.id, req.params.id))
      .returning();

    if (!updatedItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    if (updatedItem.billingStatus === "READY_TO_BILL" && oldItem.billingStatus !== "READY_TO_BILL") {
      const orgConditions: SQL[] = [eq(users.role, "ADMIN")];
      if (parentProject.gcOrganizationId) {
        orgConditions.push(eq(users.organizationId, parentProject.gcOrganizationId));
      }
      const admins = await db
        .select()
        .from(users)
        .where(and(...orgConditions));
      
      const notificationsToCreate = admins.map(admin => ({
        userId: admin.id,
        type: "BILLING_READY" as const,
        title: "Scope Item Ready to Bill",
        message: `Scope item "${updatedItem.description}" is ready for billing`,
        relatedEntityId: updatedItem.id,
        relatedEntityType: "scopeItem",
        organizationId: parentProject.gcOrganizationId ?? req.user?.organizationId,
      }));

      if (notificationsToCreate.length > 0) {
        await insertNotifications(notificationsToCreate);
      }
    }

    res.json(updatedItem);
  } catch (error: any) {
    logError("Update scope item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [scopeItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.id))
      .limit(1);

    if (!scopeItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const [parentProject] = await db.select().from(projects).where(eq(projects.id, scopeItem.projectId)).limit(1);
    if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

    const userRole = req.user!.effectiveRole || req.user!.role;
    if (userRole === "SUPERINTENDENT" && parentProject.superintendentId !== req.user!.id) {
      res.status(403).json({ error: "You can only delete scope items from projects where you are the assigned superintendent" });
      return;
    }

    const [deletedItem] = await db
      .delete(scopeItems)
      .where(eq(scopeItems.id, req.params.id))
      .returning();

    res.json({ success: true });
  } catch (error) {
    logError("Delete scope item error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/scope-items/:id/materials", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const materialsSchema = z.object({
      actualConcreteYards: z.string().nullable().optional(),
      actualStoneTons: z.string().nullable().optional(),
      actualExcavationYards: z.string().nullable().optional(),
      materialResponsibility: z.enum(["TFR", "SUBCONTRACTOR", "CUSTOMER", "PENDING"]).optional(),
      overageActionStatus: z.enum(["NONE", "PENDING", "BILLED", "DEDUCTED", "ABSORBED", "RESOLVED"]).optional(),
      overageNotes: z.string().optional(),
    });

    const validationResult = materialsSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [scopeItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.id));

    if (!scopeItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const [parentProject] = await db.select().from(projects).where(eq(projects.id, scopeItem.projectId)).limit(1);
    if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

    const data = validationResult.data;
    const actualConcrete = Number(data.actualConcreteYards) || 0;
    const actualStone = Number(data.actualStoneTons) || 0;
    const actualExcavation = Number(data.actualExcavationYards) || 0;
    
    const estConcrete = Number(scopeItem.estimatedConcreteYards) || 0;
    const estStone = Number(scopeItem.estimatedStoneTons) || 0;
    const estExcavation = Number(scopeItem.estimatedExcavationYards) || 0;

    const hasConcreteOverage = estConcrete > 0 && actualConcrete > estConcrete;
    const hasStoneOverage = estStone > 0 && actualStone > estStone;
    const hasExcavationOverage = estExcavation > 0 && actualExcavation > estExcavation;
    const hasAnyOverage = hasConcreteOverage || hasStoneOverage || hasExcavationOverage;

    let overageActionStatus = data.overageActionStatus;
    if (hasAnyOverage && scopeItem.overageActionStatus === "NONE" && !overageActionStatus) {
      overageActionStatus = "PENDING";
    }

    const updateData: any = {
      actualConcreteYards: data.actualConcreteYards,
      actualStoneTons: data.actualStoneTons,
      actualExcavationYards: data.actualExcavationYards,
      materialResponsibility: data.materialResponsibility,
      overageActionStatus: overageActionStatus,
      overageNotes: data.overageNotes,
      updatedAt: new Date(),
    };

    if (overageActionStatus && overageActionStatus !== "NONE" && overageActionStatus !== "PENDING" && 
        scopeItem.overageActionStatus !== overageActionStatus) {
      updateData.overageResolvedById = req.user!.id;
      updateData.overageResolvedAt = new Date();
    }

    const [updatedItem] = await db
      .update(scopeItems)
      .set(updateData)
      .where(eq(scopeItems.id, req.params.id))
      .returning();

    if (hasAnyOverage && scopeItem.overageActionStatus === "NONE") {
      const managerConditions: SQL[] = [sql`${users.role} IN ('ADMIN', 'MANAGER')`];
      if (parentProject.gcOrganizationId) {
        managerConditions.push(eq(users.organizationId, parentProject.gcOrganizationId));
      }
      const managers = await db
        .select()
        .from(users)
        .where(and(...managerConditions));
      
      const overageDetails: string[] = [];
      if (hasConcreteOverage) {
        overageDetails.push(`Concrete: +${(actualConcrete - estConcrete).toFixed(2)} CY`);
      }
      if (hasStoneOverage) {
        overageDetails.push(`Stone: +${(actualStone - estStone).toFixed(2)} Tons`);
      }
      if (hasExcavationOverage) {
        overageDetails.push(`Excavation: +${(actualExcavation - estExcavation).toFixed(2)} CY`);
      }

      const notificationsToCreate = managers.map(manager => ({
        userId: manager.id,
        type: "MATERIAL_OVERAGE" as const,
        title: "Material Overage Detected",
        message: `Overage on "${scopeItem.description}": ${overageDetails.join(", ")}`,
        relatedEntityId: scopeItem.id,
        relatedEntityType: "scopeItem",
        organizationId: req.user?.organizationId,
      }));

      if (notificationsToCreate.length > 0) {
        await insertNotifications(notificationsToCreate);
      }
    }

    console.log(`Material update for scope item ${req.params.id} by user ${req.user!.id}:`, {
      actualMaterials: { actualConcrete, actualStone, actualExcavation },
      overages: { hasConcreteOverage, hasStoneOverage, hasExcavationOverage },
      actionStatus: overageActionStatus,
    });

    res.json(updatedItem);
  } catch (error: any) {
    logError("Update scope item materials error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:projectId/material-overages", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.projectId;
    
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const items = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.projectId, projectId));

    const overageItems = items.filter(item => {
      const estConcrete = Number(item.estimatedConcreteYards) || 0;
      const estStone = Number(item.estimatedStoneTons) || 0;
      const estExcavation = Number(item.estimatedExcavationYards) || 0;
      const actualConcrete = Number(item.actualConcreteYards) || 0;
      const actualStone = Number(item.actualStoneTons) || 0;
      const actualExcavation = Number(item.actualExcavationYards) || 0;

      return (
        (estConcrete > 0 && actualConcrete > estConcrete) ||
        (estStone > 0 && actualStone > estStone) ||
        (estExcavation > 0 && actualExcavation > estExcavation)
      );
    }).map(item => {
      const estConcrete = Number(item.estimatedConcreteYards) || 0;
      const estStone = Number(item.estimatedStoneTons) || 0;
      const estExcavation = Number(item.estimatedExcavationYards) || 0;
      const actualConcrete = Number(item.actualConcreteYards) || 0;
      const actualStone = Number(item.actualStoneTons) || 0;
      const actualExcavation = Number(item.actualExcavationYards) || 0;

      return {
        ...item,
        concreteVariance: actualConcrete - estConcrete,
        stoneVariance: actualStone - estStone,
        excavationVariance: actualExcavation - estExcavation,
        hasConcreteOverage: estConcrete > 0 && actualConcrete > estConcrete,
        hasStoneOverage: estStone > 0 && actualStone > estStone,
        hasExcavationOverage: estExcavation > 0 && actualExcavation > estExcavation,
      };
    });

    res.json({ overages: overageItems, count: overageItems.length });
  } catch (error) {
    logError("Get material overages error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/scope-items/:scopeItemId/progress", requireAuth, async (req: AuthRequest, res) => {
  try {
    const progressEntries = await db
      .select({
        progress: dailyScopeProgress,
        creator: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(dailyScopeProgress)
      .leftJoin(users, eq(dailyScopeProgress.createdById, users.id))
      .where(eq(dailyScopeProgress.scopeItemId, req.params.scopeItemId))
      .orderBy(desc(dailyScopeProgress.workDate), desc(dailyScopeProgress.createdAt));

    res.json(progressEntries);
  } catch (error) {
    logError("Get daily progress error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/scope-items/:scopeItemId/progress", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [scopeItem] = await db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.id, req.params.scopeItemId))
      .limit(1);

    if (!scopeItem) {
      res.status(404).json({ error: "Scope item not found" });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const validationResult = insertDailyScopeProgressSchema.safeParse({
      ...sanitizedBody,
      scopeItemId: req.params.scopeItemId,
      projectId: scopeItem.projectId,
      organizationSowItemId: scopeItem.organizationSowItemId || null,
      createdById: req.user!.id,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newProgress] = await db.insert(dailyScopeProgress).values([validationResult.data]).returning();

    const allProgress = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.scopeItemId, req.params.scopeItemId));

    const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
    const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
    const billingStatus = calculateBillingStatus(allProgress);

    await db
      .update(scopeItems)
      .set({
        completedQuantity: totalCompleted.toString(),
        billedQuantity: totalBilled.toString(),
        billingStatus,
        updatedAt: new Date(),
      })
      .where(eq(scopeItems.id, req.params.scopeItemId));

    await syncMaterialBudgetsFromScopeItem(req.params.scopeItemId, totalCompleted);

    try {
      const totalQty = parseFloat(scopeItem.totalQuantity) || 0;
      const previousCompleted = parseFloat(scopeItem.completedQuantity) || 0;
      const previousPercent = totalQty > 0 ? (previousCompleted / totalQty) * 100 : 0;
      const currentPercent = totalQty > 0 ? (totalCompleted / totalQty) * 100 : 0;

      const [project] = await db
        .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, scopeItem.projectId))
        .limit(1);

      if (project?.gcOrganizationId) {
        const officeManagers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, project.gcOrganizationId),
              eq(users.role),
              eq(users.isActive, true)
            )
          );

        if (officeManagers.length > 0) {
          const milestones = [25, 50, 75, 100];
          const crossedMilestones = milestones.filter(
            (m) => previousPercent < m && currentPercent >= m
          );

          if (crossedMilestones.length > 0) {
            const milestoneNotifs = crossedMilestones.flatMap((milestone) =>
              officeManagers.map((mgr) => ({
                userId: mgr.id,
                type: "PROGRESS_MILESTONE" as const,
                title: `${milestone}% Milestone Reached`,
                message: `"${scopeItem.description}" has reached ${milestone}% completion on project ${project.code || "Unknown"}`,
                relatedEntityId: project.id,
                relatedEntityType: "project" as const,
                organizationId: req.user?.organizationId,
              }))
            );
            await insertNotifications(milestoneNotifs);
          }

          const dailyNotifs = officeManagers.map((mgr) => ({
            userId: mgr.id,
            type: "DAILY_PROGRESS_LOGGED" as const,
            title: "Daily Progress Logged",
            message: `${newProgress.quantityCompleted} ${scopeItem.unit} logged for "${scopeItem.description}" on project ${project.code || "Unknown"}`,
            relatedEntityId: project.id,
            relatedEntityType: "project" as const,
            organizationId: req.user?.organizationId,
          }));
          await insertNotifications(dailyNotifs);
        }
      }
    } catch (notifError) {
      logError("Failed to create billing progress notifications:", {}, notifError instanceof Error ? notifError : new Error(String(notifError)));
    }

    res.status(201).json(newProgress);
  } catch (error: any) {
    logError("Create daily progress error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/scope-items/:scopeItemId/progress/:progressId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existingProgress] = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.id, req.params.progressId))
      .limit(1);

    if (!existingProgress) {
      res.status(404).json({ error: "Progress entry not found" });
      return;
    }

    const isCreator = existingProgress.createdById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(req.user!.role);
    
    if (!isCreator && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    if (sanitizedBody.billingStatus) {
      const validStatuses = ["NOT_READY", "READY_TO_BILL", "BILLED"];
      if (!validStatuses.includes(sanitizedBody.billingStatus)) {
        res.status(400).json({ error: "Invalid billing status. Must be one of: NOT_READY, READY_TO_BILL, BILLED" });
        return;
      }
    }

    const updateSchema = insertDailyScopeProgressSchema.omit({
      scopeItemId: true,
      projectId: true,
      createdById: true,
    }).partial();

    const validationResult = updateSchema.safeParse(sanitizedBody);

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const updateData: any = {
      ...validationResult.data,
      updatedAt: new Date(),
    };

    if (validationResult.data.billingStatus === "BILLED" && existingProgress.billingStatus !== "BILLED") {
      updateData.billedDate = new Date();
      updateData.billedById = req.user!.id;
    }

    const [updatedProgress] = await db
      .update(dailyScopeProgress)
      .set(updateData)
      .where(eq(dailyScopeProgress.id, req.params.progressId))
      .returning();

    if (validationResult.data.billingStatus === "READY_TO_BILL" && existingProgress.billingStatus !== "READY_TO_BILL") {
      try {
        const [scopeItem] = await db
          .select()
          .from(scopeItems)
          .where(eq(scopeItems.id, existingProgress.scopeItemId))
          .limit(1);

        if (scopeItem) {
          const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, existingProgress.projectId))
            .limit(1);

          const officeManagers = await db
            .select()
            .from(users)
            .where(eq(users.role));

          if (officeManagers.length > 0) {
            const notificationValues = officeManagers.map(manager => ({
              userId: manager.id,
              type: "BILLING_READY" as const,
              title: "Quantities Ready to Bill",
              message: `${scopeItem.description} (${updatedProgress.billedQuantity} ${scopeItem.unit}) is ready to bill on project ${project?.code || 'Unknown'}`,
              relatedEntityId: updatedProgress.id,
              relatedEntityType: "daily_scope_progress" as const,
              organizationId: req.user?.organizationId,
            }));
            
            await insertNotifications(notificationValues);
          }
        }
      } catch (notificationError) {
        logError("Failed to create notifications:", {}, notificationError instanceof Error ? notificationError : new Error(String(notificationError)));
      }
    }

    const allProgress = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.scopeItemId, existingProgress.scopeItemId));

    const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
    const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
    const billingStatus = calculateBillingStatus(allProgress);

    await db
      .update(scopeItems)
      .set({
        completedQuantity: totalCompleted.toString(),
        billedQuantity: totalBilled.toString(),
        billingStatus,
        updatedAt: new Date(),
      })
      .where(eq(scopeItems.id, existingProgress.scopeItemId));

    await syncMaterialBudgetsFromScopeItem(existingProgress.scopeItemId, totalCompleted);

    res.json(updatedProgress);
  } catch (error: any) {
    logError("Update daily progress error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/scope-items/:scopeItemId/progress/:progressId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existingProgress] = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.id, req.params.progressId))
      .limit(1);

    if (!existingProgress) {
      res.status(404).json({ error: "Progress entry not found" });
      return;
    }

    const isCreator = existingProgress.createdById === req.user!.id;
    const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(req.user!.role);
    
    if (!isCreator && !isAuthorized) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    await db.delete(dailyScopeProgress).where(eq(dailyScopeProgress.id, req.params.progressId));

    const allProgress = await db
      .select()
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.scopeItemId, existingProgress.scopeItemId));

    const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
    const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
    const billingStatus = calculateBillingStatus(allProgress);

    await db
      .update(scopeItems)
      .set({
        completedQuantity: totalCompleted.toString(),
        billedQuantity: totalBilled.toString(),
        billingStatus,
        updatedAt: new Date(),
      })
      .where(eq(scopeItems.id, existingProgress.scopeItemId));

    await syncMaterialBudgetsFromScopeItem(existingProgress.scopeItemId, totalCompleted);

    res.json({ success: true });
  } catch (error) {
    logError("Delete daily progress error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
