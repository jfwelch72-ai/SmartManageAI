// @vitest-environment jsdom
// Task #2586 — Front-end coverage for the per-estimate markup override
// drawer. Asserts: a partial override saves the entered factors and
// inherits the org default for blank fields, the Clear Override button
// only shows when an override is active and DELETEs through to the
// server, and the "Override" badge appears on the trigger when totals
// source = "estimate_override".
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockApiRequest, mockToast } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => ({}),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
  toast: mockToast,
}));

import { EstimateFactorsOverrideDrawer } from "../EstimateFactorsOverrideDrawer";

const ESTIMATE_ID = "est-abc-123";

const ORG_FACTORS = {
  laborBurdenPercent: 0.25,
  smallToolsPercent: 0.03,
  overheadPercent: 0.1,
  profitPercent: 0.08,
  bondPercent: 0.0125,
  escalationPercent: 0.0,
  wasteFactorPercent: 0.05,
  updatedAt: "2026-04-01T12:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Source = "estimate_override" | "org_default";

function setupApi(opts: { source: Source }) {
  // Both useQuery calls in this component go through the default
  // queryFn (fetch), and the mutations go through apiRequest.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/org/estimating-factors")) {
        return jsonResponse(ORG_FACTORS);
      }
      if (url.includes(`/api/estimates/${ESTIMATE_ID}/totals`)) {
        return jsonResponse({
          totals: {
            materialCost: 100,
            laborCost: 100,
            equipmentCost: 0,
            consumablesCost: 0,
            subcontractCost: 0,
            overhead: 0,
            profit: 0,
            bond: 0,
            escalation: 0,
            grandTotal: 200,
          },
          source: opts.source,
        });
      }
      return jsonResponse({});
    }),
  );

  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === "POST" && url === `/api/estimates/${ESTIMATE_ID}/factors-override`) {
      return jsonResponse({ override: { laborBurdenPercent: 0.5 } });
    }
    if (method === "DELETE" && url === `/api/estimates/${ESTIMATE_ID}/factors-override`) {
      return jsonResponse({ override: null });
    }
    return jsonResponse({});
  });
}

function renderDrawer() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = (queryKey as string[]).join("/");
          const res = await fetch(url, { credentials: "include" });
          return res.json();
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EstimateFactorsOverrideDrawer estimateId={ESTIMATE_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EstimateFactorsOverrideDrawer — Override badge visibility", () => {
  it("does NOT render the 'Override' badge when source = org_default", async () => {
    setupApi({ source: "org_default" });
    const user = userEvent.setup();
    renderDrawer();

    // Open the drawer to trigger the totals query.
    await user.click(screen.getByTestId("button-open-factors-override"));

    await waitFor(() => {
      expect(screen.getByTestId("input-override-laborBurdenPercent")).toBeTruthy();
    });
    expect(screen.queryByTestId("badge-override-active")).toBeNull();
    // Clear button is also gated on source === "estimate_override".
    expect(screen.queryByTestId("button-clear-factors-override")).toBeNull();
  });

  it("renders the 'Override' badge AND the Clear Override button when source = estimate_override", async () => {
    setupApi({ source: "estimate_override" });
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("button-open-factors-override"));

    await waitFor(() => {
      expect(screen.getByTestId("badge-override-active")).toBeTruthy();
    });
    expect(screen.getByTestId("button-clear-factors-override")).toBeTruthy();
  });
});

describe("EstimateFactorsOverrideDrawer — partial save", () => {
  it("POSTs only the entered factor as a fraction and inherits org defaults for blanks", async () => {
    setupApi({ source: "org_default" });
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("button-open-factors-override"));
    await waitFor(() => {
      expect(screen.getByTestId("input-override-laborBurdenPercent")).toBeTruthy();
    });

    const labor = screen.getByTestId(
      "input-override-laborBurdenPercent",
    ) as HTMLInputElement;
    await user.clear(labor);
    await user.type(labor, "40"); // 40% → 0.4

    await user.click(screen.getByTestId("button-save-factors-override"));

    await waitFor(() => {
      const postCalls = mockApiRequest.mock.calls.filter(
        ([m, u]) => m === "POST" && u === `/api/estimates/${ESTIMATE_ID}/factors-override`,
      );
      expect(postCalls.length).toBe(1);
    });

    const [, , payload] = mockApiRequest.mock.calls.find(
      ([m, u]) => m === "POST" && u === `/api/estimates/${ESTIMATE_ID}/factors-override`,
    )!;

    // The user-entered factor is converted percent → fraction.
    expect(payload.laborBurdenPercent).toBeCloseTo(0.4, 6);
    // Untouched factors carry the inherited org-default fraction so the
    // backend's "missing key → 0" normalization doesn't silently zero
    // them out.
    expect(payload.smallToolsPercent).toBeCloseTo(0.03, 6);
    expect(payload.overheadPercent).toBeCloseTo(0.1, 6);
    expect(payload.profitPercent).toBeCloseTo(0.08, 6);
    expect(payload.bondPercent).toBeCloseTo(0.0125, 6);
    expect(payload.escalationPercent).toBeCloseTo(0.0, 6);
    expect(payload.wasteFactorPercent).toBeCloseTo(0.05, 6);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Override saved" }),
      );
    });
  });

  it("refuses to save when no factor is overridden (every input blank)", async () => {
    setupApi({ source: "org_default" });
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("button-open-factors-override"));
    await waitFor(() => {
      expect(screen.getByTestId("input-override-laborBurdenPercent")).toBeTruthy();
    });

    await user.click(screen.getByTestId("button-save-factors-override"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to save override",
          variant: "destructive",
        }),
      );
    });
    const postCalls = mockApiRequest.mock.calls.filter(
      ([m, u]) => m === "POST" && u === `/api/estimates/${ESTIMATE_ID}/factors-override`,
    );
    expect(postCalls.length).toBe(0);
  });
});

describe("EstimateFactorsOverrideDrawer — clear override", () => {
  it("DELETEs the per-estimate override when Clear Override is clicked", async () => {
    setupApi({ source: "estimate_override" });
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("button-open-factors-override"));
    await waitFor(() => {
      expect(screen.getByTestId("button-clear-factors-override")).toBeTruthy();
    });

    await user.click(screen.getByTestId("button-clear-factors-override"));

    await waitFor(() => {
      const deleteCalls = mockApiRequest.mock.calls.filter(
        ([m, u]) =>
          m === "DELETE" && u === `/api/estimates/${ESTIMATE_ID}/factors-override`,
      );
      expect(deleteCalls.length).toBe(1);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Override cleared" }),
      );
    });
  });
});
