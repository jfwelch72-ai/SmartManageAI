/**
 * Task #1493 — One-shot backfill: synthesize CREATE audit_log rows for
 * past `plan_documents` imported via POST /api/documents/from-url and
 * POST /api/documents/from-cloud, which silently failed to write their
 * audit row prior to the circular-JSON fix in Task #1454.
 *
 * Selection: `plan_documents` rows where `file_url = object_key` (the
 * fingerprint both import routes share — they store the objectKey in
 * fileUrl after persisting the download). The regular POST /api/documents
 * upload route stores the client-supplied upload URL in fileUrl (which
 * differs from objectKey), so it is naturally excluded. We additionally
 * exclude rows linked to a `stackct_plan_*` entry in `integration_sync_state`
 * so the STACK CT cloud sync (a separate ingestion path with its own
 * audit gap) is not retroactively backfilled by this script.
 *
 * Idempotent: each candidate is skipped when a CREATE audit row for
 * (entityType="plan_document", entityId=doc.id) already exists.
 *
 * Usage:
 *   npx tsx scripts/backfill-cloud-document-audit.ts            # apply
 *   npx tsx scripts/backfill-cloud-document-audit.ts --dry-run  # preview
 */

import { and, eq, like, notInArray, sql } from "drizzle-orm";
import { db } from "../server/db";
import { auditLog, integrationSyncState, planDocuments } from "@shared/schema";

interface BackfillResult {
  scanned: number;
  inserted: number;
  alreadyAudited: number;
  skippedNoUploader: number;
}

export async function backfillCloudDocumentAudit(opts: { dryRun?: boolean } = {}): Promise<BackfillResult> {
  const dryRun = opts.dryRun === true;

  const stackctRows = await db
    .select({ metadata: integrationSyncState.metadata })
    .from(integrationSyncState)
    .where(like(integrationSyncState.entityType, "stackct_plan_%"));

  const stackctDocIds = stackctRows
    .map((r) => (r.metadata as { localDocId?: unknown } | null)?.localDocId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const candidates = await db
    .select({
      id: planDocuments.id,
      uploadedById: planDocuments.uploadedById,
      uploadedAt: planDocuments.uploadedAt,
      title: planDocuments.title,
      projectId: planDocuments.projectId,
      organizationId: planDocuments.organizationId,
      fileSize: planDocuments.fileSize,
      mimeType: planDocuments.mimeType,
    })
    .from(planDocuments)
    .where(
      and(
        sql`${planDocuments.objectKey} IS NOT NULL`,
        eq(planDocuments.fileUrl, planDocuments.objectKey),
        stackctDocIds.length > 0
          ? notInArray(planDocuments.id, stackctDocIds)
          : undefined,
      ),
    );

  const result: BackfillResult = {
    scanned: candidates.length,
    inserted: 0,
    alreadyAudited: 0,
    skippedNoUploader: 0,
  };

  for (const doc of candidates) {
    if (!doc.uploadedById) {
      result.skippedNoUploader += 1;
      continue;
    }

    const existing = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "plan_document"),
          eq(auditLog.entityId, doc.id),
          eq(auditLog.action, "CREATE"),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      result.alreadyAudited += 1;
      continue;
    }

    if (dryRun) {
      result.inserted += 1;
      continue;
    }

    await db.insert(auditLog).values({
      userId: doc.uploadedById,
      entityType: "plan_document",
      entityId: doc.id,
      action: "CREATE",
      oldValue: null,
      newValue: JSON.stringify({
        backfilled: true,
        backfillReason: "task-1493:cloud-import-audit-gap",
        title: doc.title,
        projectId: doc.projectId,
        organizationId: doc.organizationId,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
      }),
      ipAddress: null,
      userAgent: null,
      createdAt: doc.uploadedAt,
    });

    result.inserted += 1;
  }

  return result;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[backfill-cloud-document-audit] Starting${dryRun ? " (dry-run)" : ""}…`);
  const t0 = Date.now();
  const r = await backfillCloudDocumentAudit({ dryRun });
  const ms = Date.now() - t0;
  console.log(
    `[backfill-cloud-document-audit] Done in ${ms}ms — scanned=${r.scanned} inserted=${r.inserted} alreadyAudited=${r.alreadyAudited} skippedNoUploader=${r.skippedNoUploader}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-cloud-document-audit] FAILED", err);
    process.exit(1);
  });
