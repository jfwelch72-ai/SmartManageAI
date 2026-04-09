import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import {
  kpiTemplates,
  kpiAssignments,
  kpiEntries,
  type KpiTemplate,
  type KpiAssignment,
  type KpiEntry,
} from "@shared/schema";
import { users } from "@shared/schema";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { z } from "zod";

const router = Router();

const MANAGEMENT_ROLES = ["ADMIN", "SUPER_ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"];

function canManageKpis(role: string): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

const templateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  category: z.enum(["Productivity", "Safety", "Financial", "Quality", "Attendance", "Custom"]).default("Custom"),
  unit: z.string().min(1).max(50).default("count"),
  direction: z.enum(["higher_is_better", "lower_is_better"]).default("higher_is_better"),
});

const assignmentSchema = z.object({
  kpiTemplateId: z.string().min(1),
  userId: z.string().min(1),
  targetValue: z.string().or(z.number()).transform(v => String(v)),
  periodType: z.enum(["weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
});

const entrySchema = z.object({
  kpiAssignmentId: z.string().min(1),
  actualValue: z.string().or(z.number()).transform(v => String(v)),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  notes: z.string().max(1000).optional().nullable(),
});

router.get("/templates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const hasPagination = req.query.page || req.query.limit;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const offset = (page - 1) * limit;

    const templates = await db.select().from(kpiTemplates)
      .where(eq(kpiTemplates.organizationId, orgId))
      .orderBy(asc(kpiTemplates.name))
      .limit(limit)
      .offset(offset);

    if (hasPagination) {
      const countResult = await db.select({ count: sql<number>`count(*)` }).from(kpiTemplates).where(eq(kpiTemplates.organizationId, orgId));
      const total = Number(countResult[0]?.count ?? 0);
      return res.json({ data: templates, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    return res.json(templates);
  } catch (error) {
    logError("Error fetching KPI templates:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to fetch KPI templates" });
  }
});

router.post("/templates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [template] = await db.insert(kpiTemplates).values({
      organizationId: orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      unit: parsed.data.unit,
      direction: parsed.data.direction,
      createdBy: req.user!.id,
    }).returning();

    return res.status(201).json(template);
  } catch (error) {
    logError("Error creating KPI template:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to create KPI template" });
  }
});

router.patch("/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const parsed = templateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [updated] = await db.update(kpiTemplates)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(kpiTemplates.id, req.params.id), eq(kpiTemplates.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Template not found" });
    return res.json(updated);
  } catch (error) {
    logError("Error updating KPI template:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to update KPI template" });
  }
});

router.delete("/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const [updated] = await db.update(kpiTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(kpiTemplates.id, req.params.id), eq(kpiTemplates.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Template not found" });
    return res.json({ success: true });
  } catch (error) {
    logError("Error deleting KPI template:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to delete KPI template" });
  }
});

router.get("/assignments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const conditions: any[] = [eq(kpiAssignments.organizationId, orgId)];

    const userId = req.query.userId as string | undefined;
    if (!canManageKpis(req.user!.role)) {
      conditions.push(eq(kpiAssignments.userId, req.user!.id));
    } else if (userId) {
      conditions.push(eq(kpiAssignments.userId, userId));
    }

    const templateId = req.query.templateId as string | undefined;
    if (templateId) conditions.push(eq(kpiAssignments.kpiTemplateId, templateId));

    const assignments = await db.select({
      assignment: kpiAssignments,
      templateName: kpiTemplates.name,
      templateCategory: kpiTemplates.category,
      templateUnit: kpiTemplates.unit,
      templateDirection: kpiTemplates.direction,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
      .from(kpiAssignments)
      .innerJoin(kpiTemplates, eq(kpiAssignments.kpiTemplateId, kpiTemplates.id))
      .innerJoin(users, eq(kpiAssignments.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(kpiAssignments.createdAt));

    const result = assignments.map(a => ({
      ...a.assignment,
      templateName: a.templateName,
      templateCategory: a.templateCategory,
      templateUnit: a.templateUnit,
      templateDirection: a.templateDirection,
      userName: `${a.userFirstName || ''} ${a.userLastName || ''}`.trim() || a.userEmail,
      userEmail: a.userEmail,
    }));

    return res.json(result);
  } catch (error) {
    logError("Error fetching KPI assignments:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to fetch KPI assignments" });
  }
});

