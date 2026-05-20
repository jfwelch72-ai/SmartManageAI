// prompt-injection-guard: no LLM calls in this file; file uploads only
import { Router } from "express";
import multer from "multer";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { supportTickets, supportTicketReplies } from "@shared/schema";
import type { SupportAttachment } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { logError, logInfo } from "./utils/logger";
import { ObjectStorageService, parseObjectPath } from "./objectStorage";
import { randomUUID } from "crypto";
import { scanConfirmedUpload } from "./uploadAvScanner";
import { recordUploadScanAudit } from "./uploadAvScanAudit";

const router = Router();

const SUPPORT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const MAX_SUPPORT_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SUPPORT_ATTACHMENT_SIZE },
  fileFilter: (_req, file, cb) => {
    if (SUPPORT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed for support attachments`));
    }
  },
});

const objectStorageService = new ObjectStorageService();

class ScanBlockedError extends Error {
  readonly reason: string | undefined;
  constructor(reason: string | undefined) {
    super("Upload rejected by malware scan");
    this.name = "ScanBlockedError";
    this.reason = reason;
  }
}

async function uploadSupportFile(
  file: Express.Multer.File,
  organizationId: string | null,
  req: AuthRequest,
  userId: string,
): Promise<SupportAttachment> {
  const privateDir = objectStorageService.getPrivateObjectDir();
  const objectId = randomUUID();
  const tenantPrefix = organizationId ?? "global";
  const fullPath = `${privateDir}/${tenantPrefix}/support/${objectId}`;

  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = (await import("./objectStorage")).objectStorageClient.bucket(bucketName);
  const gcsFile = bucket.file(objectName);

  await gcsFile.save(file.buffer, {
    metadata: { contentType: file.mimetype },
  });

  const scanResult = await scanConfirmedUpload({
    objectKey: fullPath,
    organizationId,
    contentType: file.mimetype,
    sizeBytes: file.size,
  });

  await recordUploadScanAudit({
    userId,
    entityId: objectId,
    objectKey: fullPath,
    contentType: file.mimetype,
    sizeBytes: file.size,
    organizationId,
    scanResult,
    route: "support_attachment",
    req,
  });

  if (scanResult.status === "blocked") {
    throw new ScanBlockedError(scanResult.reason);
  }

  return {
    objectKey: fullPath,
    fileName: file.originalname,
    contentType: file.mimetype,
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

// POST /api/support/tickets/:id/attachments
router.post(
  "/api/support/tickets/:id/attachments",
  requireAuth,
  upload.array("files", 10),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const [ticket] = await db
        .select({ id: supportTickets.id, userId: supportTickets.userId, organizationId: supportTickets.organizationId, attachments: supportTickets.attachments })
        .from(supportTickets)
        .where(eq(supportTickets.id, req.params.id));

      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      // Only ticket owner or admin roles can attach
      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
      const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "HUSTLER";
      const isOwner = ticket.userId === userId;
      if (!isOwner && !isSuperAdmin && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const orgId = ticket.organizationId || req.user?.organizationId || null;
      const uploadedAttachments: SupportAttachment[] = [];

      for (const file of files) {
        try {
          const attachment = await uploadSupportFile(file, orgId, req, userId);
          uploadedAttachments.push(attachment);
        } catch (err) {
          if (err instanceof ScanBlockedError) {
            return res.status(422).json({ error: "Upload rejected by malware scan", reason: err.reason });
          }
          logError(`[support] Failed to upload attachment for ticket ${ticket.id}`, err);
        }
      }

      if (uploadedAttachments.length === 0) {
        return res.status(500).json({ error: "All uploads failed" });
      }

      const existing = (ticket.attachments as SupportAttachment[]) ?? [];
      const merged = [...existing, ...uploadedAttachments];

      await db
        .update(supportTickets)
        .set({ attachments: merged, updatedAt: new Date() })
        .where(eq(supportTickets.id, ticket.id));

      logInfo(`[support] ${uploadedAttachments.length} attachment(s) added to ticket ${ticket.id}`);
      res.status(201).json({ attachments: uploadedAttachments });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/support/tickets/:id/replies/:replyId/attachments
router.post(
  "/api/support/tickets/:id/replies/:replyId/attachments",
  requireAuth,
  upload.array("files", 10),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const [ticket] = await db
        .select({ id: supportTickets.id, userId: supportTickets.userId, organizationId: supportTickets.organizationId })
        .from(supportTickets)
        .where(eq(supportTickets.id, req.params.id));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });

      const [reply] = await db
        .select({ id: supportTicketReplies.id, authorId: supportTicketReplies.authorId, attachments: supportTicketReplies.attachments })
        .from(supportTicketReplies)
        .where(and(eq(supportTicketReplies.id, req.params.replyId), eq(supportTicketReplies.ticketId, req.params.id)));
      if (!reply) return res.status(404).json({ error: "Reply not found" });

      const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
      const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "HUSTLER";
      const isReplyAuthor = reply.authorId === userId;
      const isTicketOwner = ticket.userId === userId;
      if (!isReplyAuthor && !isTicketOwner && !isSuperAdmin && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const orgId = ticket.organizationId || req.user?.organizationId || null;
      const uploadedAttachments: SupportAttachment[] = [];

      for (const file of files) {
        try {
          const attachment = await uploadSupportFile(file, orgId, req, userId);
          uploadedAttachments.push(attachment);
        } catch (err) {
          if (err instanceof ScanBlockedError) {
            return res.status(422).json({ error: "Upload rejected by malware scan", reason: err.reason });
          }
          logError(`[support] Failed to upload attachment for reply ${reply.id}`, err);
        }
      }

      if (uploadedAttachments.length === 0) {
        return res.status(500).json({ error: "All uploads failed" });
      }

      const existing = (reply.attachments as SupportAttachment[]) ?? [];
      const merged = [...existing, ...uploadedAttachments];

      await db
        .update(supportTicketReplies)
        .set({ attachments: merged })
        .where(eq(supportTicketReplies.id, reply.id));

      logInfo(`[support] ${uploadedAttachments.length} attachment(s) added to reply ${reply.id}`);
      res.status(201).json({ attachments: uploadedAttachments });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/support/attachments/download — fetch a signed download URL for a support attachment
// Query param: key (the objectKey)
// Authorization: requester must be SUPER_ADMIN or belong to the org that owns the attachment.
// The org is inferred from the object path: ${privateDir}/${orgId}/support/${uuid}
router.get("/api/support/attachments/download", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const objectKey = typeof req.query.key === "string" ? req.query.key : null;
    if (!objectKey) return res.status(400).json({ error: "Missing key" });

    // Key must be under the /support/ subdirectory
    const supportIdx = objectKey.indexOf("/support/");
    if (supportIdx === -1) {
      return res.status(403).json({ error: "Invalid attachment key" });
    }

    // Extract the tenant prefix (orgId or "global") from the path segment before /support/
    const beforeSupport = objectKey.slice(0, supportIdx); // e.g. "objects/private/org-123"
    const keyTenantPrefix = beforeSupport.split("/").pop() ?? "";

    const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
    const userOrgId = req.user?.organizationId ?? null;
    const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "HUSTLER";

    // Enforce org-scoped access: tenantPrefix must match requesting user's org
    // (SUPER_ADMIN is exempt; "global" keys require SUPER_ADMIN)
    if (!isSuperAdmin) {
      if (keyTenantPrefix === "global") {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (keyTenantPrefix !== userOrgId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Look up the specific ticket that contains this exact objectKey in its attachments JSONB,
      // or a reply whose ticket belongs to the same org. This prevents IDOR by ensuring
      // the objectKey is actually stored and not a guessed cross-user path.
      const containsFragment = JSON.stringify([{ objectKey }]);

      // Check ticket attachments
      const [ticketRow] = await db
        .select({ userId: supportTickets.userId })
        .from(supportTickets)
        .where(
          and(
            eq(supportTickets.organizationId, keyTenantPrefix),
            sql`${supportTickets.attachments} @> ${containsFragment}::jsonb`,
          ),
        )
        .limit(1);

      // Check reply attachments if not found on ticket
      const [replyRow] = ticketRow
        ? [undefined]
        : await db
            .select({ ticketUserId: supportTickets.userId })
            .from(supportTicketReplies)
            .innerJoin(supportTickets, eq(supportTicketReplies.ticketId, supportTickets.id))
            .where(
              and(
                eq(supportTickets.organizationId, keyTenantPrefix),
                sql`${supportTicketReplies.attachments} @> ${containsFragment}::jsonb`,
              ),
            )
            .limit(1);

      const ownerUserId = ticketRow?.userId ?? replyRow?.ticketUserId ?? null;

      if (!ownerUserId) {
        // objectKey not found in any ticket/reply in this org — deny
        return res.status(403).json({ error: "Forbidden" });
      }

      // Non-admins may only download their own attachments; admins may download any in their org
      if (!isAdmin && ownerUserId !== req.user?.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const { bucketName, objectName } = parseObjectPath(objectKey);
    const bucket = (await import("./objectStorage")).objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: "Attachment not found" });

    const signedUrl = await objectStorageService.getSignedDownloadUrl(file, 300);
    res.redirect(signedUrl);
  } catch (err) {
    next(err);
  }
});

export default router;
