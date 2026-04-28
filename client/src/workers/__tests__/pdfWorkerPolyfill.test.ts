/**
 * Task #2219 — Pin the worker-side `pdfjs-dist` polyfill so a future
 * `pdfjs-dist` upgrade can't silently re-break PDF rendering inside
 * `pdfTileWorker.ts`.
 *
 * The bug history (Task #2189): pdfjs-dist v5's `ColorManager.convert`
 * (and a few sibling helpers) call `window.matchMedia(...)` with no
 * environment guard. In a dedicated module worker `window` is
 * undefined and the call throws `ReferenceError: window is not
 * defined`, which surfaces in the takeoff workspace as the "Failed to
 * load PDF" toast and a permanently blank canvas. We work around this
 * by installing a `window` / `matchMedia` shim on the worker global
 * before pdfjs is imported.
 *
 * These tests cover three failure modes:
 *
 *   1. The polyfill installs `window` and `matchMedia` on a target
 *      that lacks them, and the shimmed `matchMedia` returns the
 *      "not in forced-colors mode" answer pdfjs's render path
 *      assumes.
 *
 *   2. The polyfill is idempotent — pre-existing values aren't
 *      clobbered, so running it twice (or running it in a context
 *      that already has a real `window`) is a no-op.
 *
 *   3. The shipped `pdfjs-dist` build still contains the unguarded
 *      `window.matchMedia(...)` call we're shimming for. If a future
 *      pdfjs upgrade adds a `typeof window` guard the polyfill is no
 *      longer needed and this test fails to remind us to delete the
 *      shim. Conversely, if a future upgrade introduces a *new*
 *      unguarded reference (e.g. `window.foo`) the next reproduction
 *      should add a matching assertion here so the worker's contract
 *      is checked at unit-test time instead of waiting for the e2e
 *      tile-renderer baselines to fail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  installPdfWorkerGlobals,
  type PdfWorkerGlobalShim,
} from "../pdfWorkerPolyfill";

const require = createRequire(import.meta.url);

describe("installPdfWorkerGlobals", () => {
  it("installs window and matchMedia on a bare worker-like target", () => {
    const target: PdfWorkerGlobalShim = {};

    installPdfWorkerGlobals(target);

    expect(target.window).toBe(target);
    expect(typeof target.matchMedia).toBe("function");

    const mql = target.matchMedia!("(forced-colors: active)");
    expect(mql.matches).toBe(false);
    expect(mql.media).toBe("(forced-colors: active)");
    // pdfjs registers no listeners, but the MediaQueryList shape
    // expected by pdf.js / DOM TypeScript types still has to expose
    // the listener API.
    expect(typeof mql.addEventListener).toBe("function");
    expect(typeof mql.removeEventListener).toBe("function");
    expect(typeof mql.addListener).toBe("function");
    expect(typeof mql.removeListener).toBe("function");
    expect(typeof mql.dispatchEvent).toBe("function");
  });

  it("is idempotent and never overwrites an existing window/matchMedia", () => {
    const realWindow = { tag: "real-window" };
    const realMatchMedia = (q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    const target: PdfWorkerGlobalShim = {
      window: realWindow,
      matchMedia: realMatchMedia,
    };

    installPdfWorkerGlobals(target);
    installPdfWorkerGlobals(target);

    expect(target.window).toBe(realWindow);
    expect(target.matchMedia).toBe(realMatchMedia);
  });

  it("reports `matches: false` so pdfjs ColorManager.convert takes the fast path", () => {
    const target: PdfWorkerGlobalShim = {};
    installPdfWorkerGlobals(target);
    // pdf.js v5 ColorManager.convert does:
    //   if (!window.matchMedia("(forced-colors: active)").matches) { return rgb; }
    // The fast-path early return is what keeps the worker from
    // touching the rest of the DOM-only forced-colors code path.
    expect(
      target.matchMedia!("(forced-colors: active)").matches,
    ).toBe(false);
  });
});

describe("pdfjs-dist worker-context contract", () => {
  it("still reaches `window.matchMedia` unguarded in the shipped build", () => {
    // If this assertion ever fails, pdfjs has either guarded the
    // call (e.g. `typeof window !== "undefined"`) or moved away from
    // matchMedia entirely. Either way the polyfill in
    // `pdfWorkerPolyfill.ts` is no longer load-bearing for
    // `pdfTileWorker.ts` and should be re-evaluated/removed.
    const pdfMjsPath = require.resolve("pdfjs-dist/build/pdf.mjs");
    const source = readFileSync(pdfMjsPath, "utf8");
    expect(source).toContain(
      'window.matchMedia("(forced-colors: active)")',
    );
  });
});
