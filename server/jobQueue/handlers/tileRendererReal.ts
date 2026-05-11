// Task #2760 — Real server-side PDF tile pre-renderer.
//
// Replaces tileRendererStub.ts. When TILE_RENDERING_ENABLED is ON the job
// queue dispatches a `pdf_tile_prerender` job after each plan-document upload.
// This handler:
//   1. Looks up the plan document (objectKey + organizationId).
//   2. Downloads the PDF bytes from GCS via objectStorageClient.
//   3. Renders each targeted sheet page with pdfjs-dist (Node.js legacy build)
//      + the `canvas` npm package — the same rendering math the client
//      pdfTileWorker uses so tiles composite seamlessly with client-side ones.
//   4. Carves the rendered page into TILE_SIZE_PX × TILE_SIZE_PX PNG tiles and
//      uploads them to GCS under the tenant-prefixed tile path.
//   5. Stamps takeoff_sheets.tileStatus = 'READY' / 'FAILED' and records the
//      storage prefix so the client can opt into the pre-rendered path.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { planDocuments, projectPlans, takeoffSheets } from "@shared/schema";
import { objectStorageClient, parseObjectPath } from "../../objectStorage";
import { createCanvas } from "canvas";
import { logInfo, logWarn, logError } from "../../utils/logger";
import { registerTileRenderer, type PdfTilePrerenderPayload } from "./pdfTilePrerender";
import type { JobContext } from "../index";

// ─── Tile geometry constants (must match client pdfTileWorker / tileCoords.ts) ─

const TILE_SIZE_PX = 512;
const BASE_RENDER_SCALE = 1.5;

// Zoom levels pre-rendered when the job doesn't pin a single zoom.
// Zoom 2 and 4 are intentionally excluded: they produce very large canvases
// (up to ~10k×7k px) for civil plan-sets and are better left to the client
// on demand. Zoom 0.25 / 0.5 / 1 are the initial-load "fast-path" tiles.
const DEFAULT_ZOOM_BUCKETS: number[] = [0.25, 0.5, 1];

// Safety cap: skip a zoom level if the rendered canvas would exceed this many
// pixels on either axis — guards against OOM on a worker pod processing a
// multi-hundred-page, large-format civil plan set.
const MAX_CANVAS_AXIS_PX = 6144;

// ─── NodeCanvasFactory ────────────────────────────────────────────────────────
// Mirrors the WorkerCanvasFactory in pdfTileWorker.ts but uses the node-canvas
// `createCanvas` so pdfjs-dist can render to a Buffer in a Node.js process.
// The `any` type annotations match the interface pdfjs-dist's getDocument()
// expects for a custom CanvasFactory.