router.get("/assignments/my", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const assignments = await db.select({
      assignment: kpiAssignments,
      templateName: kpiTemplates.name,
      templateDescription: kpiTemplates.description,
      templateCategory: kpiTemplates.category,
      templateUnit: kpiTemplates.unit,
      templateDirection: kpiTemplates.direction,
    })
      .from(kpiAssignments)
      .innerJoin(kpiTemplates, eq(kpiAssignments.kpiTemplateId, kpiTemplates.id))
      .where(and(
        eq(kpiAssignments.organizationId, orgId),
        eq(kpiAssignments.userId, req.user!.id),
        eq(kpiAssignments.isActive, true)
      ))
      .orderBy(asc(kpiTemplates.name));

    const result = assignments.map(a => ({
      ...a.assignment,
      templateName: a.templateName,
      templateDescription: a.templateDescription,
      templateCategory: a.templateCategory,
      templateUnit: a.templateUnit,
      templateDirection: a.templateDirection,
    }));

    return res.json(result);
  } catch (error) {
    logError("Error fetching my KPIs:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to fetch your KPIs" });
  }
});

router.post("/assignments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const parsed = assignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [assignment] = await db.insert(kpiAssignments).values({
      organizationId: orgId,
      kpiTemplateId: parsed.data.kpiTemplateId,
      userId: parsed.data.userId,
      targetValue: parsed.data.targetValue,
      periodType: parsed.data.periodType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate || undefined,
      assignedBy: req.user!.id,
    }).returning();

    return res.status(201).json(assignment);
  } catch (error) {
    logError("Error creating KPI assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to create KPI assignment" });
  }
});

router.patch("/assignments/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const updateSchema = z.object({
      targetValue: z.string().or(z.number()).transform(v => String(v)).optional(),
      periodType: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
    });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [updated] = await db.update(kpiAssignments)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(kpiAssignments.id, req.params.id), eq(kpiAssignments.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Assignment not found" });
    return res.json(updated);
  } catch (error) {
    logError("Error updating KPI assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to update KPI assignment" });
  }
});

router.delete("/assignments/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const [deleted] = await db.delete(kpiAssignments)
      .where(and(eq(kpiAssignments.id, req.params.id), eq(kpiAssignments.organizationId, orgId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Assignment not found" });
    return res.json({ success: true });
  } catch (error) {
    logError("Error deleting KPI assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to delete KPI assignment" });
  }
});

router.get("/entries", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const assignmentId = req.query.assignmentId as string;
    if (!assignmentId) return res.status(400).json({ error: "assignmentId is required" });

    if (!canManageKpis(req.user!.role)) {
      const [assignment] = await db.select().from(kpiAssignments)
        .where(and(
          eq(kpiAssignments.id, assignmentId),
          eq(kpiAssignments.organizationId, orgId),
          eq(kpiAssignments.userId, req.user!.id)
        ));
      if (!assignment) return res.status(403).json({ error: "Access denied" });
    }

    const entries = await db.select().from(kpiEntries)
      .where(and(
        eq(kpiEntries.organizationId, orgId),
        eq(kpiEntries.kpiAssignmentId, assignmentId)
      ))
      .orderBy(desc(kpiEntries.periodStart));

    return res.json(entries);
  } catch (error) {
    logError("Error fetching KPI entries:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to fetch KPI entries" });
  }
});

router.post("/entries", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const parsed = entrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [assignment] = await db.select().from(kpiAssignments)
      .where(and(
        eq(kpiAssignments.id, parsed.data.kpiAssignmentId),
        eq(kpiAssignments.organizationId, orgId)
      ));

    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    const isOwner = assignment.userId === req.user!.id;
    const isManager = canManageKpis(req.user!.role);
    if (!isOwner && !isManager) return res.status(403).json({ error: "Insufficient permissions" });

    const [entry] = await db.insert(kpiEntries).values({
      organizationId: orgId,
      kpiAssignmentId: parsed.data.kpiAssignmentId,
      actualValue: parsed.data.actualValue,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      notes: parsed.data.notes,
      recordedBy: req.user!.id,
    }).returning();

    return res.status(201).json(entry);
  } catch (error) {
    logError("Error creating KPI entry:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to create KPI entry" });
  }
});

