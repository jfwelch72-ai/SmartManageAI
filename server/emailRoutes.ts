import {logError, logWarn, logInfo } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { emailAccounts, insertEmailAccountSchema, type EmailAccount, emailProviderEnum, emailThreads, emailMessages, emailAttachments, tasks, emailTasks, emailThreadStatusEnum, emailClassificationEnum, emailSummaries, type Task, crmContacts, crmOrganisations } from "@shared/schema";
import { eq, and, desc, gte, or, isNotNull, isNull, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import type { UserRole } from "@shared/schema";
import { logCreate, logUpdate, logDelete, logAudit } from "./auditLogger";

const ALL_INTERNAL_ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"];
import { sanitizeEmail, sanitizeText, sanitizeShortText } from "./sanitization";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getCanonicalBaseUrl, isRedirectUriValid } from "./utils/routeHelpers";
import { ObjectStorageService } from "./objectStorage";
import {
  analyzeEmail,
  summarizeThread,
  suggestReplies,
  generateEmailSummary,
  matchEmailToEntities,
  createTaskFromEmail,
  type EmailAnalysisResult,
} from "./ai/emailAi";
import { governedAiCall } from "./services/aiGovernance";
import { AI_MODEL_GPT5 } from "./ai/openaiClient";
import { testFullConnection, fetchImapMessages, sendSmtpEmail } from "./services/imapService";
import {
  ensureGmailWatch,
  ensureOutlookSubscription,
  isGmailPushConfigured,
  isOutlookPushConfigured,
} from "./emailPushNotifications";
import { detectInboundReply, detectInboundBounce } from "./services/sequenceService";
import { logEmailMessageForCrm, backfillCrmEmailLogging } from "./services/crmEmailLoggerService";

/**
 * Helper used at every persistence site in this file: hand the freshly
 * persisted message off to the CRM email logger asynchronously so any error
 * can never break the email sync. (Task #886)
 */
function dispatchCrmEmailLog(args: {
  account: { organizationId: string; provider: string; emailAddress: string };
  externalId: string;
  externalThreadId: string | null;
  fromAddress: string;
  toAddresses: string | null | undefined;
  ccAddresses: string | null | undefined;
  subject: string;
  snippet: string | null | undefined;
  bodyText: string | null | undefined;
  receivedAt: Date;
  isIncoming: boolean;
  sourceEmailMessageId: string;
}): void {
  const parseList = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x?.address || "")).filter(Boolean);
    } catch {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  };
  void logEmailMessageForCrm({
    organizationId: args.account.organizationId,
    provider: args.account.provider === "OUTLOOK" ? "OUTLOOK" : "GMAIL",
    ownerEmail: args.account.emailAddress,
    externalMessageId: args.externalId,
    externalThreadId: args.externalThreadId,
    fromAddress: args.fromAddress,
    toAddresses: parseList(args.toAddresses),
    ccAddresses: parseList(args.ccAddresses),
    subject: args.subject,
    snippet: args.snippet ?? null,
    bodyText: args.bodyText ?? null,
    sentAt: args.receivedAt,
    isIncoming: args.isIncoming,
    sourceEmailMessageId: args.sourceEmailMessageId,
  }).catch(() => {});
}

type EmailPushStatus = "REALTIME" | "POLLING" | "UNAVAILABLE";

interface EmailAccountPushInfo {
  pushStatus: EmailPushStatus;
  pushExpiresAt: string | null;
  pushReason: string;
}

function describeAccountPush(account: EmailAccount): EmailAccountPushInfo {
  if (account.provider === "GMAIL") {
    if (!isGmailPushConfigured()) {
      return {
        pushStatus: "UNAVAILABLE",
        pushExpiresAt: null,
        pushReason:
          "Gmail real-time push is not configured on this server (missing Pub/Sub topic or webhook secret). Mail will be fetched by the safety-net poller.",
      };
    }
    if (account.syncStatus === "NEEDS_RECONNECT") {
      return {
        pushStatus: "POLLING",
        pushExpiresAt: null,
        pushReason:
          "Reconnect this Gmail account to grant push permissions. Until then mail is fetched by the safety-net poller.",
      };
    }
    const exp = account.gmailWatchExpiration ? new Date(account.gmailWatchExpiration) : null;
    if (exp && exp.getTime() > Date.now()) {
      return {
        pushStatus: "REALTIME",
        pushExpiresAt: exp.toISOString(),
        pushReason:
          "Gmail is pushing changes to SmartManageAI in real time. Mail appears within seconds of arrival.",
      };
    }
    return {
      pushStatus: "POLLING",
      pushExpiresAt: null,
      pushReason:
        "No active Gmail watch subscription. Mail is fetched by the safety-net poller every few minutes. Click Reconnect push to try registering a watch now.",
    };
  }
  if (account.provider === "OUTLOOK") {
    if (!isOutlookPushConfigured()) {
      return {
        pushStatus: "UNAVAILABLE",
        pushExpiresAt: null,
        pushReason:
          "Outlook real-time push is not configured on this server (missing webhook secret or HTTPS base URL). Mail will be fetched by the safety-net poller.",
      };
    }
    if (account.syncStatus === "NEEDS_RECONNECT") {
      return {
        pushStatus: "POLLING",
        pushExpiresAt: null,
        pushReason:
          "Reconnect this Outlook account to grant push permissions. Until then mail is fetched by the safety-net poller.",
      };
    }
    const exp = account.outlookSubscriptionExpiration
      ? new Date(account.outlookSubscriptionExpiration)
      : null;
    if (exp && exp.getTime() > Date.now()) {
      return {
        pushStatus: "REALTIME",
        pushExpiresAt: exp.toISOString(),
        pushReason:
          "Microsoft Graph is pushing changes to SmartManageAI in real time. Mail appears within seconds of arrival.",
      };
    }
    return {
      pushStatus: "POLLING",
      pushExpiresAt: null,
      pushReason:
        "No active Outlook subscription. Mail is fetched by the safety-net poller every few minutes. Click Reconnect push to try registering a subscription now.",
    };
  }
  return {
    pushStatus: "UNAVAILABLE",
    pushExpiresAt: null,
    pushReason:
      "IMAP/SMTP accounts do not support real-time push. Mail is fetched by the background poller.",
  };
}

const router = Router();

const requireInternalRole = requireRole(...ALL_INTERNAL_ROLES);

// ========================================
// Routes from emailAccountRoutes.ts
// ========================================

// Validation schema for creating email accounts
const createEmailAccountSchema = z.object({
  provider: z.enum(emailProviderEnum.enumValues),
  emailAddress: z.string().email().transform(s => sanitizeEmail(s)),
  displayName: z.string().max(100).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  // IMAP/SMTP fields (for IMAP provider)
  imapHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapUsername: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPassword: z.string().max(500).optional(), // Sensitive - not sanitized to preserve special chars
  // OAuth fields (for Gmail/Outlook - typically set via OAuth flow)
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  oauthProviderId: z.string().optional(),
});

const updateEmailAccountSchema = z.object({
  displayName: z.string().max(100).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  isActive: z.boolean().optional(),
  imapHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapUsername: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPassword: z.string().max(500).optional(),
});

// Helper to sanitize account for response (remove sensitive fields)
function sanitizeAccountForResponse(
  account: EmailAccount,
): Omit<EmailAccount, 'accessToken' | 'refreshToken' | 'imapPassword'> & EmailAccountPushInfo {
  const { accessToken, refreshToken, imapPassword, ...safe } = account;
  return { ...safe, ...describeAccountPush(account) };
}

// GET /api/email/accounts - List linked accounts for current user
router.get("/accounts", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id)
        )
      )
      .orderBy(desc(emailAccounts.createdAt));

    // Remove sensitive fields from response
    const sanitizedAccounts = accounts.map(sanitizeAccountForResponse);

    return res.json(sanitizedAccounts);
  } catch (error) {
        return next(error);
  }
});

// GET /api/email/accounts/:id - Get single account
router.get("/accounts/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id)
        )
      )
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: "Email account not found" });
    }

    return res.json(sanitizeAccountForResponse(account));
  } catch (error) {
        return next(error);
  }
});

// POST /api/email/accounts - Create/link a new email account
router.post("/accounts", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Validate input
    const parseResult = createEmailAccountSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    // Check for duplicate email
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id),
          eq(emailAccounts.emailAddress, data.emailAddress ?? '')
        )
      )
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Email account already linked" });
    }

    // Validate IMAP provider has required fields
    if (data.provider === "IMAP") {
      if (!data.imapHost || !data.imapPort) {
        return res.status(400).json({ error: "IMAP host and port are required for IMAP accounts" });
      }
    }

    // Create the account
    const [newAccount] = await db
      .insert(emailAccounts)
      .values({
        organizationId: orgId,
        userId: req.user!.id,
        provider: data.provider,
        emailAddress: data.emailAddress ?? '',
        displayName: data.displayName,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecure: data.imapSecure,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecure: data.smtpSecure,
        imapUsername: data.imapUsername,
        imapPassword: data.imapPassword,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        oauthProviderId: data.oauthProviderId,
        isActive: true,
      })
      .returning();

    // Audit log
    await logCreate(
      req.user!.id,
      "EMAIL_ACCOUNT",
      newAccount.id,
      { provider: newAccount.provider, emailAddress: newAccount.emailAddress },
      req
    );

    if (newAccount.provider === "IMAP" && newAccount.imapHost) {
      testFullConnection(newAccount).then(async (testResult) => {
        if (testResult.success) {
          const syncResult = await syncImapAccount(newAccount, req.user!.id);
          logInfo(`Initial IMAP sync for ${newAccount.emailAddress}: ${syncResult.messagesImported} messages, ${syncResult.errors.length} errors`);
        } else {
          const errorMsg = testResult.imap.error || testResult.smtp.error || "Connection test failed";
          logInfo(`Skipping initial sync for ${newAccount.emailAddress}: ${errorMsg}`);
          await db
            .update(emailAccounts)
            .set({ lastSyncError: errorMsg.substring(0, 500), updatedAt: new Date() })
            .where(eq(emailAccounts.id, newAccount.id));
        }
      }).catch((err) => {
        logError(`Initial IMAP sync failed for ${newAccount.emailAddress}:`, {}, err instanceof Error ? err : new Error(String(err)));
      });
    } else if (newAccount.provider === "OUTLOOK" && newAccount.accessToken) {
      syncOutlookAccount(newAccount, req.user!.id).then((syncResult) => {
        logInfo(`Initial Outlook sync for ${newAccount.emailAddress}: ${syncResult.messagesImported} messages, ${syncResult.errors.length} errors`);
        backfillCrmEmailLogging(newAccount.id, 90).catch(() => {});
      }).catch((err) => {
        logError(`Initial Outlook sync failed for ${newAccount.emailAddress}:`, {}, err instanceof Error ? err : new Error(String(err)));
      });
      ensureOutlookSubscription(newAccount).catch((err) =>
        logError(`Initial Outlook subscription registration failed for ${newAccount.emailAddress}`, {}, err instanceof Error ? err : new Error(String(err))),
      );
    } else if (newAccount.provider === "GMAIL" && newAccount.accessToken) {
      ensureGmailWatch(newAccount).catch((err) =>
        logError(`Initial Gmail watch registration failed for ${newAccount.emailAddress}`, {}, err instanceof Error ? err : new Error(String(err))),
      );
    }

    return res.status(201).json(sanitizeAccountForResponse(newAccount));
  } catch (error) {
        return next(error);
  }
});

// PATCH /api/email/accounts/:id - Update an email account
router.patch("/accounts/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Find existing account
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Email account not found" });
    }

    // Validate input
    const parseResult = updateEmailAccountSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    // Update the account
    const [updated] = await db
      .update(emailAccounts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, req.params.id))
      .returning();

    // Audit log
    await logUpdate(
      req.user!.id,
      "EMAIL_ACCOUNT",
      updated.id,
      { isActive: existing.isActive },
      { isActive: updated.isActive },
      req
    );

    return res.json(sanitizeAccountForResponse(updated));
  } catch (error) {
        return next(error);
  }
});

// DELETE /api/email/accounts/:id - Remove an email account
router.delete("/accounts/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Find existing account
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Email account not found" });
    }

    // Clean up attachment files from object storage before the DB transaction
    // (non-critical: failures here are logged but don't block account deletion)
    try {
      const threads = await db
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(eq(emailThreads.emailAccountId, existing.id));
      const threadIds = threads.map((t) => t.id);

      if (threadIds.length > 0) {
        const attachments = await db
          .select({ storageKey: emailAttachments.storageKey })
          .from(emailAttachments)
          .innerJoin(emailMessages, eq(emailAttachments.emailMessageId, emailMessages.id))
          .where(inArray(emailMessages.threadId, threadIds));

        if (attachments.length > 0) {
          const objectStorageService = new ObjectStorageService();
          const deleteResults = await Promise.allSettled(
            attachments.map((a) => objectStorageService.deleteObjectByKey(a.storageKey))
          );
          const failures = deleteResults.filter((r) => r.status === "rejected");
          if (failures.length > 0) {
            logError(`Failed to delete ${failures.length}/${attachments.length} attachment files for account ${existing.id}`);
          }
        }
      }
    } catch (storageError) {
      logError("Error cleaning up attachment files from object storage:", {}, storageError instanceof Error ? storageError : new Error(String(storageError)));
    }

    // Delete ALL dependent rows inside a single transaction so failures roll back cleanly
    // Order: nullify tasks → delete emailTasks → summaries → attachments → messages → threads → account
    const BATCH_SIZE = 500;
    let deleted;
    try {
      deleted = await db.transaction(async (tx) => {
        const threads = await tx
          .select({ id: emailThreads.id })
          .from(emailThreads)
          .where(eq(emailThreads.emailAccountId, existing.id));
        const threadIds = threads.map((t) => t.id);

        const messageCount = await tx.select({ count: sql<number>`count(*)` }).from(emailMessages).where(eq(emailMessages.emailAccountId, existing.id));
        logInfo(`[Delete Account ${existing.id}] Found ${threadIds.length} threads, ${messageCount[0]?.count ?? 0} messages to clean up`);

        if (threadIds.length > 0) {
          // Process in batches to avoid exceeding DB parameter limits
          for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
            const batch = threadIds.slice(i, i + BATCH_SIZE);

            // 1. Nullify emailThreadId on unified tasks (no FK constraint, so nullify rather than delete)
            await tx
              .update(tasks)
              .set({ emailThreadId: null, emailMessageId: null })
              .where(inArray(tasks.emailThreadId, batch));

            // 2. Delete deprecated emailTasks linked to this account's threads
            await tx
              .delete(emailTasks)
              .where(inArray(emailTasks.emailThreadId, batch));
          }
        }

        // 3. Delete email summaries for this user/org
        await tx
          .delete(emailSummaries)
          .where(
            and(
              eq(emailSummaries.userId, existing.userId),
              eq(emailSummaries.organizationId, existing.organizationId)
            )
          );

        // 4. Delete attachments for all messages by account (batched)
        const messageRows = await tx
          .select({ id: emailMessages.id })
          .from(emailMessages)
          .where(eq(emailMessages.emailAccountId, existing.id));
        const msgIds = messageRows.map((m) => m.id);

        if (msgIds.length > 0) {
          for (let i = 0; i < msgIds.length; i += BATCH_SIZE) {
            const batch = msgIds.slice(i, i + BATCH_SIZE);
            await tx
              .delete(emailAttachments)
              .where(inArray(emailAttachments.emailMessageId, batch));
          }
        }

        // 5a. Best-effort cleanup of provider push subscriptions so we
        // stop getting webhooks for a mailbox we no longer manage.
        try {
          if (existing.provider === "GMAIL") {
            const { stopGmailWatch } = await import("./emailPushNotifications");
            await stopGmailWatch(existing);
          } else if (existing.provider === "OUTLOOK") {
            const { deleteOutlookSubscription } = await import("./emailPushNotifications");
            await deleteOutlookSubscription(existing);
          }
        } catch (pushErr) {
          logWarn("Failed to remove email push subscription during account delete", {
            account: existing.emailAddress,
            error: String(pushErr),
          });
        }

        // 5. Delete all messages by account (catch-all, no need for thread-based delete)
        await tx
          .delete(emailMessages)
          .where(eq(emailMessages.emailAccountId, existing.id));

        // 6. Delete threads
        await tx
          .delete(emailThreads)
          .where(eq(emailThreads.emailAccountId, existing.id));

        // 7. Delete the account itself
        const [result] = await tx
          .delete(emailAccounts)
          .where(eq(emailAccounts.id, existing.id))
          .returning();

        if (!result) {
          throw new Error("Account delete returned no rows — record may have already been removed");
        }
        return result;
      });
    } catch (deleteError) {
      return next(deleteError);
    }

    // Post-delete verification: confirm the account is actually gone
    const [stillExists] = await db
      .select({ id: emailAccounts.id })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, existing.id))
      .limit(1);

    if (stillExists) {
      const remainingThreads = await db.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.emailAccountId, existing.id));
      const remainingThreadIds = remainingThreads.map((t) => t.id);
      const [messageCount] = await db.select({ count: sql<number>`count(*)` }).from(emailMessages).where(eq(emailMessages.emailAccountId, existing.id));
      let taskCount = 0, emailTaskCount = 0, attachmentCount = 0;
      if (remainingThreadIds.length > 0) {
        const [tc] = await db.select({ count: sql<number>`count(*)` }).from(tasks).where(inArray(tasks.emailThreadId, remainingThreadIds));
        taskCount = tc?.count ?? 0;
        const [etc] = await db.select({ count: sql<number>`count(*)` }).from(emailTasks).where(inArray(emailTasks.emailThreadId, remainingThreadIds));
        emailTaskCount = etc?.count ?? 0;
        const msgRows = await db.select({ id: emailMessages.id }).from(emailMessages).where(inArray(emailMessages.threadId, remainingThreadIds));
        const msgIds = msgRows.map((m) => m.id);
        if (msgIds.length > 0) {
          const [ac] = await db.select({ count: sql<number>`count(*)` }).from(emailAttachments).where(inArray(emailAttachments.emailMessageId, msgIds));
          attachmentCount = ac?.count ?? 0;
        }
      }
      const [summaryCount] = await db.select({ count: sql<number>`count(*)` }).from(emailSummaries).where(and(eq(emailSummaries.userId, existing.userId), eq(emailSummaries.organizationId, existing.organizationId)));
      return next(new Error(
        `Email account ${existing.id} still exists after delete (messages=${messageCount?.count ?? 0}, tasks=${taskCount}, emailTasks=${emailTaskCount}, attachments=${attachmentCount}, summaries=${summaryCount?.count ?? 0})`,
      ));
    }

    // Audit log (isolated so failures don't affect the success response)
    try {
      await logDelete(
        req.user!.id,
        "EMAIL_ACCOUNT",
        deleted.id,
        { provider: deleted.provider, emailAddress: deleted.emailAddress },
        req
      );
    } catch (auditError) {
      logError("Error logging account deletion (account was already deleted):", {}, auditError instanceof Error ? auditError : new Error(String(auditError)));
    }

    return res.json({ success: true, message: "Email account removed" });
  } catch (error) {
    logError("Error deleting email account:", {}, error instanceof Error ? error : new Error(String(error)));
    return next(error);
  }
});

