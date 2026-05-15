import { logError } from "./utils/logger";
import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { withOrgContext } from "./dbContext";
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

    // Task #2478 — wrap client-portal-authenticated routes in a
    // tenant-scoped DB context so RLS protects every query against
    // cross-tenant leakage. The streaming `/client-portal/chat/events`
    // endpoint does its own auth inline below and is skipped (it only
    // pushes from the in-memory portal SSE bus).
    const res2 = res;
    await withOrgContext(
      {
        organizationId: access.organizationId,
        isSuperadmin: false,
        source: `client-portal:${req.method} ${req.path}`,
      },
      () =>
        new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          res2.on("finish", settle);
          res2.on("close", settle);
          next();
        }),
    );
  } catch (error) {
    next(error);
  }
}

router.get("/client-portal/chat/threads", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response, next: NextFunction) => {
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

router.post("/client-portal/chat/threads", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response, next: NextFunction) => {
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

router.get("/client-portal/chat/threads/:threadId/messages", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response, next: NextFunction) => {
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

router.post("/client-portal/chat/threads/:threadId/messages", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response, next: NextFunction) => {
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

router.post("/client-portal/chat/threads/:threadId/read", requireClientPortalAuth as any, async (req: ClientPortalChatRequest, res: Response, next: NextFunction) => {
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

router.get("/client-portal/chat/events", async (req: ClientPortalChatRequest, res: Response, next: NextFunction) => {
  const clientEmail = (req.query.email as string) || (req.headers["x-client-email"] as string);
  const clientProjectId = (req.query.projectId as string) || (req.headers["x-client-project-id"] as string);

  if (!clientEmail || !clientProjectId) {
    res.status(401).json({ error: "Client portal authentication required" });
    return;
  }

  try {
    // Pre-stream auth bootstrap: clientPortalAccess is RLS-gated on
    // organizationId, but we only have email + projectId at this point —
    // the portal client is not authenticated via a normal user session, so
    // there is no org context in the ALS yet. Wrap this single lookup in a
    // superadmin withOrgContext so the query succeeds under
    // STRICT_TENANT_RLS=true (fail-closed default in production). The pg
    // client is released as soon as the lookup resolves; no connection is
    // held for the lifetime of the SSE stream.
    let access: typeof clientPortalAccess.$inferSelect | undefined;
    await withOrgContext(
      {
        organizationId: null,
        isSuperadmin: true,
        source: "client-portal:sse-auth-bootstrap",
      },
      async () => {
        const [found] = await db
          .select()
          .from(clientPortalAccess)
          .where(and(
            eq(clientPortalAccess.email, clientEmail),
            eq(clientPortalAccess.projectId, clientProjectId),
            eq(clientPortalAccess.isActive, true)
          ))
          .limit(1);
        access = found;
      },
    );

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
