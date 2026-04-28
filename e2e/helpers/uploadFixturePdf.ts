import type { Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { authedRequest } from "./csrf";

const DEFAULT_BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const pdfCache = new Map<string, Buffer>();

/**
 * Returns a tiny single-page PDF buffer suitable for uploading to object
 * storage in e2e specs. Cached per-process keyed by the label so each worker
 * only generates the file once. A label (used as drawn text) lets specs
 * differentiate fixtures while still hitting the cache for repeated calls.
 */
export async function getMinimalPdf(label = "E2E Test Plan"): Promise<Buffer> {
  const cached = pdfCache.get(label);
  if (cached) return cached;
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawText(label, { x: 50, y: 750, size: 20 });
  const bytes = await doc.save();
  const buf = Buffer.from(bytes);
  pdfCache.set(label, buf);
  return buf;
}

export interface UploadFixturePdfOptions {
  /** Override the base URL used for the upload-intent request. */
  baseUrl?: string;
  /** Label drawn on the fixture PDF; doubles as the cache key. */
  label?: string;
}

export interface UploadFixturePdfResult {
  /** The storage object key returned by /api/objects/upload. */
  objectKey: string;
  /**
   * A `fileUrl` form of the uploaded object that the server's
   * `resolveGcsFile()` (in `server/takeoffSheetRoutes.ts`) can actually
   * resolve. `/api/objects/upload` hands back a raw bucket-prefixed
   * key like `/replit-objstore-XXX/<orgId>/uploads/<uuid>`, but
   * `resolveGcsFile()` only understands `/objects/...` paths or
   * `https://storage.googleapis.com/...` URLs. Storing the raw key as
   * `imageUrl` on a takeoff sheet makes `/api/takeoff/sheets/:id/pdf`
   * 404 — which silently turns specs that need the PDF to actually
   * render (like the tile renderer perf harness) into no-ops. Pass
   * this `fileUrl` to `POST /api/bids/:bidId/takeoff/plans` (or the
   * project equivalent) so the stored `imageUrl` resolves later.
   */
  fileUrl: string;
  /** Length in bytes of the uploaded PDF (handy when the caller needs it). */
  fileSize: number;
}

/**
 * Convert the raw bucket-prefixed `objectKey` returned by
 * `/api/objects/upload` into a `fileUrl` that
 * `server/takeoffSheetRoutes.ts → resolveGcsFile()` can resolve.
 *
 * The `https://storage.googleapis.com/<bucket>/<object>` form is the
 * same shape older upload flows handed back to clients before the
 * `/objects/...` short-form existed; using it here avoids leaking the
 * private object dir into the test runtime while keeping the resolver
 * happy. Exported so specs that don't go through `uploadFixturePdf`
 * (e.g. ones that build their own deterministic PDFs) can apply the
 * same wrapping without re-implementing the rule.
 */
export function objectKeyToResolvableFileUrl(objectKey: string): string {
  return objectKey.startsWith("/")
    ? `https://storage.googleapis.com${objectKey}`
    : `https://storage.googleapis.com/${objectKey}`;
}

/**
 * Reserve an upload_intents row + presigned PUT URL via /api/objects/upload,
 * then PUT the fixture PDF bytes so the object physically exists in storage.
 *
 * Why bytes have to actually land:
 *   POST /api/documents calls trySetObjectEntityAclPolicy, which loads the
 *   file from storage to attach an ACL. A bare upload-intent row isn't
 *   enough — the object has to be present, otherwise the document create
 *   fails (and silently passes when other specs use https://example.com/
 *   placeholder URLs that simply skip the ACL step on a different code
 *   path).
 *
 * Returns:
 *   - `objectKey`: the raw bucket-prefixed key returned by
 *     `/api/objects/upload`. Pass as the `fileUrl` of POST
 *     `/api/documents` (the documents route normalizes it on its own
 *     code path).
 *   - `fileUrl`: an `https://storage.googleapis.com/...` form of the
 *     same object that `server/takeoffSheetRoutes.ts → resolveGcsFile()`
 *     can resolve. Pass this (NOT the raw `objectKey`) as `fileUrl`
 *     when creating takeoff plans via POST `/api/bids/:bidId/takeoff/plans`
 *     or the project equivalent — passing the raw key makes
 *     `/api/takeoff/sheets/:id/pdf` 404 and the canvas silently stays
 *     blank.
 */
export async function uploadFixturePdf(
  page: Page,
  options: UploadFixturePdfOptions = {},
): Promise<UploadFixturePdfResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const pdf = await getMinimalPdf(options.label);

  const intentRes = await authedRequest(
    page,
    "POST",
    `${baseUrl}/api/objects/upload`,
    {
      data: {
        contentType: "application/pdf",
        fileSize: pdf.length,
        fileType: "DOCUMENT",
      },
    },
  );
  if (intentRes.status() !== 200) {
    throw new Error(
      `Upload intent reserve failed (${intentRes.status()}): ${await intentRes.text()}`,
    );
  }
  const { uploadURL, objectKey } = (await intentRes.json()) as {
    uploadURL?: string;
    objectKey?: string;
  };
  if (!uploadURL || !objectKey) {
    throw new Error("Upload intent response missing uploadURL / objectKey");
  }

  const putRes = await page.request.put(uploadURL, {
    data: pdf,
    headers: { "Content-Type": "application/pdf" },
  });
  // Object stores legitimately return 200 / 201 / 204 on a successful
  // presigned PUT (GCS / S3 / R2 differ). Accept all three so this helper
  // isn't brittle across storage backends.
  const putStatus = putRes.status();
  if (putStatus !== 200 && putStatus !== 201 && putStatus !== 204) {
    throw new Error(
      `Presigned PUT failed (${putStatus}): ${await putRes.text()}`,
    );
  }

  return {
    objectKey,
    fileUrl: objectKeyToResolvableFileUrl(objectKey),
    fileSize: pdf.length,
  };
}
