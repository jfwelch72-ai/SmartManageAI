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
  /** Length in bytes of the uploaded PDF (handy when the caller needs it). */
  fileSize: number;
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
 * Returns the storage objectKey, which can be passed straight through as
 * the `fileUrl` of POST /api/documents (or the `objectKey`/`fileUrl` of
 * POST /api/bids/:bidId/takeoff/plans).
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

  return { objectKey, fileSize: pdf.length };
}
