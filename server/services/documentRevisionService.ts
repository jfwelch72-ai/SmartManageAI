import { db } from "../db";
import { documentRevisions, planDocuments, users } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { eventBus } from "../events/eventBus";
import type { DocumentRevisionCreatedEvent } from "../events/eventTypes";

export async function createRevision(
  orgId: string,
  documentId: string,
  sourceType: "upload" | "email" | "import" | "esign",
  storageKey: string,
  createdByUserId: string,
  metadata?: Record<string, any>,
  checksum?: string
) {
  const latestRevision = await db.select({ maxRev: sql<number>`coalesce(max(${documentRevisions.revisionNumber}), 0)` })
    .from(documentRevisions)
    .where(and(
      eq(documentRevisions.organizationId, orgId),
      eq(documentRevisions.documentId, documentId)
    ));

  const nextRevisionNumber = (latestRevision[0]?.maxRev || 0) + 1;

  const previousActive = await db.select().from(documentRevisions)
    .where(and(
      eq(documentRevisions.organizationId, orgId),
      eq(documentRevisions.documentId, documentId),
      eq(documentRevisions.status, "active")
    ));

  for (const prev of previousActive) {
    await db.update(documentRevisions)
      .set({ status: "superseded" as any })
      .where(eq(documentRevisions.id, prev.id));
  }

  const supersedesId = previousActive.length > 0 ? previousActive[previousActive.length - 1].id : null;

  const [revision] = await db.insert(documentRevisions).values({
    organizationId: orgId,
    documentId,
    revisionNumber: nextRevisionNumber,
    sourceType: sourceType as any,
    supersedesRevisionId: supersedesId,
    status: "active",
    storageKey,
    checksum: checksum || null,
    metadata: metadata || null,
    createdByUserId,
  }).returning();

  logInfo("Document revision created", { revisionId: revision.id, documentId, revisionNumber: nextRevisionNumber, orgId });

  try {
    const { projects } = await import("@shared/schema");
    const [doc] = await db.select({ title: planDocuments.title, projectId: planDocuments.projectId })
      .from(planDocuments)
      .where(eq(planDocuments.id, documentId))
      .limit(1);

    if (doc) {
      let uploaderName: string | null = null;
      let projectCode = "";

      const [userRow] = await db.select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, createdByUserId))
        .limit(1);
      if (userRow) {
        uploaderName = [userRow.firstName, userRow.lastName].filter(Boolean).join(" ") || null;
      }

      const [proj] = await db.select({ code: projects.code })
        .from(projects)
        .where(eq(projects.id, doc.projectId))
        .limit(1);
      if (proj) projectCode = proj.code;

      const event: DocumentRevisionCreatedEvent = {
        type: "document.revision_created",
        version: 1,
        orgId,
        actorId: createdByUserId,
        timestamp: new Date(),
        payload: {
          documentId,
          revisionId: revision.id,
          revisionNumber: nextRevisionNumber,
          projectId: doc.projectId,
          projectCode,
          documentTitle: doc.title,
          sourceType: sourceType,
          uploadedByUserId: createdByUserId,
          uploadedByName: uploaderName,
        },
      };
      await eventBus.emit(event);
    }
  } catch (err) {
    logError("Failed to emit document.revision_created event", { error: String(err), documentId });
  }

  return revision;
}

export async function getActiveRevision(orgId: string, documentId: string) {
  const [revision] = await db.select().from(documentRevisions)
    .where(and(
      eq(documentRevisions.organizationId, orgId),
      eq(documentRevisions.documentId, documentId),
      eq(documentRevisions.status, "active")
    ))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);
  return revision || null;
}

export async function getRevisionHistory(orgId: string, documentId: string) {
  return db.select().from(documentRevisions)
    .where(and(
      eq(documentRevisions.organizationId, orgId),
      eq(documentRevisions.documentId, documentId)
    ))
    .orderBy(desc(documentRevisions.revisionNumber));
}

