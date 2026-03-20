import { Router, type Response } from "express";
import { db } from "./db";
import {
  warrantyCases, warrantyTasks, warrantyDocuments, projects,
  insertWarrantyCaseSchema, insertWarrantyTaskSchema, insertWarrantyDocumentSchema,
  type WarrantyCase, type WarrantyTask, type WarrantyDocument,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest, type UserRole } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

// ─── Role Sets ────────────────────────────────────────────────────────────────

const MANAGEMENT_ROLES: UserRole[] = [
  "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER",
  "OFFICE_MANAGER", "SAFETY_MANAGER",
];

const CLOSE_ROLES: UserRole[] = ["ADMIN", "MANAGER", "SUPERINTENDENT"];

const WORKER_ROLES: UserRole[] = [
  "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER",
  "OFFICE_MANAGER", "SAFETY_MANAGER", "HOURLY_EMPLOYEE",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StatusEntry = { status: string; changedBy: string; changedAt: string; note?: string };

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

async function resolveCase(id: string, req: AuthRequest, res: Response) {
  const [wc] = await db.select().from(warrantyCases).where(eq(warrantyCases.id, id)).limit(1);
  if (!wc) { res.status(404).json({ error: "Warranty case not found" }); return null; }

  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return null; }

  if (shouldFilter && orgId) {
    const [proj] = await db.select().from(projects).where(eq(projects.id, wc.projectId)).limit(1);
    if (!proj || proj.gcOrganizationId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return null;
    }
  }
  return wc;
}

function getUserRole(req: AuthRequest): string {
  return (req.user!.effectiveRole || req.user!.role) as string;
}

function hasRole(req: AuthRequest, roles: UserRole[]): boolean {
  return roles.includes(getUserRole(req) as UserRole);
}

function getUserName(req: AuthRequest): string {
  return `${req.user!.firstName} ${req.user!.lastName}`.trim() || req.user!.id;
}

async function generateCaseNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(warrantyCases)
    .innerJoin(projects, eq(warrantyCases.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  const count = result?.count || 0;
  return `WC-${projectCode}-${String(Number(count) + 1).padStart(3, "0")}`;
}

// Explicit source→target transition matrix for warranty cases
// OPEN → ACKNOWLEDGED (management+)
// ACKNOWLEDGED → IN_REPAIR (management+)
// IN_REPAIR → REPAIRED (worker+)
// REPAIRED → CLOSED (close_roles)
// * → REJECTED from any non-terminal state (close_roles)
// REJECTED, CLOSED are terminal
const ALLOWED_TRANSITIONS: Record<string, { targets: string[]; roles: UserRole[] }[]> = {
  OPEN: [
    { targets: ["ACKNOWLEDGED"], roles: MANAGEMENT_ROLES },
    { targets: ["REJECTED"], roles: CLOSE_ROLES },
  ],
  ACKNOWLEDGED: [
    { targets: ["IN_REPAIR"], roles: MANAGEMENT_ROLES },
    { targets: ["OPEN"], roles: MANAGEMENT_ROLES },
    { targets: ["REJECTED"], roles: CLOSE_ROLES },
  ],
  IN_REPAIR: [
    { targets: ["REPAIRED"], roles: WORKER_ROLES },
    { targets: ["ACKNOWLEDGED"], roles: MANAGEMENT_ROLES },
    { targets: ["REJECTED"], roles: CLOSE_ROLES },
  ],
  REPAIRED: [
    { targets: ["CLOSED"], roles: CLOSE_ROLES },
    { targets: ["IN_REPAIR"], roles: MANAGEMENT_ROLES },
    { targets: ["REJECTED"], roles: CLOSE_ROLES },
  ],
};

// ─── LIST CASES ───────────────────────────────────────────────────────────────

router.get("/projects/:code/warranty/cases", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) return res.json([]);

    const { status, type, priority, q } = req.query;
    const conditions: ReturnType<typeof eq>[] = [eq(warrantyCases.projectId, project.id)];

    if (status && typeof status === "string" && status !== "all") {
      conditions.push(eq(warrantyCases.status, status as WarrantyCase["status"]));
    }
    if (type && typeof type === "string" && type !== "all") {
      conditions.push(eq(warrantyCases.type, type as WarrantyCase["type"]));
    }
    if (priority && typeof priority === "string" && priority !== "all") {
      conditions.push(eq(warrantyCases.priority, priority as WarrantyCase["priority"]));
    }

    let cases = await db
      .select()
      .from(warrantyCases)
      .where(and(...conditions))
      .orderBy(desc(warrantyCases.createdAt));

    if (q && typeof q === "string" && q.trim()) {
      const lower = q.toLowerCase();
      cases = cases.filter((c) =>
        c.title.toLowerCase().includes(lower) ||
        (c.description ?? "").toLowerCase().includes(lower) ||
        (c.location ?? "").toLowerCase().includes(lower) ||
        c.caseNumber.toLowerCase().includes(lower) ||
        (c.reportedByName ?? "").toLowerCase().includes(lower),
      );
    }

    res.json(cases.map(enrichCase));
  } catch (err) {
    console.error("Error listing warranty cases:", err);
    res.status(500).json({ error: "Failed to fetch warranty cases" });
  }
});