// POST /api/email/accounts/:id/resync - Clear sync cursors so the next run does
// a full re-pull from the provider (Gmail historyId / Outlook deltaLinks).
router.post("/accounts/:id/resync", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(and(
        eq(emailAccounts.id, req.params.id),
        eq(emailAccounts.organizationId, orgId),
        eq(emailAccounts.userId, req.user!.id),
      ))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Email account not found" });

    await db
      .update(emailAccounts)
      .set({
        gmailHistoryId: null,
        outlookDeltaInbox: null,
        outlookDeltaSent: null,
        lastSyncedAt: null,
        lastFullSyncAt: null,
        lastSyncError: null,
        syncStatus: existing.syncStatus === "NEEDS_RECONNECT" ? existing.syncStatus : "OK",
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, existing.id));

    return res.json({ success: true, message: "Sync cursors cleared. Full resync will run on next sync cycle." });
  } catch (error) {
    return next(error);
  }
});

// POST /api/email/accounts/:id/reconnect-push - Re-register Gmail watch or
// Outlook subscription on demand so the account regains real-time push.
router.post("/accounts/:id/reconnect-push", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(and(
        eq(emailAccounts.id, req.params.id),
        eq(emailAccounts.organizationId, orgId),
        eq(emailAccounts.userId, req.user!.id),
      ))
      .limit(1);
    if (!account) return res.status(404).json({ error: "Email account not found" });

    if (account.provider !== "GMAIL" && account.provider !== "OUTLOOK") {
      return res.status(400).json({ error: "Real-time push is only available for Gmail and Outlook accounts." });
    }
    if (!account.isActive) {
      return res.status(400).json({ error: "Activate the account before reconnecting push." });
    }
    if (account.syncStatus === "NEEDS_RECONNECT") {
      return res.status(400).json({ error: "Reconnect the account via OAuth before re-enabling push." });
    }
    if (account.provider === "GMAIL" && !isGmailPushConfigured()) {
      return res.status(400).json({ error: "Gmail real-time push is not configured on this server." });
    }
    if (account.provider === "OUTLOOK" && !isOutlookPushConfigured()) {
      return res.status(400).json({ error: "Outlook real-time push is not configured on this server." });
    }

    // Force re-registration by clearing the current expiration so the ensure
    // helper does not short-circuit on the freshness check. If the provider
    // call fails we restore the prior expiration so a transient failure does
    // not regress a previously-valid subscription to "Polling" in the UI.
    const priorGmailExp = account.gmailWatchExpiration;
    const priorOutlookExp = account.outlookSubscriptionExpiration;
    if (account.provider === "GMAIL") {
      await db
        .update(emailAccounts)
        .set({ gmailWatchExpiration: null, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
      const [refreshed] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, account.id))
        .limit(1);
      await ensureGmailWatch(refreshed);
    } else {
      await db
        .update(emailAccounts)
        .set({ outlookSubscriptionExpiration: null, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
      const [refreshed] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, account.id))
        .limit(1);
      await ensureOutlookSubscription(refreshed);
    }

    let [final] = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, account.id))
      .limit(1);

    // Restore prior expiration if the ensure helper did not succeed and the
    // previous expiration was still in the future. This avoids regressing
    // the UI from REALTIME to POLLING on a transient provider failure.
    if (account.provider === "GMAIL" && !final.gmailWatchExpiration && priorGmailExp && priorGmailExp.getTime() > Date.now()) {
      await db
        .update(emailAccounts)
        .set({ gmailWatchExpiration: priorGmailExp, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
      [final] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, account.id))
        .limit(1);
    } else if (account.provider === "OUTLOOK" && !final.outlookSubscriptionExpiration && priorOutlookExp && priorOutlookExp.getTime() > Date.now()) {
      await db
        .update(emailAccounts)
        .set({ outlookSubscriptionExpiration: priorOutlookExp, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
      [final] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, account.id))
        .limit(1);
    }

    const sanitized = sanitizeAccountForResponse(final);
    if (sanitized.pushStatus === "REALTIME") {
      return res.json({ success: true, message: "Real-time push reconnected.", account: sanitized });
    }
    return res.status(502).json({
      success: false,
      error:
        "Push subscription could not be registered. The provider rejected the request — check server logs for details.",
      account: sanitized,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/email/accounts/:id/test - Test connection to an email account
// Accepts optional body fields to override saved settings (for testing unsaved edits)
router.post("/accounts/:id/test", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id)
        )
      )
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: "Email account not found" });
    }

    if (account.provider === "IMAP") {
      const overrides = req.body || {};
      const testAccount = {
        ...account,
        ...(overrides.imapHost !== undefined && { imapHost: overrides.imapHost }),
        ...(overrides.imapPort !== undefined && { imapPort: overrides.imapPort }),
        ...(overrides.imapSecure !== undefined && { imapSecure: overrides.imapSecure }),
        ...(overrides.smtpHost !== undefined && { smtpHost: overrides.smtpHost }),
        ...(overrides.smtpPort !== undefined && { smtpPort: overrides.smtpPort }),
        ...(overrides.smtpSecure !== undefined && { smtpSecure: overrides.smtpSecure }),
        ...(overrides.imapUsername !== undefined && { imapUsername: overrides.imapUsername }),
        ...(overrides.imapPassword !== undefined && overrides.imapPassword !== "" && { imapPassword: overrides.imapPassword }),
      };
      const result = await testFullConnection(testAccount);

      const knownSafePatterns = [
        "not found", "connection refused", "timed out", "authentication failed",
        "SSL/TLS error", "Please verify your server settings",
      ];
      const sanitizeTestResult = (r: typeof result.imap): typeof result.imap => {
        if (!r.error) return { ...r, error: undefined };
        const isSafe = knownSafePatterns.some((p) => r.error!.includes(p));
        return { ...r, error: isSafe ? r.error : "Connection failed. Please check your settings and try again." };
      };
      const sanitizedImap = sanitizeTestResult(result.imap);
      const sanitizedSmtp = sanitizeTestResult(result.smtp);

      if (!result.success) {
        const errors: string[] = [];
        if (!sanitizedImap.success) errors.push(sanitizedImap.error || "IMAP connection failed");
        if (!sanitizedSmtp.success && sanitizedSmtp.message !== "SMTP not configured (skipped)") {
          errors.push(sanitizedSmtp.error || "SMTP connection failed");
        }
        return res.status(400).json({
          success: false,
          message: errors.join("; "),
          imap: sanitizedImap,
          smtp: sanitizedSmtp,
        });
      }
      return res.json({
        success: true,
        message: "Connection test successful",
        imap: sanitizedImap,
        smtp: sanitizedSmtp,
      });
    }

    return res.json({ 
      success: true, 
      message: "Connection test successful",
      provider: account.provider
    });
  } catch (error) {
        return next(error);
  }
});

// ============================================================================
// OAuth Routes for Gmail and Outlook
// ============================================================================

const GMAIL_CONFIG = {
  get clientId() { return process.env.GOOGLE_CLIENT_ID || ""; },
  get clientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ""; },
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
};

const OUTLOOK_CONFIG = {
  get clientId() { return process.env.MICROSOFT_CLIENT_ID || ""; },
  get clientSecret() { return process.env.MICROSOFT_CLIENT_SECRET || ""; },
  scopes: [
    // Mail.ReadWrite is required to update isRead and move messages (archive)
    // as part of 2-way sync (Task #522). It implies Mail.Read.
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
    "offline_access",
  ],
};

function getGmailRedirectUri(req: import("express").Request): string {
  return process.env.GOOGLE_REDIRECT_URI || `${getCanonicalBaseUrl(req)}/api/email/oauth/gmail/callback`;
}

function getOutlookRedirectUri(req: import("express").Request): string {
  return process.env.MICROSOFT_REDIRECT_URI || `${getCanonicalBaseUrl(req)}/api/email/oauth/outlook/callback`;
}

// GET /api/email/oauth/gmail/initiate - Start Gmail OAuth flow
router.get("/oauth/gmail/initiate", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!GMAIL_CONFIG.clientId || !GMAIL_CONFIG.clientSecret) {
      return res.status(503).json({ 
        error: "Gmail integration not configured",
        message: "Please contact your administrator to set up Google OAuth credentials"
      });
    }

    // Store user info in session for callback
    const state = Buffer.from(JSON.stringify({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      timestamp: Date.now()
    })).toString("base64url");

    const gmailRedirectUri = getGmailRedirectUri(req);

    if (!isRedirectUriValid(gmailRedirectUri)) {
      logError("[OAuth] Gmail redirect URI is invalid:", {}, gmailRedirectUri instanceof Error ? gmailRedirectUri : new Error(String(gmailRedirectUri)));
      return res.status(400).json({
        error: "OAuth redirect URI misconfigured",
        message: `The Gmail redirect URI resolved to "${gmailRedirectUri}" which points to localhost or is empty. Set the APP_BASE_URL or GOOGLE_REDIRECT_URI environment variable to your public domain.`,
      });
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GMAIL_CONFIG.clientId);
    authUrl.searchParams.set("redirect_uri", gmailRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GMAIL_CONFIG.scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    return res.redirect(authUrl.toString());
  } catch (error) {
    logError("Error initiating Gmail OAuth:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.redirect("/email-assistant?error=oauth_init_failed");
  }
});

// GET /api/email/oauth/gmail/callback - Handle Gmail OAuth callback
router.get("/oauth/gmail/callback", async (req, res, next) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      logError("Gmail OAuth error:", {}, oauthError instanceof Error ? oauthError : new Error(String(oauthError)));
      return res.redirect("/email-assistant?error=oauth_denied");
    }

    if (!code || !state) {
      return res.redirect("/email-assistant?error=missing_params");
    }

    // Decode state to get user info
    let userInfo: { userId: string; organizationId: string; timestamp: number };
    try {
      userInfo = JSON.parse(Buffer.from(state as string, "base64url").toString());
    } catch {
      logWarn("Non-critical operation failed");
      return res.redirect("/email-assistant?error=invalid_state");
    }

    // Check timestamp (15 minute expiry)
    if (Date.now() - userInfo.timestamp > 15 * 60 * 1000) {
      return res.redirect("/email-assistant?error=state_expired");
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: GMAIL_CONFIG.clientId,
        client_secret: GMAIL_CONFIG.clientSecret,
        redirect_uri: getGmailRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      logError("Failed to exchange Gmail code", { detail: await tokenResponse.text() });
      return res.redirect("/email-assistant?error=token_exchange_failed");
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    // Get user email from Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
      return res.redirect("/email-assistant?error=user_info_failed");
    }

    const googleUser = await userResponse.json() as { email: string; name?: string };

    // Check if account already exists
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.emailAddress, googleUser.email),
          eq(emailAccounts.organizationId, userInfo.organizationId),
          eq(emailAccounts.userId, userInfo.userId)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing account with new tokens
      await db
        .update(emailAccounts)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing.refreshToken,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          isActive: true,
          syncStatus: "OK",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
    } else {
      // Create new account
      await db.insert(emailAccounts).values({
        id: crypto.randomUUID(),
        organizationId: userInfo.organizationId,
        userId: userInfo.userId,
        provider: "GMAIL",
        emailAddress: googleUser.email,
        displayName: googleUser.name || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        oauthProviderId: googleUser.email,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Register Gmail push watch so changes arrive via Pub/Sub instead of
    // waiting for the next polling tick (Task #524). No-op when push isn't
    // configured. Scoped to (emailAddress, organizationId, userId) so that
    // a shared mailbox connected by multiple users in different orgs maps
    // to the right row.
    try {
      const [savedAccount] = await db
        .select()
        .from(emailAccounts)
        .where(
          and(
            eq(emailAccounts.emailAddress, googleUser.email),
            eq(emailAccounts.organizationId, userInfo.organizationId),
            eq(emailAccounts.userId, userInfo.userId),
          ),
        )
        .limit(1);
      if (savedAccount) {
        ensureGmailWatch(savedAccount).catch((err) =>
          logError("Initial Gmail watch registration failed", { account: googleUser.email }, err instanceof Error ? err : new Error(String(err))),
        );
        syncGmailAccount(savedAccount, userInfo.userId).then(() => {
          backfillCrmEmailLogging(savedAccount.id, 90).catch(() => {});
        }).catch((err) => {
          logError("Initial Gmail OAuth sync failed", { account: googleUser.email }, err instanceof Error ? err : new Error(String(err)));
        });
      }
    } catch (err) {
      logError("Failed to look up Gmail account for watch registration", { account: googleUser.email }, err instanceof Error ? err : new Error(String(err)));
    }

    return res.redirect("/email-assistant?success=gmail_connected");
  } catch (error) {
    logError("Error in Gmail OAuth callback:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.redirect("/email-assistant?error=callback_failed");
  }
});

// GET /api/email/oauth/outlook/initiate - Start Outlook/Microsoft OAuth flow
router.get("/oauth/outlook/initiate", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!OUTLOOK_CONFIG.clientId || !OUTLOOK_CONFIG.clientSecret) {
      return res.status(503).json({ 
        error: "Outlook integration not configured",
        message: "Please contact your administrator to set up Microsoft OAuth credentials"
      });
    }

    // Store user info in state for callback
    const state = Buffer.from(JSON.stringify({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      timestamp: Date.now()
    })).toString("base64url");

    const outlookRedirectUri = getOutlookRedirectUri(req);

    if (!isRedirectUriValid(outlookRedirectUri)) {
      logError("[OAuth] Outlook redirect URI is invalid:", {}, outlookRedirectUri instanceof Error ? outlookRedirectUri : new Error(String(outlookRedirectUri)));
      return res.status(400).json({
        error: "OAuth redirect URI misconfigured",
        message: `The Outlook redirect URI resolved to "${outlookRedirectUri}" which points to localhost or is empty. Set the APP_BASE_URL or MICROSOFT_REDIRECT_URI environment variable to your public domain.`,
      });
    }

    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", OUTLOOK_CONFIG.clientId);
    authUrl.searchParams.set("redirect_uri", outlookRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", OUTLOOK_CONFIG.scopes.join(" "));
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);

    return res.redirect(authUrl.toString());
  } catch (error) {
    logError("Error initiating Outlook OAuth:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.redirect("/email-assistant?error=oauth_init_failed");
  }
});

