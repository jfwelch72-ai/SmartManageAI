import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { users, auditLog, billingEvents } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, and, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "./utils/validation";
import { logCreate } from "./auditLogger";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const multipartParamsSchema = z.object({
  partNumber: z.coerce.number().int().min(1),
});

const multipartQuerySchema = z.object({
  chunkSize: z.coerce.number().int().min(1).optional(),
});

const uploadByteRangeSchema = z.object({
  start: z.coerce.number().int().min(0),
  end: z.coerce.number().int().min(0),
  total: z.coerce.number().int().min(1),
});

const uploadPartQueues = new Map<string, Promise<void>>();

function serializePartUpload(uploadId: string, task: () => Promise<void>): Promise<void> {
  const prev = uploadPartQueues.get(uploadId) ?? Promise.resolve();
  const queued = prev.then(task);
  const next = queued.catch(() => {});
  uploadPartQueues.set(uploadId, next);
  return queued;
}

router.get("/api/projects/:projectId/billing-events", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { scopeItems } = await import("@shared/schema");
    const events = await db
      .select({
        billingEvent: billingEvents,
        scopeItem: scopeItems,
      })
      .from(billingEvents)
      .innerJoin(scopeItems, eq(billingEvents.scopeItemId, scopeItems.id))
      .where(eq(scopeItems.projectId, req.params.projectId))
      .orderBy(desc(billingEvents.createdAt));

    res.json(events);
  } catch (error) {
    next(error);
  }
});

router.post("/api/billing-events", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      scopeItemId: z.string(),
      quantity: z.string(),
      unitPrice: z.string(),
      totalAmount: z.string(),
      billedDate: z.coerce.date(),
      invoiceNumber: z.string().optional(),
      paymentStatus: z.enum(["pending", "paid", "overdue"]).default("pending"),
    });

    const data = validateBody(schema, req.body, res);
    if (!data) return;

    const insertData = { ...data, createdById: req.user!.id };

    const [newEvent] = await db.insert(billingEvents).values([insertData]).returning();

    await logCreate(req.user!.id, "BILLING_EVENT", newEvent.id, newEvent, req);

    res.status(201).json(newEvent);
  } catch (error) {
    next(error);
  }
});

router.get("/api/audit-logs", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { entityType, entityId, userId, action } = req.query;

    const pq = paginationQuerySchema.safeParse(req.query);
    if (!pq.success) { res.status(400).json({ error: "Invalid pagination parameters", details: pq.error.errors }); return; }
    const { page: pageNum, pageSize: pageSizeNum } = pq.data;
    const offset = (pageNum - 1) * pageSizeNum;

    const validActions = ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE", "REJECT", "LOGIN", "LOGOUT", "STATUS_CHANGE"];
    if (action && !validActions.includes(action as string)) {
      res.status(400).json({ error: "Invalid action parameter" });
      return;
    }

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [];
    if (entityType) conditions.push(eq(auditLog.entityType, entityType as string));
    if (entityId) conditions.push(eq(auditLog.entityId, entityId as string));
    if (userId) conditions.push(eq(auditLog.userId, userId as string));
    if (action) conditions.push(eq(auditLog.action, action as any));

    if (shouldFilter && orgId) {
      const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, orgId));
      const orgUserIds = orgUsers.map(u => u.id);
      if (orgUserIds.length > 0) {
        conditions.push(inArray(auditLog.userId, orgUserIds));
      } else {
        return res.json([]);
      }
    }

    let query = db.select().from(auditLog);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const logs = await query
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSizeNum)
      .offset(offset);

    res.json(logs);
  } catch (error) {
    next(error);
  }
});

router.get("/api/audit-logs/:entityType/:entityId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const logs = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.entityType, req.params.entityType),
        eq(auditLog.entityId, req.params.entityId)
      ))
      .orderBy(desc(auditLog.createdAt))
      .limit(100);

    res.json(logs);
  } catch (error) {
    next(error);
  }
});

const objectStoragePromise = import("./objectStorage").then(m => ({
  ObjectStorageService: m.ObjectStorageService,
  ObjectNotFoundError: m.ObjectNotFoundError,
}));
const objectAclPromise = import("./objectAcl").then(m => ({
  ObjectPermission: m.ObjectPermission,
  getObjectAclPolicy: m.getObjectAclPolicy,
}));