function enrichCase(wc: WarrantyCase) {
  return { ...wc, statusHistory: wc.statusHistory ?? [] };
}

// ─── CREATE CASE ──────────────────────────────────────────────────────────────

router.post(
  "/projects/:code/warranty/cases",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const userId = req.user!.id;
      const caseNumber = await generateCaseNumber(req.params.code);

      const initialHistory: StatusEntry[] = [{
        status: "OPEN",
        changedBy: getUserName(req),
        changedAt: new Date().toISOString(),
        note: "Case created",
      }];

      const body = {
        ...req.body,
        projectId: project.id,
        caseNumber,
        createdById: userId,
        status: "OPEN",
        title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : null,
        location: req.body.location ? sanitizeShortText(req.body.location) : null,
        reportedByName: req.body.reportedByName ? sanitizeShortText(req.body.reportedByName) : null,
        reportedByEmail: req.body.reportedByEmail ? sanitizeShortText(req.body.reportedByEmail) : null,
        reportedByPhone: req.body.reportedByPhone ? sanitizeShortText(req.body.reportedByPhone) : null,
        assignedToName: req.body.assignedToName ? sanitizeShortText(req.body.assignedToName) : null,
        rootCause: req.body.rootCause ? sanitizeText(req.body.rootCause) : null,
        resolution: req.body.resolution ? sanitizeText(req.body.resolution) : null,
        reportedDate: req.body.reportedDate ? new Date(req.body.reportedDate) : null,
        targetResolutionDate: req.body.targetResolutionDate ? new Date(req.body.targetResolutionDate) : null,
        statusHistory: initialHistory,
      };

      const parsed = insertWarrantyCaseSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [wc] = await db.insert(warrantyCases).values(parsed.data).returning();

      await logAudit({
        userId,
        action: "CREATE",
        entityType: "warrantyCase",
        entityId: wc.id,
        newValue: JSON.stringify({ caseNumber, title: wc.title, projectId: project.id }),
      }, req);

      res.status(201).json(enrichCase(wc));
    } catch (err) {
      console.error("Error creating warranty case:", err);
      res.status(500).json({ error: "Failed to create warranty case" });
    }
  },
);

// ─── GET ONE CASE ─────────────────────────────────────────────────────────────

router.get("/projects/:code/warranty/cases/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const wc = await resolveCase(req.params.id, req, res);
    if (!wc) return;
    const project = await getProjectByCode(req.params.code);
    if (!project || project.id !== wc.projectId) return res.status(404).json({ error: "Warranty case not found" });
    res.json(enrichCase(wc));
  } catch (err) {
    console.error("Error fetching warranty case:", err);
    res.status(500).json({ error: "Failed to fetch warranty case" });
  }
});

// ─── UPDATE CASE ──────────────────────────────────────────────────────────────

