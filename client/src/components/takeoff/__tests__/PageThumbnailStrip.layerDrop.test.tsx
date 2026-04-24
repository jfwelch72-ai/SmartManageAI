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

beforeEach(() => {
  apiRequestMock.mockClear();
  // jsdom doesn't implement scrollIntoView; the strip calls it on the
  // active thumbnail in a useEffect.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
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
