// @vitest-environment jsdom
/**
 * Task #1703 — Unit coverage for LayerPickerExportDialog.
 *
 * Validates that:
 *   1. The dialog hydrates the layer list from the markup-layers API
 *      and pre-selects every layer by default.
 *   2. "Select none" / individual checkboxes update the selection.
 *   3. Clicking "Export" opens a window with
 *      `?includeMarkups=true&layerIds=<csv>` and uses the
 *      `__default__` sentinel for the auto-default layer (instead of
 *      its real UUID), so legacy null-layer markups are picked up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import LayerPickerExportDialog from "../LayerPickerExportDialog";

const DOC_ID = "doc-1";

const layers = [
  {
    id: "L-default",
    planDocumentId: DOC_ID,
    name: "Default",
    color: "#94a3b8",
    sortOrder: 1000,
    isDefault: true,
    isVisible: true,
    markupCount: 4,
  },
  {
    id: "L-qa",
    planDocumentId: DOC_ID,
    name: "QA/QC",
    color: "#ef4444",
    sortOrder: 2000,
    isDefault: false,
    isVisible: true,
    markupCount: 7,
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

let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof fetch | undefined;
let originalOpen: typeof window.open;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    },
  });
}

function renderDialog(client = makeClient()) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <LayerPickerExportDialog
      open={true}
      onOpenChange={() => {}}
      documentId={DOC_ID}
      documentLabel="Sheet A.pdf"
    />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => layers,
  })) as unknown as ReturnType<typeof vi.fn>;
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  openMock = vi.fn();
  originalOpen = window.open;
  window.open = openMock as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
  if (originalFetch) globalThis.fetch = originalFetch;
  window.open = originalOpen;
});

describe("LayerPickerExportDialog (Task #1703)", () => {
  it("loads layers from the markup-layers API and pre-selects all of them", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId(`text-layer-name-L-default`)).toBeTruthy();
      expect(screen.getByTestId(`text-layer-name-L-qa`)).toBeTruthy();
      expect(screen.getByTestId(`text-layer-name-L-design`)).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      `/api/plan-documents/${encodeURIComponent(DOC_ID)}/markup-layers`,
    );

    expect(screen.getByTestId("text-layer-picker-count").textContent).toBe(
      "3 of 3 selected",
    );

    for (const l of layers) {
      const cb = screen.getByTestId(`checkbox-layer-${l.id}`) as HTMLButtonElement;
      expect(cb.getAttribute("aria-checked")).toBe("true");
    }
  });

  it("Export opens the PDF URL with __default__ for the auto-default layer and real UUIDs otherwise", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId(`checkbox-layer-L-qa`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-layer-picker-export"));

    expect(openMock).toHaveBeenCalledTimes(1);
    const url = String((openMock.mock.calls[0] as unknown[])[0]);
    expect(url.startsWith(
      `/api/plan-documents/${encodeURIComponent(DOC_ID)}/export.pdf?`,
    )).toBe(true);

    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("includeMarkups")).toBe("true");
    const ids = (qs.get("layerIds") ?? "").split(",").filter(Boolean);
    expect(new Set(ids)).toEqual(new Set(["__default__", "L-qa", "L-design"]));
    // No real UUID for the default layer should leak into the URL.
    expect(ids).not.toContain("L-default");
  });

  it("Select none disables the Export button and clears the selection count", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId(`checkbox-layer-L-qa`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-layer-picker-select-none"));
    expect(screen.getByTestId("text-layer-picker-count").textContent).toBe(
      "0 of 3 selected",
    );
    const exportBtn = screen.getByTestId("button-layer-picker-export") as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);

    fireEvent.click(exportBtn);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("Toggling a single layer off omits it from the exported layerIds CSV", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId(`checkbox-layer-L-qa`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(`checkbox-layer-L-qa`));
    expect(screen.getByTestId("text-layer-picker-count").textContent).toBe(
      "2 of 3 selected",
    );

    fireEvent.click(screen.getByTestId("button-layer-picker-export"));
    const url = String((openMock.mock.calls[0] as unknown[])[0]);
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    const ids = (qs.get("layerIds") ?? "").split(",").filter(Boolean);
    expect(new Set(ids)).toEqual(new Set(["__default__", "L-design"]));
  });

  it("Select all re-fills the selection after a Select none", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId(`checkbox-layer-L-qa`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-layer-picker-select-none"));
    fireEvent.click(screen.getByTestId("button-layer-picker-select-all"));
    expect(screen.getByTestId("text-layer-picker-count").textContent).toBe(
      "3 of 3 selected",
    );
  });
});
