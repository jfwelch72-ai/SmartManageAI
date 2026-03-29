import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import {
  assetHandoverItems, assetHandoverSignoffs, maintenanceLogs, maintenanceRecurringSchedules,
  projects,
  insertHandoverItemSchema, insertHandoverSignoffSchema,
  insertMaintenanceLogSchema, insertMaintenanceRecurringScheduleSchema,
  type HandoverItem, type MaintenanceLog, type MaintenanceRecurringSchedule,
} from "@shared/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { requireAuth, requireRole, type AuthRequest, type UserRole } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const MANAGEMENT_ROLES: UserRole[] = [
  "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER",
  "OFFICE_MANAGER", "SAFETY_MANAGER",
];

const VALID_HANDOVER_STATUSES = ["PENDING", "COMPLETE", "NOT_APPLICABLE"] as const;
const VALID_MAINTENANCE_TYPES = ["PREVENTIVE", "CORRECTIVE", "EMERGENCY"] as const;
const VALID_MAINTENANCE_SYSTEMS = ["HVAC", "PLUMBING", "ELECTRICAL", "ROOFING", "STRUCTURAL", "FIRE_PROTECTION", "ELEVATOR", "LANDSCAPING", "GENERAL", "OTHER"] as const;
const VALID_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"] as const;

function isValidEnum<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

async function verifyProjectAccess(code: string, req: AuthRequest, res: Response) {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return null; }
  const project = await getProjectByCode(code);
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }
  if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
    res.status(403).json({ error: "Access denied" }); return null;
  }
  return project;
}

async function isHandoverComplete(projectId: string): Promise<boolean> {
  const signoffs = await db.select({ role: assetHandoverSignoffs.role })
    .from(assetHandoverSignoffs)
    .where(eq(assetHandoverSignoffs.projectId, projectId));
  const hasContractor = signoffs.some(s => s.role === "CONTRACTOR");
  const hasOwner = signoffs.some(s => s.role === "OWNER");
  return hasContractor && hasOwner;
}

async function requireHandoverComplete(projectId: string, res: Response): Promise<boolean> {
  const complete = await isHandoverComplete(projectId);
  if (!complete) {
    res.status(403).json({ error: "Handover must be completed (both contractor and owner signoff) before this action is allowed." });
    return false;
  }
  return true;
}

// ─── HANDOVER ITEMS ───────────────────────────────────────────────────────────

router.get("/projects/:code/handover/items", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await verifyProjectAccess(req.params.code, req, res);
    if (!project) return;
    const items = await db.select().from(assetHandoverItems)
      .where(eq(assetHandoverItems.projectId, project.id))
      .orderBy(assetHandoverItems.sortOrder, assetHandoverItems.createdAt);
    res.json(items);
  } catch (err) {
    logError("Error listing handover items:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to fetch handover items" });
  }
});

router.post(
  "/projects/:code/handover/items",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const userId = req.user!.id;
      const body = {
        ...req.body,
        projectId: project.id,
        createdById: userId,
        title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : null,
        category: req.body.category ? sanitizeShortText(req.body.category) : undefined,
      };
      const parsed = insertHandoverItemSchema.safeParse(body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      const [item] = await db.insert(assetHandoverItems).values(parsed.data).returning();
      await logAudit({ userId, action: "CREATE", entityType: "handoverItem", entityId: item.id, newValue: JSON.stringify({ title: item.title }) }, req);
      res.status(201).json(item);
    } catch (err) {
      logError("Error creating handover item:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create handover item" });
    }
  },
);

