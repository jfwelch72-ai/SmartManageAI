import { Router, Response } from "express";
import { db } from "./db";
import { insertNotifications } from "./services/notificationService";
import { portalChatThreads, portalChatMessages, subcontractorPortalTokens, clientPortalAccess, projects, users, notifications } from "@shared/schema";
import { eq, and, desc, sql, inArray, asc, gt, or } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { sendEmail } from "./email";

const router = Router();

export async function notifyChatTeamMembers(orgId: string, projectId: string, senderName: string, content: string) {
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
      await insertNotifications(teamMembers.map(m => ({
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
        or(
          eq(portalChatMessages.senderType, "portal"),
          eq(portalChatMessages.senderType, "client_portal")
        ),
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
        subContactName: subcontractorPortalTokens.contactName,
        subContactEmail: subcontractorPortalTokens.contactEmail,
        clientName: clientPortalAccess.name,
        clientEmail: clientPortalAccess.email,
        projectName: projects.name,
        projectCode: projects.code,
      })
      .from(portalChatThreads)
      .leftJoin(subcontractorPortalTokens, eq(portalChatThreads.portalTokenId, subcontractorPortalTokens.id))
      .leftJoin(clientPortalAccess, eq(portalChatThreads.clientPortalAccessId, clientPortalAccess.id))
      .leftJoin(projects, eq(portalChatThreads.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(portalChatThreads.lastMessageAt));

    let mapped = results.map((r) => ({
      ...r.thread,
      contactName: r.subContactName || r.clientName || null,
      contactEmail: r.subContactEmail || r.clientEmail || null,
      portalType: r.thread.clientPortalAccessId ? "CLIENT" : "SUBCONTRACTOR",
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
        or(
          eq(portalChatMessages.senderType, "portal"),
          eq(portalChatMessages.senderType, "client_portal")
        ),
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
        if (thread.portalTokenId) {
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
        } else if (thread.clientPortalAccessId) {
          const [clientAccess] = await db
            .select()
            .from(clientPortalAccess)
            .where(eq(clientPortalAccess.id, thread.clientPortalAccessId))
            .limit(1);

          if (clientAccess) {
            await sendEmail({
              to: clientAccess.email,
              subject: `New message on "${thread.subject}"`,
              html: `<p>Hi ${clientAccess.name || "Client"},</p><p>You have a new message from the project team regarding "${thread.subject}".</p><p>Please log in to the client portal to view and respond.</p>`,
            });
          }
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
