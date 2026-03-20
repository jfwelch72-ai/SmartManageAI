import { Router, type Response } from "express";
import { db } from "./db";
import {
  punchListItems, projects,
  insertPunchListItemSchema, type PunchListItem,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest, type UserRole } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
};

// Roles that can manage items (create/edit)
const MANAGEMENT_ROLES: UserRole[] = [
  "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER",
  "OFFICE_MANAGER", "SAFETY_MANAGER",
];

// Roles that can verify/reject (close out phase gate)
const VERIFY_ROLES: UserRole[] = ["ADMIN", "MANAGER", "SUPERINTENDENT"];

// Roles that can mark in-progress / resolved
const WORKER_ROLES: UserRole[] = [
  "ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER",
  "OFFICE_MANAGER", "SAFETY_MANAGER", "HOURLY_EMPLOYEE",
];

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

// Verify the item belongs to a project in the user's org; returns project + item or sends 403/404
async function resolveItem(id: string, req: AuthRequest, res: Response) {
  const [item] = await db
    .select()
    .from(punchListItems)
    .where(eq(punchListItems.id, id))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Punch list item not found" });
    return null;
  }

  // Check project org membership
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }

  if (shouldFilter && orgId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, item.projectId)).limit(1);
    if (!project || project.gcOrganizationId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return null;
    }
  }

  return item;
}

function getUserRole(req: AuthRequest): string {
  return (req.user!.effectiveRole || req.user!.role) as string;
}

function hasRole(req: AuthRequest, roles: UserRole[]): boolean {
  const role = getUserRole(req);
  return roles.includes(role as UserRole);
}

async function generateItemNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(punchListItems)
    .innerJoin(projects, eq(punchListItems.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  const count = result?.count || 0;
  return `PLI-${projectCode}-${String(Number(count) + 1).padStart(3, "0")}`;
}

function enrichItem(item: PunchListItem) {
  return {
    ...item,
    attachments: item.attachments ?? [],
    statusHistory: item.statusHistory ?? [],
  };
}

type AttachmentEntry = { url: string; filename: string; mimeType: string; uploadedAt: string };
type StatusEntry = { status: string; changedBy: string; changedAt: string; note?: string };

// ─── LIST ─────────────────────────────────────────────────────────────────────
router.get("/projects/:code/punch-list", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) return res.json([]);

    const { status, priority, trade, q } = req.query;
    const conditions: ReturnType<typeof eq>[] = [eq(punchListItems.projectId, project.id)];

    if (status && typeof status === "string" && status !== "all") {
      conditions.push(eq(punchListItems.status, status as PunchListItem["status"]));
    }
    if (priority && typeof priority === "string" && priority !== "all") {
      conditions.push(eq(punchListItems.priority, priority as PunchListItem["priority"]));
    }
    if (trade && typeof trade === "string" && trade !== "all") {
      conditions.push(eq(punchListItems.trade, trade as PunchListItem["trade"]));
    }

    let items = await db
      .select()
      .from(punchListItems)
      .where(and(...conditions))
      .orderBy(desc(punchListItems.createdAt));

    if (q && typeof q === "string" && q.trim()) {
      const lower = q.toLowerCase();
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(lower) ||
          (i.description ?? "").toLowerCase().includes(lower) ||
          (i.location ?? "").toLowerCase().includes(lower) ||
          i.itemNumber.toLowerCase().includes(lower),
      );
    }

    items.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

    res.json(items.map(enrichItem));
  } catch (err) {
    console.error("Error listing punch list items:", err);
    res.status(500).json({ error: "Failed to fetch punch list items" });
  }
});

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post(
  "/projects/:code/punch-list",
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
      const itemNumber = await generateItemNumber(req.params.code);

      const initialHistory: StatusEntry[] = [{
        status: "OPEN",
        changedBy: `${req.user!.firstName} ${req.user!.lastName}`.trim() || userId,
        changedAt: new Date().toISOString(),
        note: "Item created",
      }];

      const body = {
        ...req.body,
        projectId: project.id,
        itemNumber,
        createdById: userId,
        title: req.body.title ? sanitizeShortText(req.body.title) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : null,
        location: req.body.location ? sanitizeShortText(req.body.location) : null,
        assignedToName: req.body.assignedToName ? sanitizeShortText(req.body.assignedToName) : null,
        assignedToEmail: req.body.assignedToEmail ? sanitizeShortText(req.body.assignedToEmail) : null,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        attachments: [],
        statusHistory: initialHistory,
        status: "OPEN",
      };

      const parsed = insertPunchListItemSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [item] = await db.insert(punchListItems).values(parsed.data).returning();

      await logAudit({
        userId,
        action: "CREATE",
        entityType: "punchListItem",
        entityId: item.id,
        newValue: JSON.stringify({ itemNumber, title: item.title, projectId: project.id }),
      }, req);

      res.status(201).json(enrichItem(item));
    } catch (err) {
      console.error("Error creating punch list item:", err);
      res.status(500).json({ error: "Failed to create punch list item" });
    }
  },
);

