// Task #2517 — Default `pdf_tile_prerender` renderer.
//
// Server-side tile rendering is not implemented yet (every existing
// rendering path runs in the client via `pdfTileWorker`). The job
// handler in `pdfTilePrerender.ts` fails loudly when no renderer is
// registered, which would DLQ a job for every plan-document upload
// once the call sites start enqueueing.
//
// Until a real renderer ships, register a no-op-but-verifies stub:
// resolve the plan document row to confirm the upload is real, then
// log a structured "would render N pages" message. The job succeeds
// so the queue path is exercised end-to-end without lying about real
// tile work.

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { planDocuments } from "@shared/schema";
import { logInfo, logWarn } from "../../utils/logger";
import { registerTileRenderer, type PdfTilePrerenderPayload } from "./pdfTilePrerender";
import type { JobContext } from "../index";

async function stubRenderer(
  payload: PdfTilePrerenderPayload,
  ctx: JobContext,
): Promise<{ skipped: true; reason: string; planDocumentId: string }> {
  try {
    const [doc] = await db
      .select({
        id: planDocuments.id,
        title: planDocuments.title,
        fileSize: planDocuments.fileSize,
      })
      .from(planDocuments)
      .where(eq(planDocuments.id, payload.planDocumentId))
      .limit(1);
    if (!doc) {
      logWarn("pdf_tile_prerender stub: plan document not found", {
        planDocumentId: payload.planDocumentId,
        jobId: ctx.jobId,
      });
      return {
        skipped: true,
        reason: "plan document not found (likely deleted before render)",
        planDocumentId: payload.planDocumentId,
      };
    }
    logInfo("pdf_tile_prerender stub: would prerender plan", {
      planDocumentId: doc.id,
      title: doc.title,
      fileSize: doc.fileSize,
      jobId: ctx.jobId,
    });
    return {
      skipped: true,
      reason: "no server-side renderer wired yet (stub)",
      planDocumentId: doc.id,
    };
  } catch (err) {
    logWarn("pdf_tile_prerender stub: lookup failed", {
      planDocumentId: payload.planDocumentId,
      error: String(err),
    });
    throw err;
  }
}

export function registerStubTileRenderer(): void {
  registerTileRenderer(stubRenderer);
}
