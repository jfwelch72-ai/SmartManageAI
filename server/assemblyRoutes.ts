import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import {
  takeoffAssemblies,
  takeoffAssemblyItems,
  takeoffMeasurementAssemblies,
  takeoffMeasurements,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, and, desc, asc } from "drizzle-orm";
import { z } from "zod";
import { computeAssemblyQuantity, type FormulaContext } from "@shared/utils/assemblyFormula";

const router = Router();

router.get("/api/assemblies", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization" });

    const rows = await db
      .select()
      .from(takeoffAssemblies)
      .where(eq(takeoffAssemblies.organizationId, orgId))
      .orderBy(desc(takeoffAssemblies.updatedAt));

    res.json(rows);
  } catch (error: any) {
    logError("List assemblies error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to list assemblies" });
  }
});

router.get("/api/assemblies/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization" });

    const [assembly] = await db
      .select()
      .from(takeoffAssemblies)
      .where(and(eq(takeoffAssemblies.id, req.params.id), eq(takeoffAssemblies.organizationId, orgId)));

    if (!assembly) return res.status(404).json({ error: "Assembly not found" });

    const items = await db
      .select()
      .from(takeoffAssemblyItems)
      .where(eq(takeoffAssemblyItems.assemblyId, assembly.id))
      .orderBy(asc(takeoffAssemblyItems.displayOrder));

    res.json({ ...assembly, items });
  } catch (error: any) {
    logError("Get assembly error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to get assembly" });
  }
});

const createAssemblySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  tradeType: z.string().optional(),
  measurementType: z.enum(["LINEAR", "AREA", "VOLUME", "COUNT"]).default("LINEAR"),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        unit: z.string().min(1),
        formula: z.string().min(1),
        wasteFactor: z.number().min(0).max(100).default(0),
        unitCost: z.string().optional(),
        displayOrder: z.number().int().min(0).default(0),
      })
    )
    .min(1),
});

router.post("/api/assemblies", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization" });

    const parsed = createAssemblySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { items, ...assemblyData } = parsed.data;

    const [assembly] = await db
      .insert(takeoffAssemblies)
      .values({ ...assemblyData, organizationId: orgId })
      .returning();

    const insertedItems = await db
      .insert(takeoffAssemblyItems)
      .values(items.map((item) => ({ ...item, assemblyId: assembly.id })))
      .returning();

    res.status(201).json({ ...assembly, items: insertedItems });
  } catch (error: any) {
    logError("Create assembly error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create assembly" });
  }
});

router.patch("/api/assemblies/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization" });

    const [existing] = await db
      .select()
      .from(takeoffAssemblies)
      .where(and(eq(takeoffAssemblies.id, req.params.id), eq(takeoffAssemblies.organizationId, orgId)));

    if (!existing) return res.status(404).json({ error: "Assembly not found" });

    const updateSchema = z.object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      tradeType: z.string().optional(),
      measurementType: z.enum(["LINEAR", "AREA", "VOLUME", "COUNT"]).optional(),
      isActive: z.boolean().optional(),
      items: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string().min(1),
            description: z.string().optional(),
            unit: z.string().min(1),
            formula: z.string().min(1),
            wasteFactor: z.number().min(0).max(100).default(0),
            unitCost: z.string().optional(),
            displayOrder: z.number().int().min(0).default(0),
          })
        )
        .optional(),
    });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { items, ...updateData } = parsed.data;

    const [updated] = await db
      .update(takeoffAssemblies)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(takeoffAssemblies.id, req.params.id))
      .returning();

    if (items) {
      await db.delete(takeoffAssemblyItems).where(eq(takeoffAssemblyItems.assemblyId, req.params.id));
      await db
        .insert(takeoffAssemblyItems)
        .values(items.map((item) => ({ ...item, assemblyId: req.params.id })));
    }

    const finalItems = await db
      .select()
      .from(takeoffAssemblyItems)
      .where(eq(takeoffAssemblyItems.assemblyId, req.params.id))
      .orderBy(asc(takeoffAssemblyItems.displayOrder));

    res.json({ ...updated, items: finalItems });
  } catch (error: any) {
    logError("Update assembly error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update assembly" });
  }
});

router.delete("/api/assemblies/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization" });

    const [existing] = await db
      .select()
      .from(takeoffAssemblies)
      .where(and(eq(takeoffAssemblies.id, req.params.id), eq(takeoffAssemblies.organizationId, orgId)));

    if (!existing) return res.status(404).json({ error: "Assembly not found" });

    await db.delete(takeoffAssemblies).where(eq(takeoffAssemblies.id, req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    logError("Delete assembly error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete assembly" });
  }
});

router.post("/api/takeoff/measurements/:measurementId/assemblies", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization" });

    const { assemblyId } = req.body;
    if (!assemblyId) return res.status(400).json({ error: "assemblyId required" });

    const [assembly] = await db
      .select()
      .from(takeoffAssemblies)
      .where(and(eq(takeoffAssemblies.id, assemblyId), eq(takeoffAssemblies.organizationId, orgId)));

    if (!assembly) return res.status(404).json({ error: "Assembly not found" });

    const [link] = await db
      .insert(takeoffMeasurementAssemblies)
      .values({ measurementId: req.params.measurementId, assemblyId })
      .returning();

    res.status(201).json(link);
  } catch (error: any) {
    logError("Link assembly error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to link assembly" });
  }
});

router.delete("/api/takeoff/measurement-assemblies/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .delete(takeoffMeasurementAssemblies)
      .where(eq(takeoffMeasurementAssemblies.id, req.params.id));

    res.json({ success: true });
  } catch (error: any) {
    logError("Unlink assembly error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to unlink assembly" });
  }
});

router.get("/api/takeoff/measurements/:measurementId/assembly-quantities", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [measurement] = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, req.params.measurementId));

    if (!measurement) return res.status(404).json({ error: "Measurement not found" });

    const links = await db
      .select()
      .from(takeoffMeasurementAssemblies)
      .where(eq(takeoffMeasurementAssemblies.measurementId, req.params.measurementId));

    if (links.length === 0) return res.json([]);

    const ctx: FormulaContext = {
      length: measurement.computedLengthFt ?? 0,
      area: measurement.computedAreaFt2 ?? 0,
      volume: measurement.computedVolumeCy ?? 0,
      count: measurement.count ?? 0,
      depth: measurement.depthFeet ?? 0,
    };

    const results = [];

    for (const link of links) {
      const [assembly] = await db
        .select()
        .from(takeoffAssemblies)
        .where(eq(takeoffAssemblies.id, link.assemblyId));

      if (!assembly) continue;

      const items = await db
        .select()
        .from(takeoffAssemblyItems)
        .where(eq(takeoffAssemblyItems.assemblyId, assembly.id))
        .orderBy(asc(takeoffAssemblyItems.displayOrder));

      const computed = items.map((item) => ({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        formula: item.formula,
        wasteFactor: item.wasteFactor,
        unitCost: item.unitCost,
        quantity: computeAssemblyQuantity(item.formula, ctx, item.wasteFactor),
        totalCost: item.unitCost
          ? computeAssemblyQuantity(item.formula, ctx, item.wasteFactor) * parseFloat(item.unitCost)
          : null,
      }));

      results.push({
        linkId: link.id,
        assemblyId: assembly.id,
        assemblyName: assembly.name,
        items: computed,
      });
    }

    res.json(results);
  } catch (error: any) {
    logError("Assembly quantities error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to compute assembly quantities" });
  }
});

export default router;
