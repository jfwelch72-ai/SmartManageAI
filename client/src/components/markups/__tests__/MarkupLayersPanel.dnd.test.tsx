// @vitest-environment jsdom
/**
 * Task #1678 — Drag-and-drop reorder coverage for MarkupLayersPanel.
 *
 * The PATCH /api/plan-markup-layers/:id endpoint already accepts a
 * `sortOrder` field; this test pins down that:
 *   1. Each row exposes a draggable handle.
 *   2. Dragging a row onto another row produces PATCH calls with
 *      renumbered sortOrder values that match the new visual order.
 *   3. The default layer participates in reordering (no longer pinned).
 *   4. Dropping onto the dedicated end-of-list zone moves the row to
 *      the bottom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
    apiRequest: vi.fn(async () => ({ ok: true } as unknown as Response)),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import MarkupLayersPanel, { type MarkupLayer } from "../MarkupLayersPanel";
import { apiRequest, queryClient as testQueryClient } from "@/lib/queryClient";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const DOC_ID = "doc-1";
const layers: MarkupLayer[] = [
  {
    id: "L-default",
    planDocumentId: DOC_ID,
    name: "Default",
    color: "#94a3b8",
    sortOrder: 1000,
    isDefault: true,
    isVisible: true,
    markupCount: 0,
  },
  {
    id: "L-qa",
    planDocumentId: DOC_ID,
    name: "QA/QC",
    color: "#ef4444",
    sortOrder: 2000,
    isDefault: false,
    isVisible: true,
    markupCount: 0,
  },
  {
    id: "L-design",
    planDocumentId: DOC_ID,
    name: "Design Review",
    color: "#3b82f6",
    sortOrder: 3000,
    isDefault: false,
    isVisible: true,
    markupCount: 0,
  },
];

const queryKey = ["/api/plan-documents", DOC_ID, "markup-layers"] as const;

function renderPanel() {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  );
  // Pre-seed the query cache so the panel renders synchronously without
  // hitting the network. This mirrors how the parent (PlansTab) already
  // has the data when this dialog is mounted in production.
  testQueryClient.setQueryData<MarkupLayer[]>(queryKey, layers);
  return render(
    <MarkupLayersPanel
      documentId={DOC_ID}
      activeLayerId={null}
      onChangeActiveLayer={() => {}}
      hiddenLayerIds={new Set()}
      onChangeHiddenLayerIds={() => {}}
    />,
    { wrapper: Wrapper },
  );
}

function makeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as readonly string[],
    clearData: () => store.clear(),
    getData: (k: string) => store.get(k) ?? "",
    setData: (k: string, v: string) => {
      store.set(k, v);
    },
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

beforeEach(() => {
  apiRequestMock.mockClear();
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
});

describe("MarkupLayersPanel drag-and-drop reorder (Task #1678)", () => {
  it("renders a drag handle on every row, including the default layer", () => {
    renderPanel();
    expect(screen.getByTestId("button-markup-layer-drag-L-default")).toBeTruthy();
    expect(screen.getByTestId("button-markup-layer-drag-L-qa")).toBeTruthy();
    expect(screen.getByTestId("button-markup-layer-drag-L-design")).toBeTruthy();
  });

  it("dragging QA/QC onto Default reorders it above and PATCHes new sortOrders", async () => {
    renderPanel();
    const sourceHandle = screen.getByTestId("button-markup-layer-drag-L-qa");
    const targetRow = screen.getByTestId("row-markup-layer-L-default");
    const dt = makeDataTransfer();

    fireEvent.dragStart(sourceHandle, { dataTransfer: dt });
    fireEvent.dragOver(targetRow, { dataTransfer: dt });
    fireEvent.drop(targetRow, { dataTransfer: dt });

    // Optimistic cache update: QA/QC should now be the first row.
    await waitFor(() => {
      const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
      expect(cached?.map((l) => l.id)).toEqual(["L-qa", "L-default", "L-design"]);
    });

    // PATCH was issued for the two layers whose sortOrder changed
    // (L-design keeps sortOrder=3000 since it is still in slot #3).
    await waitFor(() => {
      const patchCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "PATCH" && /\/api\/plan-markup-layers\//.test(String(c[1])),
      );
      expect(patchCalls.length).toBe(2);
      const byUrl = Object.fromEntries(
        patchCalls.map((c) => [String(c[1]).split("/").pop(), c[2] as { sortOrder: number }]),
      );
      expect(byUrl["L-qa"]).toEqual({ sortOrder: 1000 });
      expect(byUrl["L-default"]).toEqual({ sortOrder: 2000 });
      expect(byUrl["L-design"]).toBeUndefined();
    });
  });

  it("dropping Default onto the end zone moves it to the bottom (no longer pinned)", async () => {
    renderPanel();
    const sourceHandle = screen.getByTestId("button-markup-layer-drag-L-default");
    const endZone = screen.getByTestId("dropzone-markup-layer-end");
    const dt = makeDataTransfer();

    fireEvent.dragStart(sourceHandle, { dataTransfer: dt });
    fireEvent.dragOver(endZone, { dataTransfer: dt });
    fireEvent.drop(endZone, { dataTransfer: dt });

    await waitFor(() => {
      const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
      expect(cached?.map((l) => l.id)).toEqual(["L-qa", "L-design", "L-default"]);
    });

    await waitFor(() => {
      const patchCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "PATCH" && /\/api\/plan-markup-layers\//.test(String(c[1])),
      );
      const byUrl = Object.fromEntries(
        patchCalls.map((c) => [String(c[1]).split("/").pop(), c[2] as { sortOrder: number }]),
      );
      expect(byUrl["L-qa"]).toEqual({ sortOrder: 1000 });
      expect(byUrl["L-design"]).toEqual({ sortOrder: 2000 });
      expect(byUrl["L-default"]).toEqual({ sortOrder: 3000 });
    });
  });

  it("dropping a row onto itself is a no-op (no PATCH calls)", async () => {
    renderPanel();
    const handle = screen.getByTestId("button-markup-layer-drag-L-qa");
    const ownRow = screen.getByTestId("row-markup-layer-L-qa");
    const dt = makeDataTransfer();

    fireEvent.dragStart(handle, { dataTransfer: dt });
    fireEvent.dragOver(ownRow, { dataTransfer: dt });
    fireEvent.drop(ownRow, { dataTransfer: dt });

    // Yield once to let any queued microtasks settle.
    await Promise.resolve();
    const patchCalls = apiRequestMock.mock.calls.filter((c) => c[0] === "PATCH");
    expect(patchCalls.length).toBe(0);

    const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
    expect(cached?.map((l) => l.id)).toEqual(["L-default", "L-qa", "L-design"]);
  });
});