router.patch("/projects/:code/warranty/cases/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const wc = await resolveCase(req.params.id, req, res);
    if (!wc) return;

    const project = await getProjectByCode(req.params.code);
    if (!project || project.id !== wc.projectId) return res.status(404).json({ error: "Warranty case not found" });

    const userId = req.user!.id;
    const update: Partial<WarrantyCase> & { updatedAt: Date } = { updatedAt: new Date() };

    // Field edits require management role
    const isEditingFields = req.body.status === undefined;
    if (isEditingFields && !hasRole(req, MANAGEMENT_ROLES)) {
      return res.status(403).json({ error: "Insufficient permissions to edit warranty cases" });
    }

    if (req.body.title !== undefined) update.title = sanitizeShortText(req.body.title);
    if (req.body.description !== undefined) update.description = sanitizeText(req.body.description);
    if (req.body.location !== undefined) update.location = sanitizeShortText(req.body.location);
    if (req.body.type !== undefined) update.type = req.body.type;
    if (req.body.priority !== undefined) update.priority = req.body.priority;
    if (req.body.assignedToUserId !== undefined) update.assignedToUserId = req.body.assignedToUserId ?? null;
    if (req.body.assignedToName !== undefined) update.assignedToName = sanitizeShortText(req.body.assignedToName);
    if (req.body.reportedByName !== undefined) update.reportedByName = sanitizeShortText(req.body.reportedByName);
    if (req.body.reportedByEmail !== undefined) update.reportedByEmail = sanitizeShortText(req.body.reportedByEmail);
    if (req.body.reportedByPhone !== undefined) update.reportedByPhone = sanitizeShortText(req.body.reportedByPhone);
    if (req.body.reportedDate !== undefined) update.reportedDate = req.body.reportedDate ? new Date(req.body.reportedDate) : null;
    if (req.body.targetResolutionDate !== undefined) update.targetResolutionDate = req.body.targetResolutionDate ? new Date(req.body.targetResolutionDate) : null;
    if (req.body.estimatedCost !== undefined) update.estimatedCost = req.body.estimatedCost ?? null;
    if (req.body.actualCost !== undefined) update.actualCost = req.body.actualCost ?? null;
    if (req.body.rootCause !== undefined) update.rootCause = sanitizeText(req.body.rootCause);
    if (req.body.resolution !== undefined) update.resolution = sanitizeText(req.body.resolution);

    // Status transitions — enforced via transition matrix
    if (req.body.status !== undefined && req.body.status !== wc.status) {
      const newStatus = req.body.status as WarrantyCase["status"];
      const fromStatus = wc.status;
      const role = getUserRole(req);

      if (fromStatus === "REJECTED" || fromStatus === "CLOSED") {
        return res.status(409).json({ error: `'${fromStatus}' is a terminal status and cannot be changed.` });
      }

      const allowedForSource = ALLOWED_TRANSITIONS[fromStatus] ?? [];
      const matchingRule = allowedForSource.find((rule) => rule.targets.includes(newStatus));

      if (!matchingRule) {
        return res.status(422).json({ error: `Transition from '${fromStatus}' to '${newStatus}' is not permitted.` });
      }

      if (!hasRole(req, matchingRule.roles)) {
        return res.status(403).json({ error: `Role '${role}' cannot transition from '${fromStatus}' to '${newStatus}'.` });
      }

      update.status = newStatus;

      const historyEntry: StatusEntry = {
        status: newStatus,
        changedBy: getUserName(req),
        changedAt: new Date().toISOString(),
        note: req.body.statusNote || undefined,
      };

      // Normalize timestamps
      if (newStatus === "REPAIRED") {
        update.resolvedAt = new Date();
      } else if (newStatus === "CLOSED") {
        update.closedAt = new Date();
        if (!wc.resolvedAt) update.resolvedAt = new Date();
      } else if (newStatus === "OPEN" || newStatus === "ACKNOWLEDGED" || newStatus === "IN_REPAIR") {
        update.resolvedAt = null;
        update.closedAt = null;
      }

      update.statusHistory = [...((wc.statusHistory ?? []) as StatusEntry[]), historyEntry];
    }

    const [updated] = await db
      .update(warrantyCases)
      .set(update)
      .where(eq(warrantyCases.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "warrantyCase",
      entityId: updated.id,
      newValue: JSON.stringify({ changes: Object.keys(update), projectCode: req.params.code }),
    }, req);

    res.json(enrichCase(updated));
  } catch (err) {
    console.error("Error updating warranty case:", err);
    res.status(500).json({ error: "Failed to update warranty case" });
  }
});

// ─── DELETE CASE ──────────────────────────────────────────────────────────────