router.patch(
  "/projects/:code/handover/items/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const [existing] = await db.select().from(assetHandoverItems)
        .where(and(eq(assetHandoverItems.id, req.params.id), eq(assetHandoverItems.projectId, project.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Handover item not found" });

      if (req.body.status !== undefined && !isValidEnum(req.body.status, VALID_HANDOVER_STATUSES)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_HANDOVER_STATUSES.join(", ")}` });
      }

      const update: Partial<typeof assetHandoverItems.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
      if (req.body.title !== undefined) update.title = sanitizeShortText(req.body.title);
      if (req.body.description !== undefined) update.description = req.body.description ? sanitizeText(req.body.description) : null;
      if (req.body.category !== undefined) update.category = sanitizeShortText(req.body.category);
      if (req.body.documentUrl !== undefined) update.documentUrl = req.body.documentUrl;
      if (req.body.documentFilename !== undefined) update.documentFilename = req.body.documentFilename;
      if (req.body.sortOrder !== undefined) update.sortOrder = req.body.sortOrder;
      if (req.body.status !== undefined) {
        update.status = req.body.status;
        if (req.body.status === "COMPLETE") {
          update.completedAt = new Date();
          update.completedById = req.user!.id;
        } else {
          update.completedAt = null;
          update.completedById = null;
        }
      }

      const [updated] = await db.update(assetHandoverItems).set(update).where(eq(assetHandoverItems.id, req.params.id)).returning();
      await logAudit({ userId: req.user!.id, action: "UPDATE", entityType: "handoverItem", entityId: updated.id, newValue: JSON.stringify({ changes: Object.keys(update) }) }, req);
      res.json(updated);
    } catch (err) {
      logError("Error updating handover item:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to update handover item" });
    }
  },
);

router.delete(
  "/projects/:code/handover/items/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const [existing] = await db.select().from(assetHandoverItems)
        .where(and(eq(assetHandoverItems.id, req.params.id), eq(assetHandoverItems.projectId, project.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Handover item not found" });
      await db.delete(assetHandoverItems).where(eq(assetHandoverItems.id, req.params.id));
      await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "handoverItem", entityId: existing.id, oldValue: JSON.stringify({ title: existing.title }) }, req);
      res.status(204).send();
    } catch (err) {
      logError("Error deleting handover item:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to delete handover item" });
    }
  },
);

// ─── HANDOVER EXPORT ──────────────────────────────────────────────────────────

router.get("/projects/:code/handover/export", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await verifyProjectAccess(req.params.code, req, res);
    if (!project) return;
    const items = await db.select().from(assetHandoverItems)
      .where(eq(assetHandoverItems.projectId, project.id))
      .orderBy(assetHandoverItems.sortOrder);
    const signoffs = await db.select().from(assetHandoverSignoffs)
      .where(eq(assetHandoverSignoffs.projectId, project.id));

    const categories = [...new Set(items.map(i => i.category))];
    const completedCount = items.filter(i => i.status === "COMPLETE").length;
    const applicableCount = items.filter(i => i.status !== "NOT_APPLICABLE").length;

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    const PRIMARY = "#1a365d";
    const GRAY = "#6b7280";
    const GREEN = "#16a34a";

    doc.fontSize(22).fillColor(PRIMARY).text("Asset Handover Summary", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor(GRAY).text(`Project: ${project.name} (${project.code})`, { align: "center" });
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#111").text(`Progress: ${completedCount} of ${applicableCount} items complete (${applicableCount > 0 ? Math.round((completedCount / applicableCount) * 100) : 0}%)`);
    doc.moveDown(0.3);

    const barY = doc.y;
    const barW = 500;
    const barH = 12;
    const pct = applicableCount > 0 ? completedCount / applicableCount : 0;
    doc.rect(50, barY, barW, barH).fillColor("#e5e7eb").fill();
    if (pct > 0) doc.rect(50, barY, barW * pct, barH).fillColor(GREEN).fill();
    doc.y = barY + barH + 15;

    for (const cat of categories) {
      doc.moveDown(0.3);
      doc.fontSize(13).fillColor(PRIMARY).text(cat);
      doc.moveDown(0.2);

      const catItems = items.filter(i => i.category === cat);
      for (const item of catItems) {
        const icon = item.status === "COMPLETE" ? "✓" : item.status === "NOT_APPLICABLE" ? "N/A" : "○";
        const color = item.status === "COMPLETE" ? GREEN : item.status === "NOT_APPLICABLE" ? GRAY : "#111";
        doc.fontSize(10).fillColor(color);
        let line = `  ${icon}  ${item.title}`;
        if (item.completedAt) line += `  (${new Date(item.completedAt).toLocaleDateString()})`;
        if (item.documentFilename) line += `  — ${item.documentFilename}`;
        doc.text(line);
        if (item.description) {
          doc.fontSize(9).fillColor(GRAY).text(`       ${item.description}`);
        }
      }
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#d1d5db").stroke();
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor(PRIMARY).text("Signoffs");
    doc.moveDown(0.3);

    const contractor = signoffs.find(s => s.role === "CONTRACTOR");
    const owner = signoffs.find(s => s.role === "OWNER");

    doc.fontSize(11).fillColor("#111");
    doc.text(`Contractor: ${contractor ? `${contractor.signedByName} — ${new Date(contractor.signedAt).toLocaleDateString()}` : "Pending"}`);
    if (contractor?.notes) doc.fontSize(9).fillColor(GRAY).text(`  Notes: ${contractor.notes}`);
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor("#111");
    doc.text(`Owner / Client: ${owner ? `${owner.signedByName} — ${new Date(owner.signedAt).toLocaleDateString()}` : "Pending"}`);
    if (owner?.notes) doc.fontSize(9).fillColor(GRAY).text(`  Notes: ${owner.notes}`);

    if (contractor && owner) {
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor(GREEN).text("✓ Handover Complete — Both parties have signed off.", { align: "center" });
    }

    doc.end();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="handover-summary-${project.code}.pdf"`);
    stream.pipe(res);
  } catch (err) {
    logError("Error exporting handover:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to export handover summary" });
  }
});

