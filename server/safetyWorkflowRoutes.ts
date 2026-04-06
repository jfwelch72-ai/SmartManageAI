import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { requireAuth } from "./auth";
import {
  toolboxTalkTopics, toolboxTalkScheduled, toolboxTalkAttendance,
  safetyChecklistTemplates, safetyChecklistInstances,
  oshaIncidents, organizations, users, projects,
  insertToolboxTalkTopicSchema, insertToolboxTalkScheduledSchema,
  insertSafetyChecklistTemplateSchema,
  insertSafetyChecklistInstanceSchema, insertOshaIncidentSchema,
} from "@shared/schema";
import { eq, and, desc, sql, gte, lte, lt, inArray } from "drizzle-orm";
import type { AuthRequest } from "./auth";

const router = Router();

function isSafetyAdmin(role?: string): boolean {
  return ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(role || "");
}

async function verifyOrgOwnership(
  table: typeof projects,
  id: string,
  orgId: string,
  label: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.gcOrganizationId, orgId)));
  if (!row) return `${label} not found or does not belong to your organization`;
  return null;
}

async function verifyTopicOrg(topicId: string, orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: toolboxTalkTopics.id })
    .from(toolboxTalkTopics)
    .where(and(eq(toolboxTalkTopics.id, topicId), eq(toolboxTalkTopics.organizationId, orgId)));
  if (!row) return "Topic not found or does not belong to your organization";
  return null;
}

async function verifyTemplateOrg(templateId: string, orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: safetyChecklistTemplates.id })
    .from(safetyChecklistTemplates)
    .where(and(eq(safetyChecklistTemplates.id, templateId), eq(safetyChecklistTemplates.organizationId, orgId)));
  if (!row) return "Template not found or does not belong to your organization";
  return null;
}

// ==================== Toolbox Talk Topics ====================