export async function getRevisionById(orgId: string, revisionId: string) {
  const [revision] = await db.select().from(documentRevisions)
    .where(and(
      eq(documentRevisions.organizationId, orgId),
      eq(documentRevisions.id, revisionId)
    ));
  return revision || null;
}

export async function supersedeRevision(orgId: string, revisionId: string) {
  const [updated] = await db.update(documentRevisions)
    .set({ status: "superseded" as any })
    .where(and(
      eq(documentRevisions.id, revisionId),
      eq(documentRevisions.organizationId, orgId)
    ))
    .returning();
  
  if (updated) {
    logInfo("Document revision superseded", { revisionId, orgId });
  }
  return updated || null;
}

export async function compareRevisions(orgId: string, revisionId1: string, revisionId2: string) {
  const [rev1, rev2] = await Promise.all([
    getRevisionById(orgId, revisionId1),
    getRevisionById(orgId, revisionId2),
  ]);

  if (!rev1 || !rev2) return null;

  const meta1 = (rev1.metadata || {}) as Record<string, any>;
  const meta2 = (rev2.metadata || {}) as Record<string, any>;

  const fileSize1 = meta1.fileSize || meta1.size || null;
  const fileSize2 = meta2.fileSize || meta2.size || null;
  const fileName1 = meta1.fileName || meta1.name || null;
  const fileName2 = meta2.fileName || meta2.name || null;

  const timeBetween = rev1.createdAt && rev2.createdAt
    ? Math.abs(new Date(rev2.createdAt).getTime() - new Date(rev1.createdAt).getTime())
    : null;

  const changes: Array<{ field: string; from: any; to: any; type: "changed" | "added" | "removed" }> = [];

  if (rev1.sourceType !== rev2.sourceType) {
    changes.push({ field: "sourceType", from: rev1.sourceType, to: rev2.sourceType, type: "changed" });
  }
  if (rev1.status !== rev2.status) {
    changes.push({ field: "status", from: rev1.status, to: rev2.status, type: "changed" });
  }
  if (fileName1 !== fileName2) {
    changes.push({ field: "fileName", from: fileName1, to: fileName2, type: fileName1 && fileName2 ? "changed" : (fileName2 ? "added" : "removed") });
  }
  if (fileSize1 !== fileSize2) {
    changes.push({ field: "fileSize", from: fileSize1, to: fileSize2, type: "changed" });
  }
  if (rev1.createdByUserId !== rev2.createdByUserId) {
    changes.push({ field: "uploadedBy", from: rev1.createdByUserId, to: rev2.createdByUserId, type: "changed" });
  }
  if (rev1.storageKey !== rev2.storageKey) {
    changes.push({ field: "storageKey", from: rev1.storageKey, to: rev2.storageKey, type: "changed" });
  }

  const checksumMatch = rev1.checksum && rev2.checksum ? rev1.checksum === rev2.checksum : null;

  return {
    revision1: {
      id: rev1.id,
      revisionNumber: rev1.revisionNumber,
      sourceType: rev1.sourceType,
      status: rev1.status,
      createdAt: rev1.createdAt,
      checksum: rev1.checksum,
      storageKey: rev1.storageKey,
      createdByUserId: rev1.createdByUserId,
      metadata: rev1.metadata,
    },
    revision2: {
      id: rev2.id,
      revisionNumber: rev2.revisionNumber,
      sourceType: rev2.sourceType,
      status: rev2.status,
      createdAt: rev2.createdAt,
      checksum: rev2.checksum,
      storageKey: rev2.storageKey,
      createdByUserId: rev2.createdByUserId,
      metadata: rev2.metadata,
    },
    changes,
    checksumMatch,
    timeBetweenMs: timeBetween,
    fileSizeDelta: fileSize1 !== null && fileSize2 !== null ? fileSize2 - fileSize1 : null,
  };
}