/* eslint-disable @typescript-eslint/no-explicit-any */
class NodeCanvasFactory {
  create(width: number, height: number): { canvas: any; context: any } {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    const canvas = createCanvas(w, h);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(pair: { canvas: any; context: any }, width: number, height: number): void {
    if (!pair.canvas) throw new Error("Canvas is not specified");
    pair.canvas.width = Math.max(1, Math.ceil(width));
    pair.canvas.height = Math.max(1, Math.ceil(height));
  }

  destroy(pair: { canvas: any; context: any }): void {
    if (pair.canvas) {
      pair.canvas.width = 0;
      pair.canvas.height = 0;
      pair.canvas = null;
    }
    pair.context = null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── GCS helpers ─────────────────────────────────────────────────────────────

async function downloadPdfBytes(objectKey: string): Promise<Buffer> {
  const { bucketName, objectName } = parseObjectPath(objectKey);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const [buffer] = await file.download();
  return buffer;
}

/**
 * Resolve an objectKey from a plan document's stored fields.
 *
 * Priority:
 *   1. `objectKey` — the normalised `/bucket/path` written by the upload flow.
 *   2. `fileUrl`   — bare GCS HTTPS URL for legacy rows uploaded before
 *                    objectKey was introduced; parse out bucket + path.
 */
function resolveObjectKey(
  objectKey: string | null | undefined,
  fileUrl: string,
): string | null {
  if (objectKey && objectKey.trim().length > 0) return objectKey;
  const m = /^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/.exec(fileUrl);
  if (m) return `/${m[1]}/${m[2]}`;
  return null;
}

async function uploadTilePng(
  orgId: string,
  planDocumentId: string,
  sheetIndex: number,
  zoom: number,
  tileX: number,
  tileY: number,
  pngBuffer: Buffer,
): Promise<void> {
  const privateDir = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/\/$/, "");
  if (!privateDir) {
    throw new Error("PRIVATE_OBJECT_DIR is not set — cannot upload tiles");
  }
  const key = `${privateDir}/${orgId}/tiles/${planDocumentId}/z${zoom}/p${sheetIndex}/${tileX}_${tileY}.png`;
  const { bucketName, objectName } = parseObjectPath(key);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(pngBuffer, { contentType: "image/png", resumable: false });
}

function buildTileStoragePrefix(orgId: string, planDocumentId: string): string {
  const privateDir = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/\/$/, "");
  return `${privateDir}/${orgId}/tiles/${planDocumentId}/`;
}

// ─── Per-page tile rendering ──────────────────────────────────────────────────

/**
 * Render a single PDF page at the given zoom bucket and carve it into
 * TILE_SIZE_PX × TILE_SIZE_PX PNG tiles, uploading each to GCS.
 *
 * Returns the number of tiles uploaded (0 if canvas would be too large).
 */
async function renderPageToTiles(
  // pdfjs-dist uses `any`-typed API in Node.js — keep `any` here to avoid
  // import side-effects that differ between the browser and Node.js builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any,
  pageNumber: number,
  zoom: number,
  orgId: string,
  planDocumentId: string,
  canvasFactory: NodeCanvasFactory,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await pdfDoc.getPage(pageNumber);
  try {
    const baseViewport = page.getViewport({ scale: BASE_RENDER_SCALE });
    const renderScale = BASE_RENDER_SCALE * zoom;
    const viewport = page.getViewport({ scale: renderScale });

    const pageW = Math.max(1, Math.round(viewport.width));
    const pageH = Math.max(1, Math.round(viewport.height));

    if (pageW > MAX_CANVAS_AXIS_PX || pageH > MAX_CANVAS_AXIS_PX) {
      logWarn("[tileRenderer] page canvas exceeds safety cap at this zoom — skipping", {
        pageNumber,
        zoom,
        pageW,
        pageH,
        MAX_CANVAS_AXIS_PX,
        planDocumentId,
      });
      return 0;
    }

    // Render the full page once at this zoom level.
    const pageCanvas = createCanvas(pageW, pageH);
    const pageCtx = pageCanvas.getContext("2d");
    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageW, pageH);

    await page.render({
      canvasContext: pageCtx,
      viewport,
      canvasFactory,
    }).promise;

    // Carve into TILE_SIZE_PX × TILE_SIZE_PX tiles.
    const tileWorld = TILE_SIZE_PX / zoom;
    const cols = Math.max(1, Math.ceil(baseViewport.width / tileWorld));
    const rows = Math.max(1, Math.ceil(baseViewport.height / tileWorld));
    let uploaded = 0;

    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const worldX = tx * tileWorld;
        const worldY = ty * tileWorld;
        if (worldX >= baseViewport.width || worldY >= baseViewport.height) continue;

        const cropX = Math.floor(worldX * zoom);
        const cropY = Math.floor(worldY * zoom);
        const cropW = Math.min(TILE_SIZE_PX, pageW - cropX);
        const cropH = Math.min(TILE_SIZE_PX, pageH - cropY);

        const tileCanvas = createCanvas(TILE_SIZE_PX, TILE_SIZE_PX);
        const tileCtx = tileCanvas.getContext("2d");
        tileCtx.fillStyle = "#ffffff";
        tileCtx.fillRect(0, 0, TILE_SIZE_PX, TILE_SIZE_PX);
        if (cropW > 0 && cropH > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tileCtx.drawImage(pageCanvas as any, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        }

        const pngBuffer = tileCanvas.toBuffer("image/png");
        // sheetIndex is 0-based; pageNumber is 1-based.
        await uploadTilePng(orgId, planDocumentId, pageNumber - 1, zoom, tx, ty, pngBuffer);
        uploaded++;
      }
    }

    return uploaded;
  } finally {
    page.cleanup();
  }
}

// ─── Main renderer function ───────────────────────────────────────────────────