// GET /api/email/oauth/outlook/callback - Handle Outlook OAuth callback
router.get("/oauth/outlook/callback", async (req, res, next) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      logError("Outlook OAuth error", { oauthError: String(oauthError), error_description: String(error_description) });
      return res.redirect("/email-assistant?error=oauth_denied");
    }

    if (!code || !state) {
      return res.redirect("/email-assistant?error=missing_params");
    }

    // Decode state to get user info
    let userInfo: { userId: string; organizationId: string; timestamp: number };
    try {
      userInfo = JSON.parse(Buffer.from(state as string, "base64url").toString());
    } catch {
      logWarn("Non-critical operation failed");
      return res.redirect("/email-assistant?error=invalid_state");
    }

    // Check timestamp (15 minute expiry)
    if (Date.now() - userInfo.timestamp > 15 * 60 * 1000) {
      return res.redirect("/email-assistant?error=state_expired");
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: OUTLOOK_CONFIG.clientId,
        client_secret: OUTLOOK_CONFIG.clientSecret,
        redirect_uri: getOutlookRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      logError("Failed to exchange Outlook code", { detail: await tokenResponse.text() });
      return res.redirect("/email-assistant?error=token_exchange_failed");
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Get user info from Microsoft Graph
    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
      return res.redirect("/email-assistant?error=user_info_failed");
    }

    const msUser = await userResponse.json() as { 
      mail?: string; 
      userPrincipalName: string; 
      displayName?: string;
      id: string;
    };

    const emailAddress = msUser.mail || msUser.userPrincipalName;

    // Check if account already exists
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.emailAddress, emailAddress),
          eq(emailAccounts.organizationId, userInfo.organizationId),
          eq(emailAccounts.userId, userInfo.userId)
        )
      )
      .limit(1);

    let accountId: string;
    if (existing) {
      await db
        .update(emailAccounts)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing.refreshToken,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          isActive: true,
          // Reconnect succeeded — clear failure flags durably so the periodic
          // sync job picks the account up again, even if the immediate async
          // initial sync below fails transiently.
          syncStatus: "OK",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
      accountId = existing.id;
    } else {
      accountId = crypto.randomUUID();
      await db.insert(emailAccounts).values({
        id: accountId,
        organizationId: userInfo.organizationId,
        userId: userInfo.userId,
        provider: "OUTLOOK",
        emailAddress: emailAddress,
        displayName: msUser.displayName || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        oauthProviderId: msUser.id,
        isActive: true,
        syncStatus: "OK",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const [savedAccount] = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .limit(1);

    if (savedAccount) {
      syncOutlookAccount(savedAccount, userInfo.userId).then((syncResult) => {
        logInfo(`Initial Outlook OAuth sync for ${emailAddress}: ${syncResult.messagesImported} messages, ${syncResult.errors.length} errors`);
        backfillCrmEmailLogging(savedAccount.id, 90).catch(() => {});
      }).catch((err) => {
        logError(`Initial Outlook OAuth sync failed for ${emailAddress}:`, {}, err instanceof Error ? err : new Error(String(err)));
      });
      // Register Microsoft Graph subscription so changes arrive via webhook
      // instead of waiting for the next polling tick (Task #524). No-op when
      // push isn't configured.
      ensureOutlookSubscription(savedAccount).catch((err) =>
        logError(`Initial Outlook subscription registration failed for ${emailAddress}`, {}, err instanceof Error ? err : new Error(String(err))),
      );
    }

    return res.redirect("/email-assistant?success=outlook_connected");
  } catch (error) {
    logError("Error in Outlook OAuth callback:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.redirect("/email-assistant?error=callback_failed");
  }
});

// GET /api/email/oauth/status - Check if OAuth providers are configured
router.get("/oauth/status", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  return res.json({
    gmail: {
      configured: !!(GMAIL_CONFIG.clientId && GMAIL_CONFIG.clientSecret),
    },
    outlook: {
      configured: !!(OUTLOOK_CONFIG.clientId && OUTLOOK_CONFIG.clientSecret),
    },
  });
});

// ========================================
// Routes from emailAiRoutes.ts
// ========================================

router.get("/threads", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
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
        return next(error);
  }
});

router.get("/threads/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
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
        return next(error);
  }
});

router.patch("/threads/bulk", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const bulkSchema = z.object({
      threadIds: z.array(z.string().uuid()).min(1).max(500),
      isRead: z.boolean().optional(),
      isArchived: z.boolean().optional(),
    }).refine(
      (data) => data.isRead !== undefined || data.isArchived !== undefined,
      { message: "Must provide isRead or isArchived" },
    );

    const parseResult = bulkSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const { threadIds, isRead, isArchived } = parseResult.data;
    const uniqueIds = Array.from(new Set(threadIds));

    const existingThreads = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          inArray(emailThreads.id, uniqueIds),
          eq(emailThreads.organizationId, orgId),
        ),
      );
    const existingById = new Map(existingThreads.map((t) => [t.id, t]));

    const results: { threadId: string; success: boolean; error?: string; messagesUpdated?: number; status?: string; unreadCount?: number }[] = [];
    let totalMessagesUpdated = 0;
    let successCount = 0;

    for (const threadId of uniqueIds) {
      const existing = existingById.get(threadId);
      if (!existing) {
        results.push({ threadId, success: false, error: "Thread not found" });
        continue;
      }

      try {
        let derivedStatus: typeof existing.status | undefined;
        if (isArchived === true) derivedStatus = "ARCHIVED";
        else if (isArchived === false && existing.status === "ARCHIVED") derivedStatus = "OPEN";

        let messagesUpdated = 0;
        const messageRows = await db
          .select()
          .from(emailMessages)
          .where(eq(emailMessages.threadId, existing.id));

        const accountIds = Array.from(new Set(messageRows.map((m) => m.emailAccountId)));
        const accountRows = accountIds.length
          ? await db.select().from(emailAccounts).where(inArray(emailAccounts.id, accountIds))
          : [];
        const accountById = new Map(accountRows.map((a) => [a.id, a]));

        const targets = messageRows.filter((m) => {
          if (isRead !== undefined && m.isRead !== isRead) return true;
          if (isArchived !== undefined && (m.isArchived ?? false) !== isArchived) return true;
          return false;
        });

        for (const msg of targets) {
          const updates: Partial<typeof emailMessages.$inferInsert> = { updatedAt: new Date() };
          if (isRead !== undefined) updates.isRead = isRead;
          if (isArchived !== undefined) {
            updates.isArchived = isArchived;
            updates.folder = isArchived ? "ARCHIVE" : "INBOX";
          }
          const account = accountById.get(msg.emailAccountId);
          if (account && (account.provider === "GMAIL" || account.provider === "OUTLOOK")) {
            const existingPending = (msg.pendingProviderPush as Record<string, unknown> | null) || {};
            const patch: Record<string, boolean> = {};
            if (isRead !== undefined) patch.isRead = isRead;
            if (isArchived !== undefined) patch.isArchived = isArchived;
            updates.pendingProviderPush = { ...existingPending, ...patch, attempts: 0 };
          }
          await db.update(emailMessages).set(updates).where(eq(emailMessages.id, msg.id));
          messagesUpdated++;
        }

        for (const msg of targets) {
          const account = accountById.get(msg.emailAccountId);
          if (account && (account.provider === "GMAIL" || account.provider === "OUTLOOK")) {
            drainMessageProviderPush(account, msg.id).catch((err) => {
              logError(
                "Background email push attempt failed (will retry via job)",
                {},
                err instanceof Error ? err : new Error(String(err)),
              );
            });
          }
        }

        const [counts] = await db
          .select({
            unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
          })
          .from(emailMessages)
          .where(eq(emailMessages.threadId, existing.id));

        const updateSet: Partial<typeof emailThreads.$inferInsert> = {
          updatedAt: new Date(),
          unreadCount: counts?.unread ?? 0,
        };
        if (derivedStatus !== undefined) updateSet.status = derivedStatus;

        const [updated] = await db
          .update(emailThreads)
          .set(updateSet)
          .where(eq(emailThreads.id, existing.id))
          .returning();

        await logUpdate(
          req.user!.id,
          "EMAIL_THREAD",
          updated.id,
          { status: existing.status },
          { status: updated.status },
          req,
        );

        totalMessagesUpdated += messagesUpdated;
        successCount++;
        results.push({
          threadId,
          success: true,
          messagesUpdated,
          status: updated.status,
          unreadCount: updated.unreadCount ?? 0,
        });
      } catch (err) {
        results.push({
          threadId,
          success: false,
          error: err instanceof Error ? err.message : "Update failed",
        });
      }
    }

    return res.json({
      results,
      successCount,
      failureCount: uniqueIds.length - successCount,
      messagesUpdated: totalMessagesUpdated,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/threads/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      status: z.enum(emailThreadStatusEnum.enumValues).optional(),
      projectId: z.string().uuid().nullable().optional(),
      bidId: z.string().uuid().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
      isRead: z.boolean().optional(),
      isArchived: z.boolean().optional(),
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

    const { isRead, isArchived, ...threadFields } = data;

    let derivedStatus = threadFields.status;
    if (isArchived === true) derivedStatus = "ARCHIVED";
    else if (isArchived === false && existing.status === "ARCHIVED") derivedStatus = "OPEN";

    let messagesUpdated = 0;
    if (isRead !== undefined || isArchived !== undefined) {
      const messageRows = await db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.threadId, existing.id));

      const accountIds = Array.from(new Set(messageRows.map((m) => m.emailAccountId)));
      const accountRows = accountIds.length
        ? await db.select().from(emailAccounts).where(inArray(emailAccounts.id, accountIds))
        : [];
      const accountById = new Map(accountRows.map((a) => [a.id, a]));

      const targets = messageRows.filter((m) => {
        if (isRead !== undefined && m.isRead !== isRead) return true;
        if (isArchived !== undefined && (m.isArchived ?? false) !== isArchived) return true;
        return false;
      });

      for (const msg of targets) {
        const updates: Partial<typeof emailMessages.$inferInsert> = { updatedAt: new Date() };
        if (isRead !== undefined) updates.isRead = isRead;
        if (isArchived !== undefined) {
          updates.isArchived = isArchived;
          updates.folder = isArchived ? "ARCHIVE" : "INBOX";
        }
        const account = accountById.get(msg.emailAccountId);
        if (account && (account.provider === "GMAIL" || account.provider === "OUTLOOK")) {
          const existingPending = (msg.pendingProviderPush as Record<string, unknown> | null) || {};
          const patch: Record<string, boolean> = {};
          if (isRead !== undefined) patch.isRead = isRead;
          if (isArchived !== undefined) patch.isArchived = isArchived;
          updates.pendingProviderPush = { ...existingPending, ...patch, attempts: 0 };
        }
        await db.update(emailMessages).set(updates).where(eq(emailMessages.id, msg.id));
        messagesUpdated++;
      }

      // Best-effort async push to provider for affected messages
      for (const msg of targets) {
        const account = accountById.get(msg.emailAccountId);
        if (account && (account.provider === "GMAIL" || account.provider === "OUTLOOK")) {
          drainMessageProviderPush(account, msg.id).catch((err) => {
            logError(
              "Background email push attempt failed (will retry via job)",
              {},
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      }
    }

    // Recompute thread unread count from current message state
    const [counts] = await db
      .select({
        unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
      })
      .from(emailMessages)
      .where(eq(emailMessages.threadId, existing.id));

    const updateSet: Partial<typeof emailThreads.$inferInsert> = {
      ...threadFields,
      updatedAt: new Date(),
      unreadCount: counts?.unread ?? 0,
    };
    if (derivedStatus !== undefined) updateSet.status = derivedStatus;

    const [updated] = await db
      .update(emailThreads)
      .set(updateSet)
      .where(eq(emailThreads.id, req.params.id))
      .returning();

    await logUpdate(
      req.user!.id,
      "EMAIL_THREAD",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json({ ...updated, messagesUpdated });
  } catch (error) {
        return next(error);
  }
});

router.get("/messages", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
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
        return next(error);
  }
});

router.get("/messages/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
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
        return next(error);
  }
});

// PATCH /messages/:id — update read/archive state and push back to provider (Task #522)
router.patch("/messages/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const bodySchema = z.object({
      isRead: z.boolean().optional(),
      isArchived: z.boolean().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const patch = parsed.data;
    if (patch.isRead === undefined && patch.isArchived === undefined) {
      return res.status(400).json({ error: "Provide isRead and/or isArchived" });
    }

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(and(eq(emailMessages.id, req.params.id), eq(emailMessages.organizationId, orgId)))
      .limit(1);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, message.emailAccountId))
      .limit(1);
    if (!account) return res.status(404).json({ error: "Email account not found" });

    // Apply optimistically to local state, then queue async push-back to provider
    // (drained by the provider_sync job). This keeps the UI responsive even when
    // the provider call is slow or transiently failing.
    const updates: Partial<typeof emailMessages.$inferInsert> = { updatedAt: new Date() };
    if (patch.isRead !== undefined) updates.isRead = patch.isRead;
    if (patch.isArchived !== undefined) {
      updates.isArchived = patch.isArchived;
      // On unarchive, restore to INBOX (the message's stored folder is "ARCHIVE" by definition).
      updates.folder = patch.isArchived ? "ARCHIVE" : "INBOX";
    }
    if (account.provider === "GMAIL" || account.provider === "OUTLOOK") {
      const existing = (message.pendingProviderPush as Record<string, unknown> | null) || {};
      updates.pendingProviderPush = { ...existing, ...patch, attempts: 0 };
    }

    await db.update(emailMessages).set(updates).where(eq(emailMessages.id, message.id));

    // Recompute thread unread count
    const [counts] = await db
      .select({
        unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
      })
      .from(emailMessages)
      .where(eq(emailMessages.threadId, message.threadId));
    await db
      .update(emailThreads)
      .set({ unreadCount: counts?.unread ?? 0, updatedAt: new Date() })
      .where(eq(emailThreads.id, message.threadId));

    // Best-effort immediate push (don't block on failure — the job will retry).
    if (account.provider === "GMAIL" || account.provider === "OUTLOOK") {
      drainMessageProviderPush(account, message.id).catch((err) => {
        logError("Background email push attempt failed (will retry via job)", {}, err instanceof Error ? err : new Error(String(err)));
      });
    }

    return res.json({ success: true, queued: account.provider === "GMAIL" || account.provider === "OUTLOOK" });
  } catch (error) {
    return next(error);
  }
});

const MAX_PUSH_ATTEMPTS = 5;