const uploadRequestSchema = z.object({
  contentType: z.string().min(1),
  fileSize: z.number().int().positive(),
  fileType: z.enum(["MEDIA", "DOCUMENT", "RECEIPT", "BIM", "LIDAR"]).optional(),
});

router.post("/api/objects/upload", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "User must belong to an organization to upload files" });
      return;
    }

    const uploadData = validateBody(uploadRequestSchema, req.body, res);
    if (!uploadData) return;

    const { contentType, fileSize, fileType } = uploadData;

    const { validateMimeType, validateFileSize, getAllowedMimeTypes, getMaxFileSize } = await import("./fileValidation");

    const resolvedFileType = fileType ?? "DOCUMENT";
    if (!validateMimeType(contentType, resolvedFileType)) {
      const allowed = getAllowedMimeTypes(resolvedFileType);
      res.status(422).json({
        error: `Unsupported file type: ${contentType}`,
        allowedTypes: allowed,
      });
      return;
    }

    if (!validateFileSize(fileSize, resolvedFileType)) {
      const maxBytes = getMaxFileSize(resolvedFileType);
      res.status(422).json({
        error: `File size ${fileSize} exceeds the maximum allowed size of ${maxBytes} bytes`,
        maxBytes,
      });
      return;
    }

    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    const { uploadURL, objectKey } = await objectStorageService.getObjectEntityUploadURL(organizationId);

    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db
      .insert(uploadIntents)
      .values({
        organizationId,
        uploadedById: req.user!.id,
        objectKey,
        contentType,
        fileSize,
      })
      .returning();

    res.json({ uploadURL, intentId: intent.id, objectKey });
  } catch (error: any) {
    next(error);
  }
});


router.post("/api/objects/multipart", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "User must belong to an organization to upload files" });
      return;
    }

    const uploadData = validateBody(uploadRequestSchema, req.body, res);
    if (!uploadData) return;

    const { contentType, fileSize, fileType } = uploadData;
    const { validateMimeType, validateFileSize, getAllowedMimeTypes, getMaxFileSize } = await import("./fileValidation");
    const resolvedFileType = fileType ?? "DOCUMENT";

    if (!validateMimeType(contentType, resolvedFileType)) {
      const allowed = getAllowedMimeTypes(resolvedFileType);
      res.status(422).json({ error: `Unsupported file type: ${contentType}`, allowedTypes: allowed });
      return;
    }

    if (!validateFileSize(fileSize, resolvedFileType)) {
      const maxBytes = getMaxFileSize(resolvedFileType);
      res.status(422).json({ error: `File size ${fileSize} exceeds maximum allowed size of ${maxBytes} bytes`, maxBytes });
      return;
    }

    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    const { resumableUri, objectKey } = await objectStorageService.initiateResumableUpload(organizationId, contentType);

    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db
      .insert(uploadIntents)
      .values({ organizationId, uploadedById: req.user!.id, objectKey, contentType, fileSize, resumableUri })
      .returning();

    res.json({ uploadId: intent.id, key: objectKey });
  } catch (error: any) {
    next(error);
  }
});

router.get("/api/objects/multipart/:uploadId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { uploadId } = req.params;
    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, uploadId)).limit(1);

    if (!intent) { res.status(404).json({ error: "Upload intent not found" }); return; }
    if (intent.uploadedById !== req.user!.id) { res.status(403).json({ error: "Access denied" }); return; }

    if (!intent.resumableUri) {
      res.json({ parts: [] });
      return;
    }

    const statusRes = await fetch(intent.resumableUri, {
      method: "PUT",
      headers: { "Content-Range": `bytes */${intent.fileSize}`, "Content-Length": "0" },
    });

    if (statusRes.status === 308) {
      const range = statusRes.headers.get("range");
      if (range) {
        const match = range.match(/bytes=0-(\d+)/);
        const uploadedEnd = match ? parseInt(match[1], 10) : 0;
        const storedChunkSize = intent.chunkSize ?? 8 * 1024 * 1024;
        const parts = [];
        for (let partNumber = 1; (partNumber - 1) * storedChunkSize <= uploadedEnd; partNumber++) {
          const partStart = (partNumber - 1) * storedChunkSize;
          const isLast = partStart + storedChunkSize >= intent.fileSize;
          const partSize = isLast ? intent.fileSize - partStart : storedChunkSize;
          parts.push({ PartNumber: partNumber, ETag: `"part-${partNumber}"`, Size: partSize });
        }
        res.json({ parts });
        return;
      }
    }
    res.json({ parts: [] });
  } catch (error: any) {
    next(error);
  }
});

