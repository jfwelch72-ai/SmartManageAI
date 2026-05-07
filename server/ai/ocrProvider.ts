/**
 * Task #2577 Phase B (Step 3) — OCR provider abstraction.
 *
 * Construction plan PDFs frequently arrive as scanned raster images (no
 * embedded text layer). Without OCR the document extractor returns
 * empty text for those pages and downstream services (sheet indexer,
 * map-reduce drafter, schedule symbol counter) must rely on vision-LLM
 * passes for everything — slow and expensive.
 *
 * This module defines a tiny provider interface so the OCR
 * implementation (Tesseract for self-hosted, Document AI / Textract
 * for cloud) can be swapped without touching callers. The default
 * implementation lazy-loads `tesseract.js` if it is installed and
 * silently no-ops otherwise so the dependency stays optional.
 *
 * Providers must be deterministic given the same image bytes (i.e.
 * stateless) and SHOULD complete in O(seconds) per page; long-running
 * jobs should be split out into the queue. Every provider MUST handle
 * failure by returning `null` rather than throwing — callers treat OCR
 * as best-effort and silently fall back to the rendered image when no
 * text is recovered.
 */

import { logInfo, logWarn } from "../utils/logger";

export interface OcrProvider {
  /** Stable id used as the `extractedTextSource` value on the row. */
  id: string;
  /** Display name surfaced in admin / metrics. */
  label: string;
  /**
   * OCR a rendered page image. Returns the recognized text, or null on
   * failure. Implementations MUST NOT throw.
   */
  recognize(image: { buffer: Buffer; mimeType: string }): Promise<string | null>;
}

let registered: OcrProvider | null = null;

export function registerOcrProvider(provider: OcrProvider): void {
  registered = provider;
  logInfo(`[OcrProvider] Registered: ${provider.id}`);
}

export function clearOcrProvider(): void {
  registered = null;
}

export function getOcrProvider(): OcrProvider | null {
  if (registered) return registered;
  // Task #2577 Phase B — lazy-build a Tesseract.js default so OCR
  // fallback is functional out-of-the-box on raster PDFs without
  // requiring callers to register a provider explicitly. The
  // factory itself defers `import("tesseract.js")` to the first
  // recognize() call, so server boot stays cheap and the dependency
  // remains swappable via `registerOcrProvider`.
  if (process.env.OCR_PROVIDER_DISABLED === "true") return null;
  registered = buildTesseractProvider({
    lang: process.env.OCR_TESSERACT_LANG || "eng",
  });
  logInfo("[OcrProvider] Auto-registered default Tesseract provider");
  return registered;
}

/**
 * Built-in Tesseract.js provider factory. The module is dynamically
 * imported on the first recognize() call so the dependency stays
 * optional. Returns `null` and logs a warning if tesseract.js is not
 * installed.
 */
export function buildTesseractProvider(opts: { lang?: string } = {}): OcrProvider {
  const lang = opts.lang ?? "eng";
  let workerPromise: Promise<unknown> | null = null;
  return {
    id: "TESSERACT",
    label: `Tesseract.js (${lang})`,
    async recognize({ buffer, mimeType }) {
      try {
        if (!workerPromise) {
          workerPromise = (async () => {
            const mod = await import("tesseract.js" as string).catch(() => null);
            if (!mod) return null;
            const tesseract = (mod as { default?: unknown; createWorker?: unknown }).createWorker
              ?? (mod as { default?: { createWorker?: unknown } }).default?.createWorker;
            if (typeof tesseract !== "function") return null;
            const worker = await (tesseract as (l: string) => Promise<unknown>)(lang);
            return worker;
          })();
        }
        const worker = await workerPromise;
        if (!worker) {
          logWarn("[OcrProvider:Tesseract] tesseract.js not installed; returning null");
          return null;
        }
        const recognize = (worker as { recognize?: (b: Buffer | string) => Promise<{ data?: { text?: string } }> }).recognize;
        if (typeof recognize !== "function") return null;
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        const out = await recognize.call(worker, dataUrl);
        const text = out?.data?.text?.trim() ?? "";
        return text.length > 0 ? text : null;
      } catch (err) {
        logWarn("[OcrProvider:Tesseract] recognize failed", { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },
  };
}

/**
 * Test-only helper: lets unit tests inject a deterministic provider
 * without booting tesseract.
 */
export function __setOcrProviderForTests(provider: OcrProvider | null): void {
  registered = provider;
}