export async function drainMessageProviderPush(
  account: typeof emailAccounts.$inferSelect,
  messageId: string,
): Promise<void> {
  const [msg] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, messageId))
    .limit(1);
  if (!msg || !msg.pendingProviderPush) return;
  const pending = msg.pendingProviderPush as { isRead?: boolean; isArchived?: boolean; attempts?: number };
  const patch = { isRead: pending.isRead, isArchived: pending.isArchived };
  try {
    if (account.provider === "GMAIL") {
      await pushGmailMessageState(account, msg.externalId, patch);
    } else if (account.provider === "OUTLOOK") {
      await pushOutlookMessageState(account, msg.externalId, patch);
    }
    await db
      .update(emailMessages)
      .set({ pendingProviderPush: null, updatedAt: new Date() })
      .where(eq(emailMessages.id, msg.id));
  } catch (err) {
    const attempts = (pending.attempts ?? 0) + 1;
    if (attempts >= MAX_PUSH_ATTEMPTS) {
      // Give up; clear pending push and record the failure on the account.
      await db
        .update(emailMessages)
        .set({ pendingProviderPush: null, updatedAt: new Date() })
        .where(eq(emailMessages.id, msg.id));
      await db
        .update(emailAccounts)
        .set({
          lastSyncError: `Push-back gave up for message ${msg.externalId}: ${String(err).substring(0, 200)}`,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, account.id));
    } else {
      await db
        .update(emailMessages)
        .set({ pendingProviderPush: { ...pending, attempts }, updatedAt: new Date() })
        .where(eq(emailMessages.id, msg.id));
    }
    throw err;
  }
}

export async function drainAccountProviderPushes(
  account: typeof emailAccounts.$inferSelect,
): Promise<void> {
  const pending = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.emailAccountId, account.id),
        isNotNull(emailMessages.pendingProviderPush),
      )
    )
    .limit(50);
  for (const row of pending) {
    try {
      await drainMessageProviderPush(account, row.id);
    } catch {
      // already logged & counted; continue with next message
    }
  }
}

async function pushGmailMessageState(
  account: typeof emailAccounts.$inferSelect,
  externalId: string,
  patch: { isRead?: boolean; isArchived?: boolean },
): Promise<void> {
  const addLabelIds: string[] = [];
  const removeLabelIds: string[] = [];
  if (patch.isRead === true) removeLabelIds.push("UNREAD");
  if (patch.isRead === false) addLabelIds.push("UNREAD");
  if (patch.isArchived === true) removeLabelIds.push("INBOX");
  if (patch.isArchived === false) addLabelIds.push("INBOX");
  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(externalId)}/modify`;
  const resp = await gmailApiFetch(url, account, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail modify failed: ${resp.status} ${text}`);
  }
}

async function pushOutlookMessageState(
  account: typeof emailAccounts.$inferSelect,
  externalId: string,
  patch: { isRead?: boolean; isArchived?: boolean },
): Promise<void> {
  if (patch.isRead !== undefined) {
    const resp = await outlookApiFetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(externalId)}`,
      account,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: patch.isRead }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Outlook PATCH failed: ${resp.status} ${text}`);
    }
  }
  if (patch.isArchived !== undefined) {
    const dest = patch.isArchived ? "archive" : "inbox";
    const resp = await outlookApiFetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(externalId)}/move`,
      account,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationId: dest }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Outlook move failed: ${resp.status} ${text}`);
    }
  }
}

// Sentinel error so the sync wrapper can distinguish auth failures (which
// require the user to reconnect) from transient/unknown failures that should
// just be marked DEGRADED. Thrown from refreshGmailAccessToken when Google
// rejects the refresh token (e.g. user revoked access, password change,
// 7-day inactivity expiry on test-mode OAuth clients), and from the
// gmail.googleapis.com paths when a 401/403 survives the refresh-and-retry.
class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

async function refreshGmailAccessToken(account: typeof emailAccounts.$inferSelect): Promise<string> {
  if (!account.refreshToken) {
    throw new GmailAuthError("No refresh token available for account " + account.emailAddress);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CONFIG.clientId,
      client_secret: GMAIL_CONFIG.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logError("Gmail token refresh failed:", {}, errText instanceof Error ? errText : new Error(String(errText)));
    // Google returns 4xx (typically 400 invalid_grant) when the refresh token
    // can no longer be exchanged. Surface this as an auth error so the caller
    // marks the account NEEDS_RECONNECT instead of DEGRADED — there's no
    // amount of retrying that will fix a revoked refresh token.
    if (response.status >= 400 && response.status < 500) {
      throw new GmailAuthError(`Failed to refresh Gmail access token: ${response.status} ${errText.substring(0, 200)}`);
    }
    throw new Error("Failed to refresh Gmail access token");
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  await db
    .update(emailAccounts)
    .set({
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, account.id));

  return data.access_token;
}

async function getValidGmailToken(account: typeof emailAccounts.$inferSelect): Promise<string> {
  if (account.accessToken && account.expiresAt && account.expiresAt.getTime() > Date.now() + 60000) {
    return account.accessToken;
  }
  return refreshGmailAccessToken(account);
}

async function refreshOutlookAccessToken(account: typeof emailAccounts.$inferSelect): Promise<string> {
  if (!account.refreshToken) {
    throw new Error("No refresh token available for account " + account.emailAddress);
  }

  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: OUTLOOK_CONFIG.clientId,
      client_secret: OUTLOOK_CONFIG.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
      scope: OUTLOOK_CONFIG.scopes.join(" "),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logError("Outlook token refresh failed:", {}, errText instanceof Error ? errText : new Error(String(errText)));
    throw new Error("Failed to refresh Outlook access token");
  }

  const data = await response.json() as { access_token: string; expires_in: number; refresh_token?: string };

  await db
    .update(emailAccounts)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, account.id));

  return data.access_token;
}

async function getValidOutlookToken(account: typeof emailAccounts.$inferSelect): Promise<string> {
  if (account.accessToken && account.expiresAt && account.expiresAt.getTime() > Date.now() + 60000) {
    return account.accessToken;
  }
  return refreshOutlookAccessToken(account);
}

function mergeOutlookPreferHeader(callerHeaders: HeadersInit | undefined): string {
  // Always request immutable message IDs so that move-to-archive does not
  // change the externalId we have on file. The caller's Prefer header
  // (e.g. odata.track-changes for delta calls) is preserved.
  const callerPrefer = (() => {
    if (!callerHeaders) return "";
    if (callerHeaders instanceof Headers) return callerHeaders.get("Prefer") || "";
    if (Array.isArray(callerHeaders)) {
      const found = callerHeaders.find(([k]) => k.toLowerCase() === "prefer");
      return found?.[1] || "";
    }
    return (callerHeaders as Record<string, string>).Prefer || (callerHeaders as Record<string, string>).prefer || "";
  })();
  const immutable = 'IdType="ImmutableId"';
  return callerPrefer ? `${callerPrefer}, ${immutable}` : immutable;
}

export async function outlookApiFetch(url: string, account: typeof emailAccounts.$inferSelect, init?: RequestInit): Promise<Response> {
  let token = await getValidOutlookToken(account);
  const buildInit = (t: string): RequestInit => ({
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${t}`,
      Prefer: mergeOutlookPreferHeader(init?.headers),
    },
  });
  let response = await fetch(url, buildInit(token));

  if (response.status === 401) {
    token = await refreshOutlookAccessToken(account);
    response = await fetch(url, buildInit(token));
  }

  return response;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function buildRfc2822Message(
  from: string,
  to: string,
  subject: string,
  options: { cc?: string; text?: string; html?: string; inReplyTo?: string; references?: string }
): string {
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, "")}`;
  const lines: string[] = [];
  lines.push(`From: ${sanitizeHeaderValue(from)}`);
  lines.push(`To: ${sanitizeHeaderValue(to)}`);
  if (options.cc) lines.push(`Cc: ${sanitizeHeaderValue(options.cc)}`);
  lines.push(`Subject: ${sanitizeHeaderValue(subject)}`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${sanitizeHeaderValue(options.inReplyTo)}`);
  if (options.references) lines.push(`References: ${sanitizeHeaderValue(options.references)}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push("");

  const textBody = options.text || "";
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(textBody);

  if (options.html) {
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("");
    lines.push(options.html);
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

async function sendViaGmail(
  account: typeof emailAccounts.$inferSelect,
  options: { to: string; cc?: string; bcc?: string; subject: string; text?: string; html?: string; inReplyTo?: string; references?: string }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let token = await getValidGmailToken(account);
    const fromAddr = account.displayName
      ? `"${account.displayName}" <${account.emailAddress}>`
      : account.emailAddress;

    const rawMessage = buildRfc2822Message(fromAddr, options.to, options.subject, {
      cc: options.cc,
      text: options.text,
      html: options.html,
      inReplyTo: options.inReplyTo,
      references: options.references,
    });
    const encodedMessage = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    let response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (response.status === 401) {
      token = await refreshGmailAccessToken(account);
      response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedMessage }),
      });
    }

    if (!response.ok) {
      const errBody = await response.text();
      logError("Gmail API send failed:", { statusCode: response.status, account: account.emailAddress }, new Error(errBody));
      return { success: false, error: response.status === 403
        ? "Gmail permission denied. Please reconnect your Gmail account with send permissions."
        : "Failed to send email via Gmail. Please try again or check your account connection." };
    }

    const result = await response.json() as { id: string; threadId?: string };
    return { success: true, messageId: result.id };
  } catch (err: any) {
    logError("Gmail send error:", {}, err instanceof Error ? err : new Error(String(err)));
    return { success: false, error: "Failed to send email via Gmail. Please try again or check your account settings." };
  }
}

async function sendViaOutlook(
  account: typeof emailAccounts.$inferSelect,
  options: { to: string; cc?: string; bcc?: string; subject: string; text?: string; html?: string; inReplyTo?: string; references?: string }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let token = await getValidOutlookToken(account);

    const toRecipients = [{ emailAddress: { address: options.to } }];
    const ccRecipients = options.cc
      ? options.cc.split(",").map(e => e.trim()).filter(e => e.length > 0).map(e => ({ emailAddress: { address: e } }))
      : [];
    const bccRecipients = options.bcc
      ? options.bcc.split(",").map(e => e.trim()).filter(e => e.length > 0).map(e => ({ emailAddress: { address: e } }))
      : [];

    const message: any = {
      subject: options.subject,
      body: {
        contentType: options.html ? "HTML" : "Text",
        content: options.html || options.text || "",
      },
      toRecipients,
    };
    if (ccRecipients.length > 0) message.ccRecipients = ccRecipients;
    if (bccRecipients.length > 0) message.bccRecipients = bccRecipients;
    if (options.inReplyTo) {
      message.internetMessageHeaders = [
        { name: "In-Reply-To", value: options.inReplyTo },
        ...(options.references ? [{ name: "References", value: options.references }] : []),
      ];
    }

    let response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (response.status === 401) {
      token = await refreshOutlookAccessToken(account);
      response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
    }

    if (!response.ok) {
      const errBody = await response.text();
      logError("Outlook Graph send failed:", { statusCode: response.status, account: account.emailAddress }, new Error(errBody));
      return { success: false, error: response.status === 403
        ? "Outlook permission denied. Please reconnect your Outlook account with send permissions."
        : "Failed to send email via Outlook. Please try again or check your account connection." };
    }

    const msgId = response.headers.get("message-id") || `outlook-sent-${crypto.randomUUID()}`;
    return { success: true, messageId: msgId };
  } catch (err: any) {
    logError("Outlook send error:", {}, err instanceof Error ? err : new Error(String(err)));
    return { success: false, error: "Failed to send email via Outlook. Please try again or check your account settings." };
  }
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
  headers?: { name: string; value: string }[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart & {
    headers?: { name: string; value: string }[];
  };
  internalDate?: string;
}

function getGmailHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBodyFromParts(parts: GmailMessagePart[] | undefined, mimeType: string): string {
  if (!parts) return "";
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts, mimeType);
      if (nested) return nested;
    }
  }
  return "";
}

function parseGmailMessage(msg: GmailMessage, accountEmail: string): {
  externalId: string;
  threadId: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string;
  ccAddresses: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  snippet: string;
  receivedAt: Date;
  isIncoming: boolean;
  hasAttachments: boolean;
  isRead: boolean;
  inReplyTo: string;
  references: string;
} {
  const headers = msg.payload?.headers || [];
  const fromRaw = getGmailHeader(headers, "From");
  const fromMatch = fromRaw.match(/^(?:"?(.+?)"?\s+)?<?([^>]+@[^>]+)>?$/);
  const fromName = fromMatch?.[1] || "";
  const fromAddress = fromMatch?.[2] || fromRaw;
  const toRaw = getGmailHeader(headers, "To");
  const ccRaw = getGmailHeader(headers, "Cc");
  const subject = getGmailHeader(headers, "Subject") || "(No Subject)";

  let bodyText = "";
  let bodyHtml = "";
  if (msg.payload?.body?.data) {
    if (msg.payload.mimeType === "text/html") {
      bodyHtml = decodeBase64Url(msg.payload.body.data);
    } else {
      bodyText = decodeBase64Url(msg.payload.body.data);
    }
  }
  if (msg.payload?.parts) {
    bodyText = bodyText || extractBodyFromParts(msg.payload.parts, "text/plain");
    bodyHtml = bodyHtml || extractBodyFromParts(msg.payload.parts, "text/html");
  }

  const hasAttachments = !!(msg.payload?.parts?.some(p =>
    p.body && p.body.size && p.body.size > 0 && p.mimeType && !p.mimeType.startsWith("text/") && !p.mimeType.startsWith("multipart/")
  ));

  const isRead = !(msg.labelIds?.includes("UNREAD"));
  const isIncoming = !fromAddress.toLowerCase().includes(accountEmail.toLowerCase());

  return {
    externalId: msg.id,
    threadId: msg.threadId,
    fromAddress,
    fromName,
    toAddresses: JSON.stringify(toRaw ? toRaw.split(",").map(s => s.trim()) : []),
    ccAddresses: JSON.stringify(ccRaw ? ccRaw.split(",").map(s => s.trim()) : []),
    subject,
    bodyText: bodyText.substring(0, 50000),
    bodyHtml: bodyHtml.substring(0, 100000),
    snippet: msg.snippet || "",
    receivedAt: new Date(parseInt(msg.internalDate || "0")),
    isIncoming,
    hasAttachments,
    isRead,
    inReplyTo: getGmailHeader(headers, "In-Reply-To") || "",
    references: getGmailHeader(headers, "References") || "",
  };
}