router.get("/api/objects/multipart/:uploadId/:partNumber", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { uploadId, partNumber } = req.params;
    const { chunkSize } = req.query;
    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, uploadId)).limit(1);

    if (!intent) { res.status(404).json({ error: "Upload intent not found" }); return; }
    if (intent.uploadedById !== req.user!.id) { res.status(403).json({ error: "Access denied" }); return; }

    const mpParams = multipartParamsSchema.safeParse({ partNumber });
    if (!mpParams.success) { res.status(400).json({ error: "Invalid part number" }); return; }
    const partNum = mpParams.data.partNumber;
    const mqParsed = multipartQuerySchema.safeParse(req.query);
    const clientChunkSize = mqParsed.success ? (mqParsed.data.chunkSize ?? null) : null;
    const resolvedChunkSize = intent.chunkSize ?? clientChunkSize ?? 8 * 1024 * 1024;

    if (!intent.chunkSize && clientChunkSize) {
      await db.update(uploadIntents).set({ chunkSize: clientChunkSize }).where(eq(uploadIntents.id, uploadId));
    }

    const partStart = (partNum - 1) * resolvedChunkSize;
    const isLast = partStart + resolvedChunkSize >= intent.fileSize;
    const partEnd = isLast ? intent.fileSize - 1 : partStart + resolvedChunkSize - 1;

    const proxyUrl = `/api/objects/multipart/${uploadId}/${partNumber}/upload?start=${partStart}&end=${partEnd}&total=${intent.fileSize}`;
    res.json({ url: proxyUrl, headers: {} });
  } catch (error: any) {
    next(error);
  }
});

router.put("/api/objects/multipart/:uploadId/:partNumber/upload", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { uploadId } = req.params;
    const { start, end, total } = req.query;
    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, uploadId)).limit(1);

    if (!intent) { res.status(404).json({ error: "Upload intent not found" }); return; }
    if (intent.uploadedById !== req.user!.id) { res.status(403).json({ error: "Access denied" }); return; }
    if (!intent.resumableUri) { res.status(400).json({ error: "No resumable URI for this intent" }); return; }

    const byteRange = uploadByteRangeSchema.safeParse({ start, end, total });
    if (!byteRange.success) { res.status(400).json({ error: "Invalid byte range parameters" }); return; }
    const { start: startByte, end: endByte, total: totalBytes } = byteRange.data;
    const contentRange = `bytes ${startByte}-${endByte}/${totalBytes}`;

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>((resolve, reject) => {
      req.on("end", resolve);
      req.on("error", reject);
    });
    const body = Buffer.concat(chunks);

    let etag = `"part-${start}-${end}"`;

    await serializePartUpload(uploadId, async () => {
      const gcsRes = await fetch(intent.resumableUri!, {
        method: "PUT",
        headers: {
          "Content-Type": intent.contentType,
          "Content-Range": contentRange,
          "Content-Length": body.length.toString(),
        },
        body,
      });
      if (![200, 201, 308].includes(gcsRes.status)) {
        throw new Error(`GCS returned ${gcsRes.status}`);
      }
      etag = gcsRes.headers.get("etag") ?? etag;
    });

    res.setHeader("ETag", etag);
    res.json({ ETag: etag });
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/objects/multipart/:uploadId/complete", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { uploadId } = req.params;
    const { aclPolicy } = req.body;
    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, uploadId)).limit(1);

    if (!intent) { res.status(404).json({ error: "Upload intent not found" }); return; }
    if (intent.uploadedById !== req.user!.id) { res.status(403).json({ error: "Access denied" }); return; }
    if (intent.confirmedAt) { res.status(409).json({ error: "Already confirmed" }); return; }

    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    const resolvedVisibility: "public" | "private" = aclPolicy?.visibility === "public" ? "public" : "private";

    await objectStorageService.setAclPolicyForObjectKey(intent.objectKey, {
      owner: req.user!.id,
      organizationId: req.user!.organizationId!,
      visibility: resolvedVisibility,
    });

    const normalizedPath = objectStorageService.normalizeObjectEntityPath(intent.objectKey);
    await db.update(uploadIntents).set({ confirmedAt: new Date() }).where(eq(uploadIntents.id, uploadId));

    uploadPartQueues.delete(uploadId);
    res.json({ location: normalizedPath, objectPath: normalizedPath });
  } catch (error: any) {
    next(error);
  }
});

