// Task #2481 — PDF tile prerender handler.
//
// Registered as a delegation seam for the existing client-driven tile
// rendering path. Real renderer services register themselves via
// `registerTileRenderer(fn)` at boot. Until a renderer is registered,
// the handler fails the job loudly so it surfaces in the DLQ and
// admin UI rather than silently succeeding.

import { defineJob, type JobContext } from "../index";
import { logInfo } from "../../utils/logger";

export interface PdfTilePrerenderPayload {
  planDocumentId: string;
  sheetId?: string;
  zoom?: number;
}

export type TileRendererFn = (
  payload: PdfTilePrerenderPayload,
  ctx: JobContext,
) => Promise<unknown>;

let registeredRenderer: TileRendererFn | null = null;

/**
 * Register the real tile-renderer implementation. Called from the
 * service module's side-effect import (kept out of this file to avoid
 * pulling Sharp/PDFKit/etc. into HTTP-only pods).
 */
export function registerTileRenderer(fn: TileRendererFn): void {
  registeredRenderer = fn;
}

export function registerPdfTilePrerenderJob(): void {
  defineJob<PdfTilePrerenderPayload>(
    "pdf_tile_prerender",
    async (payload, ctx: JobContext) => {
      await ctx.progress(10, "Resolving plan document");
      if (!registeredRenderer) {
        // Fail loudly so the missing renderer is visible in DLQ/admin
        // rather than reporting false success.
        const err = new Error(
          "pdf_tile_prerender: no renderer registered (call registerTileRenderer at boot)",
        );
        logInfo("pdf_tile_prerender failing — renderer not registered", {
          planDocumentId: payload.planDocumentId,
        });
        throw err;
      }
      // Task #2535 — emit intermediate phases so any UI subscribed to the
      // job id sees the bar advance through the render pipeline. The
      // renderer itself receives `ctx` and may emit finer-grained
      // progress that overrides these defaults.
      await ctx.progress(25, "Downloading PDF pages");
      await ctx.progress(40, `Rendering tiles${payload.zoom ? ` @ zoom ${payload.zoom}` : ""}`);
      const result = await registeredRenderer(payload, ctx);
      await ctx.progress(90, "Uploading tiles to storage");
      await ctx.progress(100, "Tiles ready");
      return result;
    },
    { perTenantConcurrency: 2 },
  );
}
