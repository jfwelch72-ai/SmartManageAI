// @vitest-environment jsdom
/**
 * Task #1702 — Keyboard reorder coverage for MarkupLayersPanel.
 *
 * The drag handle added in #1678 is mouse-only; this test pins down
 * that:
 *   1. Focusing the handle and pressing Alt+ArrowUp / Alt+ArrowDown
 *      reorders the layer through the same PATCH path as drag.
 *   2. The aria-live region announces the new position so screen
 *      reader users get parity feedback ("Moved … to position N of M").
 *   3. Pressing past the boundary is a no-op for PATCHes but still
 *      announces the current position.
 *   4. Plain ArrowUp/ArrowDown (without Alt) is ignored — Alt is the
 *      modifier so the unmodified keys remain available for normal
 *      browser/AT navigation.
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

beforeEach(() => {
  apiRequestMock.mockClear();
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
});

describe("MarkupLayersPanel keyboard reorder (Task #1702)", () => {
  it("Alt+ArrowUp on QA/QC moves it above Default and PATCHes new sortOrders", async () => {
    renderPanel();
    const handle = screen.getByTestId("button-markup-layer-drag-L-qa");
    fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });

    await waitFor(() => {
      const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
      expect(cached?.map((l) => l.id)).toEqual(["L-qa", "L-default", "L-design"]);
    });

    await waitFor(() => {
      const patchCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "PATCH" && /\/api\/plan-markup-layers\//.test(String(c[1])),
      );
      const byUrl = Object.fromEntries(
        patchCalls.map((c) => [String(c[1]).split("/").pop(), c[2] as { sortOrder: number }]),
      );
      expect(byUrl["L-qa"]).toEqual({ sortOrder: 1000 });
      expect(byUrl["L-default"]).toEqual({ sortOrder: 2000 });
      expect(byUrl["L-design"]).toBeUndefined();
    });

    expect(screen.getByTestId("text-markup-layer-live").textContent).toBe(
      "Moved QA/QC to position 1 of 3",
    );
  });

  it("Alt+ArrowDown on Default moves it down a slot and announces the new position", async () => {
    renderPanel();
    const handle = screen.getByTestId("button-markup-layer-drag-L-default");
    fireEvent.keyDown(handle, { key: "ArrowDown", altKey: true });

    await waitFor(() => {
      const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
      expect(cached?.map((l) => l.id)).toEqual(["L-qa", "L-default", "L-design"]);
    });

    expect(screen.getByTestId("text-markup-layer-live").textContent).toBe(
      "Moved Default to position 2 of 3",
    );
  });

  it("Alt+ArrowDown on the bottom row drops to nowhere and announces it stayed put", async () => {
    renderPanel();
    const handle = screen.getByTestId("button-markup-layer-drag-L-design");
    fireEvent.keyDown(handle, { key: "ArrowDown", altKey: true });

    // Yield once to let any queued microtasks settle.
    await Promise.resolve();
    const patchCalls = apiRequestMock.mock.calls.filter((c) => c[0] === "PATCH");
    expect(patchCalls.length).toBe(0);

    const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
    expect(cached?.map((l) => l.id)).toEqual(["L-default", "L-qa", "L-design"]);

    expect(screen.getByTestId("text-markup-layer-live").textContent).toBe(
      "Design Review is already at position 3 of 3",
    );
  });

  it("ArrowUp without Alt is ignored (no PATCH, no reorder, no announcement)", async () => {
    renderPanel();
    const handle = screen.getByTestId("button-markup-layer-drag-L-qa");
    fireEvent.keyDown(handle, { key: "ArrowUp" });

    await Promise.resolve();
    const patchCalls = apiRequestMock.mock.calls.filter((c) => c[0] === "PATCH");
    expect(patchCalls.length).toBe(0);

    const cached = testQueryClient.getQueryData<MarkupLayer[]>(queryKey);
    expect(cached?.map((l) => l.id)).toEqual(["L-default", "L-qa", "L-design"]);

    expect(screen.getByTestId("text-markup-layer-live").textContent).toBe("");
  });

  it("exposes a polite aria-live status region for the announcements", () => {
    renderPanel();
    const live = screen.getByTestId("text-markup-layer-live");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });
});