export async function gmailApiFetch(url: string, account: typeof emailAccounts.$inferSelect, init?: RequestInit): Promise<Response> {
  let token = await getValidGmailToken(account);
  const buildInit = (t: string): RequestInit => ({
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${t}`,
    },
  });
  let response = await fetch(url, buildInit(token));

  if (response.status === 401) {
    token = await refreshGmailAccessToken(account);
    response = await fetch(url, buildInit(token));
    // If we still get 401 (or 403) after a successful refresh, the granted
    // scopes have likely been narrowed/revoked — surface as an auth error so
    // the sync wrapper can mark the account NEEDS_RECONNECT.
    if (response.status === 401 || response.status === 403) {
      throw new GmailAuthError(`Gmail API auth failed after refresh: ${response.status}`);
    }
  }

  return response;
}

function gmailFolderFromLabels(labelIds?: string[]): string {
  if (!labelIds || labelIds.length === 0) return "OTHER";
  if (labelIds.includes("TRASH") || labelIds.includes("SPAM")) return "ARCHIVE";
  if (labelIds.includes("SENT")) return "SENT";
  if (labelIds.includes("INBOX")) return "INBOX";
  return "ARCHIVE";
}

async function fetchGmailCurrentHistoryId(account: typeof emailAccounts.$inferSelect): Promise<string | null> {
  try {
    const profileResp = await gmailApiFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      account
    );
    if (!profileResp.ok) return null;
    const profile = await profileResp.json() as { historyId?: string };
    return profile.historyId ?? null;
  } catch {
    return null;
  }
}

/**
 * Recipient-based CRM auto-link. Returns the crm_organisations.id whose
 * primary contact email matches one of the addresses passed in. This handles
 * the outbound case where `fromAddress` is the rep's own mailbox so the
 * AI/sender-based matcher cannot link the thread to the prospect.
 */
async function findCrmOrgByEmailAddresses(
  organizationId: string,
  addresses: string[],
): Promise<string | null> {
  const ownerDomain = OWN_DOMAINS_PLACEHOLDER; // see below
  const cleaned = Array.from(new Set(
    addresses
      .map((a) => (a || "").trim().toLowerCase())
      .filter((a) => a && a.includes("@") && !ownerDomain.has(a.split("@")[1] || "")),
  ));
  if (cleaned.length === 0) return null;
  const [contact] = await db
    .select({ orgId: crmContacts.organisationId })
    .from(crmContacts)
    .innerJoin(crmOrganisations, eq(crmOrganisations.id, crmContacts.organisationId))
    .where(and(
      eq(crmContacts.organizationId, organizationId),
      inArray(sql`lower(${crmContacts.email})`, cleaned),
    ))
    .limit(1);
  return contact?.orgId ?? null;
}
// Empty set keeps the helper from filtering anything by domain; the caller is
// expected to drop its own mailbox address before invoking. Using a Set here
// preserves the option to populate it from org settings in the future.
const OWN_DOMAINS_PLACEHOLDER: Set<string> = new Set();

function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.flatMap((v) => extractEmails(String(v)));
    return extractEmails(String(parsed));
  } catch {
    return extractEmails(value);
  }
}
function extractEmails(s: string): string[] {
  const re = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
  return s.match(re) || [];
}

async function autoLinkThreadByRecipients(
  threadId: string,
  organizationId: string,
  ownAddress: string,
  fromAddress: string | null,
  toAddresses: string | null,
  ccAddresses: string | null,
): Promise<void> {
  try {
    const own = (ownAddress || "").toLowerCase();
    const candidates = [
      ...(fromAddress ? extractEmails(fromAddress) : []),
      ...parseAddressList(toAddresses),
      ...parseAddressList(ccAddresses),
    ].map((a) => a.toLowerCase()).filter((a) => a !== own);
    if (candidates.length === 0) return;
    const orgId = await findCrmOrgByEmailAddresses(organizationId, candidates);
    if (!orgId) return;
    // Only set vendorId if not already linked, so manual links are preserved.
    await db
      .update(emailThreads)
      .set({ vendorId: orgId, updatedAt: new Date() })
      .where(and(eq(emailThreads.id, threadId), isNull(emailThreads.vendorId)));
  } catch (err) {
    logError("Recipient auto-link failed", { threadId }, err instanceof Error ? err : new Error(String(err)));
  }
}

async function persistGmailMessage(
  account: typeof emailAccounts.$inferSelect,
  msgId: string,
  threadMap: Map<string, string>,
  result: { messagesImported: number; threadsCreated: number; errors: string[] },
  messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[],
): Promise<void> {
  const msgResponse = await gmailApiFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
    account,
  );
  if (msgResponse.status === 404) return; // message gone
  if (!msgResponse.ok) {
    result.errors.push(`Failed to fetch message ${msgId}: ${msgResponse.status}`);
    return;
  }
  const gmailMsg = await msgResponse.json() as GmailMessage;
  const parsed = parseGmailMessage(gmailMsg, account.emailAddress);
  const folder = gmailFolderFromLabels(gmailMsg.labelIds);

  // Idempotent skip if already imported
  const [existingMsg] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.emailAccountId, account.id),
        eq(emailMessages.externalId, parsed.externalId),
      )
    )
    .limit(1);
  if (existingMsg) {
    // Update mutable fields in case state changed
    await db
      .update(emailMessages)
      .set({
        isRead: parsed.isRead,
        isArchived: folder === "ARCHIVE",
        folder,
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, existingMsg.id));
    return;
  }

  let dbThreadId = threadMap.get(parsed.threadId);
  if (!dbThreadId) {
    const [existingThread] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.emailAccountId, account.id),
          eq(emailThreads.externalThreadId, parsed.threadId),
        )
      )
      .limit(1);
    if (existingThread) {
      dbThreadId = existingThread.id;
    } else {
      const newThreadId = crypto.randomUUID();
      await db.insert(emailThreads).values({
        id: newThreadId,
        organizationId: account.organizationId,
        emailAccountId: account.id,
        subject: parsed.subject,
        externalThreadId: parsed.threadId,
        status: "OPEN",
        messageCount: 0,
        unreadCount: 0,
        lastMessageAt: parsed.receivedAt,
      });
      dbThreadId = newThreadId;
      result.threadsCreated++;
    }
    threadMap.set(parsed.threadId, dbThreadId);
  }

  const newMessageId = crypto.randomUUID();
  await db.insert(emailMessages).values({
    id: newMessageId,
    organizationId: account.organizationId,
    emailAccountId: account.id,
    threadId: dbThreadId,
    externalId: parsed.externalId,
    fromAddress: parsed.fromAddress,
    fromName: parsed.fromName || null,
    toAddresses: parsed.toAddresses,
    ccAddresses: parsed.ccAddresses,
    subject: parsed.subject,
    bodyText: parsed.bodyText || null,
    bodyHtml: parsed.bodyHtml || null,
    snippet: parsed.snippet || null,
    receivedAt: parsed.receivedAt,
    isRead: parsed.isRead,
    isIncoming: parsed.isIncoming,
    isArchived: folder === "ARCHIVE",
    folder,
    hasAttachments: parsed.hasAttachments,
  });
  result.messagesImported++;

  dispatchCrmEmailLog({
    account,
    externalId: parsed.externalId,
    externalThreadId: parsed.threadId,
    fromAddress: parsed.fromAddress,
    toAddresses: parsed.toAddresses,
    ccAddresses: parsed.ccAddresses,
    subject: parsed.subject,
    snippet: parsed.snippet,
    bodyText: parsed.bodyText,
    receivedAt: parsed.receivedAt,
    isIncoming: parsed.isIncoming,
    sourceEmailMessageId: newMessageId,
  });

  // Outbound auto-link by recipient (sent-folder messages whose `from` is the rep)
  if (!parsed.isIncoming) {
    await autoLinkThreadByRecipients(
      dbThreadId,
      account.organizationId,
      account.emailAddress,
      parsed.fromAddress,
      parsed.toAddresses,
      parsed.ccAddresses,
    );
  }

  if (parsed.isIncoming) {
    try {
      await detectInboundReply({
        organizationId: account.organizationId,
        fromAddress: parsed.fromAddress,
        isIncoming: true,
        receivedAt: parsed.receivedAt,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
      });
    } catch (err) {
      logError("sequence reply detection failed", { error: String(err) });
    }
    try {
      await detectInboundBounce({
        organizationId: account.organizationId,
        fromAddress: parsed.fromAddress,
        isIncoming: true,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        inboundEmailMessageId: newMessageId,
      });
    } catch (err) {
      logError("sequence bounce detection failed", { error: String(err) });
    }
  }

  const [msgCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
      maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
    })
    .from(emailMessages)
    .where(eq(emailMessages.threadId, dbThreadId));

  await db
    .update(emailThreads)
    .set({
      messageCount: msgCounts?.total ?? 1,
      unreadCount: msgCounts?.unread ?? 1,
      lastMessageAt: msgCounts?.maxReceivedAt ?? parsed.receivedAt,
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, dbThreadId));

  messagesToClassify.push({
    messageId: newMessageId,
    threadId: dbThreadId,
    subject: parsed.subject,
    bodyText: parsed.bodyText,
    fromAddress: parsed.fromAddress,
  });
}

interface GmailHistoryEntry {
  id: string;
  messages?: { id: string; threadId: string }[];
  messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: { message: { id: string; threadId: string; labelIds?: string[] }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string; threadId: string; labelIds?: string[] }; labelIds: string[] }[];
}

async function syncGmailIncremental(
  account: typeof emailAccounts.$inferSelect,
  startHistoryId: string,
): Promise<{ result: { messagesImported: number; threadsCreated: number; errors: string[] }; messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[]; newHistoryId: string | null; needsFullResync: boolean }> {
  const result = { messagesImported: 0, threadsCreated: 0, errors: [] as string[] };
  const messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[] = [];
  const threadMap = new Map<string, string>();
  let pageToken: string | undefined;
  let lastHistoryId: string | null = null;
  const seenAdded = new Set<string>();
  const stateChanges = new Map<string, { isRead?: boolean; isArchived?: boolean; folder?: string }>();
  const deleted = new Set<string>();

  const MAX_HISTORY_PAGES = 200;
  let hitPageCap = false;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.append("historyTypes", "messageAdded");
    url.searchParams.append("historyTypes", "labelAdded");
    url.searchParams.append("historyTypes", "labelRemoved");
    url.searchParams.append("historyTypes", "messageDeleted");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const resp = await gmailApiFetch(url.toString(), account);
    if (resp.status === 404 || resp.status === 410) {
      // History too old — caller must do full re-sync
      return { result, messagesToClassify, newHistoryId: null, needsFullResync: true };
    }
    if (!resp.ok) {
      result.errors.push(`Gmail history fetch failed: ${resp.status}`);
      return { result, messagesToClassify, newHistoryId: lastHistoryId, needsFullResync: false };
    }
    const data = await resp.json() as { history?: GmailHistoryEntry[]; nextPageToken?: string; historyId?: string };
    if (data.historyId) lastHistoryId = data.historyId;

    for (const h of data.history || []) {
      for (const ma of h.messagesAdded || []) {
        seenAdded.add(ma.message.id);
      }
      for (const md of h.messagesDeleted || []) {
        deleted.add(md.message.id);
      }
      for (const la of h.labelsAdded || []) {
        const cur = stateChanges.get(la.message.id) || {};
        if (la.labelIds.includes("UNREAD")) cur.isRead = false;
        if (la.labelIds.some(l => l === "TRASH" || l === "SPAM")) cur.isArchived = true;
        // INBOX added back == unarchive on Gmail
        if (la.labelIds.includes("INBOX")) {
          cur.isArchived = false;
          cur.folder = "INBOX";
        }
        // Recompute folder from current full label set if available
        if (la.message.labelIds) cur.folder = gmailFolderFromLabels(la.message.labelIds);
        stateChanges.set(la.message.id, cur);
      }
      for (const lr of h.labelsRemoved || []) {
        const cur = stateChanges.get(lr.message.id) || {};
        if (lr.labelIds.includes("UNREAD")) cur.isRead = true;
        if (lr.labelIds.includes("INBOX")) {
          // Gmail "archive" = remove INBOX label
          cur.isArchived = true;
          cur.folder = "ARCHIVE";
        }
        if (lr.message.labelIds) cur.folder = gmailFolderFromLabels(lr.message.labelIds);
        stateChanges.set(lr.message.id, cur);
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    if (page === MAX_HISTORY_PAGES - 1 && data.nextPageToken) {
      hitPageCap = true;
    }
  }

  if (hitPageCap) {
    // Do NOT advance the cursor — leaving it at startHistoryId so we resume
    // from the same point on the next sync run instead of silently dropping
    // unread history pages.
    result.errors.push(
      `Gmail history pagination cap reached (${MAX_HISTORY_PAGES} pages); cursor not advanced`,
    );
    lastHistoryId = null;
  }

  for (const msgId of seenAdded) {
    if (deleted.has(msgId)) continue;
    try {
      await persistGmailMessage(account, msgId, threadMap, result, messagesToClassify);
    } catch (err) {
      result.errors.push(`Error processing added Gmail message ${msgId}: ${String(err)}`);
    }
  }

  for (const [msgId, change] of stateChanges) {
    if (seenAdded.has(msgId) || deleted.has(msgId)) continue;
    const update: Partial<typeof emailMessages.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (typeof change.isRead === "boolean") update.isRead = change.isRead;
    if (typeof change.isArchived === "boolean") update.isArchived = change.isArchived;
    if (change.folder) update.folder = change.folder;
    if (Object.keys(update).length > 1) {
      await db
        .update(emailMessages)
        .set(update)
        .where(
          and(
            eq(emailMessages.emailAccountId, account.id),
            eq(emailMessages.externalId, msgId),
          )
        );
    }
  }

  for (const msgId of deleted) {
    await db
      .update(emailMessages)
      .set({ isArchived: true, folder: "ARCHIVE", updatedAt: new Date() })
      .where(
        and(
          eq(emailMessages.emailAccountId, account.id),
          eq(emailMessages.externalId, msgId),
        )
      );
  }

  // Recompute thread unread counts that may have changed
  if (stateChanges.size > 0 || deleted.size > 0) {
    const affectedExternalIds = Array.from(new Set([...stateChanges.keys(), ...deleted]));
    if (affectedExternalIds.length > 0) {
      const affectedThreads = await db
        .select({ threadId: emailMessages.threadId })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.emailAccountId, account.id),
            inArray(emailMessages.externalId, affectedExternalIds),
          )
        );
      const threadIds = Array.from(new Set(affectedThreads.map(t => t.threadId)));
      for (const tid of threadIds) {
        const [counts] = await db
          .select({
            total: sql<number>`count(*)::int`,
            unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
          })
          .from(emailMessages)
          .where(eq(emailMessages.threadId, tid));
        await db
          .update(emailThreads)
          .set({ messageCount: counts?.total ?? 0, unreadCount: counts?.unread ?? 0, updatedAt: new Date() })
          .where(eq(emailThreads.id, tid));
      }
    }
  }

  return { result, messagesToClassify, newHistoryId: lastHistoryId, needsFullResync: false };
}

export async function syncGmailAccount(
  account: typeof emailAccounts.$inferSelect,
  userId: string,
): Promise<{ messagesImported: number; threadsCreated: number; errors: string[] }> {
  const markNeedsReconnect = async (msg: string) => {
    await db
      .update(emailAccounts)
      .set({
        lastSyncedAt: new Date(),
        lastSyncError: msg.substring(0, 500),
        syncStatus: "NEEDS_RECONNECT",
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, account.id));
  };

  // Incremental path using historyId cursor (Task #522)
  if (account.gmailHistoryId) {
    try {
      const incr = await syncGmailIncremental(account, account.gmailHistoryId);
      if (!incr.needsFullResync) {
        await runEmailAiClassification(account, userId, incr.messagesToClassify, incr.result);
        const incrAuthFailed = incr.result.errors.some((e) => /\b(401|403)\b/.test(e));
        await db
          .update(emailAccounts)
          .set({
            lastSyncedAt: new Date(),
            lastSyncError: incr.result.errors[0]?.substring(0, 500) ?? null,
            gmailHistoryId: incr.newHistoryId ?? account.gmailHistoryId,
            syncStatus: incrAuthFailed
              ? "NEEDS_RECONNECT"
              : incr.result.errors.length > 0
                ? "DEGRADED"
                : "OK",
            updatedAt: new Date(),
          })
          .where(eq(emailAccounts.id, account.id));
        return incr.result;
      }
      // else fall through to full resync
      logInfo(`Gmail history expired for ${account.emailAddress}, doing full resync`);
    } catch (err) {
      logError(`Gmail incremental sync failed for ${account.emailAddress}, falling back to full sync`, {}, err instanceof Error ? err : new Error(String(err)));
      // If the incremental sync threw an auth error (refresh token revoked
      // or 401/403 surviving the refresh-and-retry inside gmailApiFetch),
      // don't keep retrying via the full path — the same auth wall will
      // block us. Mark the account NEEDS_RECONNECT so the user is prompted
      // to re-authenticate.
      if (err instanceof GmailAuthError) {
        const errMsg = `Gmail sync auth failed: ${err.message}`;
        await markNeedsReconnect(errMsg);
        return { messagesImported: 0, threadsCreated: 0, errors: [errMsg] };
      }
    }
  }

  // Full sync path (initial or after history-expiry)
  const result = { messagesImported: 0, threadsCreated: 0, errors: [] as string[] };
  const MAX_PAGES = 5;
  const PAGE_SIZE = 50;

  // Bounded 30-day backfill across both inbox and sent on initial/full sync (Task #522).
  // When the historyId cursor is null (first connect, manual resync, or expired
  // history) we always do the 30-day backfill regardless of `lastSyncedAt` so
  // the user sees their recent thread history. The narrower
  // "since last sync" window is only used when we still have a cursor and are
  // doing a routine catch-up after a transient incremental failure.
  const isInitialOrResync = !account.gmailHistoryId;
  const query = isInitialOrResync || !account.lastSyncedAt
    ? "(in:inbox OR in:sent) newer_than:30d"
    : `(in:inbox OR in:sent) after:${Math.floor(account.lastSyncedAt.getTime() / 1000)}`;

  const allMessageRefs: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${PAGE_SIZE}`;
      if (pageToken) {
        listUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const listResponse = await gmailApiFetch(listUrl, account);

      if (!listResponse.ok) {
        const errText = await listResponse.text();
        logError("Gmail list messages failed:", {}, errText instanceof Error ? errText : new Error(String(errText)));
        // 401/403 here would normally be turned into a GmailAuthError by
        // gmailApiFetch's refresh-and-retry, but keep this defensive branch
        // in case the first call already returned 403 (no refresh path).
        if (listResponse.status === 401 || listResponse.status === 403) {
          throw new GmailAuthError(`Gmail API auth failed: ${listResponse.status}`);
        }
        throw new Error(`Gmail API error: ${listResponse.status}`);
      }

      const listData = await listResponse.json() as {
        messages?: { id: string; threadId: string }[];
        nextPageToken?: string;
      };

      if (listData.messages) {
        allMessageRefs.push(...listData.messages);
      }

      if (!listData.nextPageToken) break;
      pageToken = listData.nextPageToken;
    }
  } catch (err) {
    if (err instanceof GmailAuthError) {
      const errMsg = `Gmail sync auth failed: ${err.message}`;
      result.errors.push(errMsg);
      await markNeedsReconnect(errMsg);
      return result;
    }
    throw err;
  }

  // Always advance the historyId cursor so subsequent syncs use incremental mode,
  // even when there were zero new messages in the listing.
  const recordSyncCheckpoint = async () => {
    const newHistoryId = await fetchGmailCurrentHistoryId(account);
    await db
      .update(emailAccounts)
      .set({
        lastSyncedAt: new Date(),
        lastFullSyncAt: new Date(),
        gmailHistoryId: newHistoryId ?? account.gmailHistoryId,
        syncStatus: "OK",
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, account.id));
  };

  if (allMessageRefs.length === 0) {
    await recordSyncCheckpoint();
    return result;
  }

  const candidateIds = allMessageRefs.map(m => m.id);
  const existingMessages = await db
    .select({ externalId: emailMessages.externalId })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.emailAccountId, account.id),
        inArray(emailMessages.externalId, candidateIds)
      )
    );
  const existingIds = new Set(existingMessages.map(m => m.externalId));

  const newMessageRefs = allMessageRefs.filter(m => !existingIds.has(m.id));
  if (newMessageRefs.length === 0) {
    await recordSyncCheckpoint();
    return result;
  }

  const threadMap = new Map<string, string>();
  const messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[] = [];

  for (const msgRef of newMessageRefs) {
    try {
      const msgResponse = await gmailApiFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=full`,
        account
      );

      if (!msgResponse.ok) {
        result.errors.push(`Failed to fetch message ${msgRef.id}: ${msgResponse.status}`);
        continue;
      }

      const gmailMsg = await msgResponse.json() as GmailMessage;
      const parsed = parseGmailMessage(gmailMsg, account.emailAddress);

      let dbThreadId = threadMap.get(parsed.threadId);

      if (!dbThreadId) {
        const [existingThread] = await db
          .select({ id: emailThreads.id })
          .from(emailThreads)
          .where(
            and(
              eq(emailThreads.emailAccountId, account.id),
              eq(emailThreads.externalThreadId, parsed.threadId)
            )
          )
          .limit(1);

        if (existingThread) {
          dbThreadId = existingThread.id;
        } else {
          const newThreadId = crypto.randomUUID();
          await db.insert(emailThreads).values({
            id: newThreadId,
            organizationId: account.organizationId,
            emailAccountId: account.id,
            subject: parsed.subject,
            externalThreadId: parsed.threadId,
            status: "OPEN",
            messageCount: 0,
            unreadCount: 0,
            lastMessageAt: parsed.receivedAt,
          });
          dbThreadId = newThreadId;
          result.threadsCreated++;
        }
        threadMap.set(parsed.threadId, dbThreadId);
      }

      const newMessageId = crypto.randomUUID();
      const folder = gmailFolderFromLabels(gmailMsg.labelIds);
      await db.insert(emailMessages).values({
        id: newMessageId,
        organizationId: account.organizationId,
        emailAccountId: account.id,
        threadId: dbThreadId,
        externalId: parsed.externalId,
        fromAddress: parsed.fromAddress,
        fromName: parsed.fromName || null,
        toAddresses: parsed.toAddresses,
        ccAddresses: parsed.ccAddresses,
        subject: parsed.subject,
        bodyText: parsed.bodyText || null,
        bodyHtml: parsed.bodyHtml || null,
        snippet: parsed.snippet || null,
        receivedAt: parsed.receivedAt,
        isRead: parsed.isRead,
        isIncoming: parsed.isIncoming,
        isArchived: folder === "ARCHIVE",
        folder,
        hasAttachments: parsed.hasAttachments,
      });
      result.messagesImported++;

      dispatchCrmEmailLog({
        account,
        externalId: parsed.externalId,
        externalThreadId: parsed.threadId,
        fromAddress: parsed.fromAddress,
        toAddresses: parsed.toAddresses,
        ccAddresses: parsed.ccAddresses,
        subject: parsed.subject,
        snippet: parsed.snippet,
        bodyText: parsed.bodyText,
        receivedAt: parsed.receivedAt,
        isIncoming: parsed.isIncoming,
        sourceEmailMessageId: newMessageId,
      });

      // Outbound recipient-based CRM auto-link for backfilled sent mail
      if (!parsed.isIncoming) {
        await autoLinkThreadByRecipients(
          dbThreadId,
          account.organizationId,
          account.emailAddress,
          parsed.fromAddress,
          parsed.toAddresses,
          parsed.ccAddresses,
        );
      }

      // Sequence reply detection: if this is an incoming reply from a contact
      // currently enrolled in a sequence, auto-pause the enrollment.
      if (parsed.isIncoming) {
        try {
          await detectInboundReply({
            organizationId: account.organizationId,
            fromAddress: parsed.fromAddress,
            isIncoming: true,
            receivedAt: parsed.receivedAt,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
          });
        } catch (err) {
          logError("sequence reply detection failed", { error: String(err) });
        }
        try {
          await detectInboundBounce({
            organizationId: account.organizationId,
            fromAddress: parsed.fromAddress,
            isIncoming: true,
            subject: parsed.subject,
            bodyText: parsed.bodyText,
            bodyHtml: parsed.bodyHtml,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
            inboundEmailMessageId: newMessageId,
          });
        } catch (err) {
          logError("sequence bounce detection failed", { error: String(err) });
        }
      }

      const [msgCounts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
          maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
        })
        .from(emailMessages)
        .where(eq(emailMessages.threadId, dbThreadId));

      await db
        .update(emailThreads)
        .set({
          messageCount: msgCounts?.total ?? 1,
          unreadCount: msgCounts?.unread ?? 1,
          lastMessageAt: msgCounts?.maxReceivedAt ?? parsed.receivedAt,
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, dbThreadId));

      messagesToClassify.push({
        messageId: newMessageId,
        threadId: dbThreadId,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        fromAddress: parsed.fromAddress,
      });
    } catch (err) {
      result.errors.push(`Error processing message ${msgRef.id}: ${String(err)}`);
    }
  }

  await runEmailAiClassification(account, userId, messagesToClassify, result);

  await recordSyncCheckpoint();

  return result;
}

async function runEmailAiClassification(
  account: typeof emailAccounts.$inferSelect,
  userId: string,
  messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[],
  _result: { messagesImported: number; threadsCreated: number; errors: string[] },
): Promise<void> {
  for (const msg of messagesToClassify) {
    try {
      const analysis = await analyzeEmail(msg.subject, msg.bodyText, msg.fromAddress, account.organizationId);

      await db
        .update(emailMessages)
        .set({
          classification: analysis.classification,
          aiMetadata: JSON.stringify(analysis),
          aiAnalyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailMessages.id, msg.messageId));

      await db
        .update(emailThreads)
        .set({
          primaryClassification: analysis.classification,
          aiSummary: analysis.summary,
          aiMetadata: JSON.stringify(analysis.extractedEntities),
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, msg.threadId));

      const matchedEntities = await matchEmailToEntities(analysis, account.organizationId);
      if (matchedEntities.projectId || matchedEntities.bidId || matchedEntities.vendorId) {
        await db
          .update(emailThreads)
          .set({
            projectId: matchedEntities.projectId || undefined,
            bidId: matchedEntities.bidId || undefined,
            vendorId: matchedEntities.vendorId || undefined,
          })
          .where(eq(emailThreads.id, msg.threadId));
      }

      await createTaskFromEmail(
        analysis,
        msg.messageId,
        msg.threadId,
        account.organizationId,
        userId,
        matchedEntities,
      );
    } catch (err) {
      logError(`AI classification failed for message ${msg.messageId}:`, {}, err instanceof Error ? err : new Error(String(err)));
    }
  }
}

interface OutlookMessage {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body?: { contentType: string; content: string };
  from?: { emailAddress: { name: string; address: string } };
  toRecipients?: { emailAddress: { name: string; address: string } }[];
  ccRecipients?: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  internetMessageId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
}

function parseOutlookMessage(msg: OutlookMessage, accountEmail: string): {
  externalId: string;
  threadId: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string;
  ccAddresses: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  snippet: string;
  receivedAt: Date;
  isIncoming: boolean;
  hasAttachments: boolean;
  isRead: boolean;
  inReplyTo: string;
  references: string;
} {
  const fromAddress = msg.from?.emailAddress?.address || "unknown@unknown.com";
  const findHeader = (n: string) =>
    (msg.internetMessageHeaders || []).find(h => h.name?.toLowerCase() === n.toLowerCase())?.value || "";
  const fromName = msg.from?.emailAddress?.name || "";
  const toAddresses = JSON.stringify(
    (msg.toRecipients || []).map(r => r.emailAddress?.address).filter(Boolean)
  );
  const ccAddresses = JSON.stringify(
    (msg.ccRecipients || []).map(r => r.emailAddress?.address).filter(Boolean)
  );

  let bodyText = "";
  let bodyHtml = "";
  if (msg.body) {
    if (msg.body.contentType === "html") {
      bodyHtml = msg.body.content || "";
      bodyText = msg.bodyPreview || "";
    } else {
      bodyText = msg.body.content || "";
    }
  }

  const isIncoming = !fromAddress.toLowerCase().includes(accountEmail.toLowerCase());

  return {
    externalId: msg.id,
    threadId: msg.conversationId,
    fromAddress,
    fromName,
    toAddresses,
    ccAddresses,
    subject: msg.subject || "(No Subject)",
    bodyText: bodyText.substring(0, 50000),
    bodyHtml: bodyHtml.substring(0, 100000),
    snippet: msg.bodyPreview || "",
    receivedAt: new Date(msg.receivedDateTime),
    isIncoming,
    hasAttachments: msg.hasAttachments,
    isRead: msg.isRead,
    inReplyTo: findHeader("In-Reply-To"),
    references: findHeader("References"),
  };
}

interface OutlookDeltaEntity extends Partial<OutlookMessage> {
  id: string;
  "@removed"?: { reason?: string };
}

async function persistOutlookMessage(
  account: typeof emailAccounts.$inferSelect,
  outlookMsg: OutlookMessage,
  folder: "INBOX" | "SENT",
  threadMap: Map<string, string>,
  result: { messagesImported: number; threadsCreated: number; errors: string[] },
  messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[],
): Promise<void> {
  const parsed = parseOutlookMessage(outlookMsg, account.emailAddress);

  // Idempotent upsert by externalId
  const [existingMsg] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.emailAccountId, account.id),
        eq(emailMessages.externalId, parsed.externalId),
      )
    )
    .limit(1);

  if (existingMsg) {
    await db
      .update(emailMessages)
      .set({
        isRead: parsed.isRead,
        isArchived: false,
        folder,
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, existingMsg.id));
    return;
  }

  let dbThreadId = threadMap.get(parsed.threadId);
  if (!dbThreadId) {
    const [existingThread] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.emailAccountId, account.id),
          eq(emailThreads.externalThreadId, parsed.threadId),
        )
      )
      .limit(1);
    if (existingThread) {
      dbThreadId = existingThread.id;
    } else {
      const newThreadId = crypto.randomUUID();
      await db.insert(emailThreads).values({
        id: newThreadId,
        organizationId: account.organizationId,
        emailAccountId: account.id,
        subject: parsed.subject,
        externalThreadId: parsed.threadId,
        status: "OPEN",
        messageCount: 0,
        unreadCount: 0,
        lastMessageAt: parsed.receivedAt,
      });
      dbThreadId = newThreadId;
      result.threadsCreated++;
    }
    threadMap.set(parsed.threadId, dbThreadId);
  }

  const newMessageId = crypto.randomUUID();
  await db.insert(emailMessages).values({
    id: newMessageId,
    organizationId: account.organizationId,
    emailAccountId: account.id,
    threadId: dbThreadId,
    externalId: parsed.externalId,
    fromAddress: parsed.fromAddress,
    fromName: parsed.fromName || null,
    toAddresses: parsed.toAddresses,
    ccAddresses: parsed.ccAddresses,
    subject: parsed.subject,
    bodyText: parsed.bodyText || null,
    bodyHtml: parsed.bodyHtml || null,
    snippet: parsed.snippet || null,
    receivedAt: parsed.receivedAt,
    isRead: parsed.isRead,
    isIncoming: parsed.isIncoming,
    isArchived: false,
    folder,
    hasAttachments: parsed.hasAttachments,
  });
  result.messagesImported++;

  dispatchCrmEmailLog({
    account,
    externalId: parsed.externalId,
    externalThreadId: parsed.threadId,
    fromAddress: parsed.fromAddress,
    toAddresses: parsed.toAddresses,
    ccAddresses: parsed.ccAddresses,
    subject: parsed.subject,
    snippet: parsed.snippet,
    bodyText: parsed.bodyText,
    receivedAt: parsed.receivedAt,
    isIncoming: parsed.isIncoming,
    sourceEmailMessageId: newMessageId,
  });

  // Outbound auto-link by recipient (sent-folder messages)
  if (folder === "SENT" || !parsed.isIncoming) {
    await autoLinkThreadByRecipients(
      dbThreadId,
      account.organizationId,
      account.emailAddress,
      parsed.fromAddress,
      parsed.toAddresses,
      parsed.ccAddresses,
    );
  }

  if (parsed.isIncoming) {
    try {
      await detectInboundReply({
        organizationId: account.organizationId,
        fromAddress: parsed.fromAddress,
        isIncoming: true,
        receivedAt: parsed.receivedAt,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
      });
    } catch (err) {
      logError("sequence reply detection failed", { error: String(err) });
    }
    try {
      await detectInboundBounce({
        organizationId: account.organizationId,
        fromAddress: parsed.fromAddress,
        isIncoming: true,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        inboundEmailMessageId: newMessageId,
      });
    } catch (err) {
      logError("sequence bounce detection failed", { error: String(err) });
    }
  }

  const [msgCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
      maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
    })
    .from(emailMessages)
    .where(eq(emailMessages.threadId, dbThreadId));

  await db
    .update(emailThreads)
    .set({
      messageCount: msgCounts?.total ?? 1,
      unreadCount: msgCounts?.unread ?? 1,
      lastMessageAt: msgCounts?.maxReceivedAt ?? parsed.receivedAt,
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, dbThreadId));

  messagesToClassify.push({
    messageId: newMessageId,
    threadId: dbThreadId,
    subject: parsed.subject,
    bodyText: parsed.bodyText,
    fromAddress: parsed.fromAddress,
  });
}

const OUTLOOK_DELTA_SELECT =
  "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,internetMessageId";

async function syncOutlookFolderDelta(
  account: typeof emailAccounts.$inferSelect,
  folderName: "inbox" | "sentitems",
  storedDelta: string | null,
  threadMap: Map<string, string>,
  result: { messagesImported: number; threadsCreated: number; errors: string[] },
  messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[],
): Promise<{ deltaLink: string | null; needsFullResync: boolean; degraded?: boolean }> {
  let url: string;
  if (storedDelta) {
    url = storedDelta;
  } else {
    const u = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${folderName}/messages/delta`);
    u.searchParams.set("$select", OUTLOOK_DELTA_SELECT);
    u.searchParams.set("$top", "50");
    url = u.toString();
  }
  const folderTag: "INBOX" | "SENT" = folderName === "inbox" ? "INBOX" : "SENT";

  let pageCount = 0;
  let deltaLink: string | null = null;
  let lastNextLink: string | null = null;
  // Safety cap to bound a single sync run. When hit we persist the
  // @odata.nextLink as the cursor (Graph delta nextLinks are valid resume
  // tokens) so the next run picks up exactly where we left off — never
  // restarts from the folder root, which would cause an infinite replay loop.
  const MAX_PAGES = 50;

  while (url && pageCount < MAX_PAGES) {
    pageCount++;
    const resp = await outlookApiFetch(url, account, {
      headers: { Prefer: 'odata.track-changes, odata.maxpagesize=50' },
    });
    if ((resp.status === 410 || resp.status === 404) && storedDelta) {
      // delta token expired; signal full resync
      return { deltaLink: null, needsFullResync: true };
    }
    if (resp.status === 401 || resp.status === 403) {
      // Auth/scope failure — caller should mark account NEEDS_RECONNECT
      throw new Error(`Outlook delta auth failed: ${resp.status}`);
    }
    if (!resp.ok) {
      result.errors.push(`Outlook delta (${folderName}) failed: ${resp.status}`);
      return { deltaLink, needsFullResync: false };
    }
    const data = await resp.json() as {
      value?: OutlookDeltaEntity[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    const affectedThreadIds = new Set<string>();
    for (const entity of data.value || []) {
      try {
        if (entity["@removed"]) {
          const affected = await db
            .update(emailMessages)
            .set({ isArchived: true, folder: "ARCHIVE", updatedAt: new Date() })
            .where(
              and(
                eq(emailMessages.emailAccountId, account.id),
                eq(emailMessages.externalId, entity.id),
              )
            )
            .returning({ threadId: emailMessages.threadId });
          for (const a of affected) affectedThreadIds.add(a.threadId);
          continue;
        }

        // If the entity has full message fields, persist as a new/updated message
        if (entity.from || entity.subject !== undefined || entity.body) {
          await persistOutlookMessage(
            account,
            entity as OutlookMessage,
            folderTag,
            threadMap,
            result,
            messagesToClassify,
          );
        } else if (typeof entity.isRead === "boolean") {
          // Property-only change (e.g. isRead toggled remotely)
          const affected = await db
            .update(emailMessages)
            .set({ isRead: entity.isRead, updatedAt: new Date() })
            .where(
              and(
                eq(emailMessages.emailAccountId, account.id),
                eq(emailMessages.externalId, entity.id),
              )
            )
            .returning({ threadId: emailMessages.threadId });
          for (const a of affected) affectedThreadIds.add(a.threadId);
        }
      } catch (err) {
        result.errors.push(`Error processing Outlook delta entity ${entity.id}: ${String(err)}`);
      }
    }

    // Recompute thread message/unread counters for any threads whose state
    // changed via property-only or @removed updates (persistOutlookMessage
    // already handles its own counters).
    for (const threadId of affectedThreadIds) {
      const [counts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
          maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
        })
        .from(emailMessages)
        .where(eq(emailMessages.threadId, threadId));
      await db
        .update(emailThreads)
        .set({
          messageCount: counts?.total ?? 0,
          unreadCount: counts?.unread ?? 0,
          ...(counts?.maxReceivedAt ? { lastMessageAt: counts.maxReceivedAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, threadId));
    }

    if (data["@odata.deltaLink"]) {
      deltaLink = data["@odata.deltaLink"];
      lastNextLink = null;
      break;
    }
    if (!data["@odata.nextLink"]) break;
    lastNextLink = data["@odata.nextLink"];
    url = data["@odata.nextLink"];
  }

  // If we exhausted the page cap without reaching @odata.deltaLink, persist
  // the last @odata.nextLink as the cursor so the next sync run resumes
  // exactly where this one stopped (Graph delta nextLinks are valid resume
  // tokens). This prevents the infinite "restart from folder root" loop that
  // would otherwise occur on very large mailboxes.
  if (!deltaLink && lastNextLink) {
    return { deltaLink: lastNextLink, needsFullResync: false, degraded: true };
  }

  return { deltaLink: deltaLink ?? storedDelta ?? null, needsFullResync: false };
}

export async function syncOutlookAccount(
  account: typeof emailAccounts.$inferSelect,
  userId: string,
): Promise<{ messagesImported: number; threadsCreated: number; errors: string[] }> {
  const result = { messagesImported: 0, threadsCreated: 0, errors: [] as string[] };
  const threadMap = new Map<string, string>();
  const messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[] = [];

  let inboxDelta = account.outlookDeltaInbox;
  let sentDelta = account.outlookDeltaSent;
  let needsReconnect = false;
  let degraded = false;
  let isFirstSync = !inboxDelta && !sentDelta;

  try {
    const inboxResult = await syncOutlookFolderDelta(account, "inbox", inboxDelta, threadMap, result, messagesToClassify);
    if (inboxResult.needsFullResync) {
      // discard cursor and retry once
      const retry = await syncOutlookFolderDelta(account, "inbox", null, threadMap, result, messagesToClassify);
      inboxDelta = retry.deltaLink;
      if (retry.degraded) degraded = true;
    } else {
      inboxDelta = inboxResult.deltaLink;
      if (inboxResult.degraded) degraded = true;
    }

    const sentResult = await syncOutlookFolderDelta(account, "sentitems", sentDelta, threadMap, result, messagesToClassify);
    if (sentResult.needsFullResync) {
      const retry = await syncOutlookFolderDelta(account, "sentitems", null, threadMap, result, messagesToClassify);
      sentDelta = retry.deltaLink;
      if (retry.degraded) degraded = true;
    } else {
      sentDelta = sentResult.deltaLink;
      if (sentResult.degraded) degraded = true;
    }

    if (degraded) {
      result.errors.push(
        "Outlook delta sync hit page cap; cursor saved at intermediate position and will resume next cycle.",
      );
    }
  } catch (err) {
    const msg = String(err);
    if (/\b401|403\b/.test(msg)) needsReconnect = true;
    result.errors.push(`Outlook sync error: ${msg}`);
    logError(`Outlook delta sync failed for ${account.emailAddress}`, {}, err instanceof Error ? err : new Error(msg));
  }

  await runEmailAiClassification(account, userId, messagesToClassify, result);

  await db
    .update(emailAccounts)
    .set({
      lastSyncedAt: new Date(),
      lastFullSyncAt: isFirstSync ? new Date() : (account.lastFullSyncAt ?? new Date()),
      outlookDeltaInbox: inboxDelta ?? account.outlookDeltaInbox,
      outlookDeltaSent: sentDelta ?? account.outlookDeltaSent,
      lastSyncError: result.errors[0]?.substring(0, 500) ?? null,
      syncStatus: needsReconnect
        ? "NEEDS_RECONNECT"
        : result.errors.length > 0
          ? "DEGRADED"
          : "OK",
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, account.id));

  return result;
}

export async function syncImapAccount(
  account: typeof emailAccounts.$inferSelect,
  userId: string,
): Promise<{ messagesImported: number; threadsCreated: number; errors: string[] }> {
  const result = { messagesImported: 0, threadsCreated: 0, errors: [] as string[] };

  if (!account.imapHost || !account.imapPort || !account.imapPassword) {
    result.errors.push("IMAP configuration incomplete: missing host, port, or password");
    try {
      await db
        .update(emailAccounts)
        .set({ lastSyncError: "IMAP configuration incomplete: missing host, port, or password", updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    } catch (err) {
      logError("Failed to update email account sync error status:", { accountId: account.id }, err instanceof Error ? err : new Error(String(err)));
    }
    return result;
  }

  try {
    const since = account.lastSyncedAt || undefined;
    const fetched = await fetchImapMessages(account, since, 100);

    if (fetched.length === 0) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
      return result;
    }

    const candidateIds = fetched.map(m => m.externalId);
    const existingMessages = await db
      .select({ externalId: emailMessages.externalId })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.emailAccountId, account.id),
          inArray(emailMessages.externalId, candidateIds)
        )
      );
    const existingIds = new Set(existingMessages.map(m => m.externalId));

    const newMessages = fetched.filter(m => !existingIds.has(m.externalId));
    if (newMessages.length === 0) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
      return result;
    }

    const threadMap = new Map<string, string>();
    const messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[] = [];

    for (const msg of newMessages) {
      try {
        const threadKey = msg.subject
          .replace(/^(Re|Fwd|Fw):\s*/gi, "")
          .trim()
          .toLowerCase();

        let dbThreadId = threadMap.get(threadKey);

        if (!dbThreadId) {
          const normalizedSubject = msg.subject.replace(/^(Re|Fwd|Fw):\s*/gi, "").trim();
          const [existingThread] = await db
            .select({ id: emailThreads.id })
            .from(emailThreads)
            .where(
              and(
                eq(emailThreads.emailAccountId, account.id),
                eq(emailThreads.subject, normalizedSubject)
              )
            )
            .limit(1);

          if (existingThread) {
            dbThreadId = existingThread.id;
          } else {
            const newThreadId = crypto.randomUUID();
            await db.insert(emailThreads).values({
              id: newThreadId,
              organizationId: account.organizationId,
              emailAccountId: account.id,
              subject: normalizedSubject || msg.subject,
              externalThreadId: msg.messageId,
              status: "OPEN",
              messageCount: 0,
              unreadCount: 0,
              lastMessageAt: msg.receivedAt,
            });
            dbThreadId = newThreadId;
            result.threadsCreated++;
          }
          threadMap.set(threadKey, dbThreadId);
        }

        const isIncoming = msg.fromAddress.toLowerCase() !== account.emailAddress.toLowerCase();

        const newMessageId = crypto.randomUUID();
        await db.insert(emailMessages).values({
          id: newMessageId,
          organizationId: account.organizationId,
          emailAccountId: account.id,
          threadId: dbThreadId,
          externalId: msg.externalId,
          fromAddress: msg.fromAddress,
          fromName: msg.fromName || null,
          toAddresses: msg.toAddresses,
          ccAddresses: msg.ccAddresses,
          subject: msg.subject,
          bodyText: msg.bodyText || null,
          bodyHtml: msg.bodyHtml || null,
          snippet: msg.snippet || null,
          receivedAt: msg.receivedAt,
          isRead: msg.isRead,
          isIncoming: isIncoming,
          hasAttachments: msg.hasAttachments,
        });
        result.messagesImported++;

        // Note: CRM email logging intentionally not dispatched for IMAP — Task #886
        // scopes only Gmail and Outlook providers. IMAP/POP is out of scope.

        if (isIncoming) {
          try {
            await detectInboundReply({
              organizationId: account.organizationId,
              fromAddress: msg.fromAddress,
              isIncoming: true,
              receivedAt: msg.receivedAt,
              inReplyTo: (msg as any).inReplyTo,
              references: (msg as any).references,
            });
          } catch (err) {
            logError("sequence reply detection failed", { error: String(err) });
          }
          try {
            await detectInboundBounce({
              organizationId: account.organizationId,
              fromAddress: msg.fromAddress,
              isIncoming: true,
              subject: msg.subject,
              bodyText: msg.bodyText,
              bodyHtml: msg.bodyHtml,
              inReplyTo: (msg as any).inReplyTo,
              references: (msg as any).references,
              inboundEmailMessageId: newMessageId,
            });
          } catch (err) {
            logError("sequence bounce detection failed", { error: String(err) });
          }
        }

        const [msgCounts] = await db
          .select({
            total: sql<number>`count(*)::int`,
            unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
            maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
          })
          .from(emailMessages)
          .where(eq(emailMessages.threadId, dbThreadId));

        await db
          .update(emailThreads)
          .set({
            messageCount: msgCounts?.total ?? 1,
            unreadCount: msgCounts?.unread ?? 1,
            lastMessageAt: msgCounts?.maxReceivedAt ?? msg.receivedAt,
            updatedAt: new Date(),
          })
          .where(eq(emailThreads.id, dbThreadId));

        messagesToClassify.push({
          messageId: newMessageId,
          threadId: dbThreadId,
          subject: msg.subject,
          bodyText: msg.bodyText,
          fromAddress: msg.fromAddress,
        });
      } catch (err) {
        result.errors.push(`Error processing IMAP message ${msg.externalId}: ${String(err)}`);
      }
    }

    for (const msg of messagesToClassify) {
      try {
        const analysis = await analyzeEmail(msg.subject, msg.bodyText, msg.fromAddress, account.organizationId);

        await db
          .update(emailMessages)
          .set({
            classification: analysis.classification,
            aiMetadata: JSON.stringify(analysis),
            aiAnalyzedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(emailMessages.id, msg.messageId));

        await db
          .update(emailThreads)
          .set({
            primaryClassification: analysis.classification,
            aiSummary: analysis.summary,
            aiMetadata: JSON.stringify(analysis.extractedEntities),
            updatedAt: new Date(),
          })
          .where(eq(emailThreads.id, msg.threadId));

        const matchedEntities = await matchEmailToEntities(analysis, account.organizationId);
        if (matchedEntities.projectId || matchedEntities.bidId || matchedEntities.vendorId) {
          await db
            .update(emailThreads)
            .set({
              projectId: matchedEntities.projectId || undefined,
              bidId: matchedEntities.bidId || undefined,
              vendorId: matchedEntities.vendorId || undefined,
            })
            .where(eq(emailThreads.id, msg.threadId));
        }

        await createTaskFromEmail(
          analysis,
          msg.messageId,
          msg.threadId,
          account.organizationId,
          userId,
          matchedEntities,
        );
      } catch (err) {
        logError(`AI classification failed for IMAP message ${msg.messageId}:`, {}, err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (result.errors.length === 0) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    } else if (result.messagesImported > 0) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), lastSyncError: result.errors[0].substring(0, 500), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    } else {
      await db
        .update(emailAccounts)
        .set({ lastSyncError: result.errors[0].substring(0, 500), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    }
  } catch (err) {
    const errorMsg = `IMAP sync failed: ${String(err)}`;
    result.errors.push(errorMsg);
    try {
      await db
        .update(emailAccounts)
        .set({ lastSyncError: errorMsg.substring(0, 500), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    } catch (updateErr) {
      logError("Failed to persist IMAP sync error status:", { accountId: account.id }, updateErr instanceof Error ? updateErr : new Error(String(updateErr)));
    }
  }

  return result;
}

router.post("/sync", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id),
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

    const syncResults: { account: string; messagesImported: number; threadsCreated: number; errors: string[] }[] = [];

    for (const account of accounts) {
      try {
        if (account.provider === "GMAIL") {
          const accountResult = await syncGmailAccount(account, req.user!.id);
          syncResults.push({
            account: account.emailAddress,
            ...accountResult,
          });
        } else if (account.provider === "OUTLOOK") {
          const accountResult = await syncOutlookAccount(account, req.user!.id);
          syncResults.push({
            account: account.emailAddress,
            ...accountResult,
          });
        } else if (account.provider === "IMAP") {
          const accountResult = await syncImapAccount(account, req.user!.id);
          syncResults.push({
            account: account.emailAddress,
            ...accountResult,
          });
        } else {
          syncResults.push({
            account: account.emailAddress,
            messagesImported: 0,
            threadsCreated: 0,
            errors: [`Provider ${account.provider} sync not yet implemented`],
          });
        }
      } catch (err) {
        logError(`Sync failed for account ${account.emailAddress}:`, {}, err instanceof Error ? err : new Error(String(err)));
        syncResults.push({
          account: account.emailAddress,
          messagesImported: 0,
          threadsCreated: 0,
          errors: [String(err)],
        });
      }
    }

    const totalMessages = syncResults.reduce((sum, r) => sum + r.messagesImported, 0);
    const totalThreads = syncResults.reduce((sum, r) => sum + r.threadsCreated, 0);

    return res.json({
      success: true,
      message: `Synced ${totalMessages} message(s) across ${accounts.length} account(s)`,
      accountsProcessed: accounts.length,
      totalMessagesImported: totalMessages,
      totalThreadsCreated: totalThreads,
      details: syncResults,
    });
  } catch (error) {
        return next(error);
  }
});

// ========================================
// Routes from emailAnalysisRoutes.ts
// ========================================

router.post("/messages/:id/analyze", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
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

    const governedAnalysis = await governedAiCall<EmailAnalysisResult>({
      orgId,
      userId: req.user!.id,
      actionType: "email_message_analysis",
      inputRefs: { messageId: message.id },
      fn: async () => {
        const result = await analyzeEmail(
          message.subject,
          message.bodyText || message.bodyHtml || '',
          message.fromAddress,
          orgId
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: AI_MODEL_GPT5 } };
      },
    });

    if (governedAnalysis.blocked) {
      return res.status(429).json({ error: governedAnalysis.reason || "AI rate limit reached" });
    }

    const analysis = governedAnalysis.result;

    const matchedEntities = await matchEmailToEntities(analysis, orgId);

    await db
      .update(emailMessages)
      .set({
        classification: analysis.classification as any,
        aiMetadata: JSON.stringify(analysis),
        aiAnalyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, message.id));

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.id, message.threadId))
      .limit(1);

    if (thread && !thread.primaryClassification) {
      await db
        .update(emailThreads)
        .set({
          primaryClassification: analysis.classification as any,
          projectId: matchedEntities.projectId || thread.projectId,
          bidId: matchedEntities.bidId || thread.bidId,
          vendorId: matchedEntities.vendorId || thread.vendorId,
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, thread.id));
    }

    let taskId: string | null = null;
    if (analysis.requiresResponse && analysis.suggestedTaskTitle) {
      taskId = await createTaskFromEmail(
        analysis,
        message.id,
        message.threadId,
        orgId,
        req.user!.id,
        matchedEntities
      );

      if (taskId) {
        await logCreate(req.user!.id, "EMAIL_TASK", taskId, {
          source: "AI_ANALYSIS",
          messageId: message.id,
        }, req);
      }
    }

    await logAudit({
      userId: req.user!.id,
      entityType: "EMAIL_MESSAGE",
      entityId: message.id,
      action: "UPDATE",
      oldValue: null,
      newValue: JSON.stringify({ classification: analysis.classification }),
    }, req);

    return res.json({
      analysis,
      matchedEntities,
      taskCreated: taskId ? true : false,
      taskId,
    });
  } catch (error) {
        return next(error);
  }
});