router.delete("/api/objects/multipart/:uploadId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { uploadId } = req.params;
    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, uploadId)).limit(1);

    if (!intent) { res.status(404).json({ error: "Upload intent not found" }); return; }
    if (intent.uploadedById !== req.user!.id) { res.status(403).json({ error: "Access denied" }); return; }

    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    try {
      await objectStorageService.deleteObjectByKey(intent.objectKey);
    } catch (err) {
      logError("Failed to delete orphaned object during upload abort:", { objectKey: intent.objectKey }, err instanceof Error ? err : new Error(String(err)));
    }

    await db.delete(uploadIntents).where(eq(uploadIntents.id, uploadId));
    uploadPartQueues.delete(uploadId);
    res.status(204).send();
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/objects/confirm", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { intentId, aclPolicy } = req.body;
    if (!intentId) {
      res.status(400).json({ error: "intentId is required" });
      return;
    }

    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.id, intentId))
      .limit(1);

    if (!intent) {
      res.status(404).json({ error: "Upload intent not found" });
      return;
    }

    if (intent.uploadedById !== req.user!.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (intent.confirmedAt) {
      res.status(409).json({ error: "Upload already confirmed" });
      return;
    }

    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();

    const resolvedVisibility: "public" | "private" =
      aclPolicy?.visibility === "public" ? "public" : "private";

    await objectStorageService.setAclPolicyForObjectKey(intent.objectKey, {
      owner: req.user!.id,
      organizationId: req.user!.organizationId!,
      visibility: resolvedVisibility,
    });

    const normalizedPath = objectStorageService.normalizeObjectEntityPath(intent.objectKey);

    await db
      .update(uploadIntents)
      .set({ confirmedAt: new Date() })
      .where(eq(uploadIntents.id, intentId));

    res.json({ objectPath: normalizedPath, intentId });
  } catch (error: any) {
    next(error);
  }
});

router.get("/objects/:objectPath(*)", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { ObjectStorageService, ObjectNotFoundError } = await objectStoragePromise;
    const { ObjectPermission } = await objectAclPromise;
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(req.path);

    const { resolveObjectKeyToFile } = await import("./fileAccessHelpers");
    const resolvedFile = await resolveObjectKeyToFile(req.path);

    if (!resolvedFile) {
      res.status(404).json({ error: "File not found in system" });
      return;
    }

    const { getObjectAclPolicy } = await objectAclPromise;
    const aclPolicy = await getObjectAclPolicy(objectFile);

    const canAccess = await objectStorageService.canAccessObjectEntity({
      objectFile,
      userId: req.user!.id,
      userOrganizationId: req.user!.organizationId ?? undefined,
      userRole: req.user!.role,
      requestedPermission: ObjectPermission.READ,
      fileId: resolvedFile.fileId,
      fileType: resolvedFile.fileType,
      aclPolicy,
    });

    if (!canAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (aclPolicy?.visibility === "public") {
      const signedUrl = await objectStorageService.getSignedDownloadUrl(objectFile, 300);
      res.redirect(302, signedUrl);
      return;
    }

    objectStorageService.downloadObject(objectFile, res);
  } catch (error: any) {
    logError("Object download error:", {}, error instanceof Error ? error : new Error(String(error)));
    const { ObjectNotFoundError } = await objectStoragePromise;
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    next(error);
  }
});

export default router;
