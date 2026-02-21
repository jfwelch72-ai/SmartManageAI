import { db } from "../db";
import { documentRevisions } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";

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

  return {
    revision1: {
      id: rev1.id,
      revisionNumber: rev1.revisionNumber,
      sourceType: rev1.sourceType,
      status: rev1.status,
      createdAt: rev1.createdAt,
      metadata: rev1.metadata,
    },
    revision2: {
      id: rev2.id,
      revisionNumber: rev2.revisionNumber,
      sourceType: rev2.sourceType,
      status: rev2.status,
      createdAt: rev2.createdAt,
      metadata: rev2.metadata,
    },
    note: "Full document comparison coming in a future update",
  };
}
