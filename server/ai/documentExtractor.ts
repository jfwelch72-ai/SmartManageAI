import { objectStorageClient } from "../objectStorage";
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
    return null;
  }
}

async function downloadFromGcs(url: string): Promise<Buffer> {
  const gcsInfo = parseGcsUrl(url);
  if (!gcsInfo) {
    throw new Error(`Not a valid GCS URL: ${url}`);
  }

  const bucket = objectStorageClient.bucket(gcsInfo.bucketName);
  const file = bucket.file(gcsInfo.objectName);
  const [contents] = await file.download();
  return contents;
}

function isImageFile(url: string): boolean {
  const cleanUrl = url.split("?")[0].toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif)$/.test(cleanUrl);
}

function isPdfFile(url: string): boolean {
  const cleanUrl = url.split("?")[0].toLowerCase();
  return cleanUrl.endsWith(".pdf");
}

function getMimeType(url: string): string {
  const cleanUrl = url.split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".png")) return "image/png";
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "image/jpeg";
  if (cleanUrl.endsWith(".webp")) return "image/webp";
  if (cleanUrl.endsWith(".gif")) return "image/gif";
  return "image/png";
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
      console.error(`[DocumentExtractor] Failed to render PDF page ${pageNum}:`, pageError);
    }
  }

  return results;
}

export async function extractDocumentContent(
  documentUrl: string
): Promise<ImageContentBlock[]> {
  try {
    console.log(`[DocumentExtractor] Processing: ${documentUrl.substring(0, 100)}...`);

    const buffer = await downloadFromGcs(documentUrl);

    if (isPdfFile(documentUrl)) {
      console.log(`[DocumentExtractor] Rendering PDF (${(buffer.length / 1024).toFixed(0)} KB)`);
      const images = await renderPdfToImages(buffer);
      console.log(`[DocumentExtractor] Rendered ${images.length} PDF pages`);
      return images;
    }

    if (isImageFile(documentUrl)) {
      const mime = getMimeType(documentUrl);
      const base64 = buffer.toString("base64");
      console.log(`[DocumentExtractor] Encoded image (${(buffer.length / 1024).toFixed(0)} KB)`);
      return [
        {
          type: "image_url",
          image_url: {
            url: `data:${mime};base64,${base64}`,
            detail: "high",
          },
        },
      ];
    }

    console.log(`[DocumentExtractor] Unsupported file type, skipping: ${documentUrl}`);
    return [];
  } catch (error) {
    console.error(`[DocumentExtractor] Error processing ${documentUrl}:`, error);
    return [];
  }
}
