import { Router, type Response } from "express";
import { db } from "./db";
import {
  punchListItems, projects,
  insertPunchListItemSchema, type PunchListItem,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
};

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
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
  };
}

// ─── LIST ────────────────────────────────────────────────────────────────────
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

    // Sort by priority within date order
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
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER", "OFFICE_MANAGER", "SAFETY_MANAGER"),
  async (req: AuthRequest, res: Response) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const userId = req.user!.id;
      const itemNumber = await generateItemNumber(req.params.code);

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

// ─── GET ONE ──────────────────────────────────────────────────────────────────
router.get("/punch-list/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [item] = await db.select().from(punchListItems).where(eq(punchListItems.id, req.params.id)).limit(1);
    if (!item) return res.status(404).json({ error: "Punch list item not found" });
    res.json(enrichItem(item));
  } catch (err) {
    console.error("Error fetching punch list item:", err);
    res.status(500).json({ error: "Failed to fetch punch list item" });
  }
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
router.patch("/punch-list/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const [item] = await db.select().from(punchListItems).where(eq(punchListItems.id, req.params.id)).limit(1);
    if (!item) return res.status(404).json({ error: "Punch list item not found" });

    const update: Partial<PunchListItem> & { updatedAt: Date } = { updatedAt: new Date() };

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

    // Status transitions
    if (req.body.status !== undefined && req.body.status !== item.status) {
      const newStatus = req.body.status as PunchListItem["status"];
      update.status = newStatus;

      if (newStatus === "RESOLVED") {
        update.resolvedAt = new Date();
      } else if (newStatus === "VERIFIED") {
        update.verifiedAt = new Date();
        update.verifiedById = userId;
      } else if (newStatus === "OPEN" || newStatus === "IN_PROGRESS") {
        // Reopen — clear resolution timestamps
        if (item.status === "RESOLVED" || item.status === "VERIFIED") {
          update.resolvedAt = null;
          update.verifiedAt = null;
          update.verifiedById = null;
        }
      }
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
      newValue: JSON.stringify({ changes: Object.keys(update) }),
    }, req);

    res.json(enrichItem(updated));
  } catch (err) {
    console.error("Error updating punch list item:", err);
    res.status(500).json({ error: "Failed to update punch list item" });
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete(
  "/punch-list/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const [item] = await db.select().from(punchListItems).where(eq(punchListItems.id, req.params.id)).limit(1);
      if (!item) return res.status(404).json({ error: "Punch list item not found" });

      await db.delete(punchListItems).where(eq(punchListItems.id, req.params.id));

      await logAudit({
        userId,
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

// ─── ADD ATTACHMENT (URL-based — client uploads to object storage, sends URL) ─
router.post("/punch-list/:id/attachments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [item] = await db.select().from(punchListItems).where(eq(punchListItems.id, req.params.id)).limit(1);
    if (!item) return res.status(404).json({ error: "Punch list item not found" });

    const { url, filename, mimeType } = req.body;
    if (!url || !filename) return res.status(400).json({ error: "url and filename are required" });

    const current = (item.attachments ?? []) as Array<{ url: string; filename: string; mimeType: string; uploadedAt: string }>;
    const newAttachment = { url, filename, mimeType: mimeType || "application/octet-stream", uploadedAt: new Date().toISOString() };
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
});

// ─── REMOVE ATTACHMENT ────────────────────────────────────────────────────────
router.delete("/punch-list/:id/attachments/:filename", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [item] = await db.select().from(punchListItems).where(eq(punchListItems.id, req.params.id)).limit(1);
    if (!item) return res.status(404).json({ error: "Punch list item not found" });

    const current = (item.attachments ?? []) as Array<{ url: string; filename: string; mimeType: string; uploadedAt: string }>;
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
});

// ─── PDF EXPORT ───────────────────────────────────────────────────────────────
router.get("/projects/:code/punch-list/export/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const items = await db
      .select()
      .from(punchListItems)
      .where(eq(punchListItems.projectId, project.id))
      .orderBy(desc(punchListItems.createdAt));

    // Build a simple HTML → PDF approach using browser-printable HTML
    const rows = items
      .map(
        (i) => `
        <tr>
          <td>${i.itemNumber}</td>
          <td>${i.title}</td>
          <td>${i.location ?? ""}</td>
          <td>${i.trade}</td>
          <td>${i.priority}</td>
          <td>${i.status}</td>
          <td>${i.assignedToName ?? ""}</td>
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
    .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: bold; text-transform: uppercase; }
    .CRITICAL { background: #fee2e2; color: #991b1b; }
    .HIGH { background: #ffedd5; color: #9a3412; }
    .MEDIUM { background: #fef9c3; color: #92400e; }
    .LOW { background: #dcfce7; color: #166534; }
    .OPEN { background: #dbeafe; color: #1e40af; }
    .IN_PROGRESS { background: #fef9c3; color: #92400e; }
    .RESOLVED { background: #d1fae5; color: #065f46; }
    .VERIFIED { background: #f0fdf4; color: #166534; }
    .REJECTED { background: #fee2e2; color: #991b1b; }
    @media print { @page { margin: 15mm; } }
  </style>
</head>
<body>
  <h1>Punch List – ${project.name}</h1>
  <h2>Project: ${project.code} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString()}</h2>
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
  <p style="margin-top:16px;color:#888;font-size:10px;">Total items: ${items.length}</p>
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

export default router;