// ─── HANDOVER SIGNOFFS ────────────────────────────────────────────────────────

router.get("/projects/:code/handover/signoffs", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await verifyProjectAccess(req.params.code, req, res);
    if (!project) return;
    const signoffs = await db.select().from(assetHandoverSignoffs)
      .where(eq(assetHandoverSignoffs.projectId, project.id));
    res.json(signoffs);
  } catch (err) {
    logError("Error listing signoffs:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to fetch signoffs" });
  }
});

router.post(
  "/projects/:code/handover/signoffs",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const userId = req.user!.id;
      const userName = `${req.user!.firstName} ${req.user!.lastName}`.trim() || userId;
      const role = req.body.role;
      if (!role || !["CONTRACTOR", "OWNER"].includes(role)) {
        return res.status(400).json({ error: "Role must be CONTRACTOR or OWNER" });
      }
      const existingSignoffs = await db.select().from(assetHandoverSignoffs)
        .where(eq(assetHandoverSignoffs.projectId, project.id));
      if (existingSignoffs.some(s => s.role === role)) {
        return res.status(409).json({ error: `${role} has already signed off` });
      }
      const otherRole = role === "CONTRACTOR" ? "OWNER" : "CONTRACTOR";
      const otherSignoff = existingSignoffs.find(s => s.role === otherRole);
      if (otherSignoff && otherSignoff.signedByUserId === userId) {
        return res.status(403).json({ error: "The same user cannot sign off as both contractor and owner. A different authorized user must complete the other signoff." });
      }

      const body = {
        projectId: project.id,
        role,
        signedByUserId: userId,
        signedByName: userName,
        notes: req.body.notes ? sanitizeText(req.body.notes) : null,
      };
      const parsed = insertHandoverSignoffSchema.safeParse(body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      const [signoff] = await db.insert(assetHandoverSignoffs).values(parsed.data).returning();
      await logAudit({ userId, action: "CREATE", entityType: "handoverSignoff", entityId: signoff.id, newValue: JSON.stringify({ role, projectId: project.id }) }, req);
      res.status(201).json(signoff);
    } catch (err) {
      logError("Error creating signoff:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create signoff" });
    }
  },
);

// ─── MAINTENANCE LOGS ─────────────────────────────────────────────────────────

router.get("/projects/:code/maintenance/logs", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await verifyProjectAccess(req.params.code, req, res);
    if (!project) return;
    const conditions: ReturnType<typeof eq>[] = [eq(maintenanceLogs.projectId, project.id)];
    const { type, system, dateFrom, dateTo } = req.query;
    if (type && typeof type === "string" && type !== "all") {
      conditions.push(eq(maintenanceLogs.type, type as MaintenanceLog["type"]));
    }
    if (system && typeof system === "string" && system !== "all") {
      conditions.push(eq(maintenanceLogs.system, system as MaintenanceLog["system"]));
    }
    if (dateFrom && typeof dateFrom === "string") {
      conditions.push(gte(maintenanceLogs.date, new Date(dateFrom)));
    }
    if (dateTo && typeof dateTo === "string") {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(maintenanceLogs.date, end));
    }
    const logs = await db.select().from(maintenanceLogs)
      .where(and(...conditions))
      .orderBy(desc(maintenanceLogs.date));
    res.json(logs);
  } catch (err) {
    logError("Error listing maintenance logs:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to fetch maintenance logs" });
  }
});

