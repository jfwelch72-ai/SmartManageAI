// Task #2576 — Background plan-set ingest job.
//
// Reads PDF page count via `getPdfPageCountFromGcs`, splits into one
// `takeoffSheets` row per page (no silent caps — 32 GB plan sets and
// 4-figure page counts are supported), reports progress through the
// shared `ctx.progress` channel and returns `{ sheetIds, pageCount }`
// to the caller.
//
// The HTTP route enqueues this job and returns immediately with a
// `jobId`; the client polls `/api/jobs/:id` for progress and final
// status. The legacy synchronous code path is preserved on the
// existing endpoints (see `server/takeoffSheetRoutes.ts`).

import { defineJob, type JobContext } from "../index";
import { db } from "../../db";
import { takeoffSheets, bidDocuments, bids } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getPdfPageCountFromGcs } from "../../utils/pdfPageCount";
import { logError, logInfo } from "../../utils/logger";

export interface PlanSetIngestJobPayload {
  organizationId: string;
  userId: string | null;
  bidId: string;
  // Either a bid document we already know about...
  bidDocumentId?: string;
  // ...or a direct upload (fileUrl + fileName + objectKey).
  fileUrl?: string;
  fileName?: string;
  objectKey?: string;
  baseSheetName?: string;
}

export interface PlanSetIngestResult {
  sheetIds: string[];
  pageCount: number;
}

const PROGRESS_CHUNK = 250; // emit progress every N sheets while inserting.

export function registerPlanSetIngestJob(): void {
  defineJob<PlanSetIngestJobPayload>(
    "plan_set_ingest",
    async (payload, ctx: JobContext): Promise<PlanSetIngestResult> => {
      await ctx.progress(2, "Verifying bid", { bidId: payload.bidId });

      const [bid] = await db
        .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
        .from(bids)
        .where(eq(bids.id, payload.bidId))
        .limit(1);
      if (!bid) throw new Error(`bid_not_found:${payload.bidId}`);
      if (bid.gcOrganizationId !== payload.organizationId) {
        throw new Error("bid_org_mismatch");
      }

      let fileUrl = payload.fileUrl ?? null;
      let fileName = payload.fileName ?? null;
      let objectKey = payload.objectKey ?? null;

      if (payload.bidDocumentId) {
        const [doc] = await db
          .select()
          .from(bidDocuments)
          .where(and(eq(bidDocuments.id, payload.bidDocumentId), eq(bidDocuments.bidId, payload.bidId)))
          .limit(1);
        if (!doc) throw new Error(`bid_document_not_found:${payload.bidDocumentId}`);
        fileUrl = doc.fileUrl;
        fileName = doc.fileName;
        objectKey = doc.objectKey;
      }
      if (!fileUrl || !fileName) throw new Error("plan_set_ingest_missing_file");

      await ctx.progress(10, "Resolving plan file in object storage");
      const { ObjectStorageService, objectStorageClient } = await import("../../objectStorage");
      const objectStorageService = new ObjectStorageService();

      let gcsFile = null;
      if (objectKey) {
        try { gcsFile = await objectStorageService.getObjectEntityFile(objectKey); } catch { /* fall through */ }
      }
      if (!gcsFile && fileUrl.startsWith("https://storage.googleapis.com/")) {
        try {
          const url = new URL(fileUrl);
          const parts = url.pathname.split("/").filter(Boolean);
          if (parts.length >= 2) {
            gcsFile = objectStorageClient.bucket(parts[0]).file(parts.slice(1).join("/"));
            const [exists] = await gcsFile.exists();
            if (!exists) gcsFile = null;
          }
        } catch { /* leave gcsFile null */ }
      }
      if (!gcsFile) {
        try { gcsFile = await objectStorageService.getObjectEntityFile(fileUrl); } catch { /* leave null */ }
      }

      if (!gcsFile) {
        // No silent fallback: if we cannot resolve the file in GCS we
        // cannot tell how many sheets to create. Fail the job so it can
        // be retried (e.g. after eventual-consistency settles) rather
        // than silently inserting a single placeholder sheet.
        throw new Error(`plan_set_ingest_file_not_found:${fileUrl}`);
      }

      await ctx.progress(20, "Reading PDF page count");
      let pageCount: number;
      try {
        const [metadata] = await gcsFile.getMetadata();
        const fileSize = parseInt(metadata.size as string) || 0;
        const detected = await getPdfPageCountFromGcs(gcsFile, {
          fileSize,
          fileName: fileName,
          loggerContext: { route: "job:plan_set_ingest", bidId: payload.bidId },
        });
        if (!detected || detected <= 0) {
          throw new Error("plan_set_ingest_page_count_unresolved");
        }
        pageCount = detected;
      } catch (err) {
        // Surface as a job failure so pg-boss retries with backoff
        // instead of silently truncating a 5,000-page plan set to 1.
        logError(
          "plan_set_ingest: page count failed (will retry)",
          { bidId: payload.bidId },
          err instanceof Error ? err : new Error(String(err)),
        );
        throw err instanceof Error ? err : new Error(String(err));
      }

      await ctx.progress(40, `Detected ${pageCount} sheet${pageCount === 1 ? "" : "s"}`, { pageCount });

      // Idempotency: pg-boss may retry this job after a partial failure
      // (e.g. transient DB error mid-chunk). To guarantee "one sheet
      // per page" regardless of retry count, we delete any sheets we
      // previously inserted for THIS bid + plan file before
      // re-inserting. Other sheets on the bid (different plan
      // documents) are untouched. The (bidId, imageUrl) tuple is the
      // job key — every attempt for the same payload converges to the
      // same final row set.
      await db
        .delete(takeoffSheets)
        .where(and(eq(takeoffSheets.bidId, payload.bidId), eq(takeoffSheets.imageUrl, fileUrl)));

      const baseSheetName = payload.baseSheetName ?? fileName.replace(/\.[^/.]+$/, "");
      // Insert in chunks so a 5,000-page plan set doesn't ship a single
      // gigantic INSERT; emit progress between chunks for live UI.
      const sheetIds: string[] = [];
      const CHUNK = 500;
      for (let start = 0; start < pageCount; start += CHUNK) {
        const end = Math.min(start + CHUNK, pageCount);
        const values = [];
        for (let i = start; i < end; i++) {
          values.push({
            bidId: payload.bidId,
            imageUrl: fileUrl,
            sheetIndex: i,
            sheetName: pageCount > 1 ? `${baseSheetName} - Page ${i + 1}` : baseSheetName,
          });
        }
        const inserted = await db
          .insert(takeoffSheets)
          .values(values)
          .returning({ id: takeoffSheets.id });
        for (const r of inserted) sheetIds.push(r.id);
        const pct = 40 + Math.floor(((end / pageCount) * 55));
        if (end % PROGRESS_CHUNK === 0 || end === pageCount) {
          await ctx.progress(pct, `Inserted ${end} of ${pageCount} sheets`, { inserted: end, total: pageCount });
        }
      }

      await ctx.progress(98, "Plan set ingest complete", { pageCount, sheetCount: sheetIds.length });
      logInfo("plan_set_ingest finished", {
        bidId: payload.bidId,
        pageCount,
        sheetCount: sheetIds.length,
      });
      return { sheetIds, pageCount };
    },
    { perTenantConcurrency: 1 },
  );
}
