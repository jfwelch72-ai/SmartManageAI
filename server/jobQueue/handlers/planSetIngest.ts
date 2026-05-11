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
import { eq, and, sql } from "drizzle-orm";
import { getPdfPageCountFromGcs } from "../../utils/pdfPageCount";
import { logError, logInfo, logWarn } from "../../utils/logger";


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

      // Task #2780 — Physical per-page PDF splitting.
      // Every PDF plan set (any size, any page count) is split into one single-page
      // PDF per sheet in GCS. This means each takeoff_sheets row points to its own
      // dedicated object — no shared parent + sheetIndex approach. The takeoff viewer
      // therefore only downloads the bytes for the page it needs.
      //
      // If splitting fails for any reason (e.g. an encrypted PDF, a corrupt file, or
      // an out-of-memory condition for an extremely large file), the job falls back to
      // the legacy sheetIndex-based approach and logs a warning. The caller should
      // treat a fallback as a degraded-mode success, not a hard failure.
      let splitPageUrls: Map<number, string> | null = null;
      const splitBase = gcsFile.name.replace(/\.pdf$/i, "");
      const isPdf = fileName?.toLowerCase().endsWith(".pdf") ?? false;

      if (isPdf && pageCount >= 1) {
        try {
          await ctx.progress(42, "Splitting PDF into per-page files (this may take a moment)", { pageCount });
          const { PDFDocument } = await import("pdf-lib");

          const pdfBytes: Buffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            const stream = gcsFile.createReadStream();
            stream.on("data", (c: Buffer) => chunks.push(c));
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
          });

          const srcPdf = await PDFDocument.load(pdfBytes);
          const srcBucket = gcsFile.bucket;
          splitPageUrls = new Map<number, string>();

          for (let i = 0; i < pageCount; i++) {
            const pagePdf = await PDFDocument.create();
            const [page] = await pagePdf.copyPages(srcPdf, [i]);
            pagePdf.addPage(page);
            const pageBytes = await pagePdf.save();
            const pageKey = `${splitBase}_split_page_${i}.pdf`;
            await srcBucket.file(pageKey).save(Buffer.from(pageBytes), { contentType: "application/pdf" });
            const pageUrl = `https://storage.googleapis.com/${srcBucket.name}/${pageKey}`;
            splitPageUrls.set(i, pageUrl);
            // Emit progress every 10 pages during the split loop for large plan sets.
            if (pageCount > 10 && i > 0 && i % 10 === 0) {
              const splitPct = 42 + Math.floor((i / pageCount) * 20);
              await ctx.progress(splitPct, `Split ${i} of ${pageCount} pages`, { splitPage: i, total: pageCount });
            }
          }

          logInfo("plan_set_ingest: PDF split complete", {
            bidId: payload.bidId,
            pages: pageCount,
          });
        } catch (splitErr) {
          logWarn("plan_set_ingest: PDF split failed — falling back to sheetIndex mode", {
            bidId: payload.bidId,
            error: splitErr instanceof Error ? splitErr.message : String(splitErr),
          });
          splitPageUrls = null;
        }
      }

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
      // Always remove any previously-split per-page sheets by URL prefix so
      // re-runs start clean regardless of whether the prior attempt split or not.
      // This handles the retry case where a previous attempt succeeded (split URLs
      // exist) but the current attempt's split failed (splitPageUrls = null).
      //
      // Use LEFT() prefix comparison to avoid LIKE wildcard semantics entirely.
      // Every split page URL is `<bucketRoot>/<splitBase>_split_page_<N>.pdf`;
      // the shared prefix is everything up to and including "_split_page_".
      // LEFT(image_url, N) = prefix is a plain string equality — underscores and
      // percent-signs in the path are never interpreted as pattern wildcards.
      const splitUrlPrefix = `https://storage.googleapis.com/${gcsFile.bucket.name}/${splitBase}_split_page_`;
      await db.execute(
        sql`DELETE FROM takeoff_sheets WHERE bid_id = ${payload.bidId} AND LEFT(image_url, ${splitUrlPrefix.length}) = ${splitUrlPrefix}`
      );

      const baseSheetName = payload.baseSheetName ?? fileName.replace(/\.[^/.]+$/, "");
      // Insert in chunks so a 5,000-page plan set doesn't ship a single
      // gigantic INSERT; emit progress between chunks for live UI.
      const sheetIds: string[] = [];
      const CHUNK = 500;
      for (let start = 0; start < pageCount; start += CHUNK) {
        const end = Math.min(start + CHUNK, pageCount);
        const values = [];
        for (let i = start; i < end; i++) {
          // When physically split, each sheet gets its own single-page PDF URL
          // and a sheetIndex of 0 (the only page). Otherwise, all sheets
          // share the parent PDF URL and differentiate via sheetIndex.
          const imageUrl = splitPageUrls?.get(i) ?? fileUrl;
          const sheetIndex = splitPageUrls ? 0 : i;
          values.push({
            bidId: payload.bidId,
            imageUrl,
            sheetIndex,
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

      // Task #2577 — Cache per-page text on the new sheets so downstream
      // AI estimator passes (sheet indexer, map-reduce drafter, schedule
      // symbol extractor) don't have to re-download the PDF and re-run
      // pdfjs/OCR. Best-effort: failures are logged and swallowed so the
      // ingest job still reports success.
      try {
        await ctx.progress(96, "Caching plan-sheet text (OCR fallback)", { pageCount });
        const { cachePageTextOnSheets } = await import("../../services/aiEstimator/mapReduceDraft");
        const cacheResult = await cachePageTextOnSheets({
          organizationId: payload.organizationId,
          bidId: payload.bidId,
        });
        logInfo("plan_set_ingest text cache complete", {
          bidId: payload.bidId,
          updatedSheets: cacheResult.updatedSheets,
          pagesOcr: cacheResult.pagesOcr,
          ocrProviderId: cacheResult.ocrProviderId,
        });
      } catch (cacheErr) {
        logError("plan_set_ingest text cache failed (non-fatal)", { bidId: payload.bidId }, cacheErr instanceof Error ? cacheErr : new Error(String(cacheErr)));
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
