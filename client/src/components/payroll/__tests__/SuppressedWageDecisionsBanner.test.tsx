// @vitest-environment jsdom
/**
 * Task #1402 — verifies the payroll-page suppressed-failures banner
 * mirrors the integrations-page panel: hides when nothing is suppressed,
 * lists each (decision, count, since), updates as the cache refreshes
 * mid-outage, and auto-clears when the next successful sync resolves the
 * streak.
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

import { SuppressedWageDecisionsBanner } from "../SuppressedWageDecisionsBanner";
import type { SuppressedFailuresResponse } from "@/components/integrations/types";

function renderBanner(response: SuppressedFailuresResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/integrations/davis-bacon/suppressed-failures"], response);
  const utils = render(
    <QueryClientProvider client={qc}>
      <SuppressedWageDecisionsBanner />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

describe("SuppressedWageDecisionsBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-04-23T15:00:00Z") });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing when no failures are suppressed", () => {
    renderBanner({ items: [] });
    expect(screen.queryByTestId("banner-payroll-suppressed-wage-decisions")).toBeNull();
  });

  it("lists each decision with its absorbed count and 'since' timestamp", () => {
    const tEarly = new Date("2026-04-23T14:34:00Z").getTime();
    const tLate = new Date("2026-04-23T14:50:00Z").getTime();
    renderBanner({
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

    expect(screen.getByTestId("banner-payroll-suppressed-wage-decisions")).toBeTruthy();
    const summary = screen.getByTestId("text-payroll-suppressed-summary");
    expect(summary.textContent).toContain("37 wage-decision sync failures suppressed");
    expect(summary.textContent).toContain(new Date(tEarly).toLocaleString());

    expect(
      screen.getByTestId("text-payroll-suppressed-count-CA20260111").textContent,
    ).toBe("25");
    expect(
      screen.getByTestId("text-payroll-suppressed-since-CA20260111").textContent,
    ).toBe(new Date(tEarly).toLocaleString());
    expect(
      screen.getByTestId("text-payroll-suppressed-count-CA20260222").textContent,
    ).toBe("12");
  });

  it("updates the displayed count when the cache refreshes mid-outage", async () => {
    vi.useRealTimers();
    const tStart = new Date("2026-04-23T14:34:00Z").getTime();
    const { qc } = renderBanner({
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
      screen.getByTestId("text-payroll-suppressed-count-CA20260999").textContent,
    ).toBe("5");

    act(() => {
      qc.setQueryData(["/api/integrations/davis-bacon/suppressed-failures"], {
        items: [
          {
            connectionId: "conn-1",
            decisionNumber: "CA20260999",
            suppressedCount: 41,
            suppressedSince: tStart,
            lastNotifiedAt: tStart - 60_000,
          },
        ],
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("text-payroll-suppressed-count-CA20260999").textContent,
      ).toBe("41");
    });
    expect(
      screen.getByTestId("text-payroll-suppressed-summary").textContent,
    ).toContain("41 wage-decision sync failures suppressed");
  });

  it("auto-clears when the next successful sync resolves the streak", async () => {
    vi.useRealTimers();
    const tStart = Date.now() - 30 * 60_000;
    const { qc } = renderBanner({
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
    expect(screen.getByTestId("banner-payroll-suppressed-wage-decisions")).toBeTruthy();

    act(() => {
      qc.setQueryData(["/api/integrations/davis-bacon/suppressed-failures"], { items: [] });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("banner-payroll-suppressed-wage-decisions")).toBeNull();
    });
  });
});
