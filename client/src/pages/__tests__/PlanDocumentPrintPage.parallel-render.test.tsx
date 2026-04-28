// @vitest-environment jsdom
/**
 * Task #2212 — regression coverage for the parallel page-render
 * dispatcher in `PlanDocumentPrintPage.tsx`.
 *
 * Before this task the print page walked pages serially via
 * `for (let pageNum = 1; pageNum <= numPages; pageNum++) await ...`,
 * which made wall-clock cost dominated by per-page latency on 300+
 * sheet plansets. The dispatcher now keeps up to N `renderPage` calls
 * in flight against the shared worker pool. The tests below pin three
 * invariants that protect the export from regressing:
 *
 *   1. The dispatcher honours the `concurrency` URL knob and never
 *      exceeds it (otherwise Chromium can OOM holding too many
 *      ImageBitmaps at once).
 *   2. The printed DOM order matches document order even when the
 *      worker resolves renders out-of-order — page 7's bitmap
 *      finishing before page 2 must still produce a PDF where page 2
 *      is printed before page 7.
 *   3. Effect cleanup actively cancels every in-flight handle so an
 *      unmount mid-render doesn't leak pdfjs RenderTasks.
 *
 * The test mocks `getSharedScheduler` so we can deterministically
 * stage page completions without spinning up real workers, pdfjs, or
 * a Chromium instance. wouter's hooks are mocked so the page reads
 * the per-test `concurrency` query param without a real router.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, render, cleanup } from "@testing-library/react";

// ---- Scheduler fake -------------------------------------------------
//
// `renderPage` returns a CancellablePageRender whose `promise`
// resolves only when the test calls `resolvePage(pageIndex, ...)`.
// This lets each test stage completions in any order it wants and
// observe in-flight count between dispatches.

interface PendingPage {
  pageIndex: number;
  resolve: (v: { bitmap: { close: () => void; closed?: boolean }; width: number; height: number }) => void;
  reject: (e: Error) => void;
  cancelled: boolean;
}

const fakeScheduler = {
  pending: [] as PendingPage[],
  cancelCount: 0,
  numPages: 0,
  getDocumentInfo: vi.fn(async () => ({ numPages: fakeScheduler.numPages })),
  renderPage: vi.fn((_url: string, pageIndex: number, _scale: number) => {
    let resolveFn!: PendingPage["resolve"];
    let rejectFn!: PendingPage["reject"];
    const promise = new Promise<{ bitmap: { close: () => void; closed?: boolean }; width: number; height: number }>(
      (res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      },
    );
    const entry: PendingPage = {
      pageIndex,
      resolve: resolveFn,
      reject: rejectFn,
      cancelled: false,
    };
    fakeScheduler.pending.push(entry);
    return {
      promise,
      cancel: () => {
        entry.cancelled = true;
        fakeScheduler.cancelCount++;
        // Mirror the real worker's behaviour: a cancelled handle
        // rejects with "cancelled" so the dispatcher's per-lane try/
        // catch records workerError === "cancelled" (the outer
        // useEffect ignores this because `cancelled = true` short-
        // circuits before throw).
        rejectFn(new Error("cancelled"));
      },
    };
  }),
};

vi.mock("@/lib/takeoff/tileScheduler", () => ({
  getSharedScheduler: () => fakeScheduler,
}));

// Markup canvas renderer is irrelevant to the dispatch invariants and
// would otherwise pull in pdfjs deps. Stub it out.
vi.mock("@/components/markups/markupCanvasRenderer", () => ({
  renderMarkupToCanvas: vi.fn(),
}));

// ---- wouter mock ---------------------------------------------------
//
// `useParams` returns the doc id we put in the path; `useSearch`
// returns the test's chosen query string so the per-page dispatcher
// reads the `concurrency` knob.

let currentSearch = "";
vi.mock("wouter", () => ({
  useParams: () => ({ id: "doc-test" }),
  useSearch: () => currentSearch,
}));

// ---- Network mocks --------------------------------------------------
//
// PlanDocumentPrintPage performs 4 fetches before mounting the
// renderer (metadata probe, file bytes, markups, layers, pins). We
// stub them to return empty/dummy responses so the renderer mounts
// without surprises.

beforeEach(() => {
  fakeScheduler.pending = [];
  fakeScheduler.cancelCount = 0;
  fakeScheduler.numPages = 0;
  fakeScheduler.getDocumentInfo.mockClear();
  fakeScheduler.renderPage.mockClear();
  currentSearch = "";

  // Older jsdom doesn't expose URL.createObjectURL; the print page
  // calls it on the fetched PDF blob.
  if (!URL.createObjectURL) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
  }
  if (!URL.revokeObjectURL) {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  }

  // Canvas getContext is enough of a stub for our purposes — the
  // renderer only needs `drawImage` to be a no-op.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/print-stream")) {
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]),
      } as unknown as Response;
    }
    // markups, layers, pins, "page=__none__" probe — all return [].
    return {
      ok: true,
      status: 200,
      json: async () => [],
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __PLAN_PDF_READY?: boolean }).__PLAN_PDF_READY;
  delete (window as unknown as { __PLAN_PDF_PAGE_COUNT?: number }).__PLAN_PDF_PAGE_COUNT;
  delete (window as unknown as { __PLAN_PDF_ERROR?: string }).__PLAN_PDF_ERROR;
});

async function flushAsync(): Promise<void> {
  // Two microtask flushes: (1) promise that just resolved schedules
  // its `.then` continuation, (2) that continuation may schedule
  // another microtask (the dispatcher's per-lane while-loop pulls the
  // next page index synchronously after `await renderPageInto`).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeBitmap() {
  return {
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

async function mountPrintPage(numPages: number, concurrency: number) {
  fakeScheduler.numPages = numPages;
  currentSearch = `concurrency=${concurrency}`;
  const PlanDocumentPrintPage = (
    await import("../PlanDocumentPrintPage")
  ).default;
  const utils = render(<PlanDocumentPrintPage />);
  // Let the doc-meta + overlay fetches resolve, then the renderer
  // mount, then the document-info probe complete, then the dispatch
  // loops start. Multiple flushes cover all the awaits.
  await flushAsync();
  await flushAsync();
  await flushAsync();
  await flushAsync();
  return utils;
}

describe("PlanDocumentPrintPage parallel render dispatcher", () => {
  it("dispatches up to `concurrency` page renders in parallel", async () => {
    await mountPrintPage(/* numPages */ 6, /* concurrency */ 3);

    // Three lanes should be in flight before any resolves.
    expect(fakeScheduler.pending.length).toBe(3);
    expect(fakeScheduler.pending.map((p) => p.pageIndex).sort()).toEqual([0, 1, 2]);

    // Resolve page 0 — a fourth dispatch (page index 3) should pick
    // up the freed lane on the next microtask.
    const first = fakeScheduler.pending.shift()!;
    first.resolve({ bitmap: makeBitmap(), width: 100, height: 50 });
    await flushAsync();

    expect(fakeScheduler.pending.map((p) => p.pageIndex).sort()).toEqual([1, 2, 3]);

    // Drain the rest, one at a time, asserting in-flight stays <= 3.
    while (fakeScheduler.pending.length > 0) {
      expect(fakeScheduler.pending.length).toBeLessThanOrEqual(3);
      const next = fakeScheduler.pending.shift()!;
      next.resolve({ bitmap: makeBitmap(), width: 100, height: 50 });
      await flushAsync();
    }

    // All 6 pages were dispatched exactly once.
    expect(fakeScheduler.renderPage).toHaveBeenCalledTimes(6);
  });

  it("preserves printed DOM order even when renders complete out of order", async () => {
    const utils = await mountPrintPage(/* numPages */ 4, /* concurrency */ 4);

    // All four dispatched up-front because concurrency >= numPages.
    expect(fakeScheduler.pending.length).toBe(4);

    // Per-page identity stamping — each page is resolved with a
    // unique width sentinel so we can later assert wrapper N carries
    // page N's bitmap (and not, say, page 3's bitmap glued into
    // wrapper 0 because the dispatcher appended in completion order).
    // The dispatcher copies `result.width` onto the wrapper's canvas,
    // so the canvas width is a faithful identity tag of which page
    // landed in each wrapper.
    const widthForPage = (pageIndex: number) => 1000 + pageIndex;

    // Resolve out of order: page 3, 1, 0, 2.
    const byIndex = new Map<number, PendingPage>();
    for (const p of fakeScheduler.pending) byIndex.set(p.pageIndex, p);
    fakeScheduler.pending = [];

    byIndex.get(3)!.resolve({ bitmap: makeBitmap(), width: widthForPage(3), height: 50 });
    await flushAsync();
    byIndex.get(1)!.resolve({ bitmap: makeBitmap(), width: widthForPage(1), height: 50 });
    await flushAsync();
    byIndex.get(0)!.resolve({ bitmap: makeBitmap(), width: widthForPage(0), height: 50 });
    await flushAsync();
    byIndex.get(2)!.resolve({ bitmap: makeBitmap(), width: widthForPage(2), height: 50 });
    await flushAsync();
    await flushAsync();

    const root = utils.container.querySelector(
      '[data-testid="plan-pdf-print-root"]',
    );
    expect(root).not.toBeNull();
    const wrappers = Array.from(
      root!.querySelectorAll<HTMLElement>(".plan-pdf-page"),
    );
    expect(wrappers.length).toBe(4);
    // Each wrapper, in document order, carries one canvas whose width
    // identifies which source page landed there. If the dispatcher
    // had appended in completion order (3, 1, 0, 2) we'd see widths
    // [1003, 1001, 1000, 1002] in DOM order. Pre-created wrappers
    // keyed by pageIndex - 1 must instead yield [1000, 1001, 1002,
    // 1003] regardless of the completion order above.
    const widthsInOrder = wrappers.map((w) => {
      const c = w.querySelector("canvas");
      expect(c).not.toBeNull();
      return (c as HTMLCanvasElement).width;
    });
    expect(widthsInOrder).toEqual([
      widthForPage(0),
      widthForPage(1),
      widthForPage(2),
      widthForPage(3),
    ]);
  });

  it("cancels in-flight handles when the effect tears down", async () => {
    const utils = await mountPrintPage(/* numPages */ 5, /* concurrency */ 2);

    expect(fakeScheduler.pending.length).toBe(2);
    expect(fakeScheduler.cancelCount).toBe(0);

    // Unmount before any page resolves — the dispatcher's cleanup
    // must call `cancel()` on every in-flight handle so the worker
    // can stop the underlying RenderTask. Without this the print
    // page would leak two pdfjs renders per unmount.
    utils.unmount();
    await flushAsync();

    expect(fakeScheduler.cancelCount).toBe(2);
  });

  it("clamps the URL `concurrency` value to the bounded range", async () => {
    // Asking for 50 must not actually dispatch 50 renders; the upper
    // bound (8) prevents Chromium from OOMing on tall plansets.
    await mountPrintPage(/* numPages */ 20, /* concurrency */ 50);

    expect(fakeScheduler.pending.length).toBe(8);
    expect(fakeScheduler.renderPage).toHaveBeenCalledTimes(8);
  });
});
