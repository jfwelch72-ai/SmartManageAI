/**
 * Task #2189 / #2219 — Worker-context shim for `pdfjs-dist`.
 *
 * Background:
 *   pdf.js v5's `ColorManager.convert` (and a handful of sibling
 *   helpers) reach `window.matchMedia("(forced-colors: active)")` with
 *   no `typeof window !== "undefined"` guard. In a dedicated module
 *   worker `window` is undefined and the call throws
 *   `ReferenceError: window is not defined`, which surfaces in the
 *   takeoff workspace as the "Failed to load PDF" toast and a
 *   permanently blank canvas.
 *
 *   Mapping `window` to the worker global plus a no-op `matchMedia`
 *   that always reports `matches: false` keeps pdf.js on its standard
 *   (non-forced-color) render path without pulling in any DOM
 *   dependencies.
 *
 * Why this is now an exported function instead of a side-effect
 * module:
 *   The previous version of this file installed the polyfill at
 *   import-evaluation time and relied on the rule "import this module
 *   *before* `pdfjs-dist` in `pdfTileWorker.ts`". ESM hoists imports,
 *   so any future contributor reordering the imports (e.g. an
 *   automatic import sorter) silently breaks PDF rendering.
 *
 *   Exporting a function lets the worker entry call it from the
 *   module body — which is guaranteed to run after the (now
 *   dynamically imported) `pdfjs-dist`'s static dependencies but
 *   before pdfjs itself is loaded. The order is encoded in code
 *   that has to physically execute, not in import declaration
 *   ordering.
 *
 *   The function is also covered by a unit test
 *   (`__tests__/pdfWorkerPolyfill.test.ts`) so that a future
 *   `pdfjs-dist` upgrade that changes the underlying assumption is
 *   noticed instead of silently re-breaking the worker.
 *
 * Task #2263 — Upstream fix:
 *   The unguarded `window.matchMedia(...)` lives in `ColorManager.convert`
 *   in upstream pdf.js (`src/display/editor/tools.js`). A patch that
 *   guards it on `typeof window !== "undefined"` is staged at
 *   `patches/pdfjs-dist-worker-window-guard.upstream.patch` and is
 *   waiting on a maintainer to open the PR against
 *   https://github.com/mozilla/pdf.js. See `patches/README.md` for the
 *   full submission status and the cleanup checklist for deleting this
 *   file once the fix is published in `pdfjs-dist`.
 */

interface MediaQueryListLike {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
}

export interface PdfWorkerGlobalShim {
  window?: unknown;
  matchMedia?: (query: string) => MediaQueryListLike;
}

/**
 * Install the `window` / `matchMedia` shims required by pdfjs-dist
 * onto the supplied target. Idempotent: existing values are left
 * untouched, so a future host that grows real implementations
 * (e.g. a `WindowOrWorkerGlobalScope` polyfill from a bundler)
 * isn't clobbered.
 *
 * The target is typed loosely so callers can pass either the worker
 * global (`globalThis`) or a stand-in object in tests.
 */
export function installPdfWorkerGlobals(target: PdfWorkerGlobalShim): void {
  if (typeof target.window === "undefined") {
    target.window = target;
  }
  if (typeof target.matchMedia === "undefined") {
    target.matchMedia = (query: string): MediaQueryListLike => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
  }
}
