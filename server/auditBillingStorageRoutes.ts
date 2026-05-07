import { logError, logInfo } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { users, auditLog, billingEvents } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, and, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "./utils/validation";
import { logCreate, logAudit } from "./auditLogger";
import { getCorrelationId } from "./middleware/correlationId";
import { getOrgIdForFilter } from "./orgFilter";
import { uploadLimiter } from "./rateLimiter";
import {
  parsePagination,
  setNextLinkHeader,
  buildPage,
  PaginationError,
  MAX_PAGE_SIZE,
} from "./utils/pagination";

const router = Router();

/**
 * Task #2493 — record every upload AV-scan outcome in the audit_log.
 *
 * Both the single-shot (`/api/objects/confirm`) and multipart
 * (`/api/objects/multipart/:uploadId/complete`) confirm paths funnel
 * through this helper after `scanConfirmedUpload(...)` so we get a
 * tamper-evident trail of:
 *   - who triggered the scan and from which org,
 *   - which object was scanned (path + content-type + size),
 *   - which scanner was active and what verdict it returned,
 *   - the request correlation id (`x-request-id`) so the audit row
 *     can be cross-referenced with structured logs / Sentry.
 *
 * Blocked uploads also get the offending object deleted from GCS
 * here so an "infected" verdict actually quarantines the bytes
 * instead of leaving an unreferenced (but still-downloadable via
 * signed URL leak) blob in the bucket.
 */
