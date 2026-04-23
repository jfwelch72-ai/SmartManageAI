// @vitest-environment jsdom
/**
 * Task #1384 — verifies the integrations-page panel that surfaces, in
 * real time, how many Davis-Bacon auto-sync failure alerts have been
 * absorbed by the coalescing window since the last delivery.
 *
 *   - hides itself when the API returns no items, or only items that
 *     belong to a different connection on the same org
 *   - lists each (decision, suppressedCount, since) and shows an
 *     aggregate header with the earliest "since" timestamp
 *   - re-renders when the cache is updated (simulating the streak of
 *     failures driving the suppressedCount upward) so admins watching
 *     an active outage see the count climb without a page refresh
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
    getQueryFn: () => async () => ({ items: [] }),
  };
});

import { DavisBaconSuppressedFailuresPanel } from "../IntegrationProviderCard";
import type { SuppressedFailuresResponse } from "../types";

function renderPanel(connectionId: string, response: SuppressedFailuresResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/integrations/davis-bacon/suppressed-failures"], response);
  const utils = render(
    <QueryClientProvider client={qc}>
      <DavisBaconSuppressedFailuresPanel connectionId={connectionId} />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

describe("DavisBaconSuppressedFailuresPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-04-23T15:00:00Z") });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing when the org has no suppressed failures", () => {
    renderPanel("conn-1", { items: [] });
    expect(screen.queryByTestId("panel-davis-bacon-suppressed-failures-conn-1")).toBeNull();
  });

  it("ignores items belonging to a different connection on the same org", () => {
    renderPanel("conn-1", {
      items: [
        {
          connectionId: "conn-other",
          decisionNumber: "CA20260111",
          suppressedCount: 12,
          suppressedSince: Date.now() - 60_000,
          lastNotifiedAt: Date.now() - 120_000,
        },
      ],
    });
    expect(screen.queryByTestId("panel-davis-bacon-suppressed-failures-conn-1")).toBeNull();
  });

  it("lists each (decision, count, since) and aggregates the header", () => {
    const tEarly = new Date("2026-04-23T14:34:00Z").getTime();
    const tLate = new Date("2026-04-23T14:50:00Z").getTime();
    renderPanel("conn-1", {
      items: [
        {
          connectionId: "conn-1",
          decisionNumber: "CA20260111",
          suppressedCount: 25,
          suppressedSince: tEarly,
          lastNotifiedAt: tEarly - 30 * 60_000,
        },
        {
          connectionId: "conn-1",
          decisionNumber: "CA20260222",
          suppressedCount: 12,
          suppressedSince: tLate,
          lastNotifiedAt: tLate - 30 * 60_000,
        },
      ],
    });

    expect(screen.getByTestId("panel-davis-bacon-suppressed-failures-conn-1")).toBeTruthy();
    const summary = screen.getByTestId("text-davis-bacon-suppressed-summary-conn-1");
    expect(summary.textContent).toContain("37 failure alerts suppressed");
    // Earliest since timestamp is rendered in the summary.
    expect(summary.textContent).toContain(new Date(tEarly).toLocaleString());

    expect(
      screen.getByTestId("text-davis-bacon-suppressed-count-CA20260111").textContent,
    ).toBe("25");
    expect(
      screen.getByTestId("text-davis-bacon-suppressed-count-CA20260222").textContent,
    ).toBe("12");
    expect(
      screen.getByTestId("text-davis-bacon-suppressed-since-CA20260111").textContent,
    ).toBe(new Date(tEarly).toLocaleString());
  });

  it("updates the displayed count when the cache refreshes mid-outage", async () => {
    vi.useRealTimers();
    const tStart = new Date("2026-04-23T14:34:00Z").getTime();
    const { qc } = renderPanel("conn-1", {
      items: [
        {
          connectionId: "conn-1",
          decisionNumber: "CA20260999",
          suppressedCount: 5,
          suppressedSince: tStart,
          lastNotifiedAt: tStart - 60_000,
        },
      ],
    });
    expect(
      screen.getByTestId("text-davis-bacon-suppressed-count-CA20260999").textContent,
    ).toBe("5");

    // Simulate the next poll bringing in an updated count after another
    // 32 failures were absorbed by the window.
    act(() => {
      qc.setQueryData(["/api/integrations/davis-bacon/suppressed-failures"], {
        items: [
          {
            connectionId: "conn-1",
            decisionNumber: "CA20260999",
            suppressedCount: 37,
            suppressedSince: tStart,
            lastNotifiedAt: tStart - 60_000,
          },
        ],
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("text-davis-bacon-suppressed-count-CA20260999").textContent,
      ).toBe("37");
    });
    expect(
      screen.getByTestId("text-davis-bacon-suppressed-summary-conn-1").textContent,
    ).toContain("37 failure alerts suppressed");
  });

  it("clears itself when a successful sync resolves the streak", async () => {
    vi.useRealTimers();
    const tStart = Date.now() - 30 * 60_000;
    const { qc } = renderPanel("conn-1", {
      items: [
        {
          connectionId: "conn-1",
          decisionNumber: "CA20260999",
          suppressedCount: 9,
          suppressedSince: tStart,
          lastNotifiedAt: tStart - 60_000,
        },
      ],
    });
    expect(screen.getByTestId("panel-davis-bacon-suppressed-failures-conn-1")).toBeTruthy();

    act(() => {
      qc.setQueryData(["/api/integrations/davis-bacon/suppressed-failures"], { items: [] });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("panel-davis-bacon-suppressed-failures-conn-1")).toBeNull();
    });
  });
});
