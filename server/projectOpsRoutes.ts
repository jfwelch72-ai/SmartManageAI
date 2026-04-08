import { Router } from "express";
import { db } from "./db";
import { projects, receipts, planDocuments, filePermissions, changeOrders, changeOrderRevisions, changeOrderLaborEntries, changeOrderEquipmentEntries, changeOrderMaterialEntries, changeOrderScopeModifiers, calendarEvents, notifications, users, orgCostCodes, insertReceiptSchema, insertPlanDocumentSchema, insertFilePermissionSchema, insertChangeOrderSchema, insertCalendarEventSchema, changeOrderStatusEnum, vendorUsers, vendorPricingCatalogs, vendorEnrollments, purchaseOrders, rentalEquipmentUsages, rentalVendors, subcontractorBidInvitations, subcontractorBidRequests, crmOrganisations, organizations } from "@shared/schema";
import { requireAuth, requireRole, requireRoleOrFeature, type AuthRequest, type UserRole } from "./auth";
import { eq, desc, sql, and, lt, gte, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logDelete } from "./auditLogger";
import { safeJsonParse } from "./responseHelper";
import { insertNotification, insertNotifications } from "./services/notificationService";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { verifyOrgAccess, getOrgIdForFilter } from "./orgFilter";
import * as healthService from "./services/projectHealthService";
import {logError, logWarn } from "./utils/logger";
import { eventBus } from "./events";

const router = Router();

// ========================================
// Routes from projectOpsRoutes.ts
// ========================================

function validateChangeOrderAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
  if (amount === null || amount === undefined) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  
  if (numAmount === 0) {
    return { valid: false, error: `${fieldName} cannot be zero (use positive for additions, negative for deductions)` };
  }
  
  if (Math.abs(numAmount) > 100000000) {
    return { valid: false, error: `${fieldName} exceeds maximum allowed value (±$100,000,000)` };
  }
  
  return { valid: true };
}

function validateJSONField(jsonString: string | null | undefined, fieldName: string): { valid: boolean; error?: string; parsed?: any } {
  if (jsonString === null || jsonString === undefined) {
    return { valid: true };
  }

  if (jsonString === "") {
    return { valid: true, parsed: null };
  }

  try {
    const parsed = JSON.parse(jsonString);
    return { valid: true, parsed };
  } catch (error) {
    return { 
      valid: false, 
      error: `${fieldName} contains invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}` 
    };
  }
}

// ====================
// Receipts Routes
// ====================

router.get("/api/projects/:code/receipts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const allReceipts = await db
      .select()
      .from(receipts)
      .where(eq(receipts.projectId, project.id))
      .orderBy(desc(receipts.date));

    const { filterFilesByPermissions } = await import("./fileAccessHelpers");
    const projectReceipts = await filterFilesByPermissions(
      allReceipts,
      req.user!.id,
      req.user!.role,
      "RECEIPT"
    );

    res.json(projectReceipts);
  } catch (error) {
    logError("Get receipts error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/receipts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const rawAmount = req.body.amount;
    let processedAmount: string | undefined = undefined;
    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== "") {
      processedAmount = String(rawAmount);
    } else if (rawAmount === "") {
      processedAmount = "0";
    }
    
    const transformedData = {
      ...req.body,
      userId: req.user!.id,
      date: req.body.date ? new Date(req.body.date) : undefined,
      amount: processedAmount,
    };
    
    const validationResult = insertReceiptSchema.extend({
      userId: z.string().optional(),
    }).safeParse(transformedData);
    
    if (!validationResult.success) {
      logError("Receipt validation errors", { errors: validationResult.error.errors });
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    
    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
      validationResult.data.fileUrl,
      {
        owner: req.user!.id,
        organizationId: req.user!.organizationId!,
        visibility: "private",
      }
    );

    const insertData = { ...validationResult.data, userId: req.user!.id, objectKey };
    const [newReceipt] = await db.insert(receipts).values([insertData]).returning();
    
    await db.insert(filePermissions).values([{
      fileId: newReceipt.id,
      fileType: "RECEIPT",
      userId: req.user!.id,
      grantedById: req.user!.id,
    }]);

    if (newReceipt.projectId) {
      import("./costLedgerRoutes").then(m => m.evaluateBudgetAlerts(newReceipt.projectId!)).catch(e => logError("Budget alert eval after receipt:", {}, e instanceof Error ? e : new Error(String(e))));

      try {
        await eventBus.emit({
          version: 1,
          orgId: req.user!.organizationId || "",
          actorId: req.user!.id,
          timestamp: new Date(),
          type: "receipt.created" as const,
          payload: {
            receiptId: newReceipt.id,
            projectId: newReceipt.projectId,
            costCode: newReceipt.costCode || null,
            amount: parseFloat(newReceipt.amount?.toString() || "0"),
            category: newReceipt.category || null,
          },
        });
      } catch (emitErr) {
        logError("Failed to emit receipt.created event:", {}, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
      }
    }

    res.status(201).json(newReceipt);
  } catch (error: any) {
    logError("Create receipt error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Plan Documents Routes
// ====================

router.get("/api/projects/:code/documents", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const allDocs = await db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.projectId, project.id))
      .orderBy(desc(planDocuments.uploadedAt));

    const { filterFilesByPermissions } = await import("./fileAccessHelpers");
    const docs = await filterFilesByPermissions(
      allDocs,
      req.user!.id,
      req.user!.role,
      "DOCUMENT"
    );

    res.json(docs);
  } catch (error) {
    logError("Get documents error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/documents/:docId/preview-url", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [doc] = await db.select().from(planDocuments)
      .where(and(eq(planDocuments.id, req.params.docId), eq(planDocuments.projectId, project.id)))
      .limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const { filterFilesByPermissions } = await import("./fileAccessHelpers");
    const permitted = await filterFilesByPermissions(
      [doc],
      req.user!.id,
      req.user!.role,
      "DOCUMENT"
    );
    if (permitted.length === 0) return res.status(403).json({ error: "You do not have permission to access this document" });

    const storageKey = doc.objectKey || doc.fileUrl;
    if (!storageKey) return res.status(404).json({ error: "No file associated with this document" });

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
    await objectStorageService.downloadObject(objectFile, res, 3600);
  } catch (error) {
    logError("Project document preview-url error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate preview URL" });
    }
  }
});

router.get("/api/projects/:code/documents/:docId/stream", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [doc] = await db.select().from(planDocuments)
      .where(and(eq(planDocuments.id, req.params.docId), eq(planDocuments.projectId, project.id)))
      .limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const { filterFilesByPermissions } = await import("./fileAccessHelpers");
    const permitted = await filterFilesByPermissions(
      [doc],
      req.user!.id,
      req.user!.role,
      "DOCUMENT"
    );
    if (permitted.length === 0) return res.status(403).json({ error: "You do not have permission to access this document" });

    const storageKey = doc.objectKey || doc.fileUrl;
    if (!storageKey) return res.status(404).json({ error: "No file associated with this document" });

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
    await objectStorageService.downloadObject(objectFile, res, 3600);
  } catch (error) {
    logError("Project document stream error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream document" });
    }
  }
});

