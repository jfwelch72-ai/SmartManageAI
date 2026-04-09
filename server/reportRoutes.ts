import { logError } from "./utils/logger";
import { Router } from "express";
import { exportLimiter } from "./rateLimiter";
import { db } from "./db";
import {
  projects,
  estimates,
  estimateLineItems,
  takeoffSheets,
  takeoffMeasurements,
  quantityCategories,
} from "@shared/schema";
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
router.use("/api/reports", requireAuth, requireFeaturePermission('canAccessReports'));

function getProjectFilter(req: AuthRequest, projectId?: string) {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) return null;

  const conditions: any[] = [];
  if (shouldFilter && orgId) {
    conditions.push(eq(projects.gcOrganizationId, orgId));
  }
  if (projectId) {
    conditions.push(eq(projects.id, projectId));
  }
  return conditions;
}

router.get("/api/reports/takeoff/quantity", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select().from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      sheetId: takeoffMeasurements.sheetId,
      unitCost: takeoffMeasurements.unitCost,
      categoryId: takeoffMeasurements.categoryId,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const sheetMap = Object.fromEntries(sheets.map(s => [s.id, s]));

    const rows = measurements.map(m => {
      const sheet = sheetMap[m.sheetId];
      let quantity = 0;
      let unit = "EA";
      if (m.type === "LINEAR") { quantity = Number(m.computedLengthFt || 0); unit = "LF"; }
      else if (m.type === "AREA") { quantity = Number(m.computedAreaFt2 || 0); unit = "SF"; }
      else if (m.type === "VOLUME") { quantity = Number(m.computedVolumeCy || 0); unit = "CY"; }
      else if (m.type === "COUNT") { quantity = Number(m.count || 1); unit = "EA"; }
      return {
        id: m.id,
        description: m.label,
        quantity: Math.round(quantity * 100) / 100,
        unit,
        scale: sheet?.scalePxPerFoot ? `${Math.round(sheet.scalePxPerFoot * 100) / 100} px/ft` : "Not set",
        sheetName: sheet?.sheetName || "Unknown",
        type: m.type,
      };
    });

    res.json(rows);
  } catch (error) {
    logError("Error fetching takeoff quantity report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/takeoff/summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const summary: Record<string, { type: string; totalQuantity: number; unit: string; measurementCount: number }> = {};
    for (const m of measurements) {
      if (!summary[m.type]) {
        const unit = m.type === "LINEAR" ? "LF" : m.type === "AREA" ? "SF" : m.type === "VOLUME" ? "CY" : "EA";
        summary[m.type] = { type: m.type, totalQuantity: 0, unit, measurementCount: 0 };
      }
      summary[m.type].measurementCount++;
      if (m.type === "LINEAR") summary[m.type].totalQuantity += Number(m.computedLengthFt || 0);
      else if (m.type === "AREA") summary[m.type].totalQuantity += Number(m.computedAreaFt2 || 0);
      else if (m.type === "VOLUME") summary[m.type].totalQuantity += Number(m.computedVolumeCy || 0);
      else if (m.type === "COUNT") summary[m.type].totalQuantity += Number(m.count || 1);
    }

    const rows = Object.values(summary).map(s => ({
      ...s,
      totalQuantity: Math.round(s.totalQuantity * 100) / 100,
    }));

    res.json(rows);
  } catch (error) {
    logError("Error fetching takeoff summary report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/takeoff/by-takeoff", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select().from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      sheetId: takeoffMeasurements.sheetId,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const sheetMap = Object.fromEntries(sheets.map(s => [s.id, s]));
    const grouped: Record<string, { sheetName: string; measurements: any[] }> = {};

    for (const m of measurements) {
      const sheet = sheetMap[m.sheetId];
      const sheetName = sheet?.sheetName || "Unknown";
      if (!grouped[sheetName]) grouped[sheetName] = { sheetName, measurements: [] };
      let quantity = 0;
      let unit = "EA";
      if (m.type === "LINEAR") { quantity = Number(m.computedLengthFt || 0); unit = "LF"; }
      else if (m.type === "AREA") { quantity = Number(m.computedAreaFt2 || 0); unit = "SF"; }
      else if (m.type === "VOLUME") { quantity = Number(m.computedVolumeCy || 0); unit = "CY"; }
      else if (m.type === "COUNT") { quantity = Number(m.count || 1); unit = "EA"; }
      grouped[sheetName].measurements.push({
        id: m.id,
        description: m.label,
        quantity: Math.round(quantity * 100) / 100,
        unit,
        type: m.type,
      });
    }

    res.json(Object.values(grouped));
  } catch (error) {
    logError("Error fetching takeoff by-takeoff report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/takeoff/items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const seen = new Map<string, any>();
    for (const m of measurements) {
      const key = `${m.label}-${m.type}`;
      if (!seen.has(key)) {
        const unit = m.type === "LINEAR" ? "LF" : m.type === "AREA" ? "SF" : m.type === "VOLUME" ? "CY" : "EA";
        seen.set(key, { description: m.label, type: m.type, unit });
      }
    }

    res.json(Array.from(seen.values()));
  } catch (error) {
    logError("Error fetching takeoff items report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/takeoff/item-cost", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      unitCost: takeoffMeasurements.unitCost,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const rows = measurements.map(m => {
      let quantity = 0;
      let unit = "EA";
      if (m.type === "LINEAR") { quantity = Number(m.computedLengthFt || 0); unit = "LF"; }
      else if (m.type === "AREA") { quantity = Number(m.computedAreaFt2 || 0); unit = "SF"; }
      else if (m.type === "VOLUME") { quantity = Number(m.computedVolumeCy || 0); unit = "CY"; }
      else if (m.type === "COUNT") { quantity = Number(m.count || 1); unit = "EA"; }
      const unitCost = Number(m.unitCost || 0);
      return {
        id: m.id,
        description: m.label,
        quantity: Math.round(quantity * 100) / 100,
        unit,
        unitCost: Math.round(unitCost * 100) / 100,
        totalCost: Math.round(quantity * unitCost * 100) / 100,
      };
    });

    res.json(rows);
  } catch (error) {
    logError("Error fetching takeoff item-cost report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/takeoff/item-cost-by-type", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      unitCost: takeoffMeasurements.unitCost,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const grouped: Record<string, { type: string; items: any[]; subtotal: number }> = {};
    for (const m of measurements) {
      if (!grouped[m.type]) grouped[m.type] = { type: m.type, items: [], subtotal: 0 };
      let quantity = 0;
      let unit = "EA";
      if (m.type === "LINEAR") { quantity = Number(m.computedLengthFt || 0); unit = "LF"; }
      else if (m.type === "AREA") { quantity = Number(m.computedAreaFt2 || 0); unit = "SF"; }
      else if (m.type === "VOLUME") { quantity = Number(m.computedVolumeCy || 0); unit = "CY"; }
      else if (m.type === "COUNT") { quantity = Number(m.count || 1); unit = "EA"; }
      const unitCost = Number(m.unitCost || 0);
      const totalCost = quantity * unitCost;
      grouped[m.type].items.push({
        id: m.id,
        description: m.label,
        quantity: Math.round(quantity * 100) / 100,
        unit,
        unitCost: Math.round(unitCost * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
      });
      grouped[m.type].subtotal += totalCost;
    }

    const result = Object.values(grouped).map(g => ({
      ...g,
      subtotal: Math.round(g.subtotal * 100) / 100,
    }));

    res.json(result);
  } catch (error) {
    logError("Error fetching takeoff item-cost-by-type report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/takeoff/item-cost-by-takeoff", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const projectRows = await db.select({ id: projects.id }).from(projects).where(projectCondition);
    const projectIds = projectRows.map(p => p.id);
    if (projectIds.length === 0) return res.json([]);

    const sheets = await db.select().from(takeoffSheets)
      .where(inArray(takeoffSheets.projectId, projectIds));
    const sheetIds = sheets.map(s => s.id);
    if (sheetIds.length === 0) return res.json([]);

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      unitCost: takeoffMeasurements.unitCost,
      sheetId: takeoffMeasurements.sheetId,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const sheetMap = Object.fromEntries(sheets.map(s => [s.id, s]));
    const grouped: Record<string, { sheetName: string; items: any[]; subtotal: number }> = {};

    for (const m of measurements) {
      const sheet = sheetMap[m.sheetId];
      const sheetName = sheet?.sheetName || "Unknown";
      if (!grouped[sheetName]) grouped[sheetName] = { sheetName, items: [], subtotal: 0 };
      let quantity = 0;
      let unit = "EA";
      if (m.type === "LINEAR") { quantity = Number(m.computedLengthFt || 0); unit = "LF"; }
      else if (m.type === "AREA") { quantity = Number(m.computedAreaFt2 || 0); unit = "SF"; }
      else if (m.type === "VOLUME") { quantity = Number(m.computedVolumeCy || 0); unit = "CY"; }
      else if (m.type === "COUNT") { quantity = Number(m.count || 1); unit = "EA"; }
      const unitCost = Number(m.unitCost || 0);
      const totalCost = quantity * unitCost;
      grouped[sheetName].items.push({
        id: m.id,
        description: m.label,
        quantity: Math.round(quantity * 100) / 100,
        unit,
        unitCost: Math.round(unitCost * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
      });
      grouped[sheetName].subtotal += totalCost;
    }

    const result = Object.values(grouped).map(g => ({
      ...g,
      subtotal: Math.round(g.subtotal * 100) / 100,
    }));

    res.json(result);
  } catch (error) {
    logError("Error fetching takeoff item-cost-by-takeoff report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/estimates/summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) return res.json([]);

    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json([]);

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const [project] = await db.select().from(projects).where(projectCondition).limit(1);
    if (!project) return res.json([]);

    const estimate = await db.select().from(estimates)
      .where(and(
        eq(estimates.projectId, projectId),
        sql`${estimates.status} IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')`
      ))
      .orderBy(desc(estimates.createdAt))
      .limit(1);

    if (estimate.length === 0) return res.json([]);

    const lineItems = await db.select().from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimate[0].id));

    const rows = lineItems.map(item => ({
      id: item.id,
      category: item.category,
      description: item.description,
      quantity: Number(item.quantity || 0),
      unit: item.unit || "EA",
      materialCost: Number(item.materialCost || 0),
      laborCost: Number(item.laborCost || 0),
      equipmentCost: Number(item.equipmentCost || 0),
      totalCost: Number(item.totalCost || 0),
    }));

    res.json(rows);
  } catch (error) {
    logError("Error fetching estimate summary report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/estimates/cost-breakdown", requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) return res.json({ categories: [], grandTotal: 0 });

    const conditions = getProjectFilter(req, projectId);
    if (!conditions) return res.json({ categories: [], grandTotal: 0 });

    const projectCondition = conditions.length > 0 ? and(...conditions) : undefined;
    const [project] = await db.select().from(projects).where(projectCondition).limit(1);
    if (!project) return res.json({ categories: [], grandTotal: 0 });

    const estimate = await db.select().from(estimates)
      .where(and(
        eq(estimates.projectId, projectId),
        sql`${estimates.status} IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')`
      ))
      .orderBy(desc(estimates.createdAt))
      .limit(1);

    if (estimate.length === 0) return res.json({ categories: [], grandTotal: 0 });

    const lineItems = await db.select().from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimate[0].id));

    const categoryTotals: Record<string, number> = {};
    let grandTotal = 0;

    for (const item of lineItems) {
      const cat = item.category || "GENERAL";
      const cost = Number(item.totalCost || 0);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + cost;
      grandTotal += cost;
    }

    const categories = Object.entries(categoryTotals).map(([category, subtotal]) => ({
      category,
      subtotal: Math.round(subtotal * 100) / 100,
      percentage: grandTotal > 0 ? Math.round((subtotal / grandTotal) * 10000) / 100 : 0,
    }));

    res.json({
      categories,
      grandTotal: Math.round(grandTotal * 100) / 100,
    });
  } catch (error) {
    logError("Error fetching estimate cost-breakdown report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/export/csv", requireAuth, exportLimiter, async (req: AuthRequest, res) => {
  try {
    const reportType = req.query.type as string;
    const projectId = req.query.projectId as string | undefined;

    if (!reportType) {
      return res.status(400).json({ error: "Report type is required" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    let data: any;

    const fetchReport = async (path: string) => {
      const url = new URL(path, baseUrl);
      if (projectId) url.searchParams.set("projectId", projectId);

      const internalRes = await fetch(url.toString(), {
        headers: {
          cookie: req.headers.cookie || "",
        },
      });
      return internalRes.json();
    };

    switch (reportType) {
      case "takeoff-quantity":
        data = await fetchReport("/api/reports/takeoff/quantity");
        break;
      case "takeoff-summary":
        data = await fetchReport("/api/reports/takeoff/summary");
        break;
      case "takeoff-items":
        data = await fetchReport("/api/reports/takeoff/items");
        break;
      case "takeoff-item-cost":
        data = await fetchReport("/api/reports/takeoff/item-cost");
        break;
      case "estimate-summary":
        data = await fetchReport("/api/reports/estimates/summary");
        break;
      case "estimate-cost-breakdown": {
        const result = await fetchReport("/api/reports/estimates/cost-breakdown");
        data = result.categories || [];
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown report type: ${reportType}` });
    }

    if (!Array.isArray(data) || data.length === 0) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${reportType}-report.csv"`);
      return res.send("No data available");
    }

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(","),
      ...data.map((row: any) =>
        headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(",")
      ),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}-report.csv"`);
    res.send(csvRows.join("\n"));
  } catch (error) {
    logError("Error exporting CSV:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/reports/export/pdf", requireAuth, exportLimiter, async (_req: AuthRequest, res) => {
  res.status(200).json({
    message: "PDF export is handled via browser print (window.print()). Use the Print button in the Reports UI.",
  });
});

export default router;