router.delete(
  "/projects/:code/warranty/cases/:id",
  requireAuth,
  requireRole(...CLOSE_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const wc = await resolveCase(req.params.id, req, res);
      if (!wc) return;
      const project = await getProjectByCode(req.params.code);
      if (!project || project.id !== wc.projectId) return res.status(404).json({ error: "Warranty case not found" });

      await db.delete(warrantyCases).where(eq(warrantyCases.id, req.params.id));

      await logAudit({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "warrantyCase",
        entityId: wc.id,
        oldValue: JSON.stringify({ caseNumber: wc.caseNumber, title: wc.title }),
      }, req);

      res.status(204).send();
    } catch (err) {
      console.error("Error deleting warranty case:", err);
      res.status(500).json({ error: "Failed to delete warranty case" });
    }
  },
);

// ─── LIST TASKS FOR CASE ──────────────────────────────────────────────────────

router.get("/projects/:code/warranty/cases/:id/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const wc = await resolveCase(req.params.id, req, res);
    if (!wc) return;

    const tasks = await db
      .select()
      .from(warrantyTasks)
      .where(eq(warrantyTasks.caseId, req.params.id))
      .orderBy(desc(warrantyTasks.createdAt));

    res.json(tasks);
  } catch (err) {
    console.error("Error listing warranty tasks:", err);
    res.status(500).json({ error: "Failed to fetch warranty tasks" });
  }
});

// ─── CREATE TASK FOR CASE ─────────────────────────────────────────────────────

router.post(
  "/projects/:code/warranty/cases/:id/tasks",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const wc = await resolveCase(req.params.id, req, res);
      if (!wc) return;

      const userId = req.user!.id;
      const body = {
        ...req.body,
        caseId: req.params.id,
        projectId: wc.projectId,
        createdById: userId,
        title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : null,
        assignedToName: req.body.assignedToName ? sanitizeShortText(req.body.assignedToName) : null,
        notes: req.body.notes ? sanitizeText(req.body.notes) : null,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        status: "PENDING",
      };

      const parsed = insertWarrantyTaskSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [task] = await db.insert(warrantyTasks).values(parsed.data).returning();
      res.status(201).json(task);
    } catch (err) {
      console.error("Error creating warranty task:", err);
      res.status(500).json({ error: "Failed to create warranty task" });
    }
  },
);

// ─── UPDATE TASK ──────────────────────────────────────────────────────────────

router.patch("/projects/:code/warranty/tasks/:taskId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [task] = await db.select().from(warrantyTasks).where(eq(warrantyTasks.id, req.params.taskId)).limit(1);
    if (!task) return res.status(404).json({ error: "Warranty task not found" });

    // Verify org access via case → project
    const wc = await resolveCase(task.caseId, req, res);
    if (!wc) return;

    const update: Partial<WarrantyTask> & { updatedAt: Date } = { updatedAt: new Date() };

    if (req.body.title !== undefined) update.title = sanitizeShortText(req.body.title);
    if (req.body.description !== undefined) update.description = sanitizeText(req.body.description);
    if (req.body.notes !== undefined) update.notes = sanitizeText(req.body.notes);
    if (req.body.assignedToUserId !== undefined) update.assignedToUserId = req.body.assignedToUserId ?? null;
    if (req.body.assignedToName !== undefined) update.assignedToName = sanitizeShortText(req.body.assignedToName);
    if (req.body.dueDate !== undefined) update.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    if (req.body.estimatedHours !== undefined) update.estimatedHours = req.body.estimatedHours ?? null;
    if (req.body.actualHours !== undefined) update.actualHours = req.body.actualHours ?? null;

    if (req.body.status !== undefined && req.body.status !== task.status) {
      update.status = req.body.status;
      if (req.body.status === "COMPLETED") update.completedAt = new Date();
      else if (req.body.status !== "COMPLETED") update.completedAt = null;
    }

    const [updated] = await db
      .update(warrantyTasks)
      .set(update)
      .where(eq(warrantyTasks.id, req.params.taskId))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("Error updating warranty task:", err);
    res.status(500).json({ error: "Failed to update warranty task" });
  }
});

// ─── DELETE TASK ──────────────────────────────────────────────────────────────

router.delete(
  "/projects/:code/warranty/tasks/:taskId",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const [task] = await db.select().from(warrantyTasks).where(eq(warrantyTasks.id, req.params.taskId)).limit(1);
      if (!task) return res.status(404).json({ error: "Warranty task not found" });

      const wc = await resolveCase(task.caseId, req, res);
      if (!wc) return;

      await db.delete(warrantyTasks).where(eq(warrantyTasks.id, req.params.taskId));
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting warranty task:", err);
      res.status(500).json({ error: "Failed to delete warranty task" });
    }
  },
);

