import { Router, Response } from "express";
import { db } from "./db";
import { portalChatThreads, portalChatMessages, subcontractorPortalTokens, projects, users, notifications } from "@shared/schema";
import { eq, and, desc, sql, inArray, asc, gt, or, ilike } from "drizzle-orm";
import { requirePortalAuth, type PortalRequest } from "./portalAuth";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { sendEmail } from "./email";

const router = Router();

async function notifyChatTeamMembers(orgId: string, projectId: string, senderName: string, content: string) {
  try {
    const teamMembers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        eq(users.isActive, true),
        inArray(users.role, ["ADMIN", "MANAGER", "SUPERINTENDENT"])
      ));

    if (teamMembers.length > 0) {
      await db.insert(notifications).values(teamMembers.map(m => ({
        userId: m.id,
        type: "PORTAL_CHAT_MESSAGE" as const,
        title: "New Portal Chat Message",
        message: `${senderName} sent a message: "${content.substring(0, 80)}..."`,
        relatedEntityId: projectId,
        relatedEntityType: "project" as const,
      })));
    }
  } catch (error) {
    console.error("Failed to create portal chat notifications:", error);
  }
}

// ============================================================
// Portal User Routes (token-based auth)
// ============================================================

router.get("/portal/chat/threads", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;

    const threads = await db
      .select()
      .from(portalChatThreads)
      .where(eq(portalChatThreads.portalTokenId, token.id))
      .orderBy(desc(portalChatThreads.lastMessageAt));

    const threadsWithPreview = await Promise.all(
      threads.map(async (thread) => {
        const [latestMsg] = await db
          .select({ content: portalChatMessages.content })
          .from(portalChatMessages)
          .where(and(
            eq(portalChatMessages.threadId, thread.id),
            eq(portalChatMessages.isInternal, false)
          ))
          .orderBy(desc(portalChatMessages.createdAt))
          .limit(1);

        return {
          ...thread,
          lastMessagePreview: latestMsg ? latestMsg.content.substring(0, 100) : null,
        };
      })
    );

    res.json(threadsWithPreview);
  } catch (error) {
    console.error("Portal chat threads list error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/chat/threads", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { subject, category, linkedEntityType, linkedEntityId, priority, message } = req.body;

    if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
      return res.status(400).json({ error: "Subject is required" });
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Initial message is required" });
    }

    const [thread] = await db.insert(portalChatThreads).values({
      organizationId: token.organizationId,
      projectId: token.projectId,
      portalTokenId: token.id,
      subject: subject.trim(),
      category: category || "GENERAL",
      linkedEntityType: linkedEntityType || null,
      linkedEntityId: linkedEntityId || null,
      priority: priority || "NORMAL",
      teamUnreadCount: 1,
      portalUnreadCount: 0,
    }).returning();

    const [msg] = await db.insert(portalChatMessages).values({
      threadId: thread.id,
      senderType: "portal",
      senderPortalTokenId: token.id,
      senderName: token.contactName,
      content: message.trim(),
      readByPortal: true,
      readByTeam: false,
    }).returning();

    notifyChatTeamMembers(token.organizationId, token.projectId, token.contactName, message.trim());

    res.status(201).json({ ...thread, message: msg });
  } catch (error) {
    console.error("Portal chat create thread error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/portal/chat/threads/:threadId/messages", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { threadId } = req.params;

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(
        eq(portalChatThreads.id, threadId),
        eq(portalChatThreads.portalTokenId, token.id)
      ))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db
      .select()
      .from(portalChatMessages)
      .where(and(
        eq(portalChatMessages.threadId, threadId),
        eq(portalChatMessages.isInternal, false)
      ))
      .orderBy(asc(portalChatMessages.createdAt));

    await db
      .update(portalChatMessages)
      .set({ readByPortal: true })
      .where(and(
        eq(portalChatMessages.threadId, threadId),
        eq(portalChatMessages.senderType, "team"),
        eq(portalChatMessages.readByPortal, false)
      ));

    await db
      .update(portalChatThreads)
      .set({ portalUnreadCount: 0 })
      .where(eq(portalChatThreads.id, threadId));

    res.json(messages);
  } catch (error) {
    console.error("Portal chat get messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/chat/threads/:threadId/messages", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { threadId } = req.params;
    const { content, attachmentUrl, attachmentName, attachmentType } = req.body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Message content is required" });
    }

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(
        eq(portalChatThreads.id, threadId),
        eq(portalChatThreads.portalTokenId, token.id)
      ))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (thread.status !== "OPEN") {
      return res.status(403).json({ error: "Thread is not open for new messages" });
    }

    const [msg] = await db.insert(portalChatMessages).values({
      threadId,
      senderType: "portal",
      senderPortalTokenId: token.id,
      senderName: token.contactName,
      content: content.trim(),
      attachmentUrl: attachmentUrl || null,
      attachmentName: attachmentName || null,
      attachmentType: attachmentType || null,
      readByPortal: true,
      readByTeam: false,
    }).returning();

    await db
      .update(portalChatThreads)
      .set({
        lastMessageAt: new Date(),
        teamUnreadCount: sql`${portalChatThreads.teamUnreadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(portalChatThreads.id, threadId));

    notifyChatTeamMembers(thread.organizationId, thread.projectId, token.contactName, content.trim());

    res.status(201).json(msg);
  } catch (error) {
    console.error("Portal chat send message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/portal/chat/threads/:threadId/read", requirePortalAuth, async (req: PortalRequest, res: Response) => {
  try {
    const token = req.portalToken!;
    const { threadId } = req.params;

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(
        eq(portalChatThreads.id, threadId),
        eq(portalChatThreads.portalTokenId, token.id)
      ))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    await db
      .update(portalChatMessages)
      .set({ readByPortal: true })
      .where(and(
        eq(portalChatMessages.threadId, threadId),
        eq(portalChatMessages.senderType, "team"),
        eq(portalChatMessages.readByPortal, false)
      ));

    await db
      .update(portalChatThreads)
      .set({ portalUnreadCount: 0 })
      .where(eq(portalChatThreads.id, threadId));

    res.json({ success: true });
  } catch (error) {
    console.error("Portal chat mark read error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Also add team-side mark read route
router.post("/team/chat/threads/:threadId/read", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const { threadId } = req.params;

    const conditions: any[] = [eq(portalChatThreads.id, threadId)];
    if (shouldFilter && orgId) {
      conditions.push(eq(portalChatThreads.organizationId, orgId));
    }

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(...conditions))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    await db
      .update(portalChatMessages)
      .set({ readByTeam: true })
      .where(and(
        eq(portalChatMessages.threadId, threadId),
        eq(portalChatMessages.senderType, "portal"),
        eq(portalChatMessages.readByTeam, false)
      ));

    await db
      .update(portalChatThreads)
      .set({ teamUnreadCount: 0 })
      .where(eq(portalChatThreads.id, threadId));

    res.json({ success: true });
  } catch (error) {
    console.error("Team portal chat mark read error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Team Member Routes (JWT auth)
// ============================================================

router.get("/team/chat/threads", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const projectIdFilter = req.query.projectId as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const priorityFilter = req.query.priority as string | undefined;
    const searchFilter = req.query.search as string | undefined;

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(portalChatThreads.organizationId, orgId));
    }
    if (projectIdFilter) {
      conditions.push(eq(portalChatThreads.projectId, projectIdFilter));
    }
    if (statusFilter) {
      conditions.push(eq(portalChatThreads.status, statusFilter as any));
    }
    if (priorityFilter) {
      conditions.push(eq(portalChatThreads.priority, priorityFilter as any));
    }

    const results = await db
      .select({
        thread: portalChatThreads,
        contactName: subcontractorPortalTokens.contactName,
        contactEmail: subcontractorPortalTokens.contactEmail,
        projectName: projects.name,
        projectCode: projects.code,
      })
      .from(portalChatThreads)
      .leftJoin(subcontractorPortalTokens, eq(portalChatThreads.portalTokenId, subcontractorPortalTokens.id))
      .leftJoin(projects, eq(portalChatThreads.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(portalChatThreads.lastMessageAt));

    let mapped = results.map((r) => ({
      ...r.thread,
      contactName: r.contactName,
      contactEmail: r.contactEmail,
      project: {
        name: r.projectName,
        code: r.projectCode,
      },
    }));

    if (searchFilter && searchFilter.trim().length > 0) {
      const searchLower = searchFilter.trim().toLowerCase();
      mapped = mapped.filter(t =>
        t.subject.toLowerCase().includes(searchLower) ||
        (t.contactName && t.contactName.toLowerCase().includes(searchLower))
      );
    }

    res.json(mapped);
  } catch (error) {
    console.error("Team portal chat threads list error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/team/chat/threads/:threadId/messages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const { threadId } = req.params;

    const conditions: any[] = [eq(portalChatThreads.id, threadId)];
    if (shouldFilter && orgId) {
      conditions.push(eq(portalChatThreads.organizationId, orgId));
    }

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(...conditions))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db
      .select()
      .from(portalChatMessages)
      .where(eq(portalChatMessages.threadId, threadId))
      .orderBy(asc(portalChatMessages.createdAt));

    await db
      .update(portalChatMessages)
      .set({ readByTeam: true })
      .where(and(
        eq(portalChatMessages.threadId, threadId),
        eq(portalChatMessages.senderType, "portal"),
        eq(portalChatMessages.readByTeam, false)
      ));

    await db
      .update(portalChatThreads)
      .set({ teamUnreadCount: 0 })
      .where(eq(portalChatThreads.id, threadId));

    res.json(messages);
  } catch (error) {
    console.error("Team portal chat get messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/team/chat/threads/:threadId/messages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const user = req.user!;
    const { threadId } = req.params;
    const { content, isInternal, attachmentUrl, attachmentName, attachmentType } = req.body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Message content is required" });
    }

    const conditions: any[] = [eq(portalChatThreads.id, threadId)];
    if (shouldFilter && orgId) {
      conditions.push(eq(portalChatThreads.organizationId, orgId));
    }

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(...conditions))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (thread.status !== "OPEN") {
      return res.status(403).json({ error: "Thread is not open for new messages" });
    }

    const isInternalNote = isInternal === true;
    const senderName = `${user.firstName} ${user.lastName}`;

    const [msg] = await db.insert(portalChatMessages).values({
      threadId,
      senderType: "team",
      senderUserId: user.id,
      senderName,
      content: content.trim(),
      isInternal: isInternalNote,
      attachmentUrl: attachmentUrl || null,
      attachmentName: attachmentName || null,
      attachmentType: attachmentType || null,
      readByTeam: true,
      readByPortal: isInternalNote ? true : false,
    }).returning();

    if (!isInternalNote) {
      await db
        .update(portalChatThreads)
        .set({
          lastMessageAt: new Date(),
          portalUnreadCount: sql`${portalChatThreads.portalUnreadCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(portalChatThreads.id, threadId));

      try {
        const [portalToken] = await db
          .select()
          .from(subcontractorPortalTokens)
          .where(eq(subcontractorPortalTokens.id, thread.portalTokenId))
          .limit(1);

        if (portalToken) {
          await sendEmail({
            to: portalToken.contactEmail,
            subject: `New message on "${thread.subject}"`,
            html: `<p>Hi ${portalToken.contactName},</p><p>You have a new message from the project team regarding "${thread.subject}".</p><p>Please log in to the portal to view and respond.</p>`,
          });
        }
      } catch (emailError) {
        console.error("Failed to send portal chat email notification:", emailError);
      }
    }

    res.status(201).json(msg);
  } catch (error) {
    console.error("Team portal chat send message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/team/chat/threads/:threadId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.status(404).json({ error: "Not found" });

    const { threadId } = req.params;
    const { status, priority } = req.body;

    const conditions: any[] = [eq(portalChatThreads.id, threadId)];
    if (shouldFilter && orgId) {
      conditions.push(eq(portalChatThreads.organizationId, orgId));
    }

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(...conditions))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const updates: any = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (priority) updates.priority = priority;

    const [updated] = await db
      .update(portalChatThreads)
      .set(updates)
      .where(eq(portalChatThreads.id, threadId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Team portal chat update thread error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/team/chat/unread", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json({ unreadCount: 0 });

    const conditions: any[] = [gt(portalChatThreads.teamUnreadCount, 0)];
    if (shouldFilter && orgId) {
      conditions.push(eq(portalChatThreads.organizationId, orgId));
    }

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(portalChatThreads)
      .where(and(...conditions));

    res.json({ unreadCount: result[0]?.count || 0 });
  } catch (error) {
    console.error("Team portal chat unread count error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
