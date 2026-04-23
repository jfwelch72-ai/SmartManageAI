import { Router } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { addenda, addendumAcknowledgments } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {logInfo, logError, logWarn } from "./utils/logger";
import { notifyDocumentEvent } from "./services/documentNotificationService";
import { assertStorageKeyBelongsToOrg } from "./services/documentRevisionService";
import { ObjectPermission } from "./objectAcl";

const router = Router();

router.get("/projects/:projectId/addenda", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { projectId } = req.params;

    const items = await db.select().from(addenda)
      .where(and(
        eq(addenda.organizationId, user.organizationId),
        eq(addenda.projectId, projectId)
      ))
      .orderBy(desc(addenda.addendumNumber));

    const withAcks = await Promise.all(items.map(async (item) => {
      const acks = await db.select().from(addendumAcknowledgments)
        .where(eq(addendumAcknowledgments.addendumId, item.id));
      const totalAcks = acks.length;
      const acknowledgedCount = acks.filter(a => a.acknowledgedAt !== null).length;
      return { ...item, totalRecipients: totalAcks, acknowledgedCount };
    }));

    res.json(withAcks);
  } catch (err) {
    next(err);
  }
});

router.post("/projects/:projectId/addenda", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { projectId } = req.params;
    const { title, description, relatedDocumentId, storageKey, fileUrl, fileName } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const supplied = storageKey || fileUrl;
    if (supplied) {
      try {
        await assertStorageKeyBelongsToOrg(supplied, user.organizationId, user.id, user.role);
      } catch (err: any) {
        return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
      }
    }

    const latest = await db.select({ maxNum: sql<number>`coalesce(max(${addenda.addendumNumber}), 0)` })
      .from(addenda)
      .where(and(
        eq(addenda.organizationId, user.organizationId),
        eq(addenda.projectId, projectId)
      ));
    const nextNumber = (latest[0]?.maxNum || 0) + 1;

    const [addendum] = await db.insert(addenda).values({
      organizationId: user.organizationId,
      projectId,
      addendumNumber: nextNumber,
      title,
      description: description || null,
      relatedDocumentId: relatedDocumentId || null,
      storageKey: storageKey || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      status: "DRAFT",
    }).returning();

    logInfo("Addendum created", { addendumId: addendum.id, projectId, number: nextNumber });
    res.status(201).json(addendum);
  } catch (err) {
    next(err);
  }
});

router.get("/addenda/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const [addendum] = await db.select().from(addenda)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ));
    if (!addendum) return res.status(404).json({ error: "Addendum not found" });

    const acks = await db.select().from(addendumAcknowledgments)
      .where(eq(addendumAcknowledgments.addendumId, addendum.id));

    res.json({ ...addendum, acknowledgments: acks });
  } catch (err) {
    next(err);
  }
});

