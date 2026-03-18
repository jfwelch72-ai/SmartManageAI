import { Router } from "express";
import { db } from "./db";
import { users, auditLog, billingEvents } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, and, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { logCreate } from "./auditLogger";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

router.get("/api/projects/:projectId/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
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
    console.error("Get billing events error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
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

    const data = schema.parse(req.body);

    const insertData = { ...data, createdById: req.user!.id };

    const [newEvent] = await db.insert(billingEvents).values([insertData]).returning();

    await logCreate(req.user!.id, "BILLING_EVENT", newEvent.id, newEvent, req);

    res.status(201).json(newEvent);
  } catch (error) {
    console.error("Create billing event error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/audit-logs", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const { entityType, entityId, userId, action, page = "1", pageSize = "100" } = req.query;

    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
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
    console.error("Get audit logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/audit-logs/:entityType/:entityId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    console.error("Get entity audit logs error:", error);
    res.status(500).json({ error: "Internal server error" });
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

router.post("/api/objects/upload", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "User must belong to an organization to upload files" });
      return;
    }
    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(organizationId);
    res.json({ uploadURL });
  } catch (error: any) {
    console.error("Get upload URL error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/objects/:objectPath(*)", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { ObjectStorageService, ObjectNotFoundError } = await objectStoragePromise;
    const { ObjectPermission } = await objectAclPromise;
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(req.path);
    const objectKey = objectFile.name;

    const { resolveObjectKeyToFile } = await import("./fileAccessHelpers");
    const resolvedFile = await resolveObjectKeyToFile(objectKey);

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
    console.error("Object download error:", error);
    const { ObjectNotFoundError } = await objectStoragePromise;
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