router.post("/messages/:id/suggest-reply", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const toneSchema = z.object({
      tones: z.array(z.enum(['professional', 'casual', 'firm'])).default(['professional']),
    });

    const parseResult = toneSchema.safeParse(req.body);
    const tones = parseResult.success ? parseResult.data.tones : ['professional'] as const;

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

    const governedReplies = await governedAiCall<import("./ai/emailAi").ReplyDraft[]>({
      orgId,
      userId: req.user!.id,
      actionType: "email_suggest_reply",
      inputRefs: { messageId: message.id },
      fn: async () => {
        const result = await suggestReplies(
          {
            subject: message.subject,
            body: message.bodyText || message.bodyHtml || '',
            fromAddress: message.fromAddress,
          },
          tones as Array<'professional' | 'casual' | 'firm'>
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: AI_MODEL_GPT5 } };
      },
    });

    if (governedReplies.blocked) {
      return res.status(429).json({ error: governedReplies.reason || "AI rate limit reached" });
    }

    const drafts = governedReplies.result;

    return res.json({ drafts });
  } catch (error) {
        return next(error);
  }
});

const sendEmailSchema = z.object({
  accountId: z.string().min(1),
  to: z.string().email(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1).max(500),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  replyToMessageId: z.string().optional(),
});

router.post("/send", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const parseResult = sendEmailSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, data.accountId),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user!.id),
          eq(emailAccounts.isActive, true)
        )
      )
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: "Email account not found or inactive" });
    }

    const sendOpts = {
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      text: data.text,
      html: data.html,
      inReplyTo: data.inReplyTo,
      references: data.references,
    };

    let sendResult: { success: boolean; messageId?: string; error?: string };

    if (account.provider === "IMAP") {
      if (!account.smtpHost) {
        return res.status(400).json({ error: "SMTP not configured for this account. Please add SMTP settings to send emails." });
      }
      sendResult = await sendSmtpEmail(account, sendOpts);
    } else if (account.provider === "GMAIL") {
      if (!account.accessToken && !account.refreshToken) {
        return res.status(400).json({ error: "Gmail account not authorized. Please reconnect your Gmail account." });
      }
      sendResult = await sendViaGmail(account, sendOpts);
    } else if (account.provider === "OUTLOOK") {
      if (!account.accessToken && !account.refreshToken) {
        return res.status(400).json({ error: "Outlook account not authorized. Please reconnect your Outlook account." });
      }
      sendResult = await sendViaOutlook(account, sendOpts);
    } else {
      return res.status(400).json({ error: `Sending via ${account.provider} is not supported. Supported providers: IMAP/SMTP, Gmail, Outlook.` });
    }

    if (!sendResult.success) {
      return res.status(500).json({ error: sendResult.error || "Failed to send email" });
    }

    let targetThreadId: string | null = null;

    if (data.replyToMessageId) {
      const [originalMessage] = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.id, data.replyToMessageId),
            eq(emailMessages.organizationId, orgId)
          )
        )
        .limit(1);

      if (originalMessage) {
        targetThreadId = originalMessage.threadId;
      }
    }

    if (!targetThreadId) {
      const newThreadId = crypto.randomUUID();
      await db.insert(emailThreads).values({
        id: newThreadId,
        organizationId: orgId,
        emailAccountId: account.id,
        subject: data.subject,
        externalThreadId: sendResult.messageId || `sent-thread-${newThreadId}`,
        status: "OPEN",
        messageCount: 0,
        unreadCount: 0,
        lastMessageAt: new Date(),
      });
      targetThreadId = newThreadId;
    }

    const sentMessageId = crypto.randomUUID();
    await db.insert(emailMessages).values({
      id: sentMessageId,
      organizationId: orgId,
      emailAccountId: account.id,
      threadId: targetThreadId,
      externalId: sendResult.messageId || `sent-${sentMessageId}`,
      fromAddress: account.emailAddress,
      fromName: account.displayName || null,
      toAddresses: JSON.stringify([data.to]),
      ccAddresses: data.cc ? JSON.stringify([data.cc]) : null,
      subject: data.subject,
      bodyText: data.text || null,
      bodyHtml: data.html || null,
      snippet: (data.text || "").substring(0, 200),
      receivedAt: new Date(),
      isRead: true,
      isIncoming: false,
      isArchived: false,
      folder: "SENT",
      hasAttachments: false,
    });

    dispatchCrmEmailLog({
      account,
      externalId: sendResult.messageId || `sent-${sentMessageId}`,
      externalThreadId: sendResult.messageId || null,
      fromAddress: account.emailAddress,
      toAddresses: JSON.stringify([data.to]),
      ccAddresses: data.cc ? JSON.stringify([data.cc]) : null,
      subject: data.subject,
      snippet: (data.text || "").substring(0, 200),
      bodyText: data.text || null,
      receivedAt: new Date(),
      isIncoming: false,
      sourceEmailMessageId: sentMessageId,
    });

    // Outbound auto-link by recipient
    await autoLinkThreadByRecipients(
      targetThreadId,
      orgId,
      account.emailAddress,
      account.emailAddress,
      JSON.stringify([data.to]),
      data.cc ? JSON.stringify([data.cc]) : null,
    );

    const [msgCounts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
      })
      .from(emailMessages)
      .where(eq(emailMessages.threadId, targetThreadId));

    await db
      .update(emailThreads)
      .set({
        messageCount: msgCounts?.total ?? 1,
        unreadCount: msgCounts?.unread ?? 0,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, targetThreadId));

    await logAudit({
      userId: req.user!.id,
      entityType: "EMAIL_MESSAGE",
      entityId: data.accountId,
      action: "CREATE",
      oldValue: null,
      newValue: JSON.stringify({ to: data.to, subject: data.subject, provider: account.provider }),
    }, req);

    return res.json({ success: true, messageId: sendResult.messageId });
  } catch (error) {
        return next(error);
  }
});