// ─── GET ONE (project-scoped) ─────────────────────────────────────────────────
router.get("/projects/:code/punch-list/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const item = await resolveItem(req.params.id, req, res);
    if (!item) return;
    // Verify item belongs to this project code
    const project = await getProjectByCode(req.params.code);
    if (!project || project.id !== item.projectId) {
      return res.status(404).json({ error: "Punch list item not found" });
    }
    res.json(enrichItem(item));
  } catch (err) {
    console.error("Error fetching punch list item:", err);
    res.status(500).json({ error: "Failed to fetch punch list item" });
  }
});

// ─── UPDATE (project-scoped) ──────────────────────────────────────────────────
router.patch("/projects/:code/punch-list/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const item = await resolveItem(req.params.id, req, res);
    if (!item) return;

    const project = await getProjectByCode(req.params.code);
    if (!project || project.id !== item.projectId) {
      return res.status(404).json({ error: "Punch list item not found" });
    }

    const userId = req.user!.id;
    const userName = `${req.user!.firstName} ${req.user!.lastName}`.trim() || userId;

    const update: Partial<PunchListItem> & { updatedAt: Date } = { updatedAt: new Date() };

    // Field edits — require management role
    const isEditingFields = req.body.status === undefined &&
      (req.body.title !== undefined || req.body.description !== undefined ||
       req.body.location !== undefined || req.body.trade !== undefined ||
       req.body.priority !== undefined || req.body.assignedToUserId !== undefined ||
       req.body.assignedToName !== undefined || req.body.assignedToEmail !== undefined ||
       req.body.dueDate !== undefined);

    if (isEditingFields && !hasRole(req, MANAGEMENT_ROLES)) {
      return res.status(403).json({ error: "Insufficient permissions to edit punch list items" });
    }

    if (req.body.title !== undefined) update.title = sanitizeShortText(req.body.title);
    if (req.body.description !== undefined) update.description = sanitizeText(req.body.description);
    if (req.body.location !== undefined) update.location = sanitizeShortText(req.body.location);
    if (req.body.trade !== undefined) update.trade = req.body.trade;
    if (req.body.priority !== undefined) update.priority = req.body.priority;
    if (req.body.assignedToUserId !== undefined) update.assignedToUserId = req.body.assignedToUserId ?? null;
    if (req.body.assignedToName !== undefined) update.assignedToName = sanitizeShortText(req.body.assignedToName);
    if (req.body.assignedToEmail !== undefined) update.assignedToEmail = sanitizeShortText(req.body.assignedToEmail);
    if (req.body.dueDate !== undefined) update.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    if (req.body.inspectionId !== undefined) update.inspectionId = req.body.inspectionId ?? null;

    // Status transitions with server-side role enforcement
    if (req.body.status !== undefined && req.body.status !== item.status) {
      const newStatus = req.body.status as PunchListItem["status"];

      // Determine allowed transitions per role
      const role = getUserRole(req);
      const canDoTransition = (() => {
        if (newStatus === "IN_PROGRESS" || newStatus === "RESOLVED") {
          return hasRole(req, WORKER_ROLES);
        }
        if (newStatus === "VERIFIED" || newStatus === "REJECTED") {
          return hasRole(req, VERIFY_ROLES);
        }
        if (newStatus === "OPEN") {
          return hasRole(req, VERIFY_ROLES); // reopen requires manager+
        }
        return false;
      })();

      if (!canDoTransition) {
        return res.status(403).json({ error: `Role '${role}' cannot set status to '${newStatus}'` });
      }

      update.status = newStatus;

      const currentHistory = (item.statusHistory ?? []) as StatusEntry[];
      const historyEntry: StatusEntry = {
        status: newStatus,
        changedBy: userName,
        changedAt: new Date().toISOString(),
        note: req.body.statusNote || undefined,
      };

      if (newStatus === "RESOLVED") {
        update.resolvedAt = new Date();
      } else if (newStatus === "VERIFIED") {
        update.verifiedAt = new Date();
        update.verifiedById = userId;
      } else if (newStatus === "OPEN" || newStatus === "IN_PROGRESS") {
        if (item.status === "RESOLVED" || item.status === "VERIFIED") {
          update.resolvedAt = null;
          update.verifiedAt = null;
          update.verifiedById = null;
        }
      }

      update.statusHistory = [...currentHistory, historyEntry];
    }

    const [updated] = await db
      .update(punchListItems)
      .set(update)
      .where(eq(punchListItems.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "punchListItem",
      entityId: updated.id,
      newValue: JSON.stringify({ changes: Object.keys(update), projectCode: req.params.code }),
    }, req);

    res.json(enrichItem(updated));
  } catch (err) {
    console.error("Error updating punch list item:", err);
    res.status(500).json({ error: "Failed to update punch list item" });
  }
});

