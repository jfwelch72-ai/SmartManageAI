import { logError } from "./utils/logger";
import { Router, Response } from "express";
import { db } from "./db";
import { portalChatThreads, portalChatMessages } from "@shared/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { requirePortalAuth, type PortalRequest } from "./portalAuth";
import { notifyChatTeamMembers } from "./portalRoutes";
import { registerPortalSseClient, emitPortalChatMessage, emitPortalChatThreadUpdate } from "./portalChatEvents";
import { assertPortalAttachmentUrlAllowed } from "./services/storageKeyOwnership";

const router = Router();

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
    next(error);
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

    emitPortalChatMessage("sub", token.id, thread.id, msg);
    emitPortalChatThreadUpdate("sub", token.id, thread.id);

    res.status(201).json({ ...thread, message: msg });
  } catch (error) {
    next(error);
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
    next(error);
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

    // Task #1356 — gate client-supplied attachment URL against the thread's org.
    try {
      await assertPortalAttachmentUrlAllowed(attachmentUrl, { orgId: thread.organizationId });
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({ error: err?.message || "Forbidden" });
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

    emitPortalChatMessage("sub", token.id, threadId, msg);
    emitPortalChatThreadUpdate("sub", token.id, threadId);

    res.status(201).json(msg);
  } catch (error) {
    next(error);
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
    next(error);
  }
});

router.get("/portal/chat/events", requirePortalAuth, (req: PortalRequest, res: Response) => {
  const token = req.portalToken!;
  const identifier = token.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`event: connected\ndata: {}\n\n`);

  const unregister = registerPortalSseClient("sub", identifier, res);

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unregister();
  });
});

export default router;
