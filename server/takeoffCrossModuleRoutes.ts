import { Router } from "express";
import { safeJsonParse } from "./responseHelper";
import { db } from "./db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import {
  projects,
  takeoffSheets,
  takeoffMeasurements,
  quantityCategories,
  purchaseRequests,
  purchaseRequestItems,
  changeOrders,
  procurementItems,
  scheduleOfValues,
  sovLineItems,
} from "@shared/schema";

const router = Router();

async function getProjectWithAccess(req: AuthRequest, res: any, projectId: string) {
  const user = req.user!;
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const conditions = isSuperAdmin
    ? [eq(projects.id, projectId)]
    : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)];
  const [project] = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return project;
}

router.post(
  "/api/takeoff/convert-to-material-request",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const { measurementIds, projectId } = req.body;
      if (!projectId || !Array.isArray(measurementIds) || measurementIds.length === 0) {
        return res.status(400).json({ error: "projectId and measurementIds are required" });
      }
      const project = await getProjectWithAccess(req, res, projectId);
      if (!project) return;

      const projectSheets = await db
        .select({ id: takeoffSheets.id })
        .from(takeoffSheets)
        .where(eq(takeoffSheets.projectId, projectId));
      const projectSheetIds = projectSheets.map((s) => s.id);
      if (projectSheetIds.length === 0) {
        return res.status(400).json({ error: "No takeoff sheets found for this project" });
      }

      const measurements = await db
        .select({
          id: takeoffMeasurements.id,
          label: takeoffMeasurements.label,
          type: takeoffMeasurements.type,
          categoryId: takeoffMeasurements.categoryId,
          computedLengthFt: takeoffMeasurements.computedLengthFt,
          computedAreaFt2: takeoffMeasurements.computedAreaFt2,
          computedVolumeCy: takeoffMeasurements.computedVolumeCy,
          count: takeoffMeasurements.count,
          unitCost: takeoffMeasurements.unitCost,
          costCodeId: takeoffMeasurements.costCodeId,
          metadata: takeoffMeasurements.metadata,
        })
        .from(takeoffMeasurements)
        .where(and(
          inArray(takeoffMeasurements.id, measurementIds),
          inArray(takeoffMeasurements.sheetId, projectSheetIds)
        ));

      if (measurements.length === 0) {
        return res.status(404).json({ error: "No measurements found" });
      }

      const categoryIds = [...new Set(measurements.map((m) => m.categoryId).filter(Boolean))] as string[];
      const categories =
        categoryIds.length > 0
          ? await db.select().from(quantityCategories).where(inArray(quantityCategories.id, categoryIds))
          : [];
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      const prItems: Array<{
        description: string;
        category: string | null;
        quantity: string;
        unit: string;
        estimatedUnitCost: string;
        costCode: string;
      }> = [];

      let totalEstCost = 0;

      for (const m of measurements) {
        const cat = m.categoryId ? categoryMap.get(m.categoryId) : null;
        let quantity = 0;
        let unit = "EA";

        if (m.type === "LINEAR" && m.computedLengthFt) {
          quantity = m.computedLengthFt;
          unit = "LF";
        } else if (m.type === "AREA" && m.computedAreaFt2) {
          quantity = m.computedAreaFt2;
          unit = "SF";
        } else if (m.type === "VOLUME" && m.computedVolumeCy) {
          quantity = m.computedVolumeCy;
          unit = "CY";
        } else if (m.type === "COUNT" && m.count) {
          quantity = m.count;
          unit = "EA";
        } else {
          quantity = m.count || 1;
        }

        let metaUnit: string | undefined;
        if (m.metadata) {
          try {
            const parsed = safeJsonParse(m.metadata, null);
            if (parsed.unit) metaUnit = parsed.unit;
          } catch {}
        }
        if (metaUnit) unit = metaUnit;

        const unitCost = m.unitCost || cat?.unitCost || 0;
        const lineCost = quantity * unitCost;
        totalEstCost += lineCost;

        prItems.push({
          description: `${m.label}${cat ? ` (${cat.name})` : ""}`,
          category: cat?.name || null,
          quantity: String(quantity.toFixed(2)),
          unit,
          estimatedUnitCost: String(unitCost),
          costCode: m.costCodeId || "",
        });
      }

      const existingPRs = await db
        .select({ prNumber: purchaseRequests.prNumber })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.orgId, project.gcOrganizationId));
      const maxNum = existingPRs.reduce((max, pr) => {
        const match = pr.prNumber.match(/PR-(\d+)/);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);
      const prNumber = `PR-${String(maxNum + 1).padStart(3, "0")}`;

      const [pr] = await db
        .insert(purchaseRequests)
        .values({
          orgId: project.gcOrganizationId,
          projectId,
          requestedById: req.user!.id,
          prNumber,
          title: `Takeoff Material Request - ${measurements.length} item(s)`,
          status: "DRAFT",
          totalEstimatedCost: String(totalEstCost.toFixed(2)),
          notes: `Auto-generated from takeoff measurements. IDs: ${measurementIds.join(",")}`,
        })
        .returning();

      for (const item of prItems) {
        await db.insert(purchaseRequestItems).values({
          prId: pr.id,
          description: item.description,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          estimatedUnitCost: item.estimatedUnitCost,
          costCode: item.costCode,
        });
      }

      res.status(201).json({
        purchaseRequest: pr,
        itemCount: prItems.length,
        totalEstimatedCost: totalEstCost,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/takeoff/sheets/:sheetId/detect-changes",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const { sheetId } = req.params;

      const [currentSheet] = await db
        .select()
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, sheetId))
        .limit(1);
      if (!currentSheet) {
        return res.status(404).json({ error: "Sheet not found" });
      }

      const projectId = currentSheet.projectId;
      const bidId = currentSheet.bidId;
      if (!projectId && !bidId) {
        return res.status(400).json({ error: "Sheet not associated with a project or bid" });
      }

      if (projectId) {
        const project = await getProjectWithAccess(req, res, projectId);
        if (!project) return;
      }

      let predecessorSheet: any = null;
      if (currentSheet.isActive) {
        const allSheets = await db
          .select()
          .from(takeoffSheets)
          .where(
            projectId
              ? eq(takeoffSheets.projectId, projectId)
              : eq(takeoffSheets.bidId!, bidId!)
          );
        predecessorSheet = allSheets.find((s) => s.supersededById === currentSheet.id);
      }

      if (!predecessorSheet) {
        return res.json({ deltas: [], message: "No previous version found for comparison" });
      }

      const currentMeasurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sheetId, currentSheet.id));
      const oldMeasurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sheetId, predecessorSheet.id));

      const categoryIds = [
        ...new Set([...currentMeasurements, ...oldMeasurements].map((m) => m.categoryId).filter(Boolean)),
      ] as string[];
      const categories =
        categoryIds.length > 0
          ? await db.select().from(quantityCategories).where(inArray(quantityCategories.id, categoryIds))
          : [];
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      function getMeasurementValue(m: any): { value: number; unit: string } {
        if (m.type === "LINEAR" && m.computedLengthFt) return { value: m.computedLengthFt, unit: "LF" };
        if (m.type === "AREA" && m.computedAreaFt2) return { value: m.computedAreaFt2, unit: "SF" };
        if (m.type === "VOLUME" && m.computedVolumeCy) return { value: m.computedVolumeCy, unit: "CY" };
        if (m.type === "COUNT" && m.count) return { value: m.count, unit: "EA" };
        return { value: m.count || 1, unit: "EA" };
      }

      const oldByLabel = new Map<string, any[]>();
      for (const m of oldMeasurements) {
        const key = `${m.label}__${m.categoryId || "none"}`;
        if (!oldByLabel.has(key)) oldByLabel.set(key, []);
        oldByLabel.get(key)!.push(m);
      }

      const currentByLabel = new Map<string, any[]>();
      for (const m of currentMeasurements) {
        const key = `${m.label}__${m.categoryId || "none"}`;
        if (!currentByLabel.has(key)) currentByLabel.set(key, []);
        currentByLabel.get(key)!.push(m);
      }

      const deltas: any[] = [];
      const processedKeys = new Set<string>();

      for (const [key, curMeasures] of currentByLabel) {
        processedKeys.add(key);
        const oldMeasures = oldByLabel.get(key) || [];
        const curTotal = curMeasures.reduce((sum, m) => sum + getMeasurementValue(m).value, 0);
        const oldTotal = oldMeasures.reduce((sum, m) => sum + getMeasurementValue(m).value, 0);
        const diff = curTotal - oldTotal;

        if (Math.abs(diff) > 0.01) {
          const sample = curMeasures[0];
          const cat = sample.categoryId ? categoryMap.get(sample.categoryId) : null;
          const { unit } = getMeasurementValue(sample);
          const unitCost = sample.unitCost || cat?.unitCost || 0;
          deltas.push({
            label: sample.label,
            categoryName: cat?.name || "Uncategorized",
            categoryId: sample.categoryId,
            type: oldTotal === 0 ? "ADDED" : "CHANGED",
            oldQuantity: parseFloat(oldTotal.toFixed(2)),
            newQuantity: parseFloat(curTotal.toFixed(2)),
            quantityDiff: parseFloat(diff.toFixed(2)),
            unit,
            unitCost,
            costImpact: parseFloat((diff * unitCost).toFixed(2)),
            measurementIds: curMeasures.map((m: any) => m.id),
          });
        }
      }

      for (const [key, oldMeasures] of oldByLabel) {
        if (processedKeys.has(key)) continue;
        const sample = oldMeasures[0];
        const cat = sample.categoryId ? categoryMap.get(sample.categoryId) : null;
        const { value, unit } = getMeasurementValue(sample);
        const oldTotal = oldMeasures.reduce((sum, m) => sum + getMeasurementValue(m).value, 0);
        const unitCost = sample.unitCost || cat?.unitCost || 0;
        deltas.push({
          label: sample.label,
          categoryName: cat?.name || "Uncategorized",
          categoryId: sample.categoryId,
          type: "REMOVED",
          oldQuantity: parseFloat(oldTotal.toFixed(2)),
          newQuantity: 0,
          quantityDiff: parseFloat((-oldTotal).toFixed(2)),
          unit,
          unitCost,
          costImpact: parseFloat((-oldTotal * unitCost).toFixed(2)),
          measurementIds: [],
        });
      }

      res.json({
        deltas,
        currentSheetId: currentSheet.id,
        predecessorSheetId: predecessorSheet.id,
        currentSheetName: currentSheet.sheetName,
        predecessorSheetName: predecessorSheet.sheetName,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/takeoff/create-pco-from-delta",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const { projectId, deltas } = req.body;
      if (!projectId || !Array.isArray(deltas) || deltas.length === 0) {
        return res.status(400).json({ error: "projectId and deltas are required" });
      }
      const project = await getProjectWithAccess(req, res, projectId);
      if (!project) return;

      const allMeasurementIds = deltas.flatMap((d: any) => d.measurementIds || []).filter(Boolean);
      if (allMeasurementIds.length > 0) {
        const projectSheets = await db
          .select({ id: takeoffSheets.id })
          .from(takeoffSheets)
          .where(eq(takeoffSheets.projectId, projectId));
        const projectSheetIds = projectSheets.map((s) => s.id);
        if (projectSheetIds.length > 0) {
          const validMeasurements = await db
            .select({ id: takeoffMeasurements.id })
            .from(takeoffMeasurements)
            .where(and(
              inArray(takeoffMeasurements.id, allMeasurementIds),
              inArray(takeoffMeasurements.sheetId, projectSheetIds)
            ));
          const validIds = new Set(validMeasurements.map((m) => m.id));
          for (const d of deltas) {
            if (d.measurementIds) {
              d.measurementIds = d.measurementIds.filter((id: string) => validIds.has(id));
            }
          }
        }
      }

      const existingCOs = await db
        .select({ changeOrderNumber: changeOrders.changeOrderNumber })
        .from(changeOrders)
        .where(eq(changeOrders.projectId, projectId));
      const maxNum = existingCOs.reduce((max, co) => {
        const match = co.changeOrderNumber.match(/CO-(\d+)/);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);

      const totalCostImpact = deltas.reduce((sum: number, d: any) => sum + (d.costImpact || 0), 0);
      const changeDescription = deltas
        .map(
          (d: any) =>
            `${d.label} (${d.categoryName}): ${d.type === "ADDED" ? "Added" : d.type === "REMOVED" ? "Removed" : "Changed"} — ${d.oldQuantity} → ${d.newQuantity} ${d.unit} (Δ${d.quantityDiff > 0 ? "+" : ""}${d.quantityDiff}), Cost Impact: $${d.costImpact.toFixed(2)}`
        )
        .join("\n");

      const coNumber = `CO-${String(maxNum + 1).padStart(3, "0")}`;

      const [co] = await db
        .insert(changeOrders)
        .values({
          projectId,
          changeOrderNumber: coNumber,
          description: `Takeoff Revision Deltas:\n${changeDescription}\nMeasurement IDs: ${deltas.flatMap((d: any) => d.measurementIds || []).join(",")}`,
          amount: String(totalCostImpact.toFixed(2)),
          status: "PCO",
          requestedById: req.user!.id,
        })
        .returning();

      res.status(201).json({
        changeOrder: co,
        deltaCount: deltas.length,
        totalCostImpact,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/takeoff/projects/:projectId/generate-sov",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const { projectId } = req.params;
      const project = await getProjectWithAccess(req, res, projectId);
      if (!project) return;

      const allSheets = await db
        .select()
        .from(takeoffSheets)
        .where(and(eq(takeoffSheets.projectId, projectId), eq(takeoffSheets.isActive, true)));

      if (allSheets.length === 0) {
        return res.status(400).json({ error: "No active takeoff sheets found for this project" });
      }

      const sheetIds = allSheets.map((s) => s.id);
      const allMeasurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.sheetId, sheetIds));

      if (allMeasurements.length === 0) {
        return res.status(400).json({ error: "No measurements found on active sheets" });
      }

      const categoryIds = [...new Set(allMeasurements.map((m) => m.categoryId).filter(Boolean))] as string[];
      const categories =
        categoryIds.length > 0
          ? await db.select().from(quantityCategories).where(inArray(quantityCategories.id, categoryIds))
          : [];
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      interface CategoryAgg {
        categoryId: string | null;
        categoryName: string;
        totalQuantity: number;
        unit: string;
        unitCost: number;
        totalCost: number;
      }
      const aggregation = new Map<string, CategoryAgg>();

      for (const m of allMeasurements) {
        const catKey = m.categoryId || "__uncategorized__";
        const cat = m.categoryId ? categoryMap.get(m.categoryId) : null;
        let quantity = 0;
        let unit = "EA";

        if (m.type === "LINEAR" && m.computedLengthFt) {
          quantity = m.computedLengthFt;
          unit = "LF";
        } else if (m.type === "AREA" && m.computedAreaFt2) {
          quantity = m.computedAreaFt2;
          unit = "SF";
        } else if (m.type === "VOLUME" && m.computedVolumeCy) {
          quantity = m.computedVolumeCy;
          unit = "CY";
        } else if (m.type === "COUNT" && m.count) {
          quantity = m.count;
          unit = "EA";
        } else {
          quantity = m.count || 1;
        }

        const unitCost = m.unitCost || cat?.unitCost || 0;

        if (!aggregation.has(catKey)) {
          aggregation.set(catKey, {
            categoryId: m.categoryId,
            categoryName: cat?.name || "Uncategorized",
            totalQuantity: 0,
            unit,
            unitCost,
            totalCost: 0,
          });
        }
        const agg = aggregation.get(catKey)!;
        agg.totalQuantity += quantity;
        agg.totalCost += quantity * unitCost;
      }

      const existingSOVs = await db
        .select({ sovNumber: scheduleOfValues.sovNumber })
        .from(scheduleOfValues)
        .where(eq(scheduleOfValues.projectId, projectId));
      const maxSovNum = existingSOVs.reduce((max, s) => {
        const match = s.sovNumber.match(/SOV-(\d+)/);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);
      const sovNumber = `SOV-${String(maxSovNum + 1).padStart(3, "0")}`;

      const totalScheduledValue = [...aggregation.values()].reduce((sum, a) => sum + a.totalCost, 0);

      const [sov] = await db
        .insert(scheduleOfValues)
        .values({
          organizationId: project.gcOrganizationId,
          projectId,
          sovNumber,
          title: `Takeoff-Generated SOV`,
          description: `Auto-generated from takeoff categories (${aggregation.size} line items)`,
          contractValue: String(totalScheduledValue.toFixed(2)),
          status: "DRAFT",
          totalScheduledValue: String(totalScheduledValue.toFixed(2)),
          createdById: req.user!.id,
        })
        .returning();

      let lineNumber = 1;
      for (const [, agg] of aggregation) {
        await db.insert(sovLineItems).values({
          sovId: sov.id,
          lineNumber,
          itemCode: `${String(lineNumber).padStart(2, "0")}`,
          description: `${agg.categoryName} — ${agg.totalQuantity.toFixed(1)} ${agg.unit}`,
          category: agg.categoryName,
          scheduledValue: String(agg.totalCost.toFixed(2)),
          previouslyCompleted: "0",
          thisPeriodCompleted: "0",
          materialsStored: "0",
          totalCompletedAndStored: "0",
          percentComplete: "0",
          balanceToFinish: String(agg.totalCost.toFixed(2)),
          retainageAmount: "0",
        });
        lineNumber++;
      }

      res.status(201).json({
        sov,
        lineItemCount: aggregation.size,
        totalScheduledValue,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/api/takeoff/projects/:projectId/cost-summary",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { projectId } = req.params;
      const project = await getProjectWithAccess(req, res, projectId);
      if (!project) return;

      const allSheets = await db
        .select()
        .from(takeoffSheets)
        .where(and(eq(takeoffSheets.projectId, projectId), eq(takeoffSheets.isActive, true)));

      const sheetIds = allSheets.map((s) => s.id);
      const allMeasurements =
        sheetIds.length > 0
          ? await db.select().from(takeoffMeasurements).where(inArray(takeoffMeasurements.sheetId, sheetIds))
          : [];

      const categoryIds = [...new Set(allMeasurements.map((m) => m.categoryId).filter(Boolean))] as string[];
      const categories =
        categoryIds.length > 0
          ? await db.select().from(quantityCategories).where(inArray(quantityCategories.id, categoryIds))
          : [];
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      const projectProcurement = await db
        .select()
        .from(procurementItems)
        .where(eq(procurementItems.projectId, projectId));

      const projectCOs = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.projectId, projectId));

      const projectSOVs = await db
        .select()
        .from(scheduleOfValues)
        .where(eq(scheduleOfValues.projectId, projectId));

      interface ScopeArea {
        name: string;
        takeoffQty: number;
        unit: string;
        estimatedCost: number;
        budget: number;
        committed: number;
        actual: number;
        variance: number;
      }
      const scopeAreas = new Map<string, ScopeArea>();

      for (const m of allMeasurements) {
        const cat = m.categoryId ? categoryMap.get(m.categoryId) : null;
        const catName = cat?.name || "Uncategorized";
        let quantity = 0;
        let unit = "EA";

        if (m.type === "LINEAR" && m.computedLengthFt) {
          quantity = m.computedLengthFt;
          unit = "LF";
        } else if (m.type === "AREA" && m.computedAreaFt2) {
          quantity = m.computedAreaFt2;
          unit = "SF";
        } else if (m.type === "VOLUME" && m.computedVolumeCy) {
          quantity = m.computedVolumeCy;
          unit = "CY";
        } else if (m.type === "COUNT" && m.count) {
          quantity = m.count;
          unit = "EA";
        } else {
          quantity = m.count || 1;
        }

        const unitCost = m.unitCost || cat?.unitCost || 0;
        const estimated = quantity * unitCost;

        if (!scopeAreas.has(catName)) {
          scopeAreas.set(catName, {
            name: catName,
            takeoffQty: 0,
            unit,
            estimatedCost: 0,
            budget: 0,
            committed: 0,
            actual: 0,
            variance: 0,
          });
        }
        const area = scopeAreas.get(catName)!;
        area.takeoffQty += quantity;
        area.estimatedCost += estimated;
      }

      const committedFromPOs = projectProcurement
        .filter((p) => p.status !== "PLANNED")
        .reduce((sum, p) => sum + (parseFloat(p.quantity || "0") * parseFloat(p.unitCost || "0")), 0);

      const approvedCOAmount = projectCOs
        .filter((co) => co.status === "APPROVED")
        .reduce((sum, co) => sum + parseFloat(co.amount), 0);

      const totalTakeoffEstimate = [...scopeAreas.values()].reduce((s, a) => s + a.estimatedCost, 0);
      const totalBudget = parseFloat(project.budget || "0") || totalTakeoffEstimate;

      const summaryData = {
        scopeAreas: [...scopeAreas.values()].map((a) => ({
          ...a,
          takeoffQty: parseFloat(a.takeoffQty.toFixed(2)),
          estimatedCost: parseFloat(a.estimatedCost.toFixed(2)),
          budget: parseFloat(a.estimatedCost.toFixed(2)),
          variance: parseFloat((a.estimatedCost - a.actual).toFixed(2)),
        })),
        totals: {
          takeoffEstimate: parseFloat(totalTakeoffEstimate.toFixed(2)),
          budget: parseFloat(totalBudget.toFixed(2)),
          committed: parseFloat(committedFromPOs.toFixed(2)),
          approvedChanges: parseFloat(approvedCOAmount.toFixed(2)),
          actual: 0,
          variance: parseFloat((totalBudget - committedFromPOs).toFixed(2)),
        },
        counts: {
          measurements: allMeasurements.length,
          categories: categoryIds.length,
          procurementItems: projectProcurement.length,
          changeOrders: projectCOs.length,
          sovs: projectSOVs.length,
        },
      };

      res.json(summaryData);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/api/takeoff/projects/:projectId/measurement-links",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { projectId } = req.params;
      const project = await getProjectWithAccess(req, res, projectId);
      if (!project) return;

      const projectCOs = await db
        .select({
          id: changeOrders.id,
          description: changeOrders.description,
          status: changeOrders.status,
          changeOrderNumber: changeOrders.changeOrderNumber,
        })
        .from(changeOrders)
        .where(eq(changeOrders.projectId, projectId));

      const procurement = await db
        .select({
          id: procurementItems.id,
          description: procurementItems.description,
          status: procurementItems.status,
        })
        .from(procurementItems)
        .where(eq(procurementItems.projectId, projectId));

      const prs = await db
        .select({
          id: purchaseRequests.id,
          title: purchaseRequests.title,
          status: purchaseRequests.status,
          notes: purchaseRequests.notes,
        })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.projectId, projectId));

      const prMeasurementIds = new Set<string>();
      for (const pr of prs) {
        const match = (pr.notes || "").match(/IDs:\s*(.+)/);
        if (match) {
          match[1].split(",").filter(Boolean).forEach((id) => prMeasurementIds.add(id.trim()));
        }
      }

      const coMeasurementIds = new Set<string>();
      for (const co of projectCOs) {
        const match = (co.description || "").match(/Measurement IDs:\s*(.+)/);
        if (match) {
          match[1].split(",").filter(Boolean).forEach((id) => coMeasurementIds.add(id.trim()));
        }
      }

      const projectSOVs = await db
        .select({ id: scheduleOfValues.id })
        .from(scheduleOfValues)
        .where(eq(scheduleOfValues.projectId, projectId));

      const allSheets = await db
        .select()
        .from(takeoffSheets)
        .where(and(eq(takeoffSheets.projectId, projectId), eq(takeoffSheets.isActive, true)));
      const sheetIds = allSheets.map((s) => s.id);
      const sovMeasurementIds = new Set<string>();
      if (projectSOVs.length > 0 && sheetIds.length > 0) {
        const allMeasurements = await db
          .select({ id: takeoffMeasurements.id })
          .from(takeoffMeasurements)
          .where(inArray(takeoffMeasurements.sheetId, sheetIds));
        allMeasurements.forEach((m) => sovMeasurementIds.add(m.id));
      }

      res.json({
        changeOrders: projectCOs,
        procurementItems: procurement,
        purchaseRequests: prs,
        hasCrossModuleLinks: projectCOs.length > 0 || procurement.length > 0 || prs.length > 0,
        linkedMeasurementIds: {
          pr: [...prMeasurementIds],
          co: [...coMeasurementIds],
          sov: projectSOVs.length > 0 ? [...sovMeasurementIds] : [],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