router.post("/threads/:id/summarize", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
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

    if (messages.length === 0) {
      return res.json({ summary: "No messages in this thread." });
    }

    const governedSummary = await governedAiCall<import("./ai/emailAi").ThreadSummaryResult>({
      orgId,
      userId: req.user!.id,
      actionType: "email_thread_summary",
      inputRefs: { threadId: thread.id },
      fn: async () => {
        const result = await summarizeThread(
          messages.map(m => ({
            fromAddress: m.fromAddress,
            fromName: m.fromName ?? undefined,
            subject: m.subject,
            bodyText: m.bodyText ?? undefined,
            receivedAt: m.receivedAt,
          }))
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: AI_MODEL_GPT5 } };
      },
    });

    if (governedSummary.blocked) {
      return res.status(429).json({ error: governedSummary.reason || "AI rate limit reached" });
    }

    const summary = governedSummary.result;

    await db
      .update(emailThreads)
      .set({
        aiSummary: summary.summary,
        aiMetadata: JSON.stringify(summary),
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, thread.id));

    return res.json(summary);
  } catch (error) {
        return next(error);
  }
});

router.post("/summary/daily", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentMessages = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        subject: emailMessages.subject,
        fromAddress: emailMessages.fromAddress,
        snippet: emailMessages.snippet,
        classification: emailMessages.classification,
        receivedAt: emailMessages.receivedAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.organizationId, orgId),
          gte(emailMessages.receivedAt, oneDayAgo)
        )
      )
      .orderBy(desc(emailMessages.receivedAt))
      .limit(100);

    if (recentMessages.length === 0) {
      return res.json({
        periodDescription: "Last 24 hours",
        totalEmails: 0,
        byClassification: {},
        highlights: [],
        actionNeeded: [],
        summaryNarrative: "No new emails in the last 24 hours.",
      });
    }

    const governedDaily = await governedAiCall<import("./ai/emailAi").EmailSummaryDigest>({
      orgId,
      userId: req.user!.id,
      actionType: "email_daily_summary",
      inputRefs: { messageCount: recentMessages.length },
      fn: async () => {
        const result = await generateEmailSummary(
          recentMessages.map(m => ({
            classification: m.classification ?? undefined,
            subject: m.subject,
            fromAddress: m.fromAddress,
            snippet: m.snippet ?? undefined,
            threadId: m.threadId,
            receivedAt: m.receivedAt,
          })),
          'DAILY'
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: AI_MODEL_GPT5 } };
      },
    });

    if (governedDaily.blocked) {
      return res.status(429).json({ error: governedDaily.reason || "AI rate limit reached" });
    }

    const summary = governedDaily.result;

    await db.insert(emailSummaries).values({
      organizationId: orgId,
      userId: req.user!.id,
      summaryType: 'DAILY',
      periodStart: oneDayAgo,
      periodEnd: new Date(),
      summaryContent: summary.summaryNarrative,
      highlightsJson: JSON.stringify(summary.highlights),
      emailCount: summary.totalEmails,
      tasksCreated: 0,
    });

    return res.json(summary);
  } catch (error) {
        return next(error);
  }
});

