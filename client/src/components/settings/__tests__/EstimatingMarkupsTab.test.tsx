// @vitest-environment jsdom
// Task #2586 — Front-end coverage for the org-level Estimating Markups
// settings tab. Asserts: percent ↔ fraction round-trip, validation
// rejects negative / >100 / non-numeric, and that the save mutation
// posts the *fraction* payload to PUT /api/org/estimating-factors and
// surfaces the audit-log success toast on 2xx (failure on 4xx).
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

import { EstimatingMarkupsTab } from "../EstimatingMarkupsTab";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SERVER_FACTORS = {
  laborBurdenPercent: 0.25, // 25%
  smallToolsPercent: 0.03, // 3%
  overheadPercent: 0.1, // 10%
  profitPercent: 0.08, // 8%
  bondPercent: 0.0125, // 1.25%
  escalationPercent: 0.0,
  wasteFactorPercent: 0.05, // 5%
  updatedAt: "2026-04-01T12:00:00Z",
};

function renderTab() {
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
      <EstimatingMarkupsTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
  // Default GET handler — return server factors as fractions.
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && url === "/api/org/estimating-factors") {
      return jsonResponse(SERVER_FACTORS);
    }
    if (method === "PUT" && url === "/api/org/estimating-factors") {
      return jsonResponse({ ...SERVER_FACTORS, updatedAt: new Date().toISOString() });
    }
    return jsonResponse({});
  });
  // The tab's useQuery uses the default queryFn (not apiRequest), so
  // also intercept fetch for the GET load path.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/org/estimating-factors")) {
        return jsonResponse(SERVER_FACTORS);
      }
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EstimatingMarkupsTab — load + percent/fraction round-trip", () => {
  it("loads org factors and converts fractions to whole-number percents in the inputs", async () => {
    renderTab();

    await waitFor(() => {
      expect(
        (screen.getByTestId("input-laborBurdenPercent") as HTMLInputElement).value,
      ).toBe("25");
    });
    expect((screen.getByTestId("input-smallToolsPercent") as HTMLInputElement).value).toBe("3");
    expect((screen.getByTestId("input-overheadPercent") as HTMLInputElement).value).toBe("10");
    expect((screen.getByTestId("input-profitPercent") as HTMLInputElement).value).toBe("8");
    expect((screen.getByTestId("input-bondPercent") as HTMLInputElement).value).toBe("1.25");
    expect((screen.getByTestId("input-escalationPercent") as HTMLInputElement).value).toBe("0");
    expect((screen.getByTestId("input-wasteFactorPercent") as HTMLInputElement).value).toBe("5");
  });
});

describe("EstimatingMarkupsTab — validation", () => {
  async function loaded() {
    renderTab();
    await waitFor(() => {
      expect(
        (screen.getByTestId("input-laborBurdenPercent") as HTMLInputElement).value,
      ).toBe("25");
    });
  }

  it("rejects a negative value, surfaces the inline error, and does NOT call PUT", async () => {
    const user = userEvent.setup();
    await loaded();

    const input = screen.getByTestId("input-laborBurdenPercent") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "-5");
    await user.click(screen.getByTestId("button-save-estimating-markups"));

    await waitFor(() => {
      expect(screen.getByTestId("error-laborBurdenPercent")).toBeTruthy();
    });
    expect(screen.getByTestId("error-laborBurdenPercent").textContent).toContain("0 and 100");

    const putCalls = mockApiRequest.mock.calls.filter(
      ([method, url]) => method === "PUT" && url === "/api/org/estimating-factors",
    );
    expect(putCalls.length).toBe(0);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("rejects a value greater than 100 and does NOT call PUT", async () => {
    const user = userEvent.setup();
    await loaded();

    const input = screen.getByTestId("input-overheadPercent") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "150");
    await user.click(screen.getByTestId("button-save-estimating-markups"));

    await waitFor(() => {
      expect(screen.getByTestId("error-overheadPercent")).toBeTruthy();
    });
    const putCalls = mockApiRequest.mock.calls.filter(
      ([m, u]) => m === "PUT" && u === "/api/org/estimating-factors",
    );
    expect(putCalls.length).toBe(0);
  });

  it("rejects a non-numeric / blank value and does NOT call PUT", async () => {
    const user = userEvent.setup();
    await loaded();

    const input = screen.getByTestId("input-profitPercent") as HTMLInputElement;
    await user.clear(input);
    await user.click(screen.getByTestId("button-save-estimating-markups"));

    await waitFor(() => {
      expect(screen.getByTestId("error-profitPercent")).toBeTruthy();
    });
    const putCalls = mockApiRequest.mock.calls.filter(
      ([m, u]) => m === "PUT" && u === "/api/org/estimating-factors",
    );
    expect(putCalls.length).toBe(0);
  });
});

describe("EstimatingMarkupsTab — save success / failure", () => {
  it("converts each percent input back to a fraction and PUTs the full payload", async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => {
      expect(
        (screen.getByTestId("input-laborBurdenPercent") as HTMLInputElement).value,
      ).toBe("25");
    });

    const labor = screen.getByTestId("input-laborBurdenPercent") as HTMLInputElement;
    await user.clear(labor);
    await user.type(labor, "30");

    const overhead = screen.getByTestId("input-overheadPercent") as HTMLInputElement;
    await user.clear(overhead);
    await user.type(overhead, "12.5");

    await user.click(screen.getByTestId("button-save-estimating-markups"));

    await waitFor(() => {
      const putCalls = mockApiRequest.mock.calls.filter(
        ([m, u]) => m === "PUT" && u === "/api/org/estimating-factors",
      );
      expect(putCalls.length).toBe(1);
    });

    const [, , payload] = mockApiRequest.mock.calls.find(
      ([m, u]) => m === "PUT" && u === "/api/org/estimating-factors",
    )!;
    // Percent → fraction round-trip: 30 → 0.3, 12.5 → 0.125.
    expect(payload.laborBurdenPercent).toBeCloseTo(0.3, 6);
    expect(payload.overheadPercent).toBeCloseTo(0.125, 6);
    // Untouched fields are still sent as fractions, not as percents.
    expect(payload.smallToolsPercent).toBeCloseTo(0.03, 6);
    expect(payload.profitPercent).toBeCloseTo(0.08, 6);
    expect(payload.bondPercent).toBeCloseTo(0.0125, 6);
    expect(payload.wasteFactorPercent).toBeCloseTo(0.05, 6);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Estimating markups saved",
          description: expect.stringMatching(/audit log/i),
        }),
      );
    });
  });

  it("surfaces a destructive toast when the server returns an error", async () => {
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/org/estimating-factors") {
        return jsonResponse(SERVER_FACTORS);
      }
      if (method === "PUT" && url === "/api/org/estimating-factors") {
        throw new Error("boom from server");
      }
      return jsonResponse({});
    });

    const user = userEvent.setup();
    renderTab();
    await waitFor(() => {
      expect(
        (screen.getByTestId("input-laborBurdenPercent") as HTMLInputElement).value,
      ).toBe("25");
    });

    await user.click(screen.getByTestId("button-save-estimating-markups"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to save",
          variant: "destructive",
        }),
      );
    });
  });
});
