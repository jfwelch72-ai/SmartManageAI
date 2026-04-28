/**
 * Task #2189 — Worker-context polyfill that must run *before* the
 * `pdfjs-dist` import in `pdfTileWorker.ts`.
 *
 * Why this lives in its own module:
 *   ES module imports are hoisted, so any inline code placed above
 *   the `import * as pdfjsLib from "pdfjs-dist"` statement still
 *   runs *after* pdf.js's module initializer. The only way to make
 *   sure the polyfill installs first is to put it in a separate
 *   module that is imported before pdfjs-dist — declaration order
 *   between imports is preserved.
 *
 * What we polyfill and why:
 *   pdf.js v5's `ColorManager.convert` (called on every page render
 *   through `Util.makeColors` → forced-colors detection) reaches
 *   `window.matchMedia("(forced-colors: active)")` with no
 *   environment guard. In a dedicated worker `window` is undefined
 *   and the call throws `ReferenceError: window is not defined`,
 *   which surfaces in our app as the "Failed to load PDF" toast and
 *   a permanently blank takeoff canvas. Mapping `window` to the
 *   worker global plus a no-op `matchMedia` that always reports
 *   `matches: false` keeps pdf.js on its standard (non-forced-color)
 *   render path without pulling in any DOM dependencies.
 */

interface MutableWorkerGlobal {
  window?: unknown;
  matchMedia?: (query: string) => unknown;
}

const workerGlobal = (
  typeof globalThis !== "undefined" ? globalThis : (0, eval)("this")
) as unknown as MutableWorkerGlobal;

if (typeof workerGlobal.window === "undefined") {
  workerGlobal.window = workerGlobal;
}

if (typeof workerGlobal.matchMedia === "undefined") {
  workerGlobal.matchMedia = (query: string) => ({
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

export {};
