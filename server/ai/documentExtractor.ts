import { logError, logWarn, logInfo } from "../utils/logger";
import { objectStorageClient, ObjectStorageService } from "../objectStorage";
import { createCanvas } from "canvas";

const MAX_PDF_PAGES = 5;
const PDF_RENDER_SCALE = 1.5;
const MAX_TEXT_LENGTH = 50000;

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

type TextContentBlock = {
  type: "text";
  text: string;
};

export type DocumentContentBlock = ImageContentBlock | TextContentBlock;

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext: any, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: any) {
    if (canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    }
  }
}

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) {
        pageTexts.push(`--- Page ${pageNum} ---\n${pageText}`);
      }
      page.cleanup();
    } catch (err) {
      logWarn(`[DocumentExtractor] Failed to extract text from page ${pageNum}`);
    }
  }

  pdfDoc.destroy();
  const fullText = pageTexts.join("\n\n");
  return fullText.length > MAX_TEXT_LENGTH ? fullText.substring(0, MAX_TEXT_LENGTH) : fullText;
}

async function processPdf(pdfBuffer: Buffer): Promise<DocumentContentBlock[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const canvasFactory = new NodeCanvasFactory();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    canvasFactory: canvasFactory as any,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
  const imageResults: ImageContentBlock[] = [];
  const failedPageTexts: string[] = [];
  let renderFailCount = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");

      await (page.render({
        canvasContext: context as any,
        viewport: viewport,
        canvasFactory: canvasFactory as any,
      } as any)).promise;

      const pngBuffer = canvas.toBuffer("image/png");
      const base64 = pngBuffer.toString("base64");

      imageResults.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: "high",
        },
      });

      page.cleanup();
    } catch (pageError) {
      renderFailCount++;
      logError(`[DocumentExtractor] Failed to render PDF page ${pageNum}:`, {}, pageError instanceof Error ? pageError : new Error(String(pageError)));

      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (pageText.length > 10) {
          failedPageTexts.push(`--- Page ${pageNum} ---\n${pageText}`);
        }
        page.cleanup();
      } catch {
        logWarn(`[DocumentExtractor] Also failed text extraction for page ${pageNum}`);
      }
    }
  }

  pdfDoc.destroy();

  if (imageResults.length > 0 && failedPageTexts.length > 0) {
    const fallbackText = failedPageTexts.join("\n\n");
    const truncated = fallbackText.length > MAX_TEXT_LENGTH ? fallbackText.substring(0, MAX_TEXT_LENGTH) : fallbackText;
    logInfo(`[DocumentExtractor] Rendered ${imageResults.length} pages as images, extracted text from ${failedPageTexts.length} failed pages`);
    return [
      ...imageResults,
      { type: "text", text: `[Text from pages that could not be rendered]\n${truncated}` },
    ];
  }

  if (imageResults.length > 0) {
    return imageResults;
  }

  if (failedPageTexts.length > 0) {
    const fullText = failedPageTexts.join("\n\n");
    const truncated = fullText.length > MAX_TEXT_LENGTH ? fullText.substring(0, MAX_TEXT_LENGTH) : fullText;
    logInfo(`[DocumentExtractor] Rendering failed for all ${renderFailCount} pages, using text fallback (${truncated.length} chars)`);
    return [{ type: "text", text: `[PDF Document Content]\n${truncated}` }];
  }

  logInfo(`[DocumentExtractor] No images rendered and no text found, trying full text extraction...`);
  const text = await extractPdfText(pdfBuffer);
  if (text.trim().length > 10) {
    logInfo(`[DocumentExtractor] Full text extraction yielded ${text.length} chars`);
    return [{ type: "text", text: `[PDF Document Content]\n${text}` }];
  }

  return [];
}

export async function extractDocumentContent(
  documentUrl: string
): Promise<DocumentContentBlock[]> {
  try {
    logInfo(`[DocumentExtractor] Processing: ${documentUrl.substring(0, 100)}...`);

    const { buffer, contentType } = await downloadFromGcs(documentUrl);
    const detected = detectFileType(buffer, contentType, documentUrl);

    logInfo(`[DocumentExtractor] Detected type: ${detected.type} (${detected.mime}), content-type header: ${contentType || 'none'}, size: ${(buffer.length / 1024).toFixed(0)} KB`);

    if (detected.type === "pdf") {
      logInfo(`[DocumentExtractor] Processing PDF...`);
      const results = await processPdf(buffer);
      const imageCount = results.filter(r => r.type === 'image_url').length;
      const textCount = results.filter(r => r.type === 'text').length;
      logInfo(`[DocumentExtractor] PDF result: ${imageCount} images, ${textCount} text blocks`);
      return results;
    }

    if (detected.type === "image") {
      const base64 = buffer.toString("base64");
      logInfo(`[DocumentExtractor] Encoded image as ${detected.mime}`);
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

    logWarn(`[DocumentExtractor] Could not determine file type for: ${documentUrl}. Content-type: ${contentType}. Trying as PDF...`);
    try {
      const results = await processPdf(buffer);
      if (results.length > 0) {
        logInfo(`[DocumentExtractor] Successfully processed as PDF`);
        return results;
      }
    } catch {
      logWarn("Non-critical operation failed");
    }

    logWarn(`[DocumentExtractor] Unable to process file, skipping`);
    return [];
  } catch (error) {
    logError(`[DocumentExtractor] Error processing ${documentUrl}:`, {}, error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}
