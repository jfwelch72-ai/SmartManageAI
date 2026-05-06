import type { File as GcsFile } from "@google-cloud/storage";
import { logError } from "./logger";

/**
 * Task #2405 — Range-only PDF opener.
 *
 * Previously this module had two paths:
 *   1. Buffer the entire file into memory if ≤ 100 MB.
 *   2. Stream the entire file to /tmp and then range-read from disk.
 * Both paths capped out at an 8 GB hard limit. That cap blocked 25 GB
 * civil plansets entirely, and the /tmp streaming path required pulling
 * every byte over the wire just to read the page count from the trailer
 * dictionary — which is the *last* few KB of the file.
 *
 * The new implementation uses pdfjs's `PDFDataRangeTransport` directly
 * against GCS via `file.download({ start, end })` so we only pay for the
 * bytes pdfjs actually asks for (typically <1 MB even on a 25 GB file).
 * No /tmp file, no full-buffer fallback, no hard cap.
 *
 * `PDF_BUFFERED_PARSE_MAX_BYTES` is preserved as a public export at the
 * 100 MB sentinel because `aiTakeoffFeatureRoutes` still uses it as the
 * inline-base64 size guard for vision calls (a model context limit, not
 * a page-count limit).
 */

export const PDF_BUFFERED_PARSE_MAX_BYTES = 100 * 1024 * 1024;

const RANGE_REQUEST_TIMEOUT_MS = 30_000;
const INITIAL_HEAD_BYTES = 64 * 1024;

export interface PdfOpenOptions {
  fileSize: number;
  fileName?: string;
  loggerContext?: Record<string, unknown>;
}

export type PdfPageCountOptions = PdfOpenOptions;

export interface OpenedPdf {
  pdfDoc: any;
  numPages: number;
  close: () => Promise<void>;
}

export async function openPdfFromGcs(
  file: GcsFile,
  options: PdfOpenOptions,
): Promise<OpenedPdf | null> {
  const { fileSize, fileName, loggerContext } = options;
  const baseContext = { ...loggerContext, fileName, fileSize };

  if (!fileSize || fileSize <= 0) {
    logError("Skipping PDF open: unknown or empty file size", baseContext);
    return null;
  }

  try {
    return await openFromGcsRanges(file, fileSize);
  } catch (error) {
    logError(
      "Range-transport PDF open failed:",
      baseContext,
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

export async function getPdfPageCountFromGcs(
  file: GcsFile,
  options: PdfPageCountOptions,
): Promise<number | null> {
  const opened = await openPdfFromGcs(file, options);
  if (!opened) return null;
  try {
    return opened.numPages;
  } finally {
    await opened.close();
  }
}

async function openFromGcsRanges(
  file: GcsFile,
  fileSize: number,
): Promise<OpenedPdf> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const initialChunkSize = Math.min(INITIAL_HEAD_BYTES, fileSize);
  const initialChunk =
    initialChunkSize > 0
      ? await downloadRangeFromGcs(file, 0, initialChunkSize - 1, fileSize)
      : new Uint8Array(0);

  const transport = new pdfjsLib.PDFDataRangeTransport(
    fileSize,
    initialChunk,
    false,
  );

  let rangeReadError: Error | null = null;
  let abortLoadingTask: ((reason: Error) => void) | null = null;

  transport.requestDataRange = (begin: number, end: number) => {
    void downloadRangeFromGcs(file, begin, Math.min(end, fileSize) - 1, fileSize)
      .then((chunk) => {
        transport.onDataRange(begin, chunk);
      })
      .catch((error) => {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        logError("PDF range read failed:", { begin, end, fileSize }, wrapped);
        rangeReadError = wrapped;
        abortLoadingTask?.(wrapped);
      });
  };

  const loadingTask = pdfjsLib.getDocument({
    range: transport,
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
  });

  abortLoadingTask = (_reason: Error) => {
    void loadingTask.destroy?.().catch(() => undefined);
    try {
      transport.abort();
    } catch {
      /* noop */
    }
  };

  let pdfDoc: any;
  try {
    pdfDoc = await loadingTask.promise;
  } catch (error) {
    try {
      transport.abort();
    } catch {
      /* noop */
    }
    throw error;
  }
  if (rangeReadError) {
    try {
      await pdfDoc.destroy();
    } catch {
      /* noop */
    }
    throw rangeReadError;
  }

  return {
    pdfDoc,
    numPages: pdfDoc.numPages,
    close: async () => {
      try {
        await pdfDoc.destroy();
      } catch {
        /* noop */
      }
      try {
        await loadingTask.destroy?.();
      } catch {
        /* noop */
      }
      try {
        transport.abort();
      } catch {
        /* noop */
      }
    },
  };
}

async function downloadRangeFromGcs(
  file: GcsFile,
  start: number,
  endInclusive: number,
  fileSize: number,
): Promise<Uint8Array> {
  if (endInclusive < start) return new Uint8Array(0);
  const clampedEnd = Math.min(endInclusive, fileSize - 1);

  const timeoutHandle: { id?: NodeJS.Timeout } = {};
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle.id = setTimeout(() => {
      reject(
        new Error(`PDF range read timed out after ${RANGE_REQUEST_TIMEOUT_MS}ms`),
      );
    }, RANGE_REQUEST_TIMEOUT_MS);
  });

  try {
    const downloadPromise = (async () => {
      const [buffer] = await file.download({ start, end: clampedEnd });
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    })();
    return await Promise.race([downloadPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
  }
}
