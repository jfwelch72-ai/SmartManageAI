import { logError } from "./utils/logger";
import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { portalChatThreads, portalChatMessages, clientPortalAccess } from "@shared/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { notifyChatTeamMembers } from "./portalRoutes";
import { registerPortalSseClient, emitPortalChatMessage, emitPortalChatThreadUpdate } from "./portalChatEvents";
import { assertPortalAttachmentUrlAllowed } from "./services/storageKeyOwnership";

const router = Router();

interface ClientPortalChatRequest extends Request {
  clientAccess?: {
    id: string;
    organizationId: string;
    projectId: string;
    email: string;
    name: string | null;
  };
}

async function requireClientPortalAuth(req: ClientPortalChatRequest, res: Response, next: NextFunction): Promise<void> {
  const clientEmail = req.headers["x-client-email"] as string;
  const clientProjectId = req.headers["x-client-project-id"] as string;

  if (!clientEmail || !clientProjectId) {
    res.status(401).json({ error: "Client portal authentication required" });
    return;
  }

  try {
    const [access] = await db
      .select()
      .from(clientPortalAccess)
      .where(and(
        eq(clientPortalAccess.email, clientEmail),
        eq(clientPortalAccess.projectId, clientProjectId),
        eq(clientPortalAccess.isActive, true)
      ))
      .limit(1);

    if (!access) {
      res.status(401).json({ error: "Invalid client portal access" });
      return;
    }

    req.clientAccess = {
      id: access.id,
      organizationId: access.organizationId,
      projectId: access.projectId,
      email: access.email,
      name: access.name,
    };

    next();
  } catch (error) {
    next(error);
  }
}

router.get("/client-portal/chat/threads", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response) => {
  try {
    const access = req.clientAccess!;

    const threads = await db
      .select()
      .from(portalChatThreads)
      .where(eq(portalChatThreads.clientPortalAccessId, access.id))
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
    next(error);
  }
});

router.post("/client-portal/chat/threads", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response) => {
  try {
    const access = req.clientAccess!;
    const { subject, category, priority, message } = req.body;

    if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
      return res.status(400).json({ error: "Subject is required" });
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Initial message is required" });
    }

    const senderName = access.name || access.email;

    const [thread] = await db.insert(portalChatThreads).values({
      organizationId: access.organizationId,
      projectId: access.projectId,
      clientPortalAccessId: access.id,
      subject: subject.trim(),
      category: category || "GENERAL",
      priority: priority || "NORMAL",
      teamUnreadCount: 1,
      portalUnreadCount: 0,
    }).returning();

    const [msg] = await db.insert(portalChatMessages).values({
      threadId: thread.id,
      senderType: "client_portal",
      senderClientAccessId: access.id,
      senderName,
      content: message.trim(),
      readByPortal: true,
      readByTeam: false,
    }).returning();

    notifyChatTeamMembers(access.organizationId, access.projectId, senderName, message.trim());

    const clientIdentifier = `${access.email}:${access.projectId}`;
    emitPortalChatMessage("client", clientIdentifier, thread.id, msg);
    emitPortalChatThreadUpdate("client", clientIdentifier, thread.id);

    res.status(201).json({ ...thread, message: msg });
  } catch (error) {
    next(error);
  }
});

router.get("/client-portal/chat/threads/:threadId/messages", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response) => {
  try {
    const access = req.clientAccess!;
    const { threadId } = req.params;

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(
        eq(portalChatThreads.id, threadId),
        eq(portalChatThreads.clientPortalAccessId, access.id)
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
    next(error);
  }
});

router.post("/client-portal/chat/threads/:threadId/messages", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response) => {
  try {
    const access = req.clientAccess!;
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
        eq(portalChatThreads.clientPortalAccessId, access.id)
      ))
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (thread.status !== "OPEN") {
      return res.status(403).json({ error: "Thread is not open for new messages" });
    }

    // Task #1356 — gate client-supplied attachment URL against the thread's org.
    try {
      await assertPortalAttachmentUrlAllowed(attachmentUrl, { orgId: thread.organizationId });
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({ error: err?.message || "Forbidden" });
    }

    const senderName = access.name || access.email;

    const [msg] = await db.insert(portalChatMessages).values({
      threadId,
      senderType: "client_portal",
      senderClientAccessId: access.id,
      senderName,
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

    notifyChatTeamMembers(thread.organizationId, thread.projectId, senderName, content.trim());

    const clientIdentifier = `${access.email}:${access.projectId}`;
    emitPortalChatMessage("client", clientIdentifier, threadId, msg);
    emitPortalChatThreadUpdate("client", clientIdentifier, threadId);

    res.status(201).json(msg);
  } catch (error) {
    next(error);
  }
});

router.post("/client-portal/chat/threads/:threadId/read", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response) => {
  try {
    const access = req.clientAccess!;
    const { threadId } = req.params;

    const [thread] = await db
      .select()
      .from(portalChatThreads)
      .where(and(
        eq(portalChatThreads.id, threadId),
        eq(portalChatThreads.clientPortalAccessId, access.id)
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
    next(error);
  }
});

router.get("/client-portal/chat/events", async (req: ClientPortalChatRequest, res: Response) => {
  const clientEmail = (req.query.email as string) || (req.headers["x-client-email"] as string);
  const clientProjectId = (req.query.projectId as string) || (req.headers["x-client-project-id"] as string);

  if (!clientEmail || !clientProjectId) {
    res.status(401).json({ error: "Client portal authentication required" });
    return;
  }

  try {
    const [access] = await db
      .select()
      .from(clientPortalAccess)
      .where(and(
        eq(clientPortalAccess.email, clientEmail),
        eq(clientPortalAccess.projectId, clientProjectId),
        eq(clientPortalAccess.isActive, true)
      ))
      .limit(1);

    if (!access) {
      res.status(401).json({ error: "Invalid client portal access" });
      return;
    }

    const identifier = `${access.email}:${access.projectId}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.write(`event: connected\ndata: {}\n\n`);

    const unregister = registerPortalSseClient("client", identifier, res);

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 30000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unregister();
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