router.patch("/addenda/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { title, description, relatedDocumentId, storageKey, fileUrl, fileName } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (relatedDocumentId !== undefined) updates.relatedDocumentId = relatedDocumentId;
    const newKey = storageKey !== undefined ? storageKey : (fileUrl !== undefined ? fileUrl : undefined);
    if (newKey) {
      try {
        await assertStorageKeyBelongsToOrg(newKey, user.organizationId, user.id, user.role);
      } catch (err: any) {
        return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
      }
    }
    if (storageKey !== undefined) updates.storageKey = storageKey;
    if (fileUrl !== undefined) updates.fileUrl = fileUrl;
    if (fileName !== undefined) updates.fileName = fileName;

    const [updated] = await db.update(addenda)
      .set(updates)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ))
      .returning();

    if (!updated) return res.status(404).json({ error: "Addendum not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/addenda/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const [existing] = await db.select().from(addenda)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ));
    if (!existing) return res.status(404).json({ error: "Addendum not found" });

    await db.delete(addendumAcknowledgments).where(eq(addendumAcknowledgments.addendumId, req.params.id));
    await db.delete(addenda).where(eq(addenda.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/addenda/:id/issue", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const [existing] = await db.select().from(addenda)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ));
    if (!existing) return res.status(404).json({ error: "Addendum not found" });
    if (existing.status !== "DRAFT") return res.status(400).json({ error: "Only draft addenda can be issued" });

    const [updated] = await db.update(addenda)
      .set({
        status: "ISSUED",
        issuedDate: new Date(),
        issuedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(addenda.id, req.params.id))
      .returning();

    logInfo("Addendum issued", { addendumId: updated.id });

    const acks = await db.select().from(addendumAcknowledgments)
      .where(eq(addendumAcknowledgments.addendumId, updated.id));
    const ackRecipientIds = acks
      .map(a => a.recipientId)
      .filter((rid): rid is string => !!rid);
    if (ackRecipientIds.length > 0) {
      notifyDocumentEvent("ADDENDUM", updated.id, user.organizationId, existing.projectId, user.id, ackRecipientIds, `Addendum Issued: ${existing.title}`, `Addendum #${existing.addendumNumber}`);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/addenda/:id/acknowledge", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { recipientType, recipientEmail } = req.body;
    const recipientName = req.body.recipientName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email || "Unknown");

    const [existing] = await db.select().from(addenda)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ));
    if (!existing) return res.status(404).json({ error: "Addendum not found" });

    const [ack] = await db.insert(addendumAcknowledgments).values({
      addendumId: req.params.id,
      recipientType: recipientType || "TEAM_MEMBER",
      recipientId: user.id,
      recipientName,
      recipientEmail: recipientEmail || null,
      acknowledgedAt: new Date(),
      sentAt: new Date(),
    }).returning();

    const allAcks = await db.select().from(addendumAcknowledgments)
      .where(eq(addendumAcknowledgments.addendumId, req.params.id));
    const allAcknowledged = allAcks.length > 0 && allAcks.every(a => a.acknowledgedAt !== null);
    if (allAcknowledged && existing.status === "ISSUED") {
      await db.update(addenda)
        .set({ status: "ACKNOWLEDGED", updatedAt: new Date() })
        .where(eq(addenda.id, req.params.id));
    }

    res.status(201).json(ack);
  } catch (err) {
    next(err);
  }
});

router.get("/addenda/:id/acknowledgments", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const [existing] = await db.select().from(addenda)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ));
    if (!existing) return res.status(404).json({ error: "Addendum not found" });

    const acks = await db.select().from(addendumAcknowledgments)
      .where(eq(addendumAcknowledgments.addendumId, req.params.id));
    res.json(acks);
  } catch (err) {
    next(err);
  }
});

router.get("/addenda/:id/preview-url", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const [addendum] = await db.select().from(addenda)
      .where(and(
        eq(addenda.id, req.params.id),
        eq(addenda.organizationId, user.organizationId)
      ));
    if (!addendum) return res.status(404).json({ error: "Addendum not found" });

    const storageKey = addendum.storageKey || addendum.fileUrl;
    if (!storageKey) return res.status(404).json({ error: "No file associated with this addendum" });

    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const normalized = objectStorageService.normalizeObjectEntityPath(storageKey);
      const objectFile = await objectStorageService.getObjectEntityFile(normalized);

      // Defense-in-depth: enforce ACL on the underlying object before
      // streaming bytes so a forged/cross-tenant addendum row cannot leak
      // another org's file. Mirrors the Task #492 preview-url hardening.
      const allowed = await objectStorageService.canAccessObjectEntity({
        userId: user.id,
        userOrganizationId: user.organizationId,
        objectFile,
        requestedPermission: ObjectPermission.READ,
        userRole: user.effectiveRole || user.role,
      });
      if (!allowed) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await objectStorageService.downloadObject(objectFile, res, 3600);
    } catch (downloadErr) {
      logWarn("Non-critical operation failed");
      if (!res.headersSent) {
        next(downloadErr);
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
