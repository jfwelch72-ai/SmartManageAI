// @vitest-environment jsdom
/**
 * Task #1878 — Deleting a non-default layer that still has markups on
 * it routes through the themed AlertDialog instead of the browser's
 * native `window.confirm()`. Empty layers continue to delete without
 * prompting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
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
    apiRequest: vi.fn(),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Radix's AlertDialog uses pointer events + portals that don't behave
// well in jsdom. Stub it with simple inline elements that respect the
// controlled `open` prop so the test can drive the themed dialog
// directly.
vi.mock("@/components/ui/alert-dialog", () => {
  const React = require("react");
  const AlertDialog = ({ open, onOpenChange, children }: any) =>
    React.createElement(
      "div",
      { "data-mock-alert-dialog": open ? "open" : "closed" },
      open
        ? React.Children.map(children, (child: any) =>
            React.isValidElement(child)
              ? React.cloneElement(child, { __onOpenChange: onOpenChange })
              : child,
          )
        : null,
    );
  const passThrough = (tag: string) => ({ children, ...rest }: any) =>
    React.createElement(tag, rest, children);
  const AlertDialogContent = ({ children, __onOpenChange, ...rest }: any) =>
    React.createElement("div", rest, children);
  const AlertDialogHeader = passThrough("div");
  const AlertDialogFooter = passThrough("div");
  const AlertDialogTitle = passThrough("h2");
  const AlertDialogDescription = passThrough("p");
  const AlertDialogAction = ({ children, onClick, ...rest }: any) =>
    React.createElement(
      "button",
      { ...rest, type: "button", onClick },
      children,
    );
  const AlertDialogCancel = ({ children, onClick, ...rest }: any) =>
    React.createElement(
      "button",
      { ...rest, type: "button", onClick },
      children,
    );
  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  };
});

// The delete flow doesn't open the dropdown menu, but the panel
// imports DropdownMenu unconditionally — provide a minimal stub to
// keep it inert in jsdom.
vi.mock("@/components/ui/dropdown-menu", () => {
  const React = require("react");
  const DropdownMenu = ({ children }: any) =>
    React.createElement("div", {}, children);
  const DropdownMenuTrigger = ({ children }: any) => {
    const child = React.Children.only(children);
    return child;
  };
  const DropdownMenuContent = () => null;
  const DropdownMenuLabel = ({ children }: any) =>
    React.createElement("div", {}, children);
  const DropdownMenuSeparator = () => React.createElement("div", {});
  const DropdownMenuItem = ({ children }: any) =>
    React.createElement("div", {}, children);
  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuItem,
  };
});

import MarkupLayersPanel, { type MarkupLayer } from "../MarkupLayersPanel";
import {
  apiRequest,
  queryClient as testQueryClient,
} from "@/lib/queryClient";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const DOC_ID = "doc-delete";
const layers: MarkupLayer[] = [
  {
    id: "L-default",
    planDocumentId: DOC_ID,
    name: "Default",
    color: "#000000",
    sortOrder: 1000,
    isDefault: true,
    isVisible: true,
    markupCount: 0,
  },
  {
    id: "L-rfi",
    planDocumentId: DOC_ID,
    name: "RFI Set",
    color: "#aabbcc",
    sortOrder: 2000,
    isDefault: false,
    isVisible: true,
    markupCount: 3,
  },
  {
    id: "L-empty",
    planDocumentId: DOC_ID,
    name: "Scratch",
    color: "#112233",
    sortOrder: 3000,
    isDefault: false,
    isVisible: true,
    markupCount: 0,
  },
];

const layersQueryKey = [
  "/api/plan-documents",
  DOC_ID,
  "markup-layers",
] as const;

function renderPanel() {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  );
  testQueryClient.setQueryData<MarkupLayer[]>(layersQueryKey, layers);
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
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  testQueryClient?.clear();
  vi.unstubAllGlobals();
});

describe("MarkupLayersPanel delete confirmation (Task #1878)", () => {
  it("opens the themed AlertDialog when deleting a non-default layer with markups, and cancel does NOT delete", async () => {
    renderPanel();

    // Sanity: no native window.confirm spy — the component should not
    // touch window.confirm at all on this path.
    const confirmSpy = vi.spyOn(window, "confirm");

    fireEvent.click(screen.getByTestId("button-markup-layer-delete-L-rfi"));

    await waitFor(() => {
      expect(screen.getByTestId("dialog-delete-layer")).toBeTruthy();
    });
    expect(confirmSpy).not.toHaveBeenCalled();

    // Surfaced text mentions the layer name and the markup count.
    const message = screen.getByTestId("text-delete-layer-message").textContent ?? "";
    expect(message).toMatch(/RFI Set/);
    expect(message).toMatch(/3 markups/);

    // Cancel → dialog closes, no DELETE fires.
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-delete-layer-cancel"));
    });

    expect(screen.queryByTestId("dialog-delete-layer")).toBeNull();
    const deleteCalls = apiRequestMock.mock.calls.filter((c) => c[0] === "DELETE");
    expect(deleteCalls.length).toBe(0);

    confirmSpy.mockRestore();
  });

  it("fires the DELETE request after the user confirms in the themed dialog", async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId("button-markup-layer-delete-L-rfi"));
    await waitFor(() => {
      expect(screen.getByTestId("dialog-delete-layer")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-delete-layer-confirm"));
    });

    await waitFor(() => {
      const deleteCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "DELETE" && /\/api\/plan-markup-layers\/L-rfi$/.test(String(c[1])),
      );
      expect(deleteCalls.length).toBe(1);
    });
    expect(screen.queryByTestId("dialog-delete-layer")).toBeNull();
  });

  it("uses the singular 'markup' wording when exactly one markup will be moved", async () => {
    testQueryClient.setQueryData<MarkupLayer[]>(layersQueryKey, [
      layers[0],
      { ...layers[1], markupCount: 1 },
    ]);
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
    );
    render(
      <MarkupLayersPanel
        documentId={DOC_ID}
        activeLayerId={null}
        onChangeActiveLayer={() => {}}
        hiddenLayerIds={new Set()}
        onChangeHiddenLayerIds={() => {}}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByTestId("button-markup-layer-delete-L-rfi"));
    await waitFor(() => {
      expect(screen.getByTestId("dialog-delete-layer")).toBeTruthy();
    });
    const message = screen.getByTestId("text-delete-layer-message").textContent ?? "";
    expect(message).toMatch(/1 markup will move/);
    expect(message).not.toMatch(/markups/);
  });

  it("deletes an empty non-default layer immediately without opening the dialog", async () => {
    renderPanel();
    const confirmSpy = vi.spyOn(window, "confirm");

    fireEvent.click(screen.getByTestId("button-markup-layer-delete-L-empty"));

    // No confirmation UI appears — the dialog is not opened and the
    // legacy native confirm is not consulted.
    expect(screen.queryByTestId("dialog-delete-layer")).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      const deleteCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "DELETE" && /\/api\/plan-markup-layers\/L-empty$/.test(String(c[1])),
      );
      expect(deleteCalls.length).toBe(1);
    });

    confirmSpy.mockRestore();
  });
});