router.patch("/entries/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const [existingEntry] = await db.select().from(kpiEntries)
      .where(and(eq(kpiEntries.id, req.params.id), eq(kpiEntries.organizationId, orgId)));
    if (!existingEntry) return res.status(404).json({ error: "Entry not found" });

    if (!canManageKpis(req.user!.role)) {
      const [assignment] = await db.select().from(kpiAssignments)
        .where(and(
          eq(kpiAssignments.id, existingEntry.kpiAssignmentId),
          eq(kpiAssignments.userId, req.user!.id)
        ));
      if (!assignment) return res.status(403).json({ error: "Insufficient permissions" });
    }

    const updateSchema = z.object({
      actualValue: z.string().or(z.number()).transform(v => String(v)).optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      notes: z.string().max(1000).optional().nullable(),
    });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [updated] = await db.update(kpiEntries)
      .set(parsed.data)
      .where(and(eq(kpiEntries.id, req.params.id), eq(kpiEntries.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Entry not found" });
    return res.json(updated);
  } catch (error) {
    logError("Error updating KPI entry:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to update KPI entry" });
  }
});

router.delete("/entries/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });
    if (!canManageKpis(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const [deleted] = await db.delete(kpiEntries)
      .where(and(eq(kpiEntries.id, req.params.id), eq(kpiEntries.organizationId, orgId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Entry not found" });
    return res.json({ success: true });
  } catch (error) {
    logError("Error deleting KPI entry:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to delete KPI entry" });
  }
});

router.get("/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const targetUserId = (req.query.userId as string) || req.user!.id;

    if (targetUserId !== req.user!.id && !canManageKpis(req.user!.role)) {
      return res.status(403).json({ error: "Cannot view other users' KPI summary" });
    }

    const assignments = await db.select({
      assignment: kpiAssignments,
      templateName: kpiTemplates.name,
      templateCategory: kpiTemplates.category,
      templateUnit: kpiTemplates.unit,
      templateDirection: kpiTemplates.direction,
    })
      .from(kpiAssignments)
      .innerJoin(kpiTemplates, eq(kpiAssignments.kpiTemplateId, kpiTemplates.id))
      .where(and(
        eq(kpiAssignments.organizationId, orgId),
        eq(kpiAssignments.userId, targetUserId),
        eq(kpiAssignments.isActive, true)
      ));

    const summary = [];

    for (const a of assignments) {
      const entries = await db.select().from(kpiEntries)
        .where(eq(kpiEntries.kpiAssignmentId, a.assignment.id))
        .orderBy(desc(kpiEntries.periodEnd))
        .limit(5);

      const latestEntry = entries[0];
      const previousEntry = entries[1];
      const target = Number(a.assignment.targetValue);
      const actual = latestEntry ? Number(latestEntry.actualValue) : 0;
      const achievement = target > 0 ? Math.round((actual / target) * 100) : 0;

      let trend: "improving" | "declining" | "stable" = "stable";
      if (latestEntry && previousEntry) {
        const diff = Number(latestEntry.actualValue) - Number(previousEntry.actualValue);
        if (a.templateDirection === "higher_is_better") {
          trend = diff > 0 ? "improving" : diff < 0 ? "declining" : "stable";
        } else {
          trend = diff < 0 ? "improving" : diff > 0 ? "declining" : "stable";
        }
      }

      summary.push({
        assignmentId: a.assignment.id,
        templateName: a.templateName,
        category: a.templateCategory,
        unit: a.templateUnit,
        direction: a.templateDirection,
        targetValue: target,
        actualValue: actual,
        achievement,
        trend,
        periodType: a.assignment.periodType,
        latestPeriodEnd: latestEntry?.periodEnd || null,
        entryCount: entries.length,
      });
    }

    return res.json(summary);
  } catch (error) {
    logError("Error fetching KPI summary:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: "Failed to fetch KPI summary" });
  }
});

export default router;
