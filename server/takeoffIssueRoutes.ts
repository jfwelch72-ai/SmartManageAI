import { Router } from "express";
import { db } from "./db";
import { eq, desc, and, sql, max } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { sanitizeText } from "./sanitization";
import { insertNotification } from "./services/notificationService";

const router = Router();

async function verifyIssueSheetAccess(sheetId: string, user: { id: string; orgId: string; role: string }): Promise<{ allowed: boolean; sheet: any | null; reason?: string }> {
  const { takeoffSheets, projects, bids } = await import("@shared/schema");
  const { isNull } = await import("drizzle-orm");

  const [sheet] = await db
    .select({ id: takeoffSheets.id, projectId: takeoffSheets.projectId, bidId: takeoffSheets.bidId })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.id, sheetId))
    .limit(1);

  if (!sheet) return { allowed: false, sheet: null, reason: "Sheet not found" };

  if (sheet.projectId) {
    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(and(eq(projects.id, sheet.projectId), eq(projects.gcOrganizationId, user.orgId)))
      .limit(1);
    if (!project) return { allowed: false, sheet, reason: "Not found" };
    return { allowed: true, sheet };
  }

  if (sheet.bidId) {
    const [bid] = await db
      .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
      .from(bids)
      .where(and(eq(bids.id, sheet.bidId), eq(bids.gcOrganizationId, user.orgId)))
      .limit(1);
    if (!bid) return { allowed: false, sheet, reason: "Not found" };
    return { allowed: true, sheet };
  }

  return { allowed: false, sheet, reason: "Sheet has no parent" };
}

const WRITE_ROLES = ["ADMIN", "MANAGER", "ESTIMATOR", "FOREMAN", "SUPERINTENDENT", "PROJECT_ENGINEER"];

function canWrite(role: string): boolean {
  return WRITE_ROLES.includes(role) || role === "SUPER_ADMIN";
}

