// @vitest-environment jsdom
/**
 * Task #1721 — Drag-a-layer-onto-a-thumbnail coverage for
 * PageThumbnailStrip.
 *
 * Pins down the new behaviour:
 *   1. Thumbnails opted in via `sheetDocumentIds` advertise a layer
 *      drop target through the `data-layer-drop-target` attribute.
 *   2. Dropping a payload carrying the
 *      `application/x-plan-markup-layer` MIME on such a thumbnail
 *      POSTs to /api/plan-markup-layers/:layerId/copy-to-document
 *      with the mapped plan-document id.
 *   3. Dropping onto a thumbnail whose mapped doc *is* the layer's
 *      source doc is a no-op (no API call) — guards against silent
 *      self-copies.
 *   4. The "Copy here" affordance toggles on dragOver / off on drop.
 *
 * Task #1806 — Pin down that the drag-to-copy path can't bypass the
 * picker's duplicate-copy warning. Before firing the mutation the
 * drop handler queries /api/plan-markup-layers/:layerId/copy-targets
 * and, if the destination already holds one or more "(copy)" layers
 * derived from the source, prompts the user via window.confirm. A
 * cancel must short-circuit the API call; an accept must let it
 * through. A copy-targets fetch failure must NOT block the copy (so
 * a transient network blip never silently swallows a user gesture).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        layer: { id: "L-new", name: "QA/QC (copy)" },
        markupsCopied: 2,
      }),
    })),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// usePdfThumbnails kicks off canvas/IntersectionObserver work that
// jsdom cannot service. Stub it so the strip renders synchronously.
vi.mock("@/hooks/use-pdf-thumbnails", () => ({
  usePdfThumbnails: () => ({
    thumbnails: new Map(),
    failedSheets: new Set(),
    isLoading: false,
    progress: 100,
    observeRef: () => {},
  }),
}));

import { PageThumbnailStrip } from "../PageThumbnailStrip";
import { PLAN_MARKUP_LAYER_DRAG_MIME } from "@/components/markups/MarkupLayersPanel";
import { apiRequest, queryClient as testQueryClient } from "@/lib/queryClient";
import type { TakeoffSheet } from "@shared/schema";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const SHEET_A: TakeoffSheet = {
  id: "sheet-A",
  projectId: "p1",
  bidId: null,
  planId: null,
  imageUrl: "blob://A",
  sheetIndex: 0,
  sheetName: "A-100",
  scalePxPerFoot: null,
  units: "ft",
  folderGroup: "Plans",
  revisionLabel: null,
  isActive: true,
  supersededById: null,
  rotation: 0,
  scaleLabel: null,
  assignedTo: null,
  completionStatus: "not_started",
  targetMeasurements: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as TakeoffSheet;

const SHEET_B: TakeoffSheet = { ...SHEET_A, id: "sheet-B", sheetName: "A-101", sheetIndex: 1 };
const SHEET_C: TakeoffSheet = { ...SHEET_A, id: "sheet-C", sheetName: "A-102", sheetIndex: 2 };

// sheet-A is the source layer's "home" sheet, sheet-B is a sibling we
// expect drops to copy onto, sheet-C is intentionally NOT included in
// the map to prove non-mapped thumbnails opt out of drop handling.
const sheetDocumentIds = new Map<string, string>([
  ["sheet-A", "doc-A"],
  ["sheet-B", "doc-B"],
]);

function makeDataTransfer(payload: Record<string, string>): DataTransfer {
  const store = new Map<string, string>(Object.entries(payload));
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    // The component reads `types` to decide whether the drag is one it
    // wants. Returning the keys mirrors the real DOMStringList.
    get types() {
      return Array.from(store.keys());
    },
    clearData: () => store.clear(),
    getData: (k: string) => store.get(k) ?? "",
    setData: (k: string, v: string) => {
      store.set(k, v);
    },
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function renderStrip(props?: { sheetDocumentIds?: Map<string, string> }) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  );
  return render(
    <PageThumbnailStrip
      sheets={[SHEET_A, SHEET_B, SHEET_C]}
      selectedSheet={SHEET_A.id}
      onSelectSheet={() => {}}
      sheetDocumentIds={props?.sheetDocumentIds ?? sheetDocumentIds}
    />,
    { wrapper: Wrapper },
  );
}

// Task #1806 — the drop handler fetches copy-targets before firing
// the mutation, so tests need to control what that endpoint returns.
// Per-test bodies override this default by re-stubbing fetch.
let fetchMock: ReturnType<typeof vi.fn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;

function stubCopyTargetsFetch(
  targets: Array<{ documentId: string; existingCopyCount: number }>,
) {
  fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/copy-targets")) {
      return new Response(
        JSON.stringify({
          targets: targets.map((t) => ({
            ...t,
            lastCopiedAt: new Date().toISOString(),
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  apiRequestMock.mockClear();
  // jsdom doesn't implement scrollIntoView; the strip calls it on the
  // active thumbnail in a useEffect.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // Default copy-targets response: no existing copies anywhere → no
  // confirm prompt, copies fire straight through.
  stubCopyTargetsFetch([]);
  confirmSpy = vi.spyOn(window, "confirm");
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
  confirmSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("PageThumbnailStrip layer drop (Task #1721)", () => {
  it("only mapped thumbnails advertise a layer drop target", () => {
    renderStrip();
    const a = screen.getByTestId("thumbnail-sheet-sheet-A");
    const b = screen.getByTestId("thumbnail-sheet-sheet-B");
    const c = screen.getByTestId("thumbnail-sheet-sheet-C");
    expect(a.hasAttribute("data-layer-drop-target")).toBe(true);
    expect(a.getAttribute("data-layer-drop-doc")).toBe("doc-A");
    expect(b.hasAttribute("data-layer-drop-target")).toBe(true);
    expect(b.getAttribute("data-layer-drop-doc")).toBe("doc-B");
    expect(c.hasAttribute("data-layer-drop-target")).toBe(false);
    expect(c.getAttribute("data-layer-drop-doc")).toBeNull();
  });

  it("drops a layer onto a sibling thumbnail and POSTs to copy-to-document", async () => {
    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-B");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
      "text/plain": "QA/QC",
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    // Affordance is shown while hovering.
    expect(screen.getByTestId("thumb-layer-drop-hint-sheet-B")).toBeTruthy();

    fireEvent.drop(target, { dataTransfer: dt });

    // …and removed once the drop completes.
    await waitFor(() => {
      expect(screen.queryByTestId("thumb-layer-drop-hint-sheet-B")).toBeNull();
    });

    await waitFor(() => {
      const calls = apiRequestMock.mock.calls.filter(
        (c) =>
          c[0] === "POST" &&
          String(c[1]) === "/api/plan-markup-layers/L-qa/copy-to-document",
      );
      expect(calls.length).toBe(1);
      expect(calls[0][2]).toEqual({ targetDocumentId: "doc-B" });
    });
  });

  it("ignores drops onto the source sheet (no API call)", async () => {
    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-A");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    // Yield once for any queued microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    const postCalls = apiRequestMock.mock.calls.filter(
      (c) => c[0] === "POST" && /copy-to-document/.test(String(c[1])),
    );
    expect(postCalls.length).toBe(0);
  });

  it("ignores drops on thumbnails not opted in via sheetDocumentIds", async () => {
    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-C");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    // No affordance was rendered for the non-mapped sheet.
    expect(screen.queryByTestId("thumb-layer-drop-hint-sheet-C")).toBeNull();

    fireEvent.drop(target, { dataTransfer: dt });
    await act(async () => {
      await Promise.resolve();
    });
    const postCalls = apiRequestMock.mock.calls.filter((c) => c[0] === "POST");
    expect(postCalls.length).toBe(0);
  });

  it("ignores drags missing the markup-layer MIME (no affordance, no call)", async () => {
    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-B");
    const dt = makeDataTransfer({ "text/plain": "not-a-layer" });

    fireEvent.dragOver(target, { dataTransfer: dt });
    expect(screen.queryByTestId("thumb-layer-drop-hint-sheet-B")).toBeNull();

    fireEvent.drop(target, { dataTransfer: dt });
    await act(async () => {
      await Promise.resolve();
    });
    expect(apiRequestMock.mock.calls.length).toBe(0);
  });
});

describe("PageThumbnailStrip drag-to-copy duplicate warning (Task #1806)", () => {
  it("prompts before copying when the destination already holds copies of this layer (cancel = no API call)", async () => {
    // Destination doc-B already has 2 "(copy)" layers derived from
    // L-qa, so a drag-to-copy must surface the same window.confirm
    // the picker uses.
    stubCopyTargetsFetch([{ documentId: "doc-B", existingCopyCount: 2 }]);
    confirmSpy.mockReturnValueOnce(false);

    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-B");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    // Wait for the copy-targets fetch + confirm to complete.
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });
    const message = String(confirmSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/already has 2/);
    expect(message).toMatch(/QA\/QC/);

    // User cancelled → mutation must NOT fire.
    await act(async () => {
      await Promise.resolve();
    });
    const postCalls = apiRequestMock.mock.calls.filter(
      (c) => c[0] === "POST" && /copy-to-document/.test(String(c[1])),
    );
    expect(postCalls.length).toBe(0);
  });

  it("fires the copy when the user accepts the duplicate-warning prompt", async () => {
    stubCopyTargetsFetch([{ documentId: "doc-B", existingCopyCount: 1 }]);
    confirmSpy.mockReturnValueOnce(true);

    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-B");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });
    expect(String(confirmSpy.mock.calls[0]?.[0] ?? "")).toMatch(/already has 1/);

    await waitFor(() => {
      const calls = apiRequestMock.mock.calls.filter(
        (c) =>
          c[0] === "POST" &&
          String(c[1]) === "/api/plan-markup-layers/L-qa/copy-to-document",
      );
      expect(calls.length).toBe(1);
      expect(calls[0][2]).toEqual({ targetDocumentId: "doc-B" });
    });
  });

  it("does not prompt when the destination has no existing copies", async () => {
    // copy-targets returns an entry for a *different* doc, so doc-B
    // has zero existing copies → no confirm, mutation fires.
    stubCopyTargetsFetch([{ documentId: "doc-other", existingCopyCount: 5 }]);

    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-B");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() => {
      const calls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "POST" && /copy-to-document/.test(String(c[1])),
      );
      expect(calls.length).toBe(1);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("falls through to the copy when the copy-targets lookup fails (best-effort)", async () => {
    // Network failure on the lookup must not silently swallow the
    // user's drag gesture — the copy still fires and the server's
    // own response surfaces any real error.
    fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrip();
    const target = screen.getByTestId("thumbnail-sheet-sheet-B");
    const dt = makeDataTransfer({
      [PLAN_MARKUP_LAYER_DRAG_MIME]: JSON.stringify({
        layerId: "L-qa",
        layerName: "QA/QC",
        sourceDocumentId: "doc-A",
      }),
    });

    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() => {
      const calls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "POST" && /copy-to-document/.test(String(c[1])),
      );
      expect(calls.length).toBe(1);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