router.post("/summary/weekly", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const recentMessages = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        subject: emailMessages.subject,
        fromAddress: emailMessages.fromAddress,
        snippet: emailMessages.snippet,
        classification: emailMessages.classification,
        receivedAt: emailMessages.receivedAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.organizationId, orgId),
          gte(emailMessages.receivedAt, oneWeekAgo)
        )
      )
      .orderBy(desc(emailMessages.receivedAt))
      .limit(200);

    if (recentMessages.length === 0) {
      return res.json({
        periodDescription: "Last 7 days",
        totalEmails: 0,
        byClassification: {},
        highlights: [],
        actionNeeded: [],
        summaryNarrative: "No new emails in the last 7 days.",
      });
    }

    const governedWeekly = await governedAiCall<import("./ai/emailAi").EmailSummaryDigest>({
      orgId,
      userId: req.user!.id,
      actionType: "email_weekly_summary",
      inputRefs: { messageCount: recentMessages.length },
      fn: async () => {
        const result = await generateEmailSummary(
          recentMessages.map(m => ({
            classification: m.classification ?? undefined,
            subject: m.subject,
            fromAddress: m.fromAddress,
            snippet: m.snippet ?? undefined,
            threadId: m.threadId,
            receivedAt: m.receivedAt,
          })),
          'WEEKLY'
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: AI_MODEL_GPT5 } };
      },
    });

    if (governedWeekly.blocked) {
      return res.status(429).json({ error: governedWeekly.reason || "AI rate limit reached" });
    }

    const summary = governedWeekly.result;

    await db.insert(emailSummaries).values({
      organizationId: orgId,
      userId: req.user!.id,
      summaryType: 'WEEKLY',
      periodStart: oneWeekAgo,
      periodEnd: new Date(),
      summaryContent: summary.summaryNarrative,
      highlightsJson: JSON.stringify(summary.highlights),
      emailCount: summary.totalEmails,
      tasksCreated: 0,
    });

    return res.json(summary);
  } catch (error) {
        return next(error);
  }
});

router.get("/summary/latest", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const summaries = await db
      .select()
      .from(emailSummaries)
      .where(
        and(
          eq(emailSummaries.organizationId, orgId),
          eq(emailSummaries.userId, req.user!.id)
        )
      )
      .orderBy(desc(emailSummaries.createdAt))
      .limit(5);

    return res.json(summaries);
  } catch (error) {
        return next(error);
  }
});

// ========================================
// Routes from emailTaskRoutes.ts
// ========================================

router.get("/tasks", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { status, projectId, limit = '50', offset = '0' } = req.query;

    const conditions = [
      eq(tasks.organizationId, orgId),
      or(
        eq(tasks.sourceType, 'EMAIL'),
        eq(tasks.sourceType, 'AI_GENERATED'),
        eq(tasks.sourceType, 'SYSTEM'),
        isNotNull(tasks.emailThreadId)
      )
    ];
    
    if (status && ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status as string)) {
      conditions.push(eq(tasks.status, status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED"));
    }
    
    if (projectId && typeof projectId === 'string') {
      conditions.push(eq(tasks.projectId, projectId));
    }

    const taskResults = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(taskResults);
  } catch (error) {
        return next(error);
  }
});

router.post("/tasks", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const taskSchema = z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
      dueDate: z.string().datetime().optional(),
      emailThreadId: z.string().uuid().optional(),
      emailMessageId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      bidId: z.string().uuid().optional(),
      vendorId: z.string().uuid().optional(),
      assignedToId: z.string().uuid().optional(),
      sourceType: z.enum(['MANUAL', 'EMAIL', 'AI_GENERATED', 'SYSTEM']).default('EMAIL'),
    });

    const parseResult = taskSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: orgId,
        createdById: req.user!.id,
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        emailThreadId: data.emailThreadId,
        emailMessageId: data.emailMessageId,
        projectId: data.projectId,
        bidId: data.bidId,
        vendorId: data.vendorId,
        assignedToId: data.assignedToId,
        status: 'PENDING',
        sourceType: data.sourceType,
      })
      .returning();

    await logCreate(req.user!.id, "TASK", task.id, { title: task.title, sourceType: task.sourceType }, req);

    return res.status(201).json(task);
  } catch (error) {
        return next(error);
  }
});

router.patch("/tasks/:id", requireAuth, requireInternalRole, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      assignedToId: z.string().uuid().nullable().optional(),
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
      .from(tasks)
      .where(
        and(
          eq(tasks.id, req.params.id),
          eq(tasks.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Task not found" });
    }

    const data = parseResult.data;
    const updateData: Partial<Task> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.projectId !== undefined) updateData.projectId = data.projectId;
    if (data.bidId !== undefined) updateData.bidId = data.bidId;
    if (data.vendorId !== undefined) updateData.vendorId = data.vendorId;

    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    if (data.status === 'COMPLETED') {
      updateData.completedAt = new Date();
      updateData.completedById = req.user!.id;
    }

    if (data.status === 'DISMISSED') {
      updateData.dismissedAt = new Date();
      updateData.dismissedById = req.user!.id;
    }

    const [updated] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, req.params.id))
      .returning();

    await logUpdate(
      req.user!.id,
      "TASK",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json(updated);
  } catch (error) {
        return next(error);
  }
});

export default router;