// ─── ADD DOCUMENT ─────────────────────────────────────────────────────────────

router.post(
  "/projects/:code/warranty/cases/:id/documents",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const wc = await resolveCase(req.params.id, req, res);
      if (!wc) return;

      const { url, filename, mimeType, title, documentType, fileSize } = req.body;
      if (!url || !filename) return res.status(400).json({ error: "url and filename are required" });

      const body = {
        caseId: req.params.id,
        projectId: wc.projectId,
        documentType: documentType || "OTHER",
        title: title ? sanitizeShortText(title) : filename,
        url,
        filename,
        mimeType: mimeType || "application/octet-stream",
        fileSize: fileSize || null,
        uploadedById: req.user!.id,
      };

      const parsed = insertWarrantyDocumentSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [doc] = await db.insert(warrantyDocuments).values(parsed.data).returning();
      res.status(201).json(doc);
    } catch (err) {
      console.error("Error adding warranty document:", err);
      res.status(500).json({ error: "Failed to add document" });
    }
  },
);

// ─── DELETE DOCUMENT ──────────────────────────────────────────────────────────

router.delete(
  "/projects/:code/warranty/cases/:id/documents/:docId",
  requireAuth,
  requireRole(...MANAGEMENT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const wc = await resolveCase(req.params.id, req, res);
      if (!wc) return;

      const [doc] = await db.select().from(warrantyDocuments).where(eq(warrantyDocuments.id, req.params.docId)).limit(1);
      if (!doc || doc.caseId !== req.params.id) return res.status(404).json({ error: "Document not found" });

      await db.delete(warrantyDocuments).where(eq(warrantyDocuments.id, req.params.docId));
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting warranty document:", err);
      res.status(500).json({ error: "Failed to delete document" });
    }
  },
);

// ─── LIST DOCUMENTS FOR CASE ──────────────────────────────────────────────────

router.get("/projects/:code/warranty/cases/:id/documents", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const wc = await resolveCase(req.params.id, req, res);
    if (!wc) return;

    const docs = await db
      .select()
      .from(warrantyDocuments)
      .where(eq(warrantyDocuments.caseId, req.params.id))
      .orderBy(desc(warrantyDocuments.createdAt));

    res.json(docs);
  } catch (err) {
    console.error("Error listing warranty documents:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// ─── HTML EXPORT ──────────────────────────────────────────────────────────────

router.get("/projects/:code/warranty/export", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const cases = await db
      .select()
      .from(warrantyCases)
      .where(eq(warrantyCases.projectId, project.id))
      .orderBy(desc(warrantyCases.createdAt));

    const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const sorted = [...cases].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

    const rows = sorted.map((wc) => `
      <tr>
        <td>${wc.caseNumber}</td>
        <td>${escHtml(wc.title)}</td>
        <td>${wc.type.replace(/_/g, " ")}</td>
        <td>${wc.status.replace(/_/g, " ")}</td>
        <td>${wc.priority}</td>
        <td>${wc.assignedToName ?? "—"}</td>
        <td>${wc.targetResolutionDate ? new Date(wc.targetResolutionDate).toLocaleDateString() : "—"}</td>
        <td>${wc.resolvedAt ? new Date(wc.resolvedAt).toLocaleDateString() : "—"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"/>
      <title>Warranty Cases — ${escHtml(project.name ?? project.code)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p { margin: 0 0 16px; color: #555; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
        th { background: #f5f5f5; font-weight: 600; }
        tr:nth-child(even) td { background: #fafafa; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>
      <h1>Warranty Cases — ${escHtml(project.name ?? project.code)}</h1>
      <p>Generated on ${new Date().toLocaleDateString()} &bull; ${cases.length} total case${cases.length !== 1 ? "s" : ""}</p>
      <table>
        <thead><tr>
          <th>Case #</th><th>Title</th><th>Type</th><th>Status</th>
          <th>Priority</th><th>Assigned To</th><th>Target Date</th><th>Resolved</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    console.error("Error exporting warranty cases:", err);
    res.status(500).json({ error: "Failed to export warranty cases" });
  }
});

function escHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default router;
