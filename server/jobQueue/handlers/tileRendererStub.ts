// Task #2757 — Gated `pdf_tile_prerender` renderer.
//
// Server-side tile rendering is not yet implemented (every existing
// rendering path runs in the client via `pdfTileWorker`). The
// `TILE_RENDERING_ENABLED` feature flag controls whether jobs are even
// dispatched — when OFF (the default) the enqueue sites skip the call
// entirely, so this handler should never be reached in normal operation.
//
// If a job does arrive (e.g. a legacy queue item from before the gate,
// or an org that had the flag flipped ON before a renderer shipped),
// this handler fails the job LOUDLY so it surfaces in the DLQ and
// admin UI rather than reporting a false-positive success. There is no
// silent "skipped: true" return here — that pattern hid the missing
// implementation from operators.

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { planDocuments } from "@shared/schema";
import { logWarn } from "../../utils/logger";
import { registerTileRenderer, type PdfTilePrerenderPayload } from "./pdfTilePrerender";
import type { JobContext } from "../index";

async function gatedRenderer(
  payload: PdfTilePrerenderPayload,
  ctx: JobContext,
): Promise<never> {
  const [doc] = await db
    .select({ id: planDocuments.id, title: planDocuments.title })
    .from(planDocuments)
    .where(eq(planDocuments.id, payload.planDocumentId))
    .limit(1);

  logWarn("pdf_tile_prerender: no server-side renderer is implemented yet", {
    planDocumentId: payload.planDocumentId,
    title: doc?.title ?? "(not found)",
    jobId: ctx.jobId,
    hint: "Set TILE_RENDERING_ENABLED=false to prevent further dispatches, or implement a real renderer and call registerTileRenderer() at boot.",
  });

  throw new Error(
    `pdf_tile_prerender: server-side tile rendering is not implemented. ` +
    `Ensure TILE_RENDERING_ENABLED feature flag is OFF to stop dispatching these jobs. ` +
    `planDocumentId=${payload.planDocumentId}`,
  );
}

export function registerGatedTileRenderer(): void {
  registerTileRenderer(gatedRenderer);
}

/**
 * Task #2761 — test-only hook that exposes the internal `gatedRenderer`
 * function so unit tests can assert it throws without going through the
 * full pg-boss job dispatch pipeline.
 *
 * @internal Not for production use.
 */
export const __testHooks = {
  gatedRenderer,
} as const;