// ─── DELETE (project-scoped) ──────────────────────────────────────────────────
router.delete(
  "/projects/:code/punch-list/:id",
  requireAuth,
  requireRole(...VERIFY_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const item = await resolveItem(req.params.id, req, res);
      if (!item) return;

      const project = await getProjectByCode(req.params.code);
      if (!project || project.id !== item.projectId) {
        return res.status(404).json({ error: "Punch list item not found" });
      }

      await db.delete(punchListItems).where(eq(punchListItems.id, req.params.id));

      await logAudit({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "punchListItem",
        entityId: item.id,
        oldValue: JSON.stringify({ itemNumber: item.itemNumber, title: item.title }),
      }, req);

      res.status(204).send();
    } catch (err) {
      console.error("Error deleting punch list item:", err);
      res.status(500).json({ error: "Failed to delete punch list item" });
    }
  },
);

// ─── ADD ATTACHMENT (project-scoped, uses object storage URL from ObjectUploader) ─
router.post(
  "/projects/:code/punch-list/:id/attachments",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const item = await resolveItem(req.params.id, req, res);
      if (!item) return;

      const project = await getProjectByCode(req.params.code);
      if (!project || project.id !== item.projectId) {
        return res.status(404).json({ error: "Punch list item not found" });
      }

      const { url, filename, mimeType } = req.body;
      if (!url || !filename) return res.status(400).json({ error: "url and filename are required" });

      const current = (item.attachments ?? []) as AttachmentEntry[];
      const newAttachment: AttachmentEntry = {
        url,
        filename,
        mimeType: mimeType || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      };
      const updated = [...current, newAttachment];

      const [updatedItem] = await db
        .update(punchListItems)
        .set({ attachments: updated, updatedAt: new Date() })
        .where(eq(punchListItems.id, req.params.id))
        .returning();

      res.json(enrichItem(updatedItem));
    } catch (err) {
      console.error("Error adding attachment:", err);
      res.status(500).json({ error: "Failed to add attachment" });
    }
  },
);

// ─── REMOVE ATTACHMENT (project-scoped) ───────────────────────────────────────
router.delete(
  "/projects/:code/punch-list/:id/attachments/:filename",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const item = await resolveItem(req.params.id, req, res);
      if (!item) return;

      const project = await getProjectByCode(req.params.code);
      if (!project || project.id !== item.projectId) {
        return res.status(404).json({ error: "Punch list item not found" });
      }

      const current = (item.attachments ?? []) as AttachmentEntry[];
      const filtered = current.filter((a) => a.filename !== req.params.filename);

      const [updatedItem] = await db
        .update(punchListItems)
        .set({ attachments: filtered, updatedAt: new Date() })
        .where(eq(punchListItems.id, req.params.id))
        .returning();

      res.json(enrichItem(updatedItem));
    } catch (err) {
      console.error("Error removing attachment:", err);
      res.status(500).json({ error: "Failed to remove attachment" });
    }
  },
);

