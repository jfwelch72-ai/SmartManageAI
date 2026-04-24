// @vitest-environment jsdom
/**
 * Task #1722 — "Copy to sheet" picker shows existing-copy badges per
 * destination and confirms before creating a duplicate.
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

// Radix's DropdownMenu uses pointer events + portals that don't behave
// well in jsdom. Replace it with simple inline elements that respect
// the controlled `open` prop. The trigger calls onOpenChange(true) on
// click and the content renders inline (no portal). Menu items invoke
// onSelect with a mock event so the panel's preventDefault check still
// runs.
vi.mock("@/components/ui/dropdown-menu", () => {
  const React = require("react");
  const DropdownMenu = ({ open, onOpenChange, children }: any) => {
    return React.createElement(
      "div",
      { "data-mock-dropdown": open ? "open" : "closed" },
      React.Children.map(children, (child: any) =>
        React.cloneElement(child, { __open: open, __onOpenChange: onOpenChange }),
      ),
    );
  };
  const DropdownMenuTrigger = ({ children, __onOpenChange, __open }: any) => {
    const child = React.Children.only(children);
    return React.cloneElement(child, {
      onClick: (e: any) => {
        child.props.onClick?.(e);
        __onOpenChange?.(!__open);
      },
    });
  };
  const DropdownMenuContent = ({ children, __open }: any) =>
    __open ? React.createElement("div", {}, children) : null;
  const DropdownMenuLabel = ({ children }: any) =>
    React.createElement("div", {}, children);
  const DropdownMenuSeparator = () => React.createElement("div", {});
  const DropdownMenuItem = ({ children, onSelect, ...rest }: any) => {
    return React.createElement(
      "div",
      {
        ...rest,
        role: "menuitem",
        onClick: () => {
          const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
          onSelect?.(e);
        },
      },
      children,
    );
  };
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

const DOC_ID = "doc-source";
const layers: MarkupLayer[] = [
  {
    id: "L-rfi",
    planDocumentId: DOC_ID,
    name: "RFI Set",
    color: "#aabbcc",
    sortOrder: 1000,
    isDefault: false,
    isVisible: true,
    markupCount: 4,
  },
];

const layersQueryKey = [
  "/api/plan-documents",
  DOC_ID,
  "markup-layers",
] as const;

const destinations = [
  { id: "doc-b", label: "Sheet B" },
  { id: "doc-c", label: "Sheet C" },
];

let fetchMock: ReturnType<typeof vi.fn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;

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
      copyDestinations={destinations}
    />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      layer: { id: "new-layer", name: "RFI Set (copy)" },
      markupsCopied: 0,
    }),
  }));
  fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/copy-targets")) {
      return new Response(
        JSON.stringify({
          targets: [
            {
              documentId: "doc-b",
              existingCopyCount: 2,
              lastCopiedAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  confirmSpy = vi.spyOn(window, "confirm");
});

afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
  testQueryClient?.clear();
  vi.unstubAllGlobals();
});

describe("MarkupLayersPanel copy-targets badges + confirm (Task #1722)", () => {
  it("renders an existing-copy badge for destinations the user has already copied to", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("button-markup-layer-copy-L-rfi"));

    // Wait for the copy-targets fetch to populate the badge.
    await waitFor(() => {
      expect(
        screen.getByTestId("badge-markup-layer-copy-existing-L-rfi-to-doc-b"),
      ).toBeTruthy();
    });
    expect(
      screen.getByTestId("badge-markup-layer-copy-existing-L-rfi-to-doc-b")
        .textContent,
    ).toMatch(/2 copies/);
    // Sheet C has no copies → no badge.
    expect(
      screen.queryByTestId("badge-markup-layer-copy-existing-L-rfi-to-doc-c"),
    ).toBeNull();
  });

  it("confirms before creating a second copy on a destination that already has one", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("button-markup-layer-copy-L-rfi"));
    await waitFor(() => {
      expect(
        screen.getByTestId("badge-markup-layer-copy-existing-L-rfi-to-doc-b"),
      ).toBeTruthy();
    });

    // User cancels the duplicate-warning confirm → no API call.
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("menu-markup-layer-copy-L-rfi-to-doc-b"),
      );
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const postCallsAfterCancel = apiRequestMock.mock.calls.filter(
      (c) => c[0] === "POST",
    );
    expect(postCallsAfterCancel.length).toBe(0);

    // User accepts → POST to copy-to-document fires.
    confirmSpy.mockReturnValueOnce(true);
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("menu-markup-layer-copy-L-rfi-to-doc-b"),
      );
    });
    await waitFor(() => {
      const postCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "POST" && /copy-to-document/.test(String(c[1])),
      );
      expect(postCalls.length).toBe(1);
      expect(postCalls[0][1]).toContain("/api/plan-markup-layers/L-rfi/copy-to-document");
      expect(postCalls[0][2]).toEqual({ targetDocumentId: "doc-b" });
    });
  });

  it("renders a relative 'last copied' timestamp next to the existing-copy badge (Task #1804)", async () => {
    // Override the default fetch mock with one fresh copy (just now)
    // and one stale copy (~3 days ago) so we can assert both flavours
    // of the relative label appear in the picker.
    const threeDaysAgoIso = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000 - 60_000,
    ).toISOString();
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/copy-targets")) {
        return new Response(
          JSON.stringify({
            targets: [
              {
                documentId: "doc-b",
                existingCopyCount: 1,
                lastCopiedAt: new Date().toISOString(),
              },
              {
                documentId: "doc-c",
                existingCopyCount: 2,
                lastCopiedAt: threeDaysAgoIso,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("[]", { status: 200 });
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("button-markup-layer-copy-L-rfi"));

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "text-markup-layer-copy-last-copied-L-rfi-to-doc-b",
        ),
      ).toBeTruthy();
    });
    expect(
      screen
        .getByTestId("text-markup-layer-copy-last-copied-L-rfi-to-doc-b")
        .textContent,
    ).toBe("just now");
    expect(
      screen
        .getByTestId("text-markup-layer-copy-last-copied-L-rfi-to-doc-c")
        .textContent,
    ).toMatch(/3 days ago/);
  });

  it("omits the 'last copied' timestamp on destinations with zero copies (Task #1804)", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("button-markup-layer-copy-L-rfi"));
    await waitFor(() => {
      expect(
        screen.getByTestId("menu-markup-layer-copy-L-rfi-to-doc-c"),
      ).toBeTruthy();
    });
    // Sheet C has no existing copies in the default mock → no timestamp.
    expect(
      screen.queryByTestId(
        "text-markup-layer-copy-last-copied-L-rfi-to-doc-c",
      ),
    ).toBeNull();
  });

  it("refreshes the 'last copied' label on a 30s interval while the picker stays open (Task #1848)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const baseTime = new Date("2026-04-24T12:00:00.000Z").getTime();
      vi.setSystemTime(baseTime);

      // 30s before the test starts → "just now" on the first render.
      const lastCopiedAt = new Date(baseTime - 30_000).toISOString();
      fetchMock.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/copy-targets")) {
          return new Response(
            JSON.stringify({
              targets: [
                {
                  documentId: "doc-b",
                  existingCopyCount: 1,
                  lastCopiedAt,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("[]", { status: 200 });
      });

      renderPanel();
      fireEvent.click(screen.getByTestId("button-markup-layer-copy-L-rfi"));

      await waitFor(() => {
        expect(
          screen.getByTestId(
            "text-markup-layer-copy-last-copied-L-rfi-to-doc-b",
          ).textContent,
        ).toBe("just now");
      });

      // No new network requests should be issued by the relabel — we
      // snapshot the call count and assert it doesn't move when the
      // tick fires.
      const fetchCallsBefore = fetchMock.mock.calls.length;

      // Jump ~2 minutes into the future and let the 30s interval fire.
      await act(async () => {
        vi.setSystemTime(baseTime + 2 * 60 * 1000);
        vi.advanceTimersByTime(30_000);
      });

      await waitFor(() => {
        expect(
          screen.getByTestId(
            "text-markup-layer-copy-last-copied-L-rfi-to-doc-b",
          ).textContent,
        ).toMatch(/minute(s)? ago/);
      });
      expect(fetchMock.mock.calls.length).toBe(fetchCallsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT confirm for destinations with zero existing copies", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("button-markup-layer-copy-L-rfi"));
    await waitFor(() => {
      expect(
        screen.getByTestId("menu-markup-layer-copy-L-rfi-to-doc-c"),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("menu-markup-layer-copy-L-rfi-to-doc-c"),
      );
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      const postCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "POST" && /copy-to-document/.test(String(c[1])),
      );
      expect(postCalls.length).toBe(1);
      expect(postCalls[0][2]).toEqual({ targetDocumentId: "doc-c" });
    });
  });
});