router.get("/api/toolbox-talks/topics", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const topics = await db
      .select()
      .from(toolboxTalkTopics)
      .where(and(eq(toolboxTalkTopics.organizationId, orgId!), eq(toolboxTalkTopics.isActive, true)))
      .orderBy(desc(toolboxTalkTopics.createdAt));
    res.json(topics);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.post("/api/toolbox-talks/topics", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const parsed = insertToolboxTalkTopicSchema.parse({
      ...req.body,
      organizationId: req.user!.organizationId,
      createdBy: req.user!.id,
    });
    const [created] = await db.insert(toolboxTalkTopics).values(parsed).returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.patch("/api/toolbox-talks/topics/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    const allowed = ["title", "content", "category", "attachments"] as const;
    const updates: Record<string, string | Date> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] as string;
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(toolboxTalkTopics).set(updates)
      .where(and(eq(toolboxTalkTopics.id, id), eq(toolboxTalkTopics.organizationId, orgId!)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.delete("/api/toolbox-talks/topics/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    await db.update(toolboxTalkTopics).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(toolboxTalkTopics.id, id), eq(toolboxTalkTopics.organizationId, orgId!)));
    res.json({ success: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

// ==================== Scheduled Toolbox Talks ====================

router.get("/api/toolbox-talks/scheduled", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const { projectId } = req.query;
    const conditions = [eq(toolboxTalkScheduled.organizationId, orgId!)];
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(toolboxTalkScheduled.projectId, projectId));
    }
    const talks = await db
      .select({
        id: toolboxTalkScheduled.id,
        topicId: toolboxTalkScheduled.topicId,
        projectId: toolboxTalkScheduled.projectId,
        scheduledDate: toolboxTalkScheduled.scheduledDate,
        presenter: toolboxTalkScheduled.presenter,
        presenterId: toolboxTalkScheduled.presenterId,
        status: toolboxTalkScheduled.status,
        notes: toolboxTalkScheduled.notes,
        completedAt: toolboxTalkScheduled.completedAt,
        createdAt: toolboxTalkScheduled.createdAt,
        topicTitle: toolboxTalkTopics.title,
        topicCategory: toolboxTalkTopics.category,
        topicContent: toolboxTalkTopics.content,
      })
      .from(toolboxTalkScheduled)
      .innerJoin(toolboxTalkTopics, eq(toolboxTalkScheduled.topicId, toolboxTalkTopics.id))
      .where(and(...conditions))
      .orderBy(desc(toolboxTalkScheduled.scheduledDate));
    res.json(talks);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.post("/api/toolbox-talks/scheduled", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;

    const topicErr = await verifyTopicOrg(req.body.topicId, orgId);
    if (topicErr) return res.status(400).json({ error: topicErr });

    if (req.body.projectId) {
      const projErr = await verifyOrgOwnership(projects, req.body.projectId, orgId, "Project");
      if (projErr) return res.status(400).json({ error: projErr });
    }

    const parsed = insertToolboxTalkScheduledSchema.parse({
      ...req.body,
      organizationId: orgId,
      createdBy: req.user!.id,
    });
    const [created] = await db.insert(toolboxTalkScheduled).values(parsed).returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.patch("/api/toolbox-talks/scheduled/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    const { id } = req.params;

    if (req.body.projectId) {
      const projErr = await verifyOrgOwnership(projects, req.body.projectId, orgId, "Project");
      if (projErr) return res.status(400).json({ error: projErr });
    }

    const updates: Record<string, string | Date> = {};
    const allowed = ["scheduledDate", "presenter", "presenterId", "status", "notes", "projectId"] as const;
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] as string;
    }
    if (req.body.status === "COMPLETED" && !updates.completedAt) {
      updates.completedAt = new Date();
    }
    const [updated] = await db.update(toolboxTalkScheduled).set(updates)
      .where(and(eq(toolboxTalkScheduled.id, id), eq(toolboxTalkScheduled.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.delete("/api/toolbox-talks/scheduled/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    await db.delete(toolboxTalkScheduled)
      .where(and(eq(toolboxTalkScheduled.id, id), eq(toolboxTalkScheduled.organizationId, orgId!)));
    res.json({ success: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

// ==================== Toolbox Talk Attendance ====================

router.get("/api/toolbox-talks/scheduled/:talkId/attendance", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const { talkId } = req.params;
    const [talk] = await db.select({ id: toolboxTalkScheduled.id }).from(toolboxTalkScheduled)
      .where(and(eq(toolboxTalkScheduled.id, talkId), eq(toolboxTalkScheduled.organizationId, orgId!)));
    if (!talk) return res.status(404).json({ error: "Not found" });
    const records = await db
      .select({
        id: toolboxTalkAttendance.id,
        scheduledTalkId: toolboxTalkAttendance.scheduledTalkId,
        employeeId: toolboxTalkAttendance.employeeId,
        signedAt: toolboxTalkAttendance.signedAt,
        signature: toolboxTalkAttendance.signature,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
      })
      .from(toolboxTalkAttendance)
      .innerJoin(users, eq(toolboxTalkAttendance.employeeId, users.id))
      .where(eq(toolboxTalkAttendance.scheduledTalkId, talkId))
      .orderBy(toolboxTalkAttendance.signedAt);
    res.json(records);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.post("/api/toolbox-talks/scheduled/:talkId/attendance", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const { talkId } = req.params;
    const [talk] = await db.select({ id: toolboxTalkScheduled.id }).from(toolboxTalkScheduled)
      .where(and(eq(toolboxTalkScheduled.id, talkId), eq(toolboxTalkScheduled.organizationId, orgId!)));
    if (!talk) return res.status(404).json({ error: "Not found" });
    const { employeeIds, signature } = req.body as { employeeIds?: string[]; signature?: string };
    let ids: string[];
    if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
      if (!isSafetyAdmin(req.user!.role)) {
        return res.status(403).json({ error: "Only safety administrators can record attendance for other employees" });
      }
      const orgEmployees = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.organizationId, orgId!), inArray(users.id, employeeIds)));
      const validIds = new Set(orgEmployees.map(e => e.id));
      ids = employeeIds.filter((eid: string) => validIds.has(eid));
      if (ids.length === 0) return res.status(400).json({ error: "No valid employees found in this organization" });
    } else {
      ids = [req.user!.id];
    }
    if (!signature) return res.status(400).json({ error: "Signature is required" });
    const rows = ids.map(empId => ({
      scheduledTalkId: talkId,
      employeeId: empId,
      signature,
    }));
    const inserted = await db.insert(toolboxTalkAttendance).values(rows).onConflictDoNothing().returning();
    res.status(201).json({ recorded: inserted.length });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.get("/api/toolbox-talks/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const today = new Date().toISOString().split("T")[0];

    const [totalScheduled] = await db.select({ count: sql<number>`count(*)::int` })
      .from(toolboxTalkScheduled).where(eq(toolboxTalkScheduled.organizationId, orgId!));

    const [completedCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(toolboxTalkScheduled)
      .where(and(eq(toolboxTalkScheduled.organizationId, orgId!), eq(toolboxTalkScheduled.status, "COMPLETED")));

    const [upcomingCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(toolboxTalkScheduled)
      .where(and(
        eq(toolboxTalkScheduled.organizationId, orgId!),
        eq(toolboxTalkScheduled.status, "SCHEDULED"),
        gte(toolboxTalkScheduled.scheduledDate, today)
      ));

    const [overdueCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(toolboxTalkScheduled)
      .where(and(
        eq(toolboxTalkScheduled.organizationId, orgId!),
        eq(toolboxTalkScheduled.status, "SCHEDULED"),
        lt(toolboxTalkScheduled.scheduledDate, today)
      ));

    res.json({
      total: totalScheduled?.count ?? 0,
      completed: completedCount?.count ?? 0,
      upcoming: upcomingCount?.count ?? 0,
      overdue: overdueCount?.count ?? 0,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

// ==================== Safety Checklist Templates ====================

router.get("/api/safety-checklists/templates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const templates = await db
      .select()
      .from(safetyChecklistTemplates)
      .where(and(eq(safetyChecklistTemplates.organizationId, orgId!), eq(safetyChecklistTemplates.isActive, true)))
      .orderBy(desc(safetyChecklistTemplates.createdAt));
    res.json(templates);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.post("/api/safety-checklists/templates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const parsed = insertSafetyChecklistTemplateSchema.parse({
      ...req.body,
      organizationId: req.user!.organizationId,
      createdBy: req.user!.id,
    });
    const [created] = await db.insert(safetyChecklistTemplates).values(parsed).returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.patch("/api/safety-checklists/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    const updates: Record<string, string | Date> = {};
    const allowed = ["name", "category", "itemsJson"] as const;
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] as string;
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(safetyChecklistTemplates).set(updates)
      .where(and(eq(safetyChecklistTemplates.id, id), eq(safetyChecklistTemplates.organizationId, orgId!)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.delete("/api/safety-checklists/templates/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    await db.update(safetyChecklistTemplates).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(safetyChecklistTemplates.id, id), eq(safetyChecklistTemplates.organizationId, orgId!)));
    res.json({ success: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

// ==================== Checklist Instances ====================

router.get("/api/safety-checklists/instances", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const { projectId } = req.query;
    const conditions = [eq(safetyChecklistInstances.organizationId, orgId!)];
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(safetyChecklistInstances.projectId, projectId));
    }
    const instances = await db
      .select({
        id: safetyChecklistInstances.id,
        templateId: safetyChecklistInstances.templateId,
        projectId: safetyChecklistInstances.projectId,
        completedBy: safetyChecklistInstances.completedBy,
        completedByName: safetyChecklistInstances.completedByName,
        status: safetyChecklistInstances.status,
        responsesJson: safetyChecklistInstances.responsesJson,
        notes: safetyChecklistInstances.notes,
        photoUrls: safetyChecklistInstances.photoUrls,
        completedAt: safetyChecklistInstances.completedAt,
        createdAt: safetyChecklistInstances.createdAt,
        templateName: safetyChecklistTemplates.name,
        templateCategory: safetyChecklistTemplates.category,
      })
      .from(safetyChecklistInstances)
      .innerJoin(safetyChecklistTemplates, eq(safetyChecklistInstances.templateId, safetyChecklistTemplates.id))
      .where(and(...conditions))
      .orderBy(desc(safetyChecklistInstances.createdAt));
    res.json(instances);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.post("/api/safety-checklists/instances", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;

    const templateErr = await verifyTemplateOrg(req.body.templateId, orgId);
    if (templateErr) return res.status(400).json({ error: templateErr });

    if (req.body.projectId) {
      const projErr = await verifyOrgOwnership(projects, req.body.projectId, orgId, "Project");
      if (projErr) return res.status(400).json({ error: projErr });
    }

    const userName = `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim();
    const parsed = insertSafetyChecklistInstanceSchema.parse({
      ...req.body,
      organizationId: orgId,
      completedBy: req.user!.id,
      completedByName: (req.body.completedByName as string) || userName,
    });
    const [created] = await db.insert(safetyChecklistInstances).values(parsed).returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.patch("/api/safety-checklists/instances/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const { id } = req.params;

    const [existing] = await db.select({ completedBy: safetyChecklistInstances.completedBy, status: safetyChecklistInstances.status })
      .from(safetyChecklistInstances)
      .where(and(eq(safetyChecklistInstances.id, id), eq(safetyChecklistInstances.organizationId, orgId!)));
    if (!existing) return res.status(404).json({ error: "Not found" });

    const isCreator = existing.completedBy === req.user!.id;
    if (!isCreator && !isSafetyAdmin(req.user!.role)) {
      return res.status(403).json({ error: "Only the creator or a safety administrator can modify this checklist" });
    }

    if (existing.status === "COMPLETED") {
      return res.status(400).json({ error: "Completed checklists cannot be modified" });
    }

    const updates: Record<string, string | Date> = {};
    const allowed = ["responsesJson", "notes", "photoUrls", "status"] as const;
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] as string;
    }
    if (req.body.status === "COMPLETED" && !updates.completedAt) {
      updates.completedAt = new Date();
    }
    const [updated] = await db.update(safetyChecklistInstances).set(updates)
      .where(and(eq(safetyChecklistInstances.id, id), eq(safetyChecklistInstances.organizationId, orgId!)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.get("/api/safety-checklists/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const [totalTemplates] = await db.select({ count: sql<number>`count(*)::int` })
      .from(safetyChecklistTemplates)
      .where(and(eq(safetyChecklistTemplates.organizationId, orgId!), eq(safetyChecklistTemplates.isActive, true)));
    const [totalCompleted] = await db.select({ count: sql<number>`count(*)::int` })
      .from(safetyChecklistInstances)
      .where(and(eq(safetyChecklistInstances.organizationId, orgId!), eq(safetyChecklistInstances.status, "COMPLETED")));
    const [totalInProgress] = await db.select({ count: sql<number>`count(*)::int` })
      .from(safetyChecklistInstances)
      .where(and(eq(safetyChecklistInstances.organizationId, orgId!), eq(safetyChecklistInstances.status, "IN_PROGRESS")));
    res.json({
      templates: totalTemplates?.count ?? 0,
      completed: totalCompleted?.count ?? 0,
      inProgress: totalInProgress?.count ?? 0,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

// ==================== OSHA Incidents ====================

router.get("/api/osha-incidents", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { startDate, endDate, recordableOnly } = req.query;
    const conditions = [eq(oshaIncidents.organizationId, orgId!)];
    if (startDate && typeof startDate === "string") {
      conditions.push(gte(oshaIncidents.dateOfInjury, startDate));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(oshaIncidents.dateOfInjury, endDate));
    }
    if (recordableOnly === "true") {
      conditions.push(eq(oshaIncidents.isRecordable, true));
    }
    const incidents = await db
      .select()
      .from(oshaIncidents)
      .where(and(...conditions))
      .orderBy(desc(oshaIncidents.dateOfInjury));
    res.json(incidents);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.post("/api/osha-incidents", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;

    if (req.body.projectId) {
      const projErr = await verifyOrgOwnership(projects, req.body.projectId, orgId, "Project");
      if (projErr) return res.status(400).json({ error: projErr });
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(oshaIncidents)
      .where(eq(oshaIncidents.organizationId, orgId));
    const caseNumber = (req.body.caseNumber as string) || `OSHA-${new Date().getFullYear()}-${String((countResult?.count ?? 0) + 1).padStart(4, "0")}`;

    const userName = `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim();
    const parsed = insertOshaIncidentSchema.parse({
      ...req.body,
      caseNumber,
      organizationId: orgId,
      reportedBy: req.user!.id,
      reportedByName: (req.body.reportedByName as string) || userName,
    });
    const [created] = await db.insert(oshaIncidents).values(parsed).returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.patch("/api/osha-incidents/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    const { id } = req.params;

    if (req.body.projectId) {
      const projErr = await verifyOrgOwnership(projects, req.body.projectId, orgId, "Project");
      if (projErr) return res.status(400).json({ error: projErr });
    }

    const updates: Record<string, string | number | boolean | Date> = {};
    const allowed = [
      "employeeName", "employeeJobTitle", "dateOfInjury", "timeOfEvent",
      "locationOfIncident", "eventDescription", "injuryIllnessType",
      "bodyPartAffected", "objectOrSubstance", "treatmentType",
      "hospitalName", "wasHospitalized", "daysAwayFromWork",
      "daysOfRestrictedDuty", "classification", "isRecordable",
      "resultedInDeath", "projectId",
    ] as const;
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] as string | number | boolean;
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(oshaIncidents).set(updates)
      .where(and(eq(oshaIncidents.id, id), eq(oshaIncidents.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(400).json({ error: errMsg });
  }
});

router.delete("/api/osha-incidents/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const { id } = req.params;
    await db.delete(oshaIncidents)
      .where(and(eq(oshaIncidents.id, id), eq(oshaIncidents.organizationId, orgId!)));
    res.json({ success: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.get("/api/osha-incidents/300-log", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const year = (req.query.year as string) || String(new Date().getFullYear());
    const startDate = (req.query.startDate as string) || `${year}-01-01`;
    const endDate = (req.query.endDate as string) || `${year}-12-31`;

    const records = await db.select().from(oshaIncidents)
      .where(and(
        eq(oshaIncidents.organizationId, orgId!),
        eq(oshaIncidents.isRecordable, true),
        gte(oshaIncidents.dateOfInjury, startDate),
        lte(oshaIncidents.dateOfInjury, endDate)
      ))
      .orderBy(oshaIncidents.dateOfInjury);

    const totalDaysAway = records.reduce((s, r) => s + (r.daysAwayFromWork ?? 0), 0);
    const totalDaysRestricted = records.reduce((s, r) => s + (r.daysOfRestrictedDuty ?? 0), 0);
    const deaths = records.filter(r => r.resultedInDeath).length;
    const daysAwayCases = records.filter(r => r.classification === "DAYS_AWAY").length;
    const restrictedCases = records.filter(r => r.classification === "RESTRICTED").length;
    const otherRecordable = records.filter(r => r.classification === "OTHER_RECORDABLE").length;

    res.json({
      year,
      startDate,
      endDate,
      records,
      summary: {
        totalRecordable: records.length,
        deaths,
        daysAwayCases,
        restrictedCases,
        otherRecordable,
        totalDaysAway,
        totalDaysRestricted,
      },
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

router.get("/api/osha-incidents/300a-pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const year = (req.query.year as string) || String(new Date().getFullYear());
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId!));

    const records = await db.select().from(oshaIncidents)
      .where(and(
        eq(oshaIncidents.organizationId, orgId!),
        eq(oshaIncidents.isRecordable, true),
        gte(oshaIncidents.dateOfInjury, startDate),
        lte(oshaIncidents.dateOfInjury, endDate)
      ))
      .orderBy(oshaIncidents.dateOfInjury);

    const totalDaysAway = records.reduce((s, r) => s + (r.daysAwayFromWork ?? 0), 0);
    const totalDaysRestricted = records.reduce((s, r) => s + (r.daysOfRestrictedDuty ?? 0), 0);
    const deaths = records.filter(r => r.resultedInDeath).length;
    const daysAwayCases = records.filter(r => r.classification === "DAYS_AWAY").length;
    const restrictedCases = records.filter(r => r.classification === "RESTRICTED").length;
    const otherRecordable = records.filter(r => r.classification === "OTHER_RECORDABLE").length;
    const injuryCases = records.filter(r => r.injuryIllnessType === "INJURY").length;
    const skinDisorderCases = records.filter(r => r.injuryIllnessType === "SKIN_DISORDER").length;
    const respiratoryCases = records.filter(r => r.injuryIllnessType === "RESPIRATORY").length;
    const poisoningCases = records.filter(r => r.injuryIllnessType === "POISONING").length;
    const hearingLossCases = records.filter(r => r.injuryIllnessType === "HEARING_LOSS").length;
    const otherIllnessCases = records.filter(r => r.injuryIllnessType === "OTHER_ILLNESS").length;

    const reportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const orgName = org?.name || "Organization";

    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="OSHA_300A_${orgName.replace(/\s+/g, "_")}_${year}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).font("Helvetica-Bold").text("OSHA's Form 300A", { align: "center" });
    doc.fontSize(12).font("Helvetica").text("Summary of Work-Related Injuries and Illnesses", { align: "center" });
    doc.fontSize(10).text(`Calendar Year ${year}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").text(`Establishment: ${orgName}          Generated: ${reportDate}`);
    doc.moveDown(0.8);

    doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e40af").text("Number of Cases");
    doc.fillColor("#000000");
    doc.moveDown(0.3);

    const drawRow = (label: string, value: number, x: number, y: number, w: number) => {
      doc.fontSize(9).font("Helvetica").text(label, x + 4, y + 4, { width: w - 40 });
      doc.font("Helvetica-Bold").fontSize(13).text(String(value), x + w - 36, y + 2, { width: 32, align: "right" });
      doc.rect(x, y, w, 22).stroke();
    };

    let cy = doc.y;
    const colW = 180;
    drawRow("Total Deaths", deaths, 40, cy, colW);
    drawRow("Cases with Days Away", daysAwayCases, 40 + colW, cy, colW);
    drawRow("Cases with Job Transfer/Restriction", restrictedCases, 40 + colW * 2, cy, colW);
    drawRow("Other Recordable Cases", otherRecordable, 40 + colW * 3, cy, colW);
    doc.y = cy + 30;
    doc.moveDown(0.3);

    doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e40af").text("Number of Days");
    doc.fillColor("#000000");
    doc.moveDown(0.3);
    cy = doc.y;
    drawRow("Total Days Away From Work", totalDaysAway, 40, cy, colW * 2);
    drawRow("Total Days of Job Transfer/Restriction", totalDaysRestricted, 40 + colW * 2, cy, colW * 2);
    doc.y = cy + 30;
    doc.moveDown(0.3);

    doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e40af").text("Injury and Illness Types");
    doc.fillColor("#000000");
    doc.moveDown(0.3);
    cy = doc.y;
    const tw = 120;
    const typeData: [string, number][] = [
      ["Injuries", injuryCases], ["Skin Disorders", skinDisorderCases],
      ["Respiratory", respiratoryCases], ["Poisonings", poisoningCases],
      ["Hearing Loss", hearingLossCases], ["Other Illnesses", otherIllnessCases],
    ];
    typeData.forEach(([label, val], i) => {
      drawRow(label, val, 40 + (i % 3) * tw * 2, cy + Math.floor(i / 3) * 26, tw * 2);
    });
    doc.y = cy + 60;
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(9).text(`Total recordable cases for ${year}: ${records.length}`);
    doc.moveDown(1);

    doc.fontSize(11).font("Helvetica-Bold").text("OSHA 300 Log — Recordable Cases");
    doc.moveDown(0.3);

    if (records.length === 0) {
      doc.fontSize(9).font("Helvetica").text("No recordable cases for this period.");
    } else {
      const headers = ["Case #", "Employee", "Job Title", "Date", "Location", "Description", "Type", "Body Part", "Death", "Days Away", "Restricted", "Class."];
      const colWidths = [55, 70, 55, 55, 60, 100, 55, 55, 35, 40, 45, 55];
      let tx = 40;
      cy = doc.y;
      doc.font("Helvetica-Bold").fontSize(7);
      headers.forEach((h, i) => {
        doc.text(h, tx + 2, cy + 2, { width: colWidths[i] - 4 });
        doc.rect(tx, cy, colWidths[i], 14).stroke();
        tx += colWidths[i];
      });
      doc.y = cy + 16;

      records.forEach(r => {
        if (doc.y > 540) { doc.addPage(); }
        tx = 40;
        cy = doc.y;
        const vals = [
          r.caseNumber, r.employeeName, r.employeeJobTitle || "", r.dateOfInjury,
          r.locationOfIncident || "", r.eventDescription.substring(0, 40),
          r.injuryIllnessType, r.bodyPartAffected,
          r.resultedInDeath ? "Y" : "", String(r.daysAwayFromWork ?? 0),
          String(r.daysOfRestrictedDuty ?? 0), r.classification,
        ];
        doc.font("Helvetica").fontSize(6);
        vals.forEach((v, i) => {
          doc.text(v, tx + 2, cy + 2, { width: colWidths[i] - 4 });
          doc.rect(tx, cy, colWidths[i], 14).stroke();
          tx += colWidths[i];
        });
        doc.y = cy + 16;
      });
    }

    doc.moveDown(1);
    doc.fontSize(7).font("Helvetica").fillColor("#94a3b8")
      .text(`Generated by SmartManageAI | ${orgName} | ${reportDate} | Confidential`, { align: "center" });

    doc.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/api/osha-incidents/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSafetyAdmin(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId;
    const year = (req.query.year as string) || String(new Date().getFullYear());
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const [totalCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(oshaIncidents)
      .where(and(
        eq(oshaIncidents.organizationId, orgId!),
        gte(oshaIncidents.dateOfInjury, startDate),
        lte(oshaIncidents.dateOfInjury, endDate)
      ));

    const [recordableCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(oshaIncidents)
      .where(and(
        eq(oshaIncidents.organizationId, orgId!),
        eq(oshaIncidents.isRecordable, true),
        gte(oshaIncidents.dateOfInjury, startDate),
        lte(oshaIncidents.dateOfInjury, endDate)
      ));

    res.json({
      year,
      totalIncidents: totalCount?.count ?? 0,
      recordableIncidents: recordableCount?.count ?? 0,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error"; res.status(500).json({ error: errMsg });
  }
});

export default router;
