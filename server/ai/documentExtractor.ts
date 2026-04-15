import {logError, logWarn } from "../utils/logger";
import { objectStorageClient, ObjectStorageService } from "../objectStorage";
import { createCanvas } from "canvas";

const MAX_PDF_PAGES = 5;
const PDF_RENDER_SCALE = 1.5;

function parseGcsUrl(url: string): { bucketName: string; objectName: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "storage.googleapis.com" || parsed.hostname === "storage.cloud.google.com") {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2) return null;
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join("/");
      return { bucketName, objectName };
    }
    return null;
  } catch {
    logWarn("Non-critical operation failed");
    return null;
  }
}

interface GcsDownloadResult {
  buffer: Buffer;
  contentType: string | null;
}

async function downloadFromObjectPath(objectPath: string): Promise<GcsDownloadResult> {
  const storageService = new ObjectStorageService();
  const file = await storageService.getObjectEntityFile(objectPath);

  let contentType: string | null = null;
  try {
    const [metadata] = await file.getMetadata();
    contentType = metadata.contentType || null;
  } catch {
    logWarn("Non-critical operation failed");
  }

  const [contents] = await file.download();
  return { buffer: contents, contentType };
}

async function downloadFromGcs(url: string): Promise<GcsDownloadResult> {
  if (url.startsWith("/objects/")) {
    return downloadFromObjectPath(url);
  }

  const gcsInfo = parseGcsUrl(url);
  if (!gcsInfo) {
    throw new Error(`Not a valid document URL: ${url}`);
  }

  const bucket = objectStorageClient.bucket(gcsInfo.bucketName);
  const file = bucket.file(gcsInfo.objectName);

  let contentType: string | null = null;
  try {
    const [metadata] = await file.getMetadata();
    contentType = metadata.contentType || null;
  } catch {
    logWarn("Non-critical operation failed");
  }

  const [contents] = await file.download();
  return { buffer: contents, contentType };
}

type FileType = "pdf" | "image" | "unknown";

function detectFileType(buffer: Buffer, contentType: string | null, url: string): { type: FileType; mime: string } {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { type: "pdf", mime: "application/pdf" };
  }

  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { type: "image", mime: "image/png" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { type: "image", mime: "image/jpeg" };
  }

  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "RIFF") {
    return { type: "image", mime: "image/webp" };
  }

  if (buffer.length >= 4 && (buffer.subarray(0, 4).toString("ascii") === "GIF8")) {
    return { type: "image", mime: "image/gif" };
  }

  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes("pdf")) return { type: "pdf", mime: "application/pdf" };
    if (ct.includes("image/png")) return { type: "image", mime: "image/png" };
    if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return { type: "image", mime: "image/jpeg" };
    if (ct.includes("image/webp")) return { type: "image", mime: "image/webp" };
    if (ct.includes("image/gif")) return { type: "image", mime: "image/gif" };
    if (ct.startsWith("image/")) return { type: "image", mime: ct };
  }

  const cleanUrl = url.split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".pdf")) return { type: "pdf", mime: "application/pdf" };
  if (cleanUrl.endsWith(".png")) return { type: "image", mime: "image/png" };
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return { type: "image", mime: "image/jpeg" };
  if (cleanUrl.endsWith(".webp")) return { type: "image", mime: "image/webp" };
  if (cleanUrl.endsWith(".gif")) return { type: "image", mime: "image/gif" };

  return { type: "unknown", mime: "application/octet-stream" };
}

type ImageContentBlock = {
  type: "image_url";
  image_url: { url: string; detail: string };
};

async function renderPdfToImages(pdfBuffer: Buffer): Promise<ImageContentBlock[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
  const results: ImageContentBlock[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");

      await (page.render({
        canvasContext: context as any,
        viewport: viewport,
        canvas: canvas as any,
      } as any)).promise;

      const pngBuffer = canvas.toBuffer("image/png");
      const base64 = pngBuffer.toString("base64");

      results.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: "high",
        },
      });

      page.cleanup();
    } catch (pageError) {
      logError(`[DocumentExtractor] Failed to render PDF page ${pageNum}:`, {}, pageError instanceof Error ? pageError : new Error(String(pageError)));
    }
  }

  return results;
}

export async function extractDocumentContent(
  documentUrl: string
): Promise<ImageContentBlock[]> {
  try {
    console.log(`[DocumentExtractor] Processing: ${documentUrl.substring(0, 100)}...`);

    const { buffer, contentType } = await downloadFromGcs(documentUrl);
    const detected = detectFileType(buffer, contentType, documentUrl);

    console.log(`[DocumentExtractor] Detected type: ${detected.type} (${detected.mime}), content-type header: ${contentType || 'none'}, size: ${(buffer.length / 1024).toFixed(0)} KB`);

    if (detected.type === "pdf") {
      console.log(`[DocumentExtractor] Rendering PDF...`);
      const images = await renderPdfToImages(buffer);
      console.log(`[DocumentExtractor] Rendered ${images.length} PDF pages`);
      return images;
    }

    if (detected.type === "image") {
      const base64 = buffer.toString("base64");
      console.log(`[DocumentExtractor] Encoded image as ${detected.mime}`);
      return [
        {
          type: "image_url",
          image_url: {
            url: `data:${detected.mime};base64,${base64}`,
            detail: "high",
          },
        },
      ];
    }

    console.warn(`[DocumentExtractor] Could not determine file type for: ${documentUrl}. Content-type: ${contentType}. Trying as PDF...`);
    try {
      const images = await renderPdfToImages(buffer);
      if (images.length > 0) {
        console.log(`[DocumentExtractor] Successfully rendered as PDF (${images.length} pages)`);
        return images;
      }
    } catch {
      logWarn("Non-critical operation failed");
    }

    console.warn(`[DocumentExtractor] Unable to process file, skipping`);
    return [];
  } catch (error) {
    logError(`[DocumentExtractor] Error processing ${documentUrl}:`, {}, error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}