async function recordUploadScanAudit(args: {
  userId: string;
  intentId: string;
  objectKey: string;
  contentType: string | null;
  sizeBytes: number | null;
  organizationId: string | null;
  scanResult: { status: "clean" | "blocked" | "skipped"; reason?: string; scannerId?: string };
  route: "confirm" | "multipart_complete";
  req: AuthRequest;
}): Promise<void> {
  const { userId, intentId, objectKey, contentType, sizeBytes, organizationId, scanResult, route, req } = args;
  const correlationId = getCorrelationId() ?? null;

  if (scanResult.status === "blocked") {
    try {
      const { ObjectStorageService } = await objectStoragePromise;
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObjectByKey(objectKey);
    } catch (err) {
      logError(
        "[upload-av] Failed to quarantine (delete) infected object",
        { objectKey, intentId, correlationId },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  const action = scanResult.status === "blocked" ? "REJECT" : "APPROVE";
  const payload = {
    op: "upload_av_scan",
    route,
    status: scanResult.status,
    reason: scanResult.reason ?? null,
    scannerId: scanResult.scannerId ?? null,
    objectKey,
    contentType,
    sizeBytes,
    organizationId,
    correlationId,
  };

  await logAudit(
    {
      userId,
      entityType: "upload_av_scan",
      entityId: intentId,
      action,
      oldValue: null,
      newValue: JSON.stringify(payload),
    },
    req,
  );
}

// Legacy schema kept for non-migrated callers. The max is the shared
// `MAX_PAGE_SIZE` (200) so even the legacy path can never return more
// than the contract allows. Migrated routes use the shared
// `paginationSchema` from `./utils/pagination`.
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(100),
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
const uploadPartCounters = new Map<string, { next: number; waiters: Map<number, { resolve: () => void }> }>();

function serializePartUpload(uploadId: string, partNumber: number, task: () => Promise<void>): Promise<void> {
  if (!uploadPartCounters.has(uploadId)) {
    uploadPartCounters.set(uploadId, { next: 1, waiters: new Map() });
  }
  const counter = uploadPartCounters.get(uploadId)!;

  const ordered = new Promise<void>((resolve, reject) => {
    const run = () => {
      task().then(() => {
        counter.next = partNumber + 1;
        const nextWaiter = counter.waiters.get(partNumber + 1);
        if (nextWaiter) {
          counter.waiters.delete(partNumber + 1);
          nextWaiter.resolve();
        }
        resolve();
      }).catch(reject);
    };

    if (counter.next === partNumber) {
      run();
    } else {
      counter.waiters.set(partNumber, { resolve: run });
      setTimeout(() => {
        if (counter.waiters.has(partNumber)) {
          counter.waiters.delete(partNumber);
          reject(new Error(`Timed out waiting for part ${partNumber - 1} to complete`));
        }
      }, 60000);
    }
  });

  const prev = uploadPartQueues.get(uploadId) ?? Promise.resolve();
  const next = prev.then(() => ordered).catch(() => {});
  uploadPartQueues.set(uploadId, next);
  return ordered;
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

    // Per the shared contract, the envelope is opt-in via `cursor` OR
    // `pageSize`. Pure-`page` callers (no `pageSize`) keep the legacy
    // offset+array shape so their existing pagination semantics aren't
    // silently changed.
    const useEnvelope =
      typeof req.query.cursor === "string" || typeof req.query.pageSize === "string";

    let pageSize: number;
    let cursor: { ts: string; id: string } | null = null;
    let legacyOffset = 0;
    let legacyPage = 1;
    try {
      if (useEnvelope) {
        const p = parsePagination(req.query);
        pageSize = p.pageSize;
        cursor = p.cursor;
      } else {
        const pq = paginationQuerySchema.safeParse(req.query);
        if (!pq.success) {
          res.status(400).json({ error: "Invalid pagination parameters", details: pq.error.errors });
          return;
        }
        legacyPage = pq.data.page;
        pageSize = pq.data.pageSize;
        legacyOffset = (legacyPage - 1) * pageSize;
      }
    } catch (e) {
      if (e instanceof PaginationError) {
        res.status(e.status).json({ error: e.message, details: e.details });
        return;
      }
      throw e;
    }

    const validActions = ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE", "REJECT", "LOGIN", "LOGOUT", "STATUS_CHANGE"];
    if (action && !validActions.includes(action as string)) {
      res.status(400).json({ error: "Invalid action parameter" });
      return;
    }

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      if (useEnvelope) return res.json({ items: [], nextCursor: null });
      return res.json([]);
    }

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
        if (useEnvelope) return res.json({ items: [], nextCursor: null });
        return res.json([]);
      }
    }

    if (cursor) {
      const ts = new Date(cursor.ts);
      conditions.push(
        or(
          lt(auditLog.createdAt, ts),
          and(eq(auditLog.createdAt, ts), lt(auditLog.id, cursor.id)),
        ) as SQL,
      );
    }

    // Drizzle query builders are immutable — every method returns a new
    // builder. The previous code dropped the `.where(...)` result on the
    // floor, which silently bypassed entity/action/user filters AND the
    // org-scoping clause above (cross-org data leak). Reassign so the
    // predicate actually lands on the executed query.
    let query = db.select().from(auditLog).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const logs = await query
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(useEnvelope ? pageSize + 1 : pageSize)
      .offset(useEnvelope ? 0 : legacyOffset);

    if (!useEnvelope) {
      res.json(logs);
      return;
    }

    const page = buildPage(
      logs,
      pageSize,
      (row) => ({
        ts: (row.createdAt instanceof Date
          ? row.createdAt
          : new Date(row.createdAt)
        ).toISOString(),
        id: row.id,
      }),
    );
    setNextLinkHeader(res, req.originalUrl, page.nextCursor);
    res.json(page);
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

router.post("/api/objects/upload", requireAuth, uploadLimiter, async (req: AuthRequest, res, next) => {
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


router.post("/api/objects/multipart", requireAuth, uploadLimiter, async (req: AuthRequest, res, next) => {
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

    // Optional client-provided chunk size. Persisting it at create-time makes
    // signPart deterministic and avoids a race where the smallest (last) part
    // arrives first and "poisons" intent.chunkSize for all subsequent parts,
    // resulting in incorrect byte ranges and an incomplete upload (409 on
    // /complete because GCS only received part of the file).
    const rawClientChunk = (req.body as { chunkSize?: unknown })?.chunkSize;
    const parsedClientChunk =
      typeof rawClientChunk === "number" && Number.isFinite(rawClientChunk) && rawClientChunk > 0
        ? Math.floor(rawClientChunk)
        : null;

    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    const { resumableUri, objectKey } = await objectStorageService.initiateResumableUpload(organizationId, contentType);

    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db
      .insert(uploadIntents)
      .values({
        organizationId,
        uploadedById: req.user!.id,
        objectKey,
        contentType,
        fileSize,
        resumableUri,
        chunkSize: parsedClientChunk,
      })
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
    // Take max() of any chunk size we've seen rather than first-wins. signPart
    // requests for the parts of a single file run in parallel (Uppy `limit`),
    // so the smallest (last) part can otherwise arrive first and poison the
    // stored chunkSize, producing wrong byte ranges for every part.
    const candidateChunkSize = Math.max(intent.chunkSize ?? 0, clientChunkSize ?? 0);
    const resolvedChunkSize = candidateChunkSize > 0 ? candidateChunkSize : 8 * 1024 * 1024;

    if (clientChunkSize && clientChunkSize > (intent.chunkSize ?? 0)) {
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

    const partNum = parseInt(req.params.partNumber, 10);
    await serializePartUpload(uploadId, partNum, async () => {
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
        const errBody = await gcsRes.text().catch(() => "");
        logError(`[multipart] GCS PUT error: status=${gcsRes.status} range=${contentRange} bodyLen=${body.length} resp=${errBody}`);
        throw new Error(`GCS returned ${gcsRes.status}`);
      }
      logInfo(`[multipart] GCS PUT ok: status=${gcsRes.status} range=${contentRange} bodyLen=${body.length}`);
      etag = gcsRes.headers.get("etag") ?? etag;
    });

    res.setHeader("ETag", etag);
    res.json({ ETag: etag });
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/objects/multipart/:uploadId/complete", requireAuth, uploadLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { uploadId } = req.params;
    const { aclPolicy } = req.body;
    const { uploadIntents } = await import("@shared/schema");
    const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, uploadId)).limit(1);

    if (!intent) { res.status(404).json({ error: "Upload intent not found" }); return; }
    if (intent.uploadedById !== req.user!.id) { res.status(403).json({ error: "Access denied" }); return; }
    if (intent.confirmedAt) { res.status(409).json({ error: "Already confirmed" }); return; }

    if (intent.resumableUri) {
      const statusRes = await fetch(intent.resumableUri, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */${intent.fileSize}`,
        },
      });
      logInfo(`[multipart-complete] Resumable status check: ${statusRes.status} for ${intent.objectKey}`);
      if (statusRes.status === 308) {
        const range = statusRes.headers.get("range");
        logError(`[multipart-complete] Upload incomplete! range=${range}, expected total=${intent.fileSize}`);
        res.status(409).json({ error: "Upload not yet complete on storage backend" });
        return;
      }
    }

    // Task #2479 (round-7) — multipart completion is also a "confirmed
    // upload" and MUST traverse the AV scan boundary before its ACL
    // policy is persisted. Same fail-closed semantics as
    // /api/objects/confirm.
    const { scanConfirmedUpload } = await import("./uploadAvScanner");
    const scanResult = await scanConfirmedUpload({
      objectKey: intent.objectKey,
      organizationId: req.user!.organizationId ?? null,
      contentType: intent.contentType ?? null,
      sizeBytes: intent.fileSize ?? null,
    });
    await recordUploadScanAudit({
      userId: req.user!.id,
      intentId: intent.id,
      objectKey: intent.objectKey,
      contentType: intent.contentType ?? null,
      sizeBytes: intent.fileSize ?? null,
      organizationId: req.user!.organizationId ?? null,
      scanResult,
      route: "multipart_complete",
      req,
    });
    if (scanResult.status === "blocked") {
      res.status(422).json({
        error: "Upload rejected by malware scan",
        reason: scanResult.reason,
      });
      return;
    }

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
    uploadPartCounters.delete(uploadId);
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
    uploadPartCounters.delete(uploadId);
    res.status(204).send();
  } catch (error: any) {
    next(error);
  }
});

router.post("/api/objects/confirm", requireAuth, uploadLimiter, async (req: AuthRequest, res, next) => {
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

    // Task #2479 — every confirmed upload MUST traverse the AV scan
    // boundary. The default scanner is the built-in EICAR head-check
    // (and Cloudmersive when `CLOUDMERSIVE_AV_API_KEY` is set). Mode
    // defaults to `enforce` in production and `permissive` in dev;
    // `UPLOAD_AV_SCAN_MODE` always wins. Fail-closed semantics live in
    // server/uploadAvScanner.ts.
    const { scanConfirmedUpload } = await import("./uploadAvScanner");
    const scanResult = await scanConfirmedUpload({
      objectKey: intent.objectKey,
      organizationId: req.user!.organizationId ?? null,
      contentType: intent.contentType ?? null,
      sizeBytes: intent.fileSize ?? null,
    });
    await recordUploadScanAudit({
      userId: req.user!.id,
      intentId: intent.id,
      objectKey: intent.objectKey,
      contentType: intent.contentType ?? null,
      sizeBytes: intent.fileSize ?? null,
      organizationId: req.user!.organizationId ?? null,
      scanResult,
      route: "confirm",
      req,
    });
    if (scanResult.status === "blocked") {
      res.status(422).json({
        error: "Upload rejected by malware scan",
        reason: scanResult.reason,
      });
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
