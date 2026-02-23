import { Router, Response } from "express";
import { AuthRequest, requireAuth, requireRole } from "./auth";
import { requireFeature } from "./middleware/requireFeature";
import { db } from "./db";
import { dataProcessingRecords, dataSubjectRequests, users, auditLog, timeEntries, projectNotes } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logAudit } from "./auditLogger";

const router = Router();

router.get("/processing-records", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("PRIVACY_COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const records = await db.select()
      .from(dataProcessingRecords)
      .where(eq(dataProcessingRecords.organizationId, orgId))
      .orderBy(desc(dataProcessingRecords.createdAt));

    res.json(records);
  } catch (error) {
    console.error("Error fetching processing records:", error);
    res.status(500).json({ error: "Failed to fetch processing records" });
  }
});

router.post("/processing-records", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("PRIVACY_COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { id, purpose, legalBasis, dataCategories, recipients, retentionPeriod } = req.body;

    if (!purpose || !legalBasis) {
      return res.status(400).json({ error: "Purpose and legal basis are required" });
    }

    if (id) {
      const [updated] = await db.update(dataProcessingRecords)
        .set({ purpose, legalBasis, dataCategories, recipients, retentionPeriod, updatedAt: new Date() })
        .where(and(eq(dataProcessingRecords.id, id), eq(dataProcessingRecords.organizationId, orgId)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Record not found" });

      await logAudit({ userId: user.id, entityType: "data_processing_records", entityId: id, action: "UPDATE" }, req);
      return res.json(updated);
    }

    const [record] = await db.insert(dataProcessingRecords).values({
      organizationId: orgId,
      purpose,
      legalBasis,
      dataCategories,
      recipients,
      retentionPeriod,
    }).returning();

    await logAudit({ userId: user.id, entityType: "data_processing_records", entityId: record.id, action: "CREATE" }, req);
    res.status(201).json(record);
  } catch (error) {
    console.error("Error saving processing record:", error);
    res.status(500).json({ error: "Failed to save processing record" });
  }
});

router.delete("/processing-records/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("PRIVACY_COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { id } = req.params;
    const deleted = await db.delete(dataProcessingRecords)
      .where(and(eq(dataProcessingRecords.id, id), eq(dataProcessingRecords.organizationId, orgId)))
      .returning();

    if (!deleted.length) return res.status(404).json({ error: "Record not found" });

    await logAudit({ userId: user.id, entityType: "data_processing_records", entityId: id, action: "DELETE" }, req);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting processing record:", error);
    res.status(500).json({ error: "Failed to delete processing record" });
  }
});

router.get("/subject-requests", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("PRIVACY_COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const requests = await db.select()
      .from(dataSubjectRequests)
      .where(eq(dataSubjectRequests.organizationId, orgId))
      .orderBy(desc(dataSubjectRequests.requestedAt));

    res.json(requests);
  } catch (error) {
    console.error("Error fetching subject requests:", error);
    res.status(500).json({ error: "Failed to fetch subject requests" });
  }
});

router.post("/subject-requests", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("PRIVACY_COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { requestType, subjectEmail, subjectName, notes } = req.body;

    if (!requestType || !subjectEmail) {
      return res.status(400).json({ error: "Request type and subject email are required" });
    }

    const [request] = await db.insert(dataSubjectRequests).values({
      organizationId: orgId,
      requestType,
      subjectEmail,
      subjectName,
      notes,
      status: "PENDING",
    }).returning();

    await logAudit({ userId: user.id, entityType: "data_subject_requests", entityId: request.id, action: "CREATE" }, req);
    res.status(201).json(request);
  } catch (error) {
    console.error("Error creating subject request:", error);
    res.status(500).json({ error: "Failed to create subject request" });
  }
});

router.post("/subject-requests/:id/process", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("PRIVACY_COMPLIANCE"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { id } = req.params;
    const { action } = req.body;

    const [request] = await db.select()
      .from(dataSubjectRequests)
      .where(and(eq(dataSubjectRequests.id, id), eq(dataSubjectRequests.organizationId, orgId)));

    if (!request) return res.status(404).json({ error: "Request not found" });

    if (action === "deny") {
      const [updated] = await db.update(dataSubjectRequests)
        .set({ status: "DENIED", completedAt: new Date(), completedBy: user.id })
        .where(eq(dataSubjectRequests.id, id))
        .returning();

      await logAudit({ userId: user.id, entityType: "data_subject_requests", entityId: id, action: "REJECT" }, req);
      return res.json(updated);
    }

    await db.update(dataSubjectRequests)
      .set({ status: "IN_PROGRESS" })
      .where(eq(dataSubjectRequests.id, id));

    if (request.requestType === "ACCESS" || request.requestType === "PORTABILITY") {
      const subjectUser = await db.select()
        .from(users)
        .where(and(eq(users.email, request.subjectEmail), eq(users.organizationId, orgId)));

      const exportData: Record<string, any> = {
        exportDate: new Date().toISOString(),
        requestId: id,
        subjectEmail: request.subjectEmail,
        userData: subjectUser.length ? {
          firstName: subjectUser[0].firstName,
          lastName: subjectUser[0].lastName,
          email: subjectUser[0].email,
          role: subjectUser[0].role,
          createdAt: subjectUser[0].createdAt,
        } : null,
      };

      if (subjectUser.length) {
        const userAuditLogs = await db.select()
          .from(auditLog)
          .where(eq(auditLog.userId, subjectUser[0].id))
          .orderBy(desc(auditLog.createdAt))
          .limit(1000);
        exportData.auditLog = userAuditLogs;
      }

      const [updated] = await db.update(dataSubjectRequests)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          completedBy: user.id,
          notes: `Data export generated with ${Object.keys(exportData).length} categories`,
        })
        .where(eq(dataSubjectRequests.id, id))
        .returning();

      await logAudit({ userId: user.id, entityType: "data_subject_requests", entityId: id, action: "APPROVE" }, req);
      return res.json({ ...updated, exportData });
    }

    if (request.requestType === "DELETION") {
      const subjectUser = await db.select()
        .from(users)
        .where(and(eq(users.email, request.subjectEmail), eq(users.organizationId, orgId)));

      if (subjectUser.length) {
        await db.update(users)
          .set({
            firstName: "[REDACTED]",
            lastName: "[REDACTED]",
            email: `redacted-${subjectUser[0].id}@deleted.local`,
            phone: null,
            isActive: false,
          })
          .where(eq(users.id, subjectUser[0].id));
      }

      const [updated] = await db.update(dataSubjectRequests)
        .set({ status: "COMPLETED", completedAt: new Date(), completedBy: user.id })
        .where(eq(dataSubjectRequests.id, id))
        .returning();

      await logAudit({ userId: user.id, entityType: "data_subject_requests", entityId: id, action: "APPROVE", newValue: "User data anonymized" }, req);
      return res.json(updated);
    }

    const [updated] = await db.update(dataSubjectRequests)
      .set({ status: "COMPLETED", completedAt: new Date(), completedBy: user.id })
      .where(eq(dataSubjectRequests.id, id))
      .returning();

    await logAudit({ userId: user.id, entityType: "data_subject_requests", entityId: id, action: "APPROVE" }, req);
    res.json(updated);
  } catch (error) {
    console.error("Error processing subject request:", error);
    res.status(500).json({ error: "Failed to process subject request" });
  }
});

export default router;