router.post("/api/documents", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertPlanDocumentSchema.extend({
      uploadedById: z.string().optional(),
    }).safeParse({
      ...req.body,
      uploadedById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    
    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
      validationResult.data.fileUrl,
      {
        owner: req.user!.id,
        organizationId: req.user!.organizationId!,
        visibility: "private",
      }
    );

    const insertData = { ...validationResult.data, uploadedById: req.user!.id, objectKey };
    const [newDoc] = await db.insert(planDocuments).values([insertData]).returning();
    
    await db.insert(filePermissions).values([{
      fileId: newDoc.id,
      fileType: "DOCUMENT",
      userId: req.user!.id,
      grantedById: req.user!.id,
    }]);

    res.status(201).json(newDoc);
  } catch (error: any) {
    logError("Create document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/documents/from-url", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const bodySchema = z.object({
      url: z.string().url(),
      title: z.string().min(1).max(255),
      type: z.string().default("OTHER"),
      projectId: z.string().min(1),
    });

    const parseResult = bodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid input", details: parseResult.error.errors });
      return;
    }

    const { url, title, type, projectId } = parseResult.data;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      logWarn("Non-critical operation failed");
      res.status(400).json({ error: "Invalid URL format" });
      return;
    }

    if (parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "Only HTTPS URLs are allowed" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const dns = await import("dns");
    const { promisify } = await import("util");
    const dnsResolve = promisify(dns.resolve4);

    const ALLOWED_CONTENT_TYPES = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/msword",
      "application/vnd.ms-excel",
      "text/plain",
      "text/csv",
    ];

    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const FETCH_TIMEOUT_MS = 30000;
    const MAX_REDIRECTS = 3;

    function isPrivateHostname(hn: string): boolean {
      return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|\[::1\]|169\.254\.)/.test(hn)
        || hn === "localhost"
        || hn.endsWith(".local")
        || hn.endsWith(".internal");
    }

    function isPrivateIp(ip: string): boolean {
      return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/.test(ip);
    }

    async function validateUrl(targetUrl: URL): Promise<string | null> {
      if (targetUrl.protocol !== "https:") {
        return "Only HTTPS URLs are allowed for security.";
      }
      if (isPrivateHostname(targetUrl.hostname)) {
        return "This URL points to an internal network address and can't be accessed. Please use a publicly accessible link.";
      }
      try {
        const ips = await dnsResolve(targetUrl.hostname);
        if (ips.some((ip: string) => isPrivateIp(ip))) {
          return "This URL points to an internal network address and can't be accessed. Please use a publicly accessible link.";
        }
      } catch {
        logWarn("Non-critical operation failed");
        return "Could not resolve the hostname. Please check the URL and try again.";
      }
      return null;
    }

    const initialValidation = await validateUrl(parsedUrl);
    if (initialValidation) {
      res.status(400).json({ error: initialValidation });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let currentUrl = url;
    let response: Response;
    let redirectCount = 0;

    try {
      while (true) {
        response = await fetch(currentUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "SmartManageAI-DocumentFetcher/1.0" },
          redirect: "manual",
        });

        if (response.status >= 300 && response.status < 400) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            clearTimeout(timeout);
            res.status(400).json({ error: "This link redirects too many times. Please paste the final download link instead." });
            return;
          }
          const location = response.headers.get("location");
          if (!location) {
            clearTimeout(timeout);
            res.status(400).json({ error: "The link sent a redirect without a destination. Please try a different link." });
            return;
          }
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, currentUrl);
          } catch {
            logWarn("Non-critical operation failed");
            clearTimeout(timeout);
            res.status(400).json({ error: "The link redirected to an invalid URL. Please try a different link." });
            return;
          }
          const redirectValidation = await validateUrl(redirectUrl);
          if (redirectValidation) {
            clearTimeout(timeout);
            res.status(400).json({ error: "This link redirected to an unsafe destination and was blocked for security." });
            return;
          }
          currentUrl = redirectUrl.toString();
          continue;
        }
        break;
      }
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      if (fetchErr.name === "AbortError") {
        res.status(408).json({ error: "The download took too long (over 30 seconds). Please try a smaller file or a faster link." });
        return;
      }
      res.status(400).json({ error: "Failed to download the file. Please check the URL and try again." });
      return;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(400).json({ error: `The link returned an error (HTTP ${response.status}). Please check that the URL is correct and publicly accessible.` });
      return;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      res.status(400).json({ error: "This file type isn't supported. You can upload PDFs, images, Office documents, or CSV files." });
      return;
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_FILE_SIZE) {
      res.status(400).json({ error: "This file is too large (over 100MB). Please use a smaller file." });
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    if (fileBuffer.length > MAX_FILE_SIZE) {
      res.status(400).json({ error: "This file is too large (over 100MB). Please use a smaller file." });
      return;
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();

    const { uploadURL: signedUploadUrl, objectKey: rawObjectKey } = await objectStorageService.getObjectEntityUploadURL(req.user!.organizationId!);

    const uploadResponse = await fetch(signedUploadUrl, {
      method: "PUT",
      body: fileBuffer,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileBuffer.length),
      },
    });

    if (!uploadResponse.ok) {
      res.status(500).json({ error: "Failed to upload file to object storage" });
      return;
    }

    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
      rawObjectKey,
      {
        owner: req.user!.id,
        organizationId: req.user!.organizationId!,
        visibility: "private",
      }
    );

    const uploadedUrl = objectKey;

    const ext = parsedUrl.pathname.split("/").pop()?.split(".").pop() || "";
    const fileName = title + (ext ? `.${ext}` : "");

    const [newDoc] = await db.insert(planDocuments).values([{
      projectId,
      type: type as any,
      title,
      fileName,
      fileUrl: uploadedUrl,
      objectKey,
      fileSize: fileBuffer.length,
      mimeType: contentType,
      uploadedById: req.user!.id,
    }]).returning();

    await db.insert(filePermissions).values([{
      fileId: newDoc.id,
      fileType: "DOCUMENT",
      userId: req.user!.id,
      grantedById: req.user!.id,
    }]);

    await logCreate(req, "plan_document", newDoc.id, {
      source: "url",
      sourceUrl: url,
      title,
      projectId,
      fileSize: fileBuffer.length,
      mimeType: contentType,
    });

    res.status(201).json(newDoc);
  } catch (error: any) {
    logError("Create document from URL error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/documents/from-cloud", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const bodySchema = z.object({
      provider: z.enum(["gdrive", "dropbox"]),
      fileId: z.string().min(1),
      fileName: z.string().min(1),
      filePath: z.string().optional(),
      title: z.string().min(1).max(255),
      type: z.enum(["PLANS", "SPECS", "TAKEOFF", "OTHER"]).default("OTHER"),
      projectId: z.string().min(1),
    });

    const parseResult = bodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid input", details: parseResult.error.errors });
      return;
    }

    const { provider, fileId, fileName, filePath, title, type, projectId } = parseResult.data;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { integrationConnections: intConnsTable } = await import("@shared/schema");
    const { decryptMetadata } = await import("./integrations/encryption");
    const { getProvider: getProviderImpl } = await import("./integrations/registry");
    const { storeConnectionTokens } = await import("./integrations/connectionService");

    const [conn] = await db
      .select()
      .from(intConnsTable)
      .where(and(
        eq(intConnsTable.organizationId, req.user!.organizationId!),
        eq(intConnsTable.provider, provider),
        eq(intConnsTable.status, "active"),
      ))
      .limit(1);

    if (!conn || !conn.metadata) {
      res.status(401).json({ error: "No active connection for provider" });
      return;
    }

    const metadata = decryptMetadata(conn.metadata as Record<string, unknown>);
    const accessTokenRaw = metadata.accessToken;
    if (!accessTokenRaw || typeof accessTokenRaw !== "string") {
      res.status(401).json({ error: "Invalid or missing access token for provider" });
      return;
    }
    let accessToken: string = accessTokenRaw;

    const expiresAtRaw = metadata.expiresAt;
    const expiresAt = expiresAtRaw && typeof expiresAtRaw === "string" ? new Date(expiresAtRaw) : null;
    const isExpired = expiresAt && expiresAt < new Date(Date.now() + 60000);
    if (isExpired && metadata.refreshToken) {
      const providerImpl = getProviderImpl(provider);
      if (providerImpl) {
        const tokens = await providerImpl.refreshToken({ ...conn, metadata });
        await storeConnectionTokens(conn.id, req.user!.organizationId!, tokens);
        accessToken = tokens.accessToken;
      }
    }

    let fileBuffer: Buffer;
    let contentType: string;

    const MAX_FILE_SIZE = 100 * 1024 * 1024;

    if (provider === "gdrive") {
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!dlRes.ok) {
        res.status(502).json({ error: "Failed to download file from Google Drive" });
        return;
      }
      const contentLengthHdr = dlRes.headers.get("content-length");
      if (contentLengthHdr && parseInt(contentLengthHdr) > MAX_FILE_SIZE) {
        res.status(400).json({ error: "File is too large (over 100MB)" });
        return;
      }
      const ab = await dlRes.arrayBuffer();
      fileBuffer = Buffer.from(ab);
      contentType = dlRes.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    } else {
      const dropboxPath = filePath || "";
      const dlRes = await fetch(
        "https://content.dropboxapi.com/2/files/download",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath || `id:${fileId}` }),
          },
        }
      );
      if (!dlRes.ok) {
        res.status(502).json({ error: "Failed to download file from Dropbox" });
        return;
      }
      const contentLengthHdr = dlRes.headers.get("content-length");
      if (contentLengthHdr && parseInt(contentLengthHdr) > MAX_FILE_SIZE) {
        res.status(400).json({ error: "File is too large (over 100MB)" });
        return;
      }
      const ab = await dlRes.arrayBuffer();
      fileBuffer = Buffer.from(ab);
      contentType = dlRes.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    }

    if (fileBuffer.length > MAX_FILE_SIZE) {
      res.status(400).json({ error: "File is too large (over 100MB)" });
      return;
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();

    const { uploadURL: signedUploadUrl, objectKey: rawObjectKey } = await objectStorageService.getObjectEntityUploadURL(req.user!.organizationId!);

    const uploadResponse = await fetch(signedUploadUrl, {
      method: "PUT",
      body: fileBuffer,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileBuffer.length),
      },
    });

    if (!uploadResponse.ok) {
      res.status(500).json({ error: "Failed to upload file to object storage" });
      return;
    }

    const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(rawObjectKey, {
      owner: req.user!.id,
      organizationId: req.user!.organizationId!,
      visibility: "private",
    });

    const ext = fileName.split(".").pop() || "";
    const finalFileName = title + (ext ? `.${ext}` : "");

    const [newDoc] = await db.insert(planDocuments).values([{
      projectId,
      type: type as any,
      title,
      fileName: finalFileName,
      fileUrl: objectKey,
      objectKey,
      fileSize: fileBuffer.length,
      mimeType: contentType,
      uploadedById: req.user!.id,
    }]).returning();

    await db.insert(filePermissions).values([{
      fileId: newDoc.id,
      fileType: "DOCUMENT",
      userId: req.user!.id,
      grantedById: req.user!.id,
    }]);

    await logCreate(req, "plan_document", newDoc.id, {
      source: provider,
      sourceFileId: fileId,
      title,
      projectId,
      fileSize: fileBuffer.length,
      mimeType: contentType,
    });

    res.status(201).json(newDoc);
  } catch (error: any) {
    logError("Create document from cloud error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/documents/:documentId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { documentId } = req.params;
    const userRole = req.user!.role;
    const userId = req.user!.id;

    const [document] = await db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.id, documentId))
      .limit(1);

    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, document.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const canDelete = userRole === "SUPER_ADMIN" || userRole === "ADMIN" || userRole === "MANAGER";
    
    if (!canDelete) {
      res.status(403).json({ error: "Only administrators and managers can delete documents" });
      return;
    }

    if (document.objectKey) {
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
        await objectFile.delete();
      } catch (error) {
        logError("Error deleting file from object storage:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    }

    const { projectPlans } = await import("@shared/schema");
    await db.delete(projectPlans).where(eq(projectPlans.documentId, documentId));

    await db.delete(planDocuments).where(eq(planDocuments.id, documentId));

    await logDelete(
      req.user!.id,
      "DOCUMENT",
      documentId,
      JSON.stringify(document),
      req
    );

    res.json({ message: "Document deleted successfully" });
  } catch (error: any) {
    logError("Delete document error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/documents/:documentId/download-url", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { documentId } = req.params;

    const [document] = await db
      .select()
      .from(planDocuments)
      .where(eq(planDocuments.id, documentId))
      .limit(1);

    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const [permission] = await db
      .select()
      .from(filePermissions)
      .where(
        and(
          eq(filePermissions.fileId, documentId),
          eq(filePermissions.fileType, "DOCUMENT"),
          eq(filePermissions.userId, req.user!.id)
        )
      )
      .limit(1);

    const hasAccess = document.uploadedById === req.user!.id || 
                      permission !== undefined ||
                      req.user!.role === "ADMIN" ||
                      req.user!.role === "MANAGER";

    if (!hasAccess) {
      res.status(403).json({ error: "Not authorized to access this document" });
      return;
    }

    if (document.objectKey) {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
        
        const [signedUrl] = await objectFile.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000,
        });

        res.json({ url: signedUrl });
      } catch (error) {
        logError("Error generating presigned URL:", {}, error instanceof Error ? error : new Error(String(error)));
        res.json({ url: document.fileUrl });
      }
    } else {
      res.json({ url: document.fileUrl });
    }
  } catch (error: any) {
    logError("Get document download URL error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// File Permissions Routes
// ====================

router.post("/api/file-permissions", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canAccessCompanySettings"), async (req: AuthRequest, res) => {
  try {
    const validationResult = insertFilePermissionSchema.extend({
      grantedById: z.string().optional(),
    }).safeParse({
      ...req.body,
      grantedById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [existing] = await db
      .select()
      .from(filePermissions)
      .where(
        and(
          eq(filePermissions.fileId, validationResult.data.fileId),
          eq(filePermissions.fileType, validationResult.data.fileType),
          eq(filePermissions.userId, validationResult.data.userId)
        )
      )
      .limit(1);

    if (existing) {
      res.status(400).json({ error: "Permission already exists" });
      return;
    }

    const insertData = { ...validationResult.data, grantedById: req.user!.id };
    const [newPermission] = await db
      .insert(filePermissions)
      .values([insertData])
      .returning();
    
    res.status(201).json(newPermission);
  } catch (error: any) {
    logError("Grant file permission error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/file-permissions/:id", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canAccessCompanySettings"), async (req: AuthRequest, res) => {
  try {
    const [deleted] = await db
      .delete(filePermissions)
      .where(eq(filePermissions.id, req.params.id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Permission not found" });
      return;
    }

    res.json({ message: "Permission revoked successfully" });
  } catch (error) {
    logError("Revoke file permission error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/file-permissions/:fileType/:fileId", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canAccessCompanySettings"), async (req: AuthRequest, res) => {
  try {
    const { fileType, fileId } = req.params;
    
    if (!["MEDIA", "DOCUMENT", "RECEIPT"].includes(fileType)) {
      res.status(400).json({ error: "Invalid file type" });
      return;
    }

    const permissions = await db
      .select({
        id: filePermissions.id,
        userId: filePermissions.userId,
        grantedById: filePermissions.grantedById,
        grantedAt: filePermissions.grantedAt,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
      })
      .from(filePermissions)
      .leftJoin(users, eq(filePermissions.userId, users.id))
      .where(
        and(
          eq(filePermissions.fileId, fileId),
          eq(filePermissions.fileType, fileType as "MEDIA" | "DOCUMENT" | "RECEIPT")
        )
      );

    res.json(permissions);
  } catch (error) {
    logError("Get file permissions error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/users/:userId/file-permissions", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user!.id !== req.params.userId && 
        req.user!.role !== "ADMIN" && 
        req.user!.role !== "MANAGER") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const permissions = await db
      .select()
      .from(filePermissions)
      .where(eq(filePermissions.userId, req.params.userId))
      .orderBy(desc(filePermissions.grantedAt));

    res.json(permissions);
  } catch (error) {
    logError("Get user file permissions error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Orders Routes
// ====================

router.get("/api/change-orders", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const { status, projectId } = req.query;

    const conditions: SQL[] = [];

    if (shouldFilter && orgId) {
      conditions.push(eq(projects.gcOrganizationId, orgId));
    }

    if (status === "OVERDUE") {
      conditions.push(eq(changeOrders.status, "SUBMITTED"));
      conditions.push(lt(changeOrders.clientResponseDueDate, sql`NOW()`));
    } else if (status && typeof status === "string") {
      const validStatuses = changeOrderStatusEnum.enumValues;
      if (validStatuses.includes(status as typeof validStatuses[number])) {
        conditions.push(eq(changeOrders.status, status as typeof validStatuses[number]));
      }
    }

    if (projectId && typeof projectId === "string") {
      conditions.push(eq(changeOrders.projectId, projectId));
    }

    const rows = await db
      .select({
        order: changeOrders,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
        },
      })
      .from(changeOrders)
      .leftJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(changeOrders.createdAt));

    res.json(rows.map(r => ({ ...r.order, project: r.project })));
  } catch (error) {
    logError("List change orders error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/change-orders", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const orders = await db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.projectId, project.id))
      .orderBy(desc(changeOrders.createdAt));

    const orderIds = orders.map(o => o.id);
    let lastStatusChanges = new Map<string, Date>();
    if (orderIds.length > 0) {
      const revRows = await db
        .select({
          changeOrderId: changeOrderRevisions.changeOrderId,
          maxCreatedAt: sql<string>`MAX(${changeOrderRevisions.createdAt})`,
        })
        .from(changeOrderRevisions)
        .where(sql`${changeOrderRevisions.changeOrderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`)
        .groupBy(changeOrderRevisions.changeOrderId);
      for (const row of revRows) {
        lastStatusChanges.set(row.changeOrderId, new Date(row.maxCreatedAt));
      }
    }

    const enrichedOrders = orders.map(o => ({
      ...o,
      lastStatusChangeAt: lastStatusChanges.get(o.id)?.toISOString() || null,
    }));

    res.json(enrichedOrders);
  } catch (error) {
    logError("Get change orders error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      description: sanitizeText(req.body.description),
    };

    const validationResult = insertChangeOrderSchema.extend({
      requestedById: z.string().optional(),
      changeOrderNumber: z.string().optional(),
    }).safeParse({
      ...sanitizedBody,
      requestedById: req.user!.id,
      changeOrderNumber: sanitizedBody.changeOrderNumber || "AUTO",
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    if (validationResult.data.projectId) {
      const [coProject] = await db.select().from(projects).where(eq(projects.id, validationResult.data.projectId)).limit(1);
      if (!coProject) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (!verifyOrgAccess(req, res, coProject.gcOrganizationId)) return;
    }

    const amountCheck = validateChangeOrderAmount(validationResult.data.amount, "Change order amount");
    if (!amountCheck.valid) {
      res.status(400).json({ error: amountCheck.error });
      return;
    }

    if (validationResult.data.attachmentsJson !== null && validationResult.data.attachmentsJson !== undefined) {
      const jsonCheck = validateJSONField(validationResult.data.attachmentsJson, "Attachments JSON");
      if (!jsonCheck.valid) {
        res.status(400).json({ error: jsonCheck.error });
        return;
      }
      if (validationResult.data.attachmentsJson === "" || jsonCheck.parsed === null) {
        validationResult.data.attachmentsJson = null;
      }
    }

    const {
      workTypeId,
      workTypeCode,
      workTypeName,
      categoryName,
      scopeModifierIds,
      scopeModifierNames,
      canonicalName,
      scopeUnit,
      scopeQuantity,
      costCodeId,
    } = req.body;

    if (costCodeId) {
      const parsedCostCodeId = parseInt(costCodeId, 10);
      if (isNaN(parsedCostCodeId)) {
        res.status(400).json({ error: "Invalid cost code ID" });
        return;
      }
      const [costCode] = await db.select().from(orgCostCodes)
        .where(and(eq(orgCostCodes.id, parsedCostCodeId), eq(orgCostCodes.organizationId, req.user!.organizationId)))
        .limit(1);
      if (!costCode) {
        res.status(400).json({ error: "Cost code not found or does not belong to your organization" });
        return;
      }
    }

    let changeOrderNumber = validationResult.data.changeOrderNumber;
    if (!changeOrderNumber || changeOrderNumber.trim() === "" || changeOrderNumber === "AUTO") {
      const [maxResult] = await db
        .select({ maxNum: sql<number>`COALESCE(MAX(CAST(REGEXP_REPLACE(${changeOrders.changeOrderNumber}, '^CO-', '') AS INTEGER)), 0)` })
        .from(changeOrders)
        .where(and(eq(changeOrders.projectId, validationResult.data.projectId), sql`${changeOrders.changeOrderNumber} ~ '^CO-\\d+$'`));
      changeOrderNumber = `CO-${String((maxResult?.maxNum ?? 0) + 1).padStart(3, "0")}`;
    }

    const insertData = { 
      ...validationResult.data,
      changeOrderNumber,
      requestedById: req.user!.id,
      status: "PCO" as const,
      workTypeId: workTypeId || null,
      workTypeCode: workTypeCode || null,
      workTypeName: workTypeName || null,
      categoryName: categoryName || null,
      scopeModifierIds: scopeModifierIds || null,
      scopeModifierNames: scopeModifierNames || null,
      canonicalName: canonicalName || null,
      scopeUnit: scopeUnit || null,
      scopeQuantity: scopeQuantity || null,
      costCodeId: costCodeId ? parseInt(costCodeId, 10) : null,
    };
    let newOrder;
    try {
      [newOrder] = await db.insert(changeOrders).values([insertData]).returning();
    } catch (err: unknown) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === "23505" && (pgErr.constraint?.includes("change_orders_project_number_uniq") || pgErr.constraint?.includes("change_order_number"))) {
        return res.status(409).json({ error: `Change order number "${changeOrderNumber}" already exists for this project. Please use a different number.` });
      }
      throw err;
    }

    if (scopeModifierIds && newOrder) {
      try {
        let ids: string[] = [];
        try { ids = JSON.parse(scopeModifierIds); } catch { /* ignore */ }
        let names: string[] = [];
        try { names = scopeModifierNames ? JSON.parse(scopeModifierNames) : []; } catch { /* ignore */ }
        if (Array.isArray(ids) && ids.length > 0) {
          await db.insert(changeOrderScopeModifiers).values(
            ids.map((modId: string, i: number) => ({
              changeOrderId: newOrder.id,
              modifierId: modId,
              modifierName: names[i] || modId,
              sortOrder: i,
            }))
          );
        }
      } catch (e) {
        logError("Failed to sync change order scope modifiers", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }
    
    const adminsAndManagers = await db
      .select()
      .from(users)
      .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
    
    const notificationsToCreate = adminsAndManagers.map(user => ({
      userId: user.id,
      type: "CHANGE_ORDER_PENDING" as const,
      title: "New Change Order Pending",
      message: `Change order ${newOrder.changeOrderNumber} requires approval`,
      relatedEntityId: newOrder.id,
      relatedEntityType: "changeOrder",
      organizationId: req.user?.organizationId,
    }));

    if (notificationsToCreate.length > 0) {
      await insertNotifications(notificationsToCreate);
    }

    res.status(201).json(newOrder);
  } catch (error: any) {
    logError("Create change order error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateChangeOrderSchema = insertChangeOrderSchema.omit({ requestedById: true }).partial();

router.patch("/api/change-orders/:id", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validationResult = updateChangeOrderSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    if (validationResult.data.amount !== undefined && validationResult.data.amount !== null) {
      const amountCheck = validateChangeOrderAmount(validationResult.data.amount, "Change order amount");
      if (!amountCheck.valid) {
        res.status(400).json({ error: amountCheck.error });
        return;
      }
    }

    if (validationResult.data.costCodeId !== undefined && validationResult.data.costCodeId !== null) {
      const [costCode] = await db.select().from(orgCostCodes)
        .where(and(eq(orgCostCodes.id, validationResult.data.costCodeId), eq(orgCostCodes.organizationId, req.user!.organizationId)))
        .limit(1);
      if (!costCode) {
        res.status(400).json({ error: "Cost code not found or does not belong to your organization" });
        return;
      }
    }

    const updateData: Record<string, unknown> = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedOrder] = await db
      .update(changeOrders)
      .set(updateData)
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    if (req.body.scopeModifierIds !== undefined) {
      try {
        await db.delete(changeOrderScopeModifiers).where(eq(changeOrderScopeModifiers.changeOrderId, updatedOrder.id));
        const modIds = req.body.scopeModifierIds;
        const modNames = req.body.scopeModifierNames;
        if (modIds) {
          let ids: string[] = [];
          try { ids = JSON.parse(modIds); } catch { /* ignore */ }
          let names: string[] = [];
          try { names = modNames ? JSON.parse(modNames) : []; } catch { /* ignore */ }
          if (Array.isArray(ids) && ids.length > 0) {
            await db.insert(changeOrderScopeModifiers).values(
              ids.map((modId: string, i: number) => ({
                changeOrderId: updatedOrder.id,
                modifierId: modId,
                modifierName: names[i] || modId,
                sortOrder: i,
              }))
            );
          }
        }
      } catch (e) {
        logError("Failed to sync change order scope modifiers on update", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }

    if (updatedOrder.status === "APPROVED") {
      const { syncApprovedCOToSOV } = await import("./aiaBillingRoutes");
      syncApprovedCOToSOV(updatedOrder.id).catch(e => logError("CO auto-sync error:", {}, e instanceof Error ? e : new Error(String(e))));
    }

    res.json(updatedOrder);
  } catch (error: any) {
    logError("Update change order error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order Line Items Routes
// ====================

router.get("/api/change-orders/:id/line-items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    const [[order], laborEntries, equipmentEntries, materialEntries] = await Promise.all([
      db.select().from(changeOrders).where(eq(changeOrders.id, id)).limit(1),
      db.select().from(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
      db.select().from(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
      db.select().from(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
    ]);

    const costBreakdown = order?.costBreakdownJson
      ? safeJsonParse(typeof order.costBreakdownJson === 'string' ? order.costBreakdownJson : null, typeof order.costBreakdownJson === 'object' ? order.costBreakdownJson : null)
      : null;
    
    res.json({
      laborEntries,
      equipmentEntries,
      materialEntries,
      costBreakdown,
      overheadPercent: order?.overheadPercent ?? "10",
      profitPercent: order?.profitPercent ?? "5",
      subcontractorMarkupPercent: order?.subcontractorMarkupPercent ?? "5",
    });
  } catch (error) {
    logError("Get change order line items error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/change-orders/:id/line-items", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canCreateChangeOrders"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { laborEntries, equipmentEntries, materialEntries, costBreakdown, overheadPercent, profitPercent, subcontractorMarkupPercent } = req.body;
    
    const [existingOrder] = await db.select().from(changeOrders).where(eq(changeOrders.id, id));
    if (!existingOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }
    if (existingOrder.status !== "DRAFT" && existingOrder.status !== "PCO") {
      res.status(400).json({ error: "Can only update line items for draft or PCO change orders" });
      return;
    }

    const safeParseFloat = (val: any): number => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    };

    if (costBreakdown) {
      const ohPct = safeParseFloat(overheadPercent) / 100;
      const prPct = safeParseFloat(profitPercent) / 100;
      const smPct = safeParseFloat(subcontractorMarkupPercent) / 100;

      const sv = costBreakdown.sectionVisibility || { A: true, B: true, C: true, D: true, E: true, F: true, G: true, H: true, I: true, J: true, K: true };

      const sumLaborStd = (rows: any[]) => rows?.reduce((s: number, r: any) => s + safeParseFloat(r.stdHours) * safeParseFloat(r.stdRate), 0) || 0;
      const sumLaborPrem = (rows: any[]) => rows?.reduce((s: number, r: any) => s + safeParseFloat(r.premHours) * safeParseFloat(r.premRate), 0) || 0;
      const sumFringeStd = (rows: any[]) => rows?.reduce((s: number, r: any) => s + safeParseFloat(r.stdAmount), 0) || 0;
      const sumFringePrem = (rows: any[]) => rows?.reduce((s: number, r: any) => s + safeParseFloat(r.premAmount), 0) || 0;
      const sumItemRows = (rows: any[]) => rows?.reduce((s: number, r: any) => s + safeParseFloat(r.quantity) * safeParseFloat(r.rate), 0) || 0;
      const sumTotalField = (rows: any[]) => rows?.reduce((s: number, r: any) => s + safeParseFloat(r.total), 0) || 0;

      const laborRows = costBreakdown.sectionA?.rows || [];
      const totalA = sv.A !== false ? sumLaborStd(laborRows) : 0;
      const totalA1 = sv.A !== false ? sumLaborPrem(costBreakdown.sectionA1?.rows || laborRows) : 0;
      const fringeRows = costBreakdown.sectionB?.rows || [];
      const totalB = sv.B !== false ? sumFringeStd(fringeRows) : 0;
      const totalB1 = sv.B !== false ? sumFringePrem(costBreakdown.sectionB1?.rows || fringeRows) : 0;
      const totalC = sv.C !== false ? sumItemRows(costBreakdown.sectionC?.rows) : 0;
      const totalD = sv.D !== false ? sumItemRows(costBreakdown.sectionD?.rows) : 0;
      const totalE = sv.E !== false ? sumItemRows(costBreakdown.sectionE?.rows) : 0;
      const subtotalForOverhead = totalA + totalA1 + totalB + totalB1 + totalC + totalD + totalE;
      const totalF = sv.F !== false ? subtotalForOverhead * ohPct : 0;
      const totalG = sv.G !== false ? sumItemRows(costBreakdown.sectionG?.rows) : 0;
      const subtotalForProfit = subtotalForOverhead + totalF + totalG;
      const totalH = sv.H !== false ? subtotalForProfit * prPct : 0;
      const totalI = sv.I !== false ? sumTotalField(costBreakdown.sectionI?.rows) : 0;
      const totalJ = sv.J !== false ? totalI * smPct : 0;
      const kBond = safeParseFloat(costBreakdown.sectionK?.bondInsurance);
      const kPermits = safeParseFloat(costBreakdown.sectionK?.permits);
      const kLodging = safeParseFloat(costBreakdown.sectionK?.lodging);
      const kRows = sumTotalField(costBreakdown.sectionK?.rows);
      const totalK = sv.K !== false ? kBond + kPermits + kLodging + kRows : 0;
      const grandTotal = subtotalForProfit + totalH + totalI + totalJ + totalK;

      const computedBreakdown = {
        ...costBreakdown,
        totals: { A: totalA, A1: totalA1, B: totalB, B1: totalB1, C: totalC, D: totalD, E: totalE, F: totalF, G: totalG, H: totalH, I: totalI, J: totalJ, K: totalK, grand: grandTotal },
      };

      await db.update(changeOrders).set({
        amount: String(Math.round(grandTotal * 100) / 100),
        costBreakdownJson: JSON.stringify(computedBreakdown),
        overheadPercent: String(safeParseFloat(overheadPercent)),
        profitPercent: String(safeParseFloat(profitPercent)),
        subcontractorMarkupPercent: String(safeParseFloat(subcontractorMarkupPercent)),
        updatedAt: new Date(),
      }).where(eq(changeOrders.id, id));

      res.json({
        costBreakdown: computedBreakdown,
        overheadPercent: String(safeParseFloat(overheadPercent)),
        profitPercent: String(safeParseFloat(profitPercent)),
        subcontractorMarkupPercent: String(safeParseFloat(subcontractorMarkupPercent)),
        total: Math.round(grandTotal * 100) / 100,
      });
      return;
    }

    await Promise.all([
      db.delete(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
      db.delete(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
      db.delete(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
    ]);

    if (laborEntries && laborEntries.length > 0) {
      const validLaborEntries = laborEntries.filter((entry: any) => 
        entry.employeeName && entry.employeeName.trim() !== ""
      );
      if (validLaborEntries.length > 0) {
        await db.insert(changeOrderLaborEntries).values(
          validLaborEntries.map((entry: any) => {
            const hours = safeParseFloat(entry.hoursWorked);
            const rate = safeParseFloat(entry.hourlyRate);
            return {
              changeOrderId: id,
              employeeName: entry.employeeName,
              position: entry.position || null,
              hoursWorked: String(hours),
              hourlyRate: String(rate),
              totalCost: String(hours * rate),
            };
          })
        );
      }
    }

    if (equipmentEntries && equipmentEntries.length > 0) {
      const validEquipmentEntries = equipmentEntries.filter((entry: any) =>
        entry.equipmentType && entry.equipmentType.trim() !== ""
      );
      if (validEquipmentEntries.length > 0) {
        await db.insert(changeOrderEquipmentEntries).values(
          validEquipmentEntries.map((entry: any) => {
            const qty = Math.max(1, parseInt(entry.quantity) || 1);
            const hours = safeParseFloat(entry.hoursUsed);
            const rate = safeParseFloat(entry.hourlyRate);
            return {
              changeOrderId: id,
              equipmentType: entry.equipmentType,
              description: entry.description || null,
              quantity: qty,
              hoursUsed: String(hours),
              hourlyRate: String(rate),
              totalCost: String(qty * hours * rate),
            };
          })
        );
      }
    }

    if (materialEntries && materialEntries.length > 0) {
      const validMaterialEntries = materialEntries.filter((entry: any) =>
        entry.materialDescription && entry.materialDescription.trim() !== ""
      );
      if (validMaterialEntries.length > 0) {
        await db.insert(changeOrderMaterialEntries).values(
          validMaterialEntries.map((entry: any) => {
            const qty = safeParseFloat(entry.quantity);
            const cost = safeParseFloat(entry.unitCost);
            return {
              changeOrderId: id,
              materialDescription: entry.materialDescription,
              category: entry.category || null,
              quantity: String(qty),
              unit: entry.unit || null,
              unitCost: String(cost),
              totalCost: String(qty * cost),
              vendorPricingId: entry.vendorPricingId || null,
            };
          })
        );
      }
    }

    const [newLaborEntries, newEquipmentEntries, newMaterialEntries] = await Promise.all([
      db.select().from(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
      db.select().from(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
      db.select().from(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
    ]);

    const totalLabor = newLaborEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
    const totalEquipment = newEquipmentEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
    const totalMaterial = newMaterialEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
    const grandTotal = totalLabor + totalEquipment + totalMaterial;

    await db.update(changeOrders)
      .set({ amount: String(grandTotal), updatedAt: new Date() })
      .where(eq(changeOrders.id, id));

    res.json({ 
      laborEntries: newLaborEntries, 
      equipmentEntries: newEquipmentEntries, 
      materialEntries: newMaterialEntries,
      total: grandTotal
    });
  } catch (error) {
    logError("Update change order line items error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Calendar Events Routes
// ====================

router.get("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, eventType } = req.query;
    const userRole = req.user?.role;
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [];
    if (startDate) {
      conditions.push(sql`${calendarEvents.startDate} >= ${startDate as string}`);
    }
    if (endDate) {
      conditions.push(sql`${calendarEvents.endDate} <= ${endDate as string}`);
    }
    const isVendorEventTypeFilter = eventType && (eventType as string).startsWith("VENDOR_");
    if (eventType && !isVendorEventTypeFilter) {
      conditions.push(eq(calendarEvents.eventType, eventType as any));
    }
    const creatorUsers = db
      .select({
        id: users.id,
        organizationId: users.organizationId,
      })
      .from(users)
      .as("creator_users");

    if (shouldFilter && orgId) {
      conditions.push(
        sql`(${users.organizationId} = ${orgId} OR ${creatorUsers.organizationId} = ${orgId})`
      );
    }
    
    const eventsWithUser = isVendorEventTypeFilter ? [] : await db
      .select({
        id: calendarEvents.id,
        eventType: calendarEvents.eventType,
        title: calendarEvents.title,
        description: calendarEvents.description,
        startDate: calendarEvents.startDate,
        endDate: calendarEvents.endDate,
        allDay: calendarEvents.allDay,
        userId: calendarEvents.userId,
        projectId: calendarEvents.projectId,
        approvedById: calendarEvents.approvedById,
        approvedAt: calendarEvents.approvedAt,
        createdById: calendarEvents.createdById,
        createdAt: calendarEvents.createdAt,
        requesteeName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`.as('requestee_name'),
        requesteeRole: users.role,
      })
      .from(calendarEvents)
      .leftJoin(users, eq(calendarEvents.userId, users.id))
      .leftJoin(creatorUsers, eq(calendarEvents.createdById, creatorUsers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(calendarEvents.startDate);

    if (userRole === "VENDOR") {
      const shouldIncludeVendorEvents = !eventType || isVendorEventTypeFilter;
      const vendorEvents = shouldIncludeVendorEvents
        ? await getVendorCalendarEvents(
            req.user!.id,
            isVendorEventTypeFilter ? (eventType as string) : undefined,
            startDate as string | undefined,
            endDate as string | undefined,
          )
        : [];
      const merged = [...eventsWithUser, ...vendorEvents];
      merged.sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      return res.json(merged);
    }

    res.json(eventsWithUser);
  } catch (error) {
    logError("Get calendar events error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getVendorCalendarEvents(userId: string, filterEventType?: string, filterStartDate?: string, filterEndDate?: string) {
  const [vendorUser] = await db.select().from(vendorUsers)
    .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
    .limit(1);

  if (!vendorUser) return [];

  const crmOrgId = vendorUser.crmOrganisationId;

  const [userRecord] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
  const userOrgId = userRecord?.organizationId;
  const syntheticEvents: any[] = [];

  const pricingEvents = await db
    .select({
      id: vendorPricingCatalogs.id,
      itemName: vendorPricingCatalogs.itemName,
      category: vendorPricingCatalogs.category,
      expirationDate: vendorPricingCatalogs.expirationDate,
      effectiveDate: vendorPricingCatalogs.effectiveDate,
      effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
      unitPrice: vendorPricingCatalogs.unitPrice,
      unit: vendorPricingCatalogs.unit,
      contractorName: organizations.name,
    })
    .from(vendorPricingCatalogs)
    .leftJoin(organizations, eq(vendorPricingCatalogs.organizationId, organizations.id))
    .where(and(
      eq(vendorPricingCatalogs.crmOrganisationId, crmOrgId),
      eq(vendorPricingCatalogs.isActive, true),
      sql`${vendorPricingCatalogs.expirationDate} IS NOT NULL`
    ));

  for (const p of pricingEvents) {
    if (!filterEventType || filterEventType === "VENDOR_PRICING_EXPIRATION") {
      syntheticEvents.push({
        id: `vpe-${p.id}`,
        eventType: "VENDOR_PRICING_EXPIRATION",
        title: `Pricing Expires: ${p.itemName}`,
        description: `${p.category} pricing (${p.effectiveQuarter}) for ${p.contractorName || "client"} expires. Unit: $${p.unitPrice}/${p.unit}`,
        startDate: p.expirationDate,
        endDate: p.expirationDate,
        allDay: true,
        userId: null,
        projectId: null,
        approvedById: null,
        approvedAt: null,
        createdById: null,
        createdAt: p.effectiveDate,
        vendorEventMeta: { category: p.category, quarter: p.effectiveQuarter, contractor: p.contractorName },
      });
    }
  }

  const poEvents = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      neededByDate: purchaseOrders.neededByDate,
      status: purchaseOrders.status,
      totalCost: purchaseOrders.totalCost,
      orgName: organizations.name,
    })
    .from(purchaseOrders)
    .innerJoin(organizations, eq(purchaseOrders.orgId, organizations.id))
    .innerJoin(vendorEnrollments, and(
      eq(vendorEnrollments.vendorCrmOrgId, crmOrgId),
      eq(vendorEnrollments.contractorOrgId, purchaseOrders.orgId),
      eq(vendorEnrollments.status, "ACTIVE"),
    ))
    .where(and(
      eq(purchaseOrders.vendorId, crmOrgId),
      sql`${purchaseOrders.neededByDate} IS NOT NULL`,
      sql`${purchaseOrders.status} NOT IN ('CANCELLED', 'CLOSED')`
    ));

  for (const po of poEvents) {
    if (!filterEventType || filterEventType === "VENDOR_PO_DEADLINE") {
      syntheticEvents.push({
        id: `vpo-${po.id}`,
        eventType: "VENDOR_PO_DEADLINE",
        title: `PO Deadline: ${po.poNumber}`,
        description: `Purchase order ${po.poNumber} for ${po.orgName} needed by this date. Status: ${po.status}${po.totalCost ? `. Total: $${po.totalCost}` : ""}`,
        startDate: po.neededByDate,
        endDate: po.neededByDate,
        allDay: true,
        userId: null,
        projectId: null,
        approvedById: null,
        approvedAt: null,
        createdById: null,
        createdAt: po.neededByDate,
        vendorEventMeta: { poNumber: po.poNumber, status: po.status, contractor: po.orgName },
      });
    }
  }

  const rentalEvents = await db
    .select({
      id: rentalEquipmentUsages.id,
      equipmentName: rentalEquipmentUsages.equipmentName,
      equipmentType: rentalEquipmentUsages.equipmentType,
      startDate: rentalEquipmentUsages.startDate,
      expectedEndDate: rentalEquipmentUsages.expectedEndDate,
      actualEndDate: rentalEquipmentUsages.actualEndDate,
      status: rentalEquipmentUsages.status,
      dailyRate: rentalEquipmentUsages.dailyRate,
    })
    .from(rentalEquipmentUsages)
    .innerJoin(rentalVendors, eq(rentalEquipmentUsages.vendorId, rentalVendors.id))
    .where(and(
      eq(rentalVendors.crmOrganisationId, crmOrgId),
      sql`${rentalEquipmentUsages.status} IN ('ACTIVE', 'EXTENDED', 'COMPLETED')`
    ));

  for (const r of rentalEvents) {
    if (!filterEventType || filterEventType === "VENDOR_RENTAL_PERIOD") {
      const endDate = r.actualEndDate || r.expectedEndDate;
      syntheticEvents.push({
        id: `vre-${r.id}`,
        eventType: "VENDOR_RENTAL_PERIOD",
        title: `Rental: ${r.equipmentName}`,
        description: `${r.equipmentType} rental period. Status: ${r.status}. Rate: $${r.dailyRate}/day`,
        startDate: r.startDate,
        endDate: endDate,
        allDay: true,
        userId: null,
        projectId: null,
        approvedById: null,
        approvedAt: null,
        createdById: null,
        createdAt: r.startDate,
        vendorEventMeta: { equipmentType: r.equipmentType, status: r.status },
      });
    }
  }

  const bidConditions: SQL[] = [
    sql`${subcontractorBidInvitations.status} IN ('PENDING', 'VIEWED', 'ACCEPTED')`,
    sql`${subcontractorBidRequests.status} IN ('PUBLISHED', 'OPEN')`,
  ];
  if (userOrgId) {
    bidConditions.push(eq(subcontractorBidInvitations.invitedOrganizationId, userOrgId));
  }

  const bidInvites = userOrgId ? await db
    .select({
      id: subcontractorBidInvitations.id,
      status: subcontractorBidInvitations.status,
      bidRequestId: subcontractorBidInvitations.bidRequestId,
      requestTitle: subcontractorBidRequests.title,
      bidDueDate: subcontractorBidRequests.bidDueDate,
      projectCity: subcontractorBidRequests.projectCity,
      projectState: subcontractorBidRequests.projectState,
      gcOrgName: organizations.name,
    })
    .from(subcontractorBidInvitations)
    .innerJoin(subcontractorBidRequests, eq(subcontractorBidInvitations.bidRequestId, subcontractorBidRequests.id))
    .innerJoin(organizations, eq(subcontractorBidRequests.organizationId, organizations.id))
    .where(and(...bidConditions)) : [];

  for (const b of bidInvites) {
    if (!filterEventType || filterEventType === "VENDOR_BID_DUE_DATE") {
      const location = [b.projectCity, b.projectState].filter(Boolean).join(", ");
      syntheticEvents.push({
        id: `vbd-${b.id}`,
        eventType: "VENDOR_BID_DUE_DATE",
        title: `Bid Due: ${b.requestTitle}`,
        description: `Bid invitation from ${b.gcOrgName}${location ? ` in ${location}` : ""}. Status: ${b.status}`,
        startDate: b.bidDueDate,
        endDate: b.bidDueDate,
        allDay: true,
        userId: null,
        projectId: null,
        approvedById: null,
        approvedAt: null,
        createdById: null,
        createdAt: b.bidDueDate,
        vendorEventMeta: { gcOrg: b.gcOrgName, bidStatus: b.status },
      });
    }
  }

  const enrollmentEvents = await db
    .select({
      id: vendorEnrollments.id,
      status: vendorEnrollments.status,
      invitedAt: vendorEnrollments.invitedAt,
      enrolledAt: vendorEnrollments.enrolledAt,
      contractorName: organizations.name,
      enrolledCategories: vendorEnrollments.enrolledCategories,
    })
    .from(vendorEnrollments)
    .innerJoin(organizations, eq(vendorEnrollments.contractorOrgId, organizations.id))
    .where(eq(vendorEnrollments.vendorCrmOrgId, crmOrgId));

  for (const e of enrollmentEvents) {
    if (!filterEventType || filterEventType === "VENDOR_ENROLLMENT_CHANGE") {
      syntheticEvents.push({
        id: `vec-${e.id}`,
        eventType: "VENDOR_ENROLLMENT_CHANGE",
        title: `Enrollment: ${e.contractorName}`,
        description: `Status: ${e.status}${e.enrolledCategories?.length ? `. Categories: ${e.enrolledCategories.join(", ")}` : ""}`,
        startDate: e.enrolledAt || e.invitedAt,
        endDate: e.enrolledAt || e.invitedAt,
        allDay: true,
        userId: null,
        projectId: null,
        approvedById: null,
        approvedAt: null,
        createdById: null,
        createdAt: e.invitedAt,
        vendorEventMeta: { contractor: e.contractorName, enrollmentStatus: e.status },
      });
    }
  }

  let filtered = syntheticEvents;
  if (filterStartDate) {
    const start = new Date(filterStartDate).getTime();
    filtered = filtered.filter(e => new Date(e.startDate).getTime() >= start);
  }
  if (filterEndDate) {
    const end = new Date(filterEndDate).getTime();
    filtered = filtered.filter(e => new Date(e.endDate || e.startDate).getTime() <= end);
  }

  filtered.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  return filtered;
}

router.get("/api/calendar/my-events", requireAuth, async (req: AuthRequest, res) => {
  try {
    const eventsWithUser = await db
      .select({
        id: calendarEvents.id,
        eventType: calendarEvents.eventType,
        title: calendarEvents.title,
        description: calendarEvents.description,
        startDate: calendarEvents.startDate,
        endDate: calendarEvents.endDate,
        allDay: calendarEvents.allDay,
        userId: calendarEvents.userId,
        projectId: calendarEvents.projectId,
        approvedById: calendarEvents.approvedById,
        approvedAt: calendarEvents.approvedAt,
        createdById: calendarEvents.createdById,
        createdAt: calendarEvents.createdAt,
        requesteeName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`.as('requestee_name'),
        requesteeRole: users.role,
      })
      .from(calendarEvents)
      .leftJoin(users, eq(calendarEvents.userId, users.id))
      .where(eq(calendarEvents.userId, req.user!.id))
      .orderBy(calendarEvents.startDate);

    res.json(eventsWithUser);
  } catch (error) {
    logError("Get user calendar events error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      title: sanitizeShortText(req.body.title),
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validationResult = insertCalendarEventSchema.extend({
      createdById: z.string().optional(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date().optional(),
    }).safeParse({
      ...sanitizedBody,
      createdById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    if (validationResult.data.eventType === "TIME_OFF_REQUEST" || validationResult.data.eventType === "TIME_OFF_APPROVED") {
      res.status(400).json({ error: "Time-off events are managed through the Leave Management module" });
      return;
    }

    if (validationResult.data.projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(
          eq(projects.id, validationResult.data.projectId),
          eq(projects.gcOrganizationId, req.user!.organizationId)
        ))
        .limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
    }

    const insertData = { ...validationResult.data, createdById: req.user!.id, userId: req.user!.id };
    const [newEvent] = await db.insert(calendarEvents).values([insertData]).returning();

    res.status(201).json(newEvent);
  } catch (error: any) {
    logError("Create calendar event error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/calendar/events/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [event] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, req.params.id))
      .limit(1);

    if (!event) {
      res.status(404).json({ error: "Calendar event not found" });
      return;
    }

    if (event.createdById !== req.user!.id && 
        event.userId !== req.user!.id &&
        req.user!.role !== "ADMIN" && 
        req.user!.role !== "MANAGER") {
      res.status(403).json({ error: "Not authorized to delete this event" });
      return;
    }

    await db.delete(calendarEvents).where(eq(calendarEvents.id, req.params.id));
    res.status(204).send();
  } catch (error: any) {
    logError("Delete calendar event error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================================
// Routes from projectHealthRoutes.ts
// ========================================

router.get("/api/project-health/overview", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const overview = await healthService.getOrgHealthOverview(user.organizationId);
    res.json(overview);
  } catch (err) {
    logError("Failed to get health overview", { error: String(err) });
    res.status(500).json({ error: "Failed to get health overview" });
  }
});

router.get("/api/project-health/:projectId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const projectId = req.params.projectId;
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)))
      .limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    let snapshot = await healthService.getLatestSnapshot(user.organizationId, projectId);
    if (!snapshot) {
      try {
        const breakdown = await healthService.computeProjectHealth(user.organizationId, projectId);
        snapshot = await healthService.saveHealthSnapshot(user.organizationId, projectId, breakdown);
      } catch (computeErr) {
        logError("Auto-compute health score failed", { error: String(computeErr), projectId });
      }
    }
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "Failed to get health score" });
  }
});

router.post("/api/project-health/:projectId/compute", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const projectId = req.params.projectId;
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)))
      .limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    const breakdown = await healthService.computeProjectHealth(user.organizationId, projectId);
    const snapshot = await healthService.saveHealthSnapshot(user.organizationId, projectId, breakdown);
    res.json({ breakdown, snapshot });
  } catch (err) {
    logError("Failed to compute health score", { error: String(err) });
    res.status(500).json({ error: "Failed to compute health score" });
  }
});

router.get("/api/project-health/:projectId/history", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const projectId = req.params.projectId;
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)))
      .limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    const limit = parseInt(req.query.limit as string) || 30;
    const history = await healthService.getSnapshotHistory(user.organizationId, projectId, limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Failed to get health history" });
  }
});

router.get("/api/project-health-portfolio/summary", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const summary = await healthService.getPortfolioHealthSummary(user.organizationId);
    res.json(summary);
  } catch (err) {
    logError("Failed to get portfolio health summary", { error: String(err) });
    res.status(500).json({ error: "Failed to get portfolio health summary" });
  }
});

// ====================
// Project Vault - Aggregated Documents
// ====================

const VAULT_MANAGEMENT_ROLES: UserRole[] = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "HUSTLER"];
const VAULT_CONTRACT_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT"];
const VAULT_CHANGE_ORDER_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "HUSTLER"];

interface VaultDocument {
  id: string;
  name: string;
  category: string;
  sourceTab: string;
  uploadDate: string;
  uploadedBy: string;
  fileSize: number | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  objectKey: string | null;
}

async function buildVaultDocuments(projectId: string, projectCode: string, userId: string, userRole: string): Promise<VaultDocument[]> {
  const { filterFilesByPermissions } = await import("./fileAccessHelpers");
  const hasManagement = VAULT_MANAGEMENT_ROLES.includes(userRole);
  const vaultDocs: VaultDocument[] = [];

  const allPlanDocs = await db.select().from(planDocuments).where(eq(planDocuments.projectId, projectId));
  const filteredPlanDocs = await filterFilesByPermissions(allPlanDocs, userId, userRole, "DOCUMENT");
  for (const doc of filteredPlanDocs) {
    vaultDocs.push({
      id: `plan-${doc.id}`,
      name: doc.title || doc.fileName,
      category: doc.type === "PLANS" ? "Plans/Specs" : doc.type === "SPECS" ? "Plans/Specs" : "Other",
      sourceTab: "Plans & Takeoff",
      uploadDate: doc.uploadedAt?.toISOString() || new Date().toISOString(),
      uploadedBy: "",
      fileSize: doc.fileSize,
      fileUrl: null,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      objectKey: doc.objectKey || doc.fileUrl,
    });
  }

  const allReceipts = await db.select().from(receipts).where(eq(receipts.projectId, projectId));
  const filteredReceipts = await filterFilesByPermissions(allReceipts, userId, userRole, "RECEIPT");
  for (const r of filteredReceipts) {
    vaultDocs.push({
      id: `receipt-${r.id}`,
      name: r.fileName || `Receipt - ${r.vendor}`,
      category: "Receipts",
      sourceTab: "Receipts",
      uploadDate: r.createdAt?.toISOString() || new Date().toISOString(),
      uploadedBy: "",
      fileSize: r.fileSize,
      fileUrl: null,
      fileName: r.fileName,
      mimeType: r.mimeType,
      objectKey: r.objectKey || r.fileUrl,
    });
  }

  const { media: mediaTable } = await import("@shared/schema");
  const allMedia = await db.select().from(mediaTable).where(eq(mediaTable.projectId, projectId));
  const filteredMedia = await filterFilesByPermissions(allMedia, userId, userRole, "MEDIA");
  for (const m of filteredMedia) {
    const isPhoto = m.type === "IMAGE";
    vaultDocs.push({
      id: `media-${m.id}`,
      name: m.caption || m.fileName,
      category: isPhoto ? "Photos" : "Videos",
      sourceTab: "Photos & Videos",
      uploadDate: m.uploadedAt?.toISOString() || new Date().toISOString(),
      uploadedBy: "",
      fileSize: m.fileSize,
      fileUrl: null,
      fileName: m.fileName,
      mimeType: m.mimeType,
      objectKey: m.objectKey || m.fileUrl,
    });
  }

  if (hasManagement) {
    const { rfis: rfisTable, submittals: submittalsTable, documentTransmittals: transmittalsTable, contracts: contractsTable } = await import("@shared/schema");

    const allRfis = await db.select().from(rfisTable).where(eq(rfisTable.projectId, projectId));
    for (const rfi of allRfis) {
      if (rfi.attachmentsJson) {
          const attachments = safeJsonParse<any[]>(rfi.attachmentsJson, []);
          if (Array.isArray(attachments)) {
            for (let i = 0; i < attachments.length; i++) {
              const att = attachments[i];
              const storageKey = att.storageKey || att.objectKey || att.fileUrl || null;
              if (!storageKey) continue;
              vaultDocs.push({
                id: `rfi-att-${rfi.id}-${i}`,
                name: att.fileName || `RFI ${rfi.rfiNumber} Attachment`,
                category: "RFIs",
                sourceTab: "RFIs",
                uploadDate: rfi.createdAt?.toISOString() || new Date().toISOString(),
                uploadedBy: rfi.submittedByName || "",
                fileSize: att.fileSize || null,
                fileUrl: null,
                fileName: att.fileName || null,
                mimeType: att.mimeType || null,
                objectKey: storageKey,
              });
            }
          }
      }
    }

    const allSubmittals = await db.select().from(submittalsTable).where(eq(submittalsTable.projectId, projectId));
    for (const sub of allSubmittals) {
      if (sub.attachmentsJson) {
          const attachments = safeJsonParse<any[]>(sub.attachmentsJson, []);
          if (Array.isArray(attachments)) {
            for (let i = 0; i < attachments.length; i++) {
              const att = attachments[i];
              const storageKey = att.storageKey || att.objectKey || att.fileUrl || null;
              if (!storageKey) continue;
              vaultDocs.push({
                id: `submittal-att-${sub.id}-${i}`,
                name: att.fileName || `Submittal ${sub.submittalNumber} Attachment`,
                category: "Submittals",
                sourceTab: "Submittals",
                uploadDate: sub.createdAt?.toISOString() || new Date().toISOString(),
                uploadedBy: sub.submittedByName || "",
                fileSize: att.fileSize || null,
                fileUrl: null,
                fileName: att.fileName || null,
                mimeType: att.mimeType || null,
                objectKey: storageKey,
              });
            }
          }
      }
    }

    const allTransmittals = await db.select().from(transmittalsTable).where(eq(transmittalsTable.projectId, projectId));
    for (const tx of allTransmittals) {
      if (tx.attachmentsJson) {
          const attachments = safeJsonParse<any[]>(tx.attachmentsJson, []);
          if (Array.isArray(attachments)) {
            for (let i = 0; i < attachments.length; i++) {
              const att = attachments[i];
              const storageKey = att.storageKey || att.objectKey || att.fileUrl || null;
              if (!storageKey) continue;
              vaultDocs.push({
                id: `transmittal-att-${tx.id}-${i}`,
                name: att.fileName || `TX ${tx.transmittalNumber} Attachment`,
                category: "Transmittals",
                sourceTab: "Transmittals",
                uploadDate: tx.createdAt?.toISOString() || new Date().toISOString(),
                uploadedBy: tx.sentByName || "",
                fileSize: att.fileSize || null,
                fileUrl: null,
                fileName: att.fileName || null,
                mimeType: att.mimeType || null,
                objectKey: storageKey,
              });
            }
          }
      }
    }

    if (VAULT_CONTRACT_ROLES.includes(userRole)) {
      const allContracts = await db.select().from(contractsTable).where(eq(contractsTable.projectId, projectId));
      for (const c of allContracts) {
        if (c.executedDocumentUrl) {
          vaultDocs.push({
            id: `contract-${c.id}`,
            name: `Contract #${c.contractNumber}`,
            category: "Contracts",
            sourceTab: "Contracts",
            uploadDate: c.createdAt?.toISOString() || new Date().toISOString(),
            uploadedBy: "",
            fileSize: null,
            fileUrl: null,
            fileName: null,
            mimeType: null,
            objectKey: c.executedDocumentUrl,
          });
        }
      }
    }

    const { purchaseOrders: purchaseOrdersTable, vendorInvoices: vendorInvoicesTable, tmInvoices: tmInvoicesTable } = await import("@shared/schema");

    const allPOs = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.projectId, projectId));
    const poIds = allPOs.map(po => po.id);

    if (poIds.length > 0) {
      const allVendorInvoices = await db.select().from(vendorInvoicesTable).where(
        sql`${vendorInvoicesTable.poId} IN (${sql.join(poIds.map(id => sql`${id}`), sql`, `)})`
      );
      for (const vi of allVendorInvoices) {
        if (vi.fileUrl) {
          vaultDocs.push({
            id: `vendor-invoice-${vi.id}`,
            name: `Vendor Invoice #${vi.invoiceNumber}`,
            category: "Invoices",
            sourceTab: "Purchase Orders",
            uploadDate: vi.createdAt?.toISOString() || new Date().toISOString(),
            uploadedBy: "",
            fileSize: null,
            fileUrl: null,
            fileName: null,
            mimeType: "application/pdf",
            objectKey: vi.fileUrl,
          });
        }
      }
    }

    const allTmInvoices = await db.select().from(tmInvoicesTable).where(eq(tmInvoicesTable.projectId, projectId));
    for (const inv of allTmInvoices) {
      const storageKey = inv.pdfObjectKey || inv.pdfUrl;
      if (storageKey) {
        vaultDocs.push({
          id: `tm-invoice-${inv.id}`,
          name: `T&M Invoice #${inv.invoiceNumber}`,
          category: "Invoices",
          sourceTab: "T&M Billing",
          uploadDate: inv.createdAt?.toISOString() || new Date().toISOString(),
          uploadedBy: "",
          fileSize: null,
          fileUrl: null,
          fileName: `Invoice_${inv.invoiceNumber}.pdf`,
          mimeType: "application/pdf",
          objectKey: storageKey,
        });
      }
    }
  }

  if (VAULT_CHANGE_ORDER_ROLES.includes(userRole)) {
    const allChangeOrders = await db.select().from(changeOrders).where(eq(changeOrders.projectId, projectId));
    for (const co of allChangeOrders) {
      if (co.attachmentsJson) {
          const attachments = safeJsonParse<any[]>(co.attachmentsJson, []);
          if (Array.isArray(attachments)) {
            for (let i = 0; i < attachments.length; i++) {
              const att = attachments[i];
              const storageKey = att.storageKey || att.objectKey || att.fileUrl || null;
              if (!storageKey) continue;
              vaultDocs.push({
                id: `co-att-${co.id}-${i}`,
                name: att.fileName || `CO ${co.changeOrderNumber} Attachment`,
                category: "Change Orders",
                sourceTab: "Change Orders",
                uploadDate: co.createdAt?.toISOString() || new Date().toISOString(),
                uploadedBy: "",
                fileSize: att.fileSize || null,
                fileUrl: null,
                fileName: att.fileName || null,
                mimeType: att.mimeType || null,
                objectKey: storageKey,
              });
            }
          }
      }
    }
  }

  return vaultDocs;
}

router.get("/api/projects/:code/vault", requireAuth, requireRole(...VAULT_MANAGEMENT_ROLES), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const typeFilter = req.query.type as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    const vaultDocs = await buildVaultDocuments(project.id, project.code, req.user!.id, req.user!.role);

    let filtered = vaultDocs;
    if (typeFilter && typeFilter !== "all") {
      filtered = filtered.filter(d => d.category === typeFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      filtered = filtered.filter(d => new Date(d.uploadDate) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(d => new Date(d.uploadDate) <= to);
    }

    filtered.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

    res.json(filtered);
  } catch (error) {
    logError("Project vault error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/vault/:docId/signed-url", requireAuth, requireRole(...VAULT_MANAGEMENT_ROLES), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const allVaultDocs = await buildVaultDocuments(project.id, project.code, req.user!.id, req.user!.role);
    const doc = allVaultDocs.find(d => d.id === req.params.docId);
    if (!doc) {
      res.status(404).json({ error: "Document not found or access denied" });
      return;
    }

    const storageKey = doc.objectKey;
    if (!storageKey) {
      res.status(404).json({ error: "No file associated with this document" });
      return;
    }

    if (storageKey.startsWith("http://") || storageKey.startsWith("https://")) {
      try {
        const url = new URL(storageKey);
        const allowedHosts = ["storage.googleapis.com", "storage.cloud.google.com"];
        if (!allowedHosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
          res.status(403).json({ error: "File URL is not from a trusted storage provider" });
          return;
        }
      } catch {
        logWarn("Non-critical operation failed");
        res.status(400).json({ error: "Invalid file URL" });
        return;
      }
      res.json({ url: storageKey, fileName: doc.fileName, mimeType: doc.mimeType });
      return;
    }

    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
    const [signedUrl] = await objectFile.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 });

    res.json({ url: signedUrl, fileName: doc.fileName, mimeType: doc.mimeType });
  } catch (error) {
    logError("Vault signed URL error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate signed URL" });
  }
});

const vaultExportSchema = z.object({
  documentIds: z.array(z.string()).min(1, "At least one document ID is required").max(500),
});

router.post("/api/projects/:code/vault/export-pdf", requireAuth, requireRole(...VAULT_MANAGEMENT_ROLES), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parsed = vaultExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid request" });
      return;
    }

    const { documentIds } = parsed.data;
    const allVaultDocs = await buildVaultDocuments(project.id, project.code, req.user!.id, req.user!.role);
    const vaultMap = new Map(allVaultDocs.map(d => [d.id, d]));
    const selectedDocs = documentIds.map(id => vaultMap.get(id)).filter((d): d is VaultDocument => !!d);

    if (selectedDocs.length === 0) {
      res.status(400).json({ error: "No accessible documents found for the given IDs" });
      return;
    }

    const PDFDocument = (await import("pdfkit")).default;
    const { PassThrough } = await import("stream");
    const stream = new PassThrough();

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    doc.pipe(stream);

    doc.fontSize(24).font("Helvetica-Bold").text("Project Document Vault", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(16).font("Helvetica").text(project.name, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#666666").text(`Project Code: ${project.code}`, { align: "center" });
    doc.text(`Export Date: ${new Date().toLocaleDateString()}`, { align: "center" });
    doc.text(`Total Documents: ${selectedDocs.length}`, { align: "center" });
    doc.moveDown(1.5);
    doc.fillColor("#000000");

    doc.fontSize(14).font("Helvetica-Bold").text("Table of Contents", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica");

    const categories = new Map<string, VaultDocument[]>();
    for (const d of selectedDocs) {
      const cat = d.category || "Other";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(d);
    }

    let tocIdx = 1;
    for (const [cat, docs] of categories) {
      doc.font("Helvetica-Bold").text(`${cat} (${docs.length})`);
      doc.font("Helvetica");
      for (const d of docs) {
        doc.text(`  ${tocIdx}. ${d.name}`, { indent: 10 });
        tocIdx++;
      }
      doc.moveDown(0.3);
    }

    const resolveStorageBuffer = async (key: string): Promise<Buffer | null> => {
      try {
        if (key.startsWith("http://") || key.startsWith("https://")) {
          return null;
        }
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(key);
        const [signedUrl] = await objectFile.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 10 * 60 * 1000 });
        const resp = await fetch(signedUrl);
        if (resp.ok) return Buffer.from(await resp.arrayBuffer());
        return null;
      } catch {
        logWarn("Non-critical operation failed");
        return null;
      }
    };

    const pdfDocsToMerge: { name: string; key: string }[] = [];

    let docIdx = 1;
    for (const d of selectedDocs) {
      doc.addPage();
      doc.fontSize(12).font("Helvetica-Bold").text(`${docIdx}. ${d.name}`);
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica")
        .text(`Category: ${d.category}`)
        .text(`Source: ${d.sourceTab}`)
        .text(`Date: ${d.uploadDate ? new Date(d.uploadDate).toLocaleDateString() : "N/A"}`);

      const storageKey = d.objectKey;
      if (storageKey) {
        doc.moveDown(0.5);
        if (d.mimeType?.startsWith("image/")) {
          try {
            const imgBuf = await resolveStorageBuffer(storageKey);
            if (imgBuf) {
              doc.image(imgBuf, { fit: [500, 600], align: "center" });
            } else {
              doc.text("[Image could not be embedded]");
            }
          } catch {
            logWarn("Non-critical operation failed");
            doc.text("[Image could not be embedded]");
          }
          if (d.name) {
            doc.moveDown(0.3);
            doc.fontSize(9).fillColor("#666666").text(d.name, { align: "center" });
            doc.fillColor("#000000");
          }
        } else if (d.mimeType === "application/pdf") {
          doc.moveDown(0.3);
          doc.fontSize(10).font("Helvetica").text(`[PDF document — merged below if available]`);
          pdfDocsToMerge.push({ name: d.fileName || d.name, key: storageKey });
        } else {
          doc.fontSize(10).font("Helvetica")
            .text(`File Type: ${d.mimeType || "Unknown"}`)
            .text(`File Name: ${d.fileName || d.name}`);
          if (d.fileSize) {
            const sizeKB = (d.fileSize / 1024).toFixed(1);
            doc.text(`File Size: ${sizeKB} KB`);
          }
          doc.moveDown(0.5);
          doc.fontSize(9).fillColor("#666666").text("Download this file individually from the Project Vault.", { align: "center" });
          doc.fillColor("#000000");
        }
      }

      doc.moveDown(1);
      doc.fontSize(8).fillColor("#999999").text(`— End of document ${docIdx} —`, { align: "center" });
      doc.fillColor("#000000");
      docIdx++;
    }

    doc.end();

    const coverPdfBytes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });

    const { PDFDocument: PDFLibDocument } = await import("pdf-lib");
    const mergedPdf = await PDFLibDocument.create();

    try {
      const coverDoc = await PDFLibDocument.load(coverPdfBytes);
      const coverPages = await mergedPdf.copyPages(coverDoc, coverDoc.getPageIndices());
      for (const page of coverPages) {
        mergedPdf.addPage(page);
      }
    } catch {
      logWarn("Non-critical operation failed");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Project_Vault_${project.code}_${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(coverPdfBytes);
      return;
    }

    for (const pdfEntry of pdfDocsToMerge) {
      try {
        const pdfBuf = await resolveStorageBuffer(pdfEntry.key);
        if (pdfBuf) {
          const externalDoc = await PDFLibDocument.load(pdfBuf, { ignoreEncryption: true });
          const pages = await mergedPdf.copyPages(externalDoc, externalDoc.getPageIndices());
          for (const page of pages) {
            mergedPdf.addPage(page);
          }
        }
      } catch { logWarn("Non-critical operation failed"); }
    }

    const finalPdfBytes = await mergedPdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Project_Vault_${project.code}_${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(Buffer.from(finalPdfBytes));
  } catch (error) {
    logError("Project vault PDF export error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

export default router;
