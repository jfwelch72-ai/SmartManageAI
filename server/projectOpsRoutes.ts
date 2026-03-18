import { Router } from "express";
import { db } from "./db";
import {
  projects, receipts, planDocuments, filePermissions, changeOrders,
  changeOrderLaborEntries, changeOrderEquipmentEntries, changeOrderMaterialEntries,
  calendarEvents, notifications, users,
  insertReceiptSchema, insertPlanDocumentSchema, insertFilePermissionSchema,
  insertChangeOrderSchema, insertCalendarEventSchema,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, sql, and, type SQL } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logDelete } from "./auditLogger";
import { insertNotification, insertNotifications } from "./services/notificationService";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { verifyOrgAccess, getOrgIdForFilter } from "./orgFilter";

const router = Router();

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
    console.error("Get receipts error:", error);
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
      console.error("Receipt validation errors:", JSON.stringify(validationResult.error.errors, null, 2));
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

    res.status(201).json(newReceipt);
  } catch (error: any) {
    console.error("Create receipt error:", error);
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
    console.error("Get documents error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/documents", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FOREMAN"), async (req: AuthRequest, res) => {
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
    console.error("Create document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/documents/from-url", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FOREMAN"), async (req: AuthRequest, res) => {
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
    console.error("Create document from URL error:", error);
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
        console.error("Error deleting file from object storage:", error);
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
    console.error("Delete document error:", error);
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
        console.error("Error generating presigned URL:", error);
        res.json({ url: document.fileUrl });
      }
    } else {
      res.json({ url: document.fileUrl });
    }
  } catch (error: any) {
    console.error("Get document download URL error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// File Permissions Routes
// ====================

router.post("/api/file-permissions", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    console.error("Grant file permission error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/file-permissions/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    console.error("Revoke file permission error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/file-permissions/:fileType/:fileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    console.error("Get file permissions error:", error);
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
    console.error("Get user file permissions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Orders Routes
// ====================

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

    res.json(orders);
  } catch (error) {
    console.error("Get change orders error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      description: sanitizeText(req.body.description),
    };

    const validationResult = insertChangeOrderSchema.extend({
      requestedById: z.string().optional(),
    }).safeParse({
      ...sanitizedBody,
      requestedById: req.user!.id,
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
    } = req.body;

    const insertData = { 
      ...validationResult.data, 
      requestedById: req.user!.id,
      workTypeId: workTypeId || null,
      workTypeCode: workTypeCode || null,
      workTypeName: workTypeName || null,
      categoryName: categoryName || null,
      scopeModifierIds: scopeModifierIds || null,
      scopeModifierNames: scopeModifierNames || null,
      canonicalName: canonicalName || null,
      scopeUnit: scopeUnit || null,
      scopeQuantity: scopeQuantity || null,
    };
    const [newOrder] = await db.insert(changeOrders).values([insertData]).returning();
    
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
    }));

    if (notificationsToCreate.length > 0) {
      await insertNotifications(notificationsToCreate);
    }

    res.status(201).json(newOrder);
  } catch (error: any) {
    console.error("Create change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateChangeOrderSchema = insertChangeOrderSchema.omit({ requestedById: true }).partial();

router.patch("/api/change-orders/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedOrder] = await db
      .update(changeOrders)
      .set(updateData)
      .where(eq(changeOrders.id, req.params.id))
      .returning();

    if (!updatedOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }

    res.json(updatedOrder);
  } catch (error: any) {
    console.error("Update change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Change Order Line Items Routes
// ====================

router.get("/api/change-orders/:id/line-items", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    const [laborEntries, equipmentEntries, materialEntries] = await Promise.all([
      db.select().from(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
      db.select().from(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
      db.select().from(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
    ]);
    
    res.json({ laborEntries, equipmentEntries, materialEntries });
  } catch (error) {
    console.error("Get change order line items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/change-orders/:id/line-items", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { laborEntries, equipmentEntries, materialEntries } = req.body;
    
    const [existingOrder] = await db.select().from(changeOrders).where(eq(changeOrders.id, id));
    if (!existingOrder) {
      res.status(404).json({ error: "Change order not found" });
      return;
    }
    if (existingOrder.status !== "DRAFT") {
      res.status(400).json({ error: "Can only update line items for draft change orders" });
      return;
    }

    await Promise.all([
      db.delete(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
      db.delete(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
      db.delete(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
    ]);

    const safeParseFloat = (val: any): number => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    };

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
    console.error("Update change order line items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Calendar Events Routes
// ====================

router.get("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate, eventType } = req.query;
    
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) return res.json([]);

    const conditions: SQL[] = [];
    if (startDate) {
      conditions.push(sql`${calendarEvents.startDate} >= ${startDate as string}`);
    }
    if (endDate) {
      conditions.push(sql`${calendarEvents.endDate} <= ${endDate as string}`);
    }
    if (eventType) {
      conditions.push(eq(calendarEvents.eventType, eventType as any));
    }
    if (shouldFilter && orgId) {
      conditions.push(eq(users.organizationId, orgId));
    }
    
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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(calendarEvents.startDate);

    res.json(eventsWithUser);
  } catch (error) {
    console.error("Get calendar events error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
    console.error("Get user calendar events error:", error);
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

    const insertData = { ...validationResult.data, createdById: req.user!.id };
    const [newEvent] = await db.insert(calendarEvents).values([insertData]).returning();
    
    if (newEvent.eventType === "TIME_OFF_REQUEST") {
      const adminsAndManagers = await db
        .select()
        .from(users)
        .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
      
      const notificationsToCreate = adminsAndManagers.map(user => ({
        userId: user.id,
        type: "TIME_OFF_REQUEST" as const,
        title: "Time Off Request",
        message: `${req.user!.firstName} ${req.user!.lastName} requested time off: ${newEvent.title}`,
        relatedEntityId: newEvent.id,
        relatedEntityType: "calendarEvent",
      }));

      if (notificationsToCreate.length > 0) {
        await insertNotifications(notificationsToCreate);
      }
    }

    res.status(201).json(newEvent);
  } catch (error: any) {
    console.error("Create calendar event error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/calendar/events/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [event] = await db
      .update(calendarEvents)
      .set({
        eventType: "TIME_OFF_APPROVED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
      })
      .where(eq(calendarEvents.id, req.params.id))
      .returning();

    if (!event) {
      res.status(404).json({ error: "Calendar event not found" });
      return;
    }

    if (event.userId) {
      await insertNotification({
        userId: event.userId,
        type: "GENERAL",
        title: "Time Off Approved",
        message: `Your time off request has been approved: ${event.title}`,
        relatedEntityId: event.id,
        relatedEntityType: "calendarEvent",
      });
    }

    res.json(event);
  } catch (error: any) {
    console.error("Approve time-off error:", error);
    if (error.message === "Calendar event not found") {
      res.status(404).json({ error: "Calendar event not found" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
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
    console.error("Delete calendar event error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
