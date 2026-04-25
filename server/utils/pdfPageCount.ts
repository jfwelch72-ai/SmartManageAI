import { promises as fsp, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { File as GcsFile } from "@google-cloud/storage";
import { logError } from "./logger";

export const PDF_BUFFERED_PARSE_MAX_BYTES = 100 * 1024 * 1024;

export const PDF_PAGE_COUNT_HARD_MAX_BYTES = 8 * 1024 * 1024 * 1024;

const RANGE_REQUEST_TIMEOUT_MS = 30_000;

export interface PdfPageCountOptions {
  fileSize: number;
  fileName?: string;
  loggerContext?: Record<string, unknown>;
}

export async function getPdfPageCountFromGcs(
  file: GcsFile,
  options: PdfPageCountOptions,
): Promise<number | null> {
  const { fileSize, fileName, loggerContext } = options;
  const baseContext = { ...loggerContext, fileName, fileSize };

  if (!fileSize || fileSize <= 0) {
    logError("Skipping PDF page count: unknown or empty file size", baseContext);
    return null;
  }

  if (fileSize > PDF_PAGE_COUNT_HARD_MAX_BYTES) {
    logError("Skipping PDF page count: file exceeds hard cap", baseContext);
    return null;
  }

  if (fileSize <= PDF_BUFFERED_PARSE_MAX_BYTES) {
    try {
      const [pdfBuffer] = await file.download();
      return await countPagesFromBuffer(new Uint8Array(pdfBuffer));
    } catch (error) {
      logError(
        "Buffered PDF page count failed (will retry via streaming):",
        baseContext,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  const tempPath = path.join(tmpdir(), `pdf-page-count-${randomUUID()}.pdf`);
  try {
    await pipeline(file.createReadStream(), createWriteStream(tempPath));
    const stat = await fsp.stat(tempPath);
    return await countPagesFromTempFile(tempPath, stat.size);
  } catch (error) {
    logError(
      "Streaming PDF page count failed:",
      baseContext,
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  } finally {
    try {
      await fsp.unlink(tempPath);
    } catch {
    }
  }
}

async function countPagesFromBuffer(data: Uint8Array): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  const pdfDoc = await loadingTask.promise;
  try {
    return pdfDoc.numPages;
  } finally {
    try {
      await pdfDoc.destroy();
    } catch {
    }
  }
}

async function countPagesFromTempFile(
  filePath: string,
  fileSize: number,
): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fd = await fsp.open(filePath, "r");

  const initialChunkSize = Math.min(64 * 1024, fileSize);
  const initialBuffer = Buffer.alloc(initialChunkSize);
  if (initialChunkSize > 0) {
    await fd.read(initialBuffer, 0, initialChunkSize, 0);
  }

  const transport = new pdfjsLib.PDFDataRangeTransport(
    fileSize,
    new Uint8Array(initialBuffer),
    false,
  );

  let rangeReadError: Error | null = null;
  let abortLoadingTask: ((reason: Error) => void) | null = null;

  transport.requestDataRange = (begin: number, end: number) => {
    void readRange(fd, begin, end, fileSize)
      .then((chunk) => {
        transport.onDataRange(begin, chunk);
      })
      .catch((error) => {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        logError(
          "PDF range read failed:",
          { begin, end, fileSize },
          wrapped,
        );
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

  abortLoadingTask = (reason: Error) => {
    void loadingTask.destroy?.().catch(() => {
    });
    transport.abort();
  };

  let pdfDoc: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdfDoc = await loadingTask.promise;
    if (rangeReadError) throw rangeReadError;
    return pdfDoc.numPages;
  } finally {
    try {
      if (pdfDoc) await pdfDoc.destroy();
    } catch {
    }
    try {
      await loadingTask.destroy?.();
    } catch {
    }
    try {
      await fd.close();
    } catch {
    }
  }
}

async function readRange(
  fd: import("fs/promises").FileHandle,
  begin: number,
  end: number,
  fileSize: number,
): Promise<Uint8Array> {
  const clampedEnd = Math.min(end, fileSize);
  const length = Math.max(0, clampedEnd - begin);
  const buffer = Buffer.alloc(length);
  if (length === 0) return new Uint8Array(0);

  const timeoutHandle: { id?: NodeJS.Timeout } = {};
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle.id = setTimeout(() => {
      reject(new Error(`PDF range read timed out after ${RANGE_REQUEST_TIMEOUT_MS}ms`));
    }, RANGE_REQUEST_TIMEOUT_MS);
  });

  try {
    const readPromise = fd
      .read(buffer, 0, length, begin)
      .then(({ bytesRead }) => new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
  }
}