// ─── PDF EXPORT (browser-printable HTML — consistent with other modules) ──────
router.get("/projects/:code/punch-list/export/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const items = await db
      .select()
      .from(punchListItems)
      .where(eq(punchListItems.projectId, project.id))
      .orderBy(desc(punchListItems.createdAt));

    const rows = items
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99))
      .map((i) => `
        <tr>
          <td>${i.itemNumber}</td>
          <td>${i.title.replace(/</g, "&lt;")}</td>
          <td>${(i.location ?? "").replace(/</g, "&lt;")}</td>
          <td>${i.trade}</td>
          <td class="${i.priority}">${i.priority}</td>
          <td class="status-${i.status}">${i.status.replace("_", " ")}</td>
          <td>${(i.assignedToName ?? "").replace(/</g, "&lt;")}</td>
          <td>${i.dueDate ? new Date(i.dueDate).toLocaleDateString() : ""}</td>
        </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Punch List – ${project.name}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
    h1 { font-size: 16px; margin-bottom: 4px; }
    h2 { font-size: 12px; color: #555; font-weight: normal; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e293b; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .CRITICAL { background: #fee2e2; color: #991b1b; font-weight: bold; padding: 2px 6px; border-radius: 3px; display: inline-block; }
    .HIGH { background: #ffedd5; color: #9a3412; font-weight: bold; padding: 2px 6px; border-radius: 3px; display: inline-block; }
    .MEDIUM { background: #fef9c3; color: #92400e; font-weight: bold; padding: 2px 6px; border-radius: 3px; display: inline-block; }
    .LOW { background: #dcfce7; color: #166534; font-weight: bold; padding: 2px 6px; border-radius: 3px; display: inline-block; }
    .status-OPEN { color: #1e40af; }
    .status-IN_PROGRESS { color: #92400e; }
    .status-RESOLVED { color: #065f46; }
    .status-VERIFIED { color: #166534; font-weight: bold; }
    .status-REJECTED { color: #991b1b; }
    .summary { display: flex; gap: 20px; margin-bottom: 16px; }
    .stat { background: #f1f5f9; padding: 8px 14px; border-radius: 6px; text-align: center; }
    .stat-num { font-size: 18px; font-weight: bold; color: #334155; }
    .stat-lbl { font-size: 9px; color: #64748b; text-transform: uppercase; }
    @media print { @page { margin: 15mm; } body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Punch List – ${project.name}</h1>
  <h2>Project: ${project.code} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString()} &nbsp;|&nbsp; Total: ${items.length} items</h2>
  <div class="summary">
    ${["OPEN","IN_PROGRESS","RESOLVED","VERIFIED","REJECTED"].map(s => {
      const count = items.filter(i => i.status === s).length;
      return `<div class="stat"><div class="stat-num">${count}</div><div class="stat-lbl">${s.replace("_"," ")}</div></div>`;
    }).join("")}
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Title</th>
        <th>Location</th>
        <th>Trade</th>
        <th>Priority</th>
        <th>Status</th>
        <th>Assigned To</th>
        <th>Due Date</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="punch-list-${project.code}.html"`);
    res.send(html);
  } catch (err) {
    console.error("Error exporting punch list:", err);
    res.status(500).json({ error: "Failed to export punch list" });
  }
});

// ─── CREATE FROM FAILED INSPECTION ────────────────────────────────────────────
// Converts a failed inspection's punch list note into a tracked punch list item
router.post(
  "/projects/:code/inspections/:inspectionId/punch-list",
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
      const itemNumber = await generateItemNumber(req.params.code);

      const initialHistory: StatusEntry[] = [{
        status: "OPEN",
        changedBy: `${req.user!.firstName} ${req.user!.lastName}`.trim() || userId,
        changedAt: new Date().toISOString(),
        note: `Created from failed inspection #${req.params.inspectionId}`,
      }];

      const body = {
        projectId: project.id,
        inspectionId: req.params.inspectionId,
        itemNumber,
        createdById: userId,
        title: req.body.title ? sanitizeShortText(req.body.title) : "Deficiency from failed inspection",
        description: req.body.description ? sanitizeText(req.body.description) : null,
        location: req.body.location ? sanitizeShortText(req.body.location) : null,
        trade: req.body.trade || "GENERAL",
        priority: req.body.priority || "MEDIUM",
        status: "OPEN" as const,
        assignedToName: req.body.assignedToName ? sanitizeShortText(req.body.assignedToName) : null,
        assignedToEmail: req.body.assignedToEmail ? sanitizeShortText(req.body.assignedToEmail) : null,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        attachments: [],
        statusHistory: initialHistory,
      };

      const parsed = insertPunchListItemSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [item] = await db.insert(punchListItems).values(parsed.data).returning();

      await logAudit({
        userId,
        action: "CREATE",
        entityType: "punchListItem",
        entityId: item.id,
        newValue: JSON.stringify({ itemNumber, inspectionId: req.params.inspectionId, projectId: project.id }),
      }, req);

      res.status(201).json(enrichItem(item));
    } catch (err) {
      console.error("Error creating punch list item from inspection:", err);
      res.status(500).json({ error: "Failed to create punch list item from inspection" });
    }
  },
);

export default router;
