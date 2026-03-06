import { Router } from "express";
import { db } from "./db";
import { 
  emailThreads, 
  emailMessages,
  emailAttachments,
  emailAccounts,
  tasks,
  emailThreadStatusEnum,
  emailClassificationEnum,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logUpdate } from "./auditLogger";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const router = Router();

router.get("/threads", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { status, classification, projectId, limit = '50', offset = '0' } = req.query;

    const conditions = [eq(emailThreads.organizationId, orgId)];
    
    if (status && emailThreadStatusEnum.enumValues.includes(status as any)) {
      conditions.push(eq(emailThreads.status, status as any));
    }
    
    if (classification && emailClassificationEnum.enumValues.includes(classification as any)) {
      conditions.push(eq(emailThreads.primaryClassification, classification as any));
    }
    
    if (projectId && typeof projectId === 'string') {
      conditions.push(eq(emailThreads.projectId, projectId));
    }

    const threads = await db
      .select()
      .from(emailThreads)
      .where(and(...conditions))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(threads);
  } catch (error) {
    console.error("Error fetching email threads:", error);
    return res.status(500).json({ error: "Failed to fetch email threads" });
  }
});

router.get("/threads/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(emailMessages.receivedAt);

    const linkedTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.emailThreadId, thread.id),
          eq(tasks.organizationId, orgId)
        )
      )
      .orderBy(desc(tasks.createdAt));

    return res.json({
      thread,
      messages,
      tasks: linkedTasks,
    });
  } catch (error) {
    console.error("Error fetching email thread:", error);
    return res.status(500).json({ error: "Failed to fetch email thread" });
  }
});

router.patch("/threads/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      status: z.enum(emailThreadStatusEnum.enumValues).optional(),
      projectId: z.string().uuid().nullable().optional(),
      bidId: z.string().uuid().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
    });

    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const [existing] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const data = parseResult.data;

    if (data.projectId) {
      const { projects } = await import("@shared/schema");
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, data.projectId))
        .limit(1);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (project.gcOrganizationId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Project belongs to another organization" });
      }
    }

    if (data.bidId) {
      const { bids } = await import("@shared/schema");
      const [bid] = await db
        .select({ gcOrganizationId: bids.gcOrganizationId })
        .from(bids)
        .where(eq(bids.id, data.bidId))
        .limit(1);
      
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }
      if (bid.gcOrganizationId && bid.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Bid belongs to another organization" });
      }
    }

    if (data.vendorId) {
      const { crmOrganisations } = await import("@shared/schema");
      const [vendor] = await db
        .select({ organizationId: crmOrganisations.organizationId })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, data.vendorId))
        .limit(1);
      
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (vendor.organizationId && vendor.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Vendor belongs to another organization" });
      }
    }

    const [updated] = await db
      .update(emailThreads)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, req.params.id))
      .returning();

    await logUpdate(
      req.user.id,
      "EMAIL_THREAD",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json(updated);
  } catch (error) {
    console.error("Error updating email thread:", error);
    return res.status(500).json({ error: "Failed to update email thread" });
  }
});

router.get("/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { threadId, limit = '50', offset = '0' } = req.query;

    const conditions = [eq(emailMessages.organizationId, orgId)];
    
    if (threadId && typeof threadId === 'string') {
      conditions.push(eq(emailMessages.threadId, threadId));
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(and(...conditions))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(messages);
  } catch (error) {
    console.error("Error fetching email messages:", error);
    return res.status(500).json({ error: "Failed to fetch email messages" });
  }
});

router.get("/messages/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.id, req.params.id),
          eq(emailMessages.organizationId, orgId)
        )
      )
      .limit(1);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const attachments = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.emailMessageId, message.id));

    return res.json({
      message,
      attachments,
    });
  } catch (error) {
    console.error("Error fetching email message:", error);
    return res.status(500).json({ error: "Failed to fetch email message" });
  }
});

router.post("/sync", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id),
          eq(emailAccounts.isActive, true)
        )
      );

    if (accounts.length === 0) {
      return res.json({ 
        success: true, 
        message: "No active email accounts to sync",
        accountsProcessed: 0
      });
    }

    for (const account of accounts) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    }

    return res.json({
      success: true,
      message: `Email sync triggered for ${accounts.length} account(s)`,
      accountsProcessed: accounts.length,
      note: "Full email ingestion requires provider-specific implementation (Gmail API, MS Graph, IMAP)"
    });
  } catch (error) {
    console.error("Error syncing emails:", error);
    return res.status(500).json({ error: "Failed to sync emails" });
  }
});

export default router;