router.get("/api/takeoff/sheets/:sheetId/issues", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { sheetId } = req.params;
    const { takeoffIssues, takeoffIssueComments, users } = await import("@shared/schema");

    const access = await verifyIssueSheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Not found" });
      return;
    }

    const issues = await db
      .select({
        id: takeoffIssues.id,
        sheetId: takeoffIssues.sheetId,
        organizationId: takeoffIssues.organizationId,
        issueNumber: takeoffIssues.issueNumber,
        category: takeoffIssues.category,
        severity: takeoffIssues.severity,
        status: takeoffIssues.status,
        assigneeId: takeoffIssues.assigneeId,
        description: takeoffIssues.description,
        position: takeoffIssues.position,
        categoryId: takeoffIssues.categoryId,
        createdById: takeoffIssues.createdById,
        createdAt: takeoffIssues.createdAt,
        updatedAt: takeoffIssues.updatedAt,
      })
      .from(takeoffIssues)
      .where(eq(takeoffIssues.sheetId, sheetId))
      .orderBy(takeoffIssues.issueNumber);

    const issueIds = issues.map(i => i.id);
    let comments: any[] = [];

    if (issueIds.length > 0) {
      const allComments = await db
        .select({
          id: takeoffIssueComments.id,
          issueId: takeoffIssueComments.issueId,
          authorId: takeoffIssueComments.authorId,
          body: takeoffIssueComments.body,
          createdAt: takeoffIssueComments.createdAt,
          authorFirstName: users.firstName,
          authorLastName: users.lastName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(takeoffIssueComments)
        .leftJoin(users, eq(takeoffIssueComments.authorId, users.id))
        .where(sql`${takeoffIssueComments.issueId} = ANY(${sql`ARRAY[${sql.join(issueIds.map(id => sql`${id}`), sql`, `)}]::varchar[]`})`)
        .orderBy(takeoffIssueComments.createdAt);
      comments = allComments;
    }

    const result = issues.map(issue => ({
      ...issue,
      comments: comments.filter(c => c.issueId === issue.id),
    }));

    res.json(result);
  } catch (error) {
    console.error("Error fetching takeoff issues:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/issues", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    if (!canWrite(user.role)) {
      res.status(403).json({ error: "Insufficient permissions to create issues" });
      return;
    }

    const { takeoffIssues } = await import("@shared/schema");
    const { sheetId, category, severity, assigneeId, description, position, categoryId } = req.body;

    if (!sheetId || !position) {
      res.status(400).json({ error: "sheetId and position are required" });
      return;
    }

    const access = await verifyIssueSheetAccess(sheetId, user);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Not found" });
      return;
    }

    const [maxNumberResult] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${takeoffIssues.issueNumber}), 0)` })
      .from(takeoffIssues)
      .where(eq(takeoffIssues.sheetId, sheetId));

    const nextNumber = (maxNumberResult?.maxNum || 0) + 1;

    const [issue] = await db.insert(takeoffIssues).values({
      sheetId,
      organizationId: user.orgId,
      issueNumber: nextNumber,
      category: category || "QUESTION",
      severity: severity || "MEDIUM",
      status: "OPEN",
      assigneeId: assigneeId || null,
      description: sanitizeText(description || ""),
      position: typeof position === "string" ? position : JSON.stringify(position),
      categoryId: categoryId || null,
      createdById: user.id,
    }).returning();

    if (assigneeId && assigneeId !== user.id) {
      await insertNotification({
        userId: assigneeId,
        type: "TAKEOFF_ISSUE_ASSIGNED" as any,
        title: "Issue Assigned to You",
        message: `You have been assigned Issue #${nextNumber} on a takeoff sheet.`,
        relatedEntityId: issue.id,
        relatedEntityType: "takeoff_issue",
      }).catch(() => undefined);
    }

    res.status(201).json(issue);
  } catch (error) {
    console.error("Error creating takeoff issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/takeoff/issues/:issueId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { issueId } = req.params;
    const { takeoffIssues } = await import("@shared/schema");

    const [existingIssue] = await db
      .select()
      .from(takeoffIssues)
      .where(eq(takeoffIssues.id, issueId))
      .limit(1);

    if (!existingIssue || existingIssue.organizationId !== user.orgId) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const access = await verifyIssueSheetAccess(existingIssue.sheetId, user);
    if (!access.allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const canResolve = canWrite(user.role);
    const { status, severity, assigneeId, description, category } = req.body;

    if ((status === "RESOLVED" || status === "IN_REVIEW") && !canResolve) {
      res.status(403).json({ error: "Insufficient permissions to change status" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (severity !== undefined) updates.severity = severity;
    if (assigneeId !== undefined) updates.assigneeId = assigneeId || null;
    if (description !== undefined) updates.description = sanitizeText(description);
    if (category !== undefined) updates.category = category;

    const [updated] = await db
      .update(takeoffIssues)
      .set(updates)
      .where(eq(takeoffIssues.id, issueId))
      .returning();

    if (status !== undefined && status !== existingIssue.status) {
      await insertNotification({
        userId: existingIssue.createdById,
        type: "TAKEOFF_ISSUE_STATUS_CHANGED" as any,
        title: "Issue Status Updated",
        message: `Issue #${existingIssue.issueNumber} status changed to ${status}.`,
        relatedEntityId: issueId,
        relatedEntityType: "takeoff_issue",
      }).catch(() => undefined);
    }

    if (assigneeId !== undefined && assigneeId && assigneeId !== existingIssue.assigneeId && assigneeId !== user.id) {
      await insertNotification({
        userId: assigneeId,
        type: "TAKEOFF_ISSUE_ASSIGNED" as any,
        title: "Issue Assigned to You",
        message: `You have been assigned Issue #${existingIssue.issueNumber} on a takeoff sheet.`,
        relatedEntityId: issueId,
        relatedEntityType: "takeoff_issue",
      }).catch(() => undefined);
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating takeoff issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/takeoff/issues/:issueId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { issueId } = req.params;
    const { takeoffIssues } = await import("@shared/schema");

    const [existingIssue] = await db
      .select()
      .from(takeoffIssues)
      .where(eq(takeoffIssues.id, issueId))
      .limit(1);

    if (!existingIssue || existingIssue.organizationId !== user.orgId) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const isAdmin = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPER_ADMIN";
    const isCreator = existingIssue.createdById === user.id;

    if (!isAdmin && !isCreator) {
      res.status(403).json({ error: "Only admins or the creator can delete this issue" });
      return;
    }

    await db.delete(takeoffIssues).where(eq(takeoffIssues.id, issueId));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting takeoff issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/takeoff/issues/:issueId/comments", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { issueId } = req.params;
    const { takeoffIssues, takeoffIssueComments, users } = await import("@shared/schema");

    const [existingIssue] = await db
      .select()
      .from(takeoffIssues)
      .where(eq(takeoffIssues.id, issueId))
      .limit(1);

    if (!existingIssue || existingIssue.organizationId !== user.orgId) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const { body } = req.body;
    if (!body || !body.trim()) {
      res.status(400).json({ error: "Comment body is required" });
      return;
    }

    const [comment] = await db.insert(takeoffIssueComments).values({
      issueId,
      authorId: user.id,
      body: sanitizeText(body),
    }).returning();

    const [userRecord] = await db
      .select({ name: users.name, profilePhotoUrl: users.profilePhotoUrl })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    res.status(201).json({
      ...comment,
      authorName: userRecord?.name,
      authorAvatarUrl: userRecord?.profilePhotoUrl,
    });
  } catch (error) {
    console.error("Error creating takeoff issue comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/takeoff/issue-comments/:commentId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { commentId } = req.params;
    const { takeoffIssueComments, takeoffIssues } = await import("@shared/schema");

    const [comment] = await db
      .select({
        id: takeoffIssueComments.id,
        authorId: takeoffIssueComments.authorId,
        issue: { organizationId: takeoffIssues.organizationId },
      })
      .from(takeoffIssueComments)
      .leftJoin(takeoffIssues, eq(takeoffIssueComments.issueId, takeoffIssues.id))
      .where(eq(takeoffIssueComments.id, commentId))
      .limit(1);

    if (!comment || comment.issue?.organizationId !== user.orgId) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const isAdmin = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPER_ADMIN";
    if (!isAdmin && comment.authorId !== user.id) {
      res.status(403).json({ error: "Cannot delete another user's comment" });
      return;
    }

    await db.delete(takeoffIssueComments).where(eq(takeoffIssueComments.id, commentId));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting takeoff issue comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