router.post(
  "/projects/:code/maintenance/logs",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      if (!(await requireHandoverComplete(project.id, res))) return;
      const userId = req.user!.id;
      const body = {
        ...req.body,
        projectId: project.id,
        createdById: userId,
        title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : null,
        vendorName: req.body.vendorName ? sanitizeShortText(req.body.vendorName) : null,
        date: req.body.date ? new Date(req.body.date) : undefined,
      };
      const parsed = insertMaintenanceLogSchema.safeParse(body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      const [log] = await db.insert(maintenanceLogs).values(parsed.data).returning();
      await logAudit({ userId, action: "CREATE", entityType: "maintenanceLog", entityId: log.id, newValue: JSON.stringify({ title: log.title }) }, req);
      res.status(201).json(log);
    } catch (err) {
      logError("Error creating maintenance log:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create maintenance log" });
    }
  },
);

router.patch(
  "/projects/:code/maintenance/logs/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const [existing] = await db.select().from(maintenanceLogs)
        .where(and(eq(maintenanceLogs.id, req.params.id), eq(maintenanceLogs.projectId, project.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Maintenance log not found" });

      if (req.body.type !== undefined && !isValidEnum(req.body.type, VALID_MAINTENANCE_TYPES)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_MAINTENANCE_TYPES.join(", ")}` });
      }
      if (req.body.system !== undefined && !isValidEnum(req.body.system, VALID_MAINTENANCE_SYSTEMS)) {
        return res.status(400).json({ error: `Invalid system. Must be one of: ${VALID_MAINTENANCE_SYSTEMS.join(", ")}` });
      }

      const update: Partial<typeof maintenanceLogs.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
      if (req.body.title !== undefined) update.title = sanitizeShortText(req.body.title);
      if (req.body.description !== undefined) update.description = req.body.description ? sanitizeText(req.body.description) : null;
      if (req.body.type !== undefined) update.type = req.body.type;
      if (req.body.system !== undefined) update.system = req.body.system;
      if (req.body.date !== undefined) update.date = new Date(req.body.date);
      if (req.body.cost !== undefined) update.cost = req.body.cost;
      if (req.body.vendorName !== undefined) update.vendorName = req.body.vendorName ? sanitizeShortText(req.body.vendorName) : null;
      if (req.body.documentUrl !== undefined) update.documentUrl = req.body.documentUrl;
      if (req.body.documentFilename !== undefined) update.documentFilename = req.body.documentFilename;

      const [updated] = await db.update(maintenanceLogs).set(update).where(eq(maintenanceLogs.id, req.params.id)).returning();
      await logAudit({ userId: req.user!.id, action: "UPDATE", entityType: "maintenanceLog", entityId: updated.id, newValue: JSON.stringify({ changes: Object.keys(update) }) }, req);
      res.json(updated);
    } catch (err) {
      logError("Error updating maintenance log:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to update maintenance log" });
    }
  },
);

router.delete(
  "/projects/:code/maintenance/logs/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const [existing] = await db.select().from(maintenanceLogs)
        .where(and(eq(maintenanceLogs.id, req.params.id), eq(maintenanceLogs.projectId, project.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Maintenance log not found" });
      await db.delete(maintenanceLogs).where(eq(maintenanceLogs.id, req.params.id));
      await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "maintenanceLog", entityId: existing.id, oldValue: JSON.stringify({ title: existing.title }) }, req);
      res.status(204).send();
    } catch (err) {
      logError("Error deleting maintenance log:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to delete maintenance log" });
    }
  },
);

// ─── MAINTENANCE COST SUMMARY ─────────────────────────────────────────────────

router.get("/projects/:code/maintenance/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await verifyProjectAccess(req.params.code, req, res);
    if (!project) return;
    const logs = await db.select().from(maintenanceLogs)
      .where(eq(maintenanceLogs.projectId, project.id));

    const bySystem: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let totalCost = 0;

    for (const log of logs) {
      const cost = log.cost ? parseFloat(log.cost) : 0;
      totalCost += cost;
      bySystem[log.system] = (bySystem[log.system] || 0) + cost;
      byType[log.type] = (byType[log.type] || 0) + cost;
      if (log.date) {
        const d = new Date(log.date);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        byMonth[monthKey] = (byMonth[monthKey] || 0) + cost;
      }
    }

    const costOverTime = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cost]) => ({ month, cost }));

    res.json({ totalCost, totalEntries: logs.length, bySystem, byType, costOverTime });
  } catch (err) {
    logError("Error fetching maintenance summary:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to fetch maintenance summary" });
  }
});

// ─── RECURRING SCHEDULES ──────────────────────────────────────────────────────

router.get("/projects/:code/maintenance/schedules", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await verifyProjectAccess(req.params.code, req, res);
    if (!project) return;
    const schedules = await db.select().from(maintenanceRecurringSchedules)
      .where(eq(maintenanceRecurringSchedules.projectId, project.id))
      .orderBy(maintenanceRecurringSchedules.nextDueDate);
    res.json(schedules);
  } catch (err) {
    logError("Error listing schedules:", {}, err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: "Failed to fetch schedules" });
  }
});

router.post(
  "/projects/:code/maintenance/schedules",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      if (!(await requireHandoverComplete(project.id, res))) return;
      const userId = req.user!.id;
      const body = {
        ...req.body,
        projectId: project.id,
        createdById: userId,
        title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : null,
        nextDueDate: req.body.nextDueDate ? new Date(req.body.nextDueDate) : null,
      };
      const parsed = insertMaintenanceRecurringScheduleSchema.safeParse(body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      const [schedule] = await db.insert(maintenanceRecurringSchedules).values(parsed.data).returning();
      await logAudit({ userId, action: "CREATE", entityType: "maintenanceSchedule", entityId: schedule.id, newValue: JSON.stringify({ title: schedule.title }) }, req);
      res.status(201).json(schedule);
    } catch (err) {
      logError("Error creating schedule:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to create schedule" });
    }
  },
);

router.patch(
  "/projects/:code/maintenance/schedules/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const [existing] = await db.select().from(maintenanceRecurringSchedules)
        .where(and(eq(maintenanceRecurringSchedules.id, req.params.id), eq(maintenanceRecurringSchedules.projectId, project.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Schedule not found" });

      if (req.body.system !== undefined && !isValidEnum(req.body.system, VALID_MAINTENANCE_SYSTEMS)) {
        return res.status(400).json({ error: `Invalid system. Must be one of: ${VALID_MAINTENANCE_SYSTEMS.join(", ")}` });
      }
      if (req.body.frequency !== undefined && !isValidEnum(req.body.frequency, VALID_FREQUENCIES)) {
        return res.status(400).json({ error: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(", ")}` });
      }

      const update: Partial<typeof maintenanceRecurringSchedules.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
      if (req.body.title !== undefined) update.title = sanitizeShortText(req.body.title);
      if (req.body.description !== undefined) update.description = req.body.description ? sanitizeText(req.body.description) : null;
      if (req.body.system !== undefined) update.system = req.body.system;
      if (req.body.frequency !== undefined) update.frequency = req.body.frequency;
      if (req.body.nextDueDate !== undefined) update.nextDueDate = req.body.nextDueDate ? new Date(req.body.nextDueDate) : null;
      if (req.body.isActive !== undefined) update.isActive = req.body.isActive;

      const [updated] = await db.update(maintenanceRecurringSchedules).set(update).where(eq(maintenanceRecurringSchedules.id, req.params.id)).returning();
      await logAudit({ userId: req.user!.id, action: "UPDATE", entityType: "maintenanceSchedule", entityId: updated.id, newValue: JSON.stringify({ changes: Object.keys(update) }) }, req);
      res.json(updated);
    } catch (err) {
      logError("Error updating schedule:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to update schedule" });
    }
  },
);

router.delete(
  "/projects/:code/maintenance/schedules/:id",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await verifyProjectAccess(req.params.code, req, res);
      if (!project) return;
      const [existing] = await db.select().from(maintenanceRecurringSchedules)
        .where(and(eq(maintenanceRecurringSchedules.id, req.params.id), eq(maintenanceRecurringSchedules.projectId, project.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Schedule not found" });
      await db.delete(maintenanceRecurringSchedules).where(eq(maintenanceRecurringSchedules.id, req.params.id));
      await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "maintenanceSchedule", entityId: existing.id, oldValue: JSON.stringify({ title: existing.title }) }, req);
      res.status(204).send();
    } catch (err) {
      logError("Error deleting schedule:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  },
);

export default router;