async function realTileRenderer(
  payload: PdfTilePrerenderPayload,
  ctx: JobContext,
): Promise<{ planDocumentId: string; sheetsRendered: number; tilesUploaded: number }> {
  const { planDocumentId, sheetId, zoom } = payload;

  // 1. Resolve plan document → objectKey + org.
  await ctx.progress(15, "Loading plan document");
  const [doc] = await db
    .select({
      id: planDocuments.id,
      title: planDocuments.title,
      objectKey: planDocuments.objectKey,
      fileUrl: planDocuments.fileUrl,
      organizationId: planDocuments.organizationId,
    })
    .from(planDocuments)
    .where(eq(planDocuments.id, planDocumentId))
    .limit(1);

  if (!doc) {
    throw new Error(`pdf_tile_prerender: planDocument ${planDocumentId} not found`);
  }

  const resolvedKey = resolveObjectKey(doc.objectKey, doc.fileUrl);
  if (!resolvedKey) {
    throw new Error(
      `pdf_tile_prerender: cannot resolve GCS key for planDocument ${planDocumentId} (fileUrl=${doc.fileUrl})`,
    );
  }

  const orgId = doc.organizationId;
  if (!orgId) {
    throw new Error(
      `pdf_tile_prerender: planDocument ${planDocumentId} has no organizationId`,
    );
  }

  // 2. Find the sheets to render.
  await ctx.progress(20, "Resolving sheets");
  let sheets: Array<{ id: string; sheetIndex: number }>;

  if (sheetId) {
    // Single sheet targeted by the payload.
    // Join against projectPlans and filter by projectPlans.documentId to verify
    // the sheet actually belongs to this planDocument (and therefore this org).
    // A mismatched payload would otherwise stamp an unrelated row and corrupt
    // its tileStatus — this is the authoritative integrity check.
    sheets = await db
      .select({ id: takeoffSheets.id, sheetIndex: takeoffSheets.sheetIndex })
      .from(takeoffSheets)
      .innerJoin(projectPlans, eq(projectPlans.id, takeoffSheets.planId))
      .where(
        and(
          eq(takeoffSheets.id, sheetId),
          eq(projectPlans.documentId, planDocumentId),
        ),
      );

    if (sheets.length === 0) {
      // The sheetId doesn't belong to any plan under this planDocument or
      // doesn't exist at all — fail fast instead of silently no-op'ing.
      throw new Error(
        `pdf_tile_prerender: sheetId ${sheetId} not found or does not belong to planDocument ${planDocumentId}`,
      );
    }
  } else {
    // All sheets belonging to projectPlans that reference this planDocument.
    const planRows = await db
      .select({ id: projectPlans.id })
      .from(projectPlans)
      .where(eq(projectPlans.documentId, planDocumentId));

    const planIds = planRows.map((r) => r.id);
    if (planIds.length === 0) {
      logWarn("[tileRenderer] no projectPlans found for planDocument, nothing to render", {
        planDocumentId,
      });
      return { planDocumentId, sheetsRendered: 0, tilesUploaded: 0 };
    }

    sheets = await db
      .select({ id: takeoffSheets.id, sheetIndex: takeoffSheets.sheetIndex })
      .from(takeoffSheets)
      .where(
        planIds.length === 1
          ? eq(takeoffSheets.planId, planIds[0])
          : inArray(takeoffSheets.planId, planIds),
      );
  }

  if (sheets.length === 0) {
    logWarn("[tileRenderer] no takeoff_sheets found", { planDocumentId, sheetId });
    return { planDocumentId, sheetsRendered: 0, tilesUploaded: 0 };
  }

  // 3. Mark all targeted sheets as RENDERING.
  const sheetIds = sheets.map((s) => s.id);
  await db
    .update(takeoffSheets)
    .set({ tileStatus: "RENDERING" })
    .where(
      sheetIds.length === 1
        ? eq(takeoffSheets.id, sheetIds[0])
        : inArray(takeoffSheets.id, sheetIds),
    );

  // 4. Download PDF bytes.
  await ctx.progress(30, "Downloading PDF from storage");
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await downloadPdfBytes(resolvedKey);
  } catch (err) {
    logError(
      "[tileRenderer] failed to download PDF",
      { planDocumentId, resolvedKey },
      err instanceof Error ? err : new Error(String(err)),
    );
    await db
      .update(takeoffSheets)
      .set({ tileStatus: "FAILED" })
      .where(
        sheetIds.length === 1
          ? eq(takeoffSheets.id, sheetIds[0])
          : inArray(takeoffSheets.id, sheetIds),
      );
    throw err;
  }

  // 5. Load PDF with pdfjs-dist (Node.js legacy build — same import path as
  //    documentExtractor.ts, which already uses this build successfully).
  //
  //    Wrap from this point onward in a top-level try/catch so that any fatal
  //    error (bad/encrypted PDF, pdfjs internal throw, OOM, unexpected rejection)
  //    guarantees all sheets are stamped FAILED rather than left stuck in
  //    RENDERING indefinitely.
  await ctx.progress(40, "Parsing PDF");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfjsLib: any;
  try {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (importErr) {
    // pdfjs-dist import itself failed (e.g. native addon issue). Mark FAILED.
    logError(
      "[tileRenderer] failed to import pdfjs-dist",
      { planDocumentId },
      importErr instanceof Error ? importErr : new Error(String(importErr)),
    );
    await db
      .update(takeoffSheets)
      .set({ tileStatus: "FAILED" })
      .where(
        sheetIds.length === 1
          ? eq(takeoffSheets.id, sheetIds[0])
          : inArray(takeoffSheets.id, sheetIds),
      );
    throw importErr;
  }

  const canvasFactory = new NodeCanvasFactory();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfDoc: any;
  try {
    pdfDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      canvasFactory,
    }).promise;
  } catch (parseErr) {
    // Bad/encrypted/corrupt PDF — mark every targeted sheet FAILED.
    logError(
      "[tileRenderer] pdfjs failed to parse PDF",
      { planDocumentId, resolvedKey },
      parseErr instanceof Error ? parseErr : new Error(String(parseErr)),
    );
    await db
      .update(takeoffSheets)
      .set({ tileStatus: "FAILED" })
      .where(
        sheetIds.length === 1
          ? eq(takeoffSheets.id, sheetIds[0])
          : inArray(takeoffSheets.id, sheetIds),
      );
    throw parseErr;
  }

  // 6. Render tiles for each sheet.
  const zoomBuckets: number[] = zoom != null ? [zoom] : DEFAULT_ZOOM_BUCKETS;
  const storagePrefix = buildTileStoragePrefix(orgId, planDocumentId);
  const progressPerSheet = 40 / Math.max(1, sheets.length);

  let totalTiles = 0;
  let sheetsRendered = 0;

  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    const pageNumber = sheet.sheetIndex + 1; // pdfjs is 1-indexed

    await ctx.progress(
      Math.round(50 + si * progressPerSheet),
      `Rendering tiles for sheet ${si + 1} of ${sheets.length}`,
    );

    if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      logWarn("[tileRenderer] sheetIndex out of PDF page range — skipping", {
        sheetId: sheet.id,
        sheetIndex: sheet.sheetIndex,
        numPages: pdfDoc.numPages,
        planDocumentId,
      });
      await db
        .update(takeoffSheets)
        .set({ tileStatus: "FAILED" })
        .where(eq(takeoffSheets.id, sheet.id));
      continue;
    }

    let sheetTiles = 0;
    let sheetFailed = false;

    for (const z of zoomBuckets) {
      try {
        const n = await renderPageToTiles(
          pdfDoc,
          pageNumber,
          z,
          orgId,
          planDocumentId,
          canvasFactory,
        );
        sheetTiles += n;
      } catch (err) {
        logError(
          "[tileRenderer] zoom-level render failed",
          { sheetId: sheet.id, zoom: z, planDocumentId },
          err instanceof Error ? err : new Error(String(err)),
        );
        sheetFailed = true;
      }
    }

    const now = new Date();
    if (!sheetFailed) {
      await db
        .update(takeoffSheets)
        .set({
          tileStatus: "READY",
          tiledAt: now,
          tileStoragePrefix: storagePrefix,
        })
        .where(eq(takeoffSheets.id, sheet.id));
      sheetsRendered++;

      // Warn when READY but zero tiles were produced — this happens when every
      // zoom level was skipped by the MAX_CANVAS_AXIS_PX safety cap (e.g. a very
      // large civil plan at high zoom). The client should fall back to its own
      // on-demand renderer; this log makes the situation visible in production.
      if (sheetTiles === 0) {
        logWarn("[tileRenderer] sheet marked READY but zero tiles uploaded — all zooms exceeded safety cap", {
          sheetId: sheet.id,
          sheetIndex: sheet.sheetIndex,
          zoomBuckets,
          planDocumentId,
        });
      }
    } else {
      await db
        .update(takeoffSheets)
        .set({ tileStatus: "FAILED" })
        .where(eq(takeoffSheets.id, sheet.id));
    }

    totalTiles += sheetTiles;
    logInfo("[tileRenderer] sheet complete", {
      sheetId: sheet.id,
      sheetIndex: sheet.sheetIndex,
      tiles: sheetTiles,
      failed: sheetFailed,
      zeroTilesReady: !sheetFailed && sheetTiles === 0,
      planDocumentId,
    });
  }

  pdfDoc.destroy();

  logInfo("[tileRenderer] plan document complete", {
    planDocumentId,
    sheetsRendered,
    totalTiles,
    zoomBuckets,
  });

  return { planDocumentId, sheetsRendered, tilesUploaded: totalTiles };
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerRealTileRenderer(): void {
  registerTileRenderer(realTileRenderer);
}
