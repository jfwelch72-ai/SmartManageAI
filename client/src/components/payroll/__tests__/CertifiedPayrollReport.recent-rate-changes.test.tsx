// @vitest-environment jsdom
/**
 * Task #1450 — verifies that the certified payroll review screen mirrors
 * the project prevailing wage panel's "rate changed recently" surfaces:
 *
 *   1. A per-row badge appears for every employee whose classification
 *      has an unacknowledged Davis-Bacon rate-change record.
 *   2. A panel-level banner lists each affected (project, wage decision)
 *      pair with an Acknowledge action that POSTs to
 *      `/api/projects/:id/prevailing-wage-summary/acknowledge-rate-changes`.
 *   3. After acknowledging, the report query data updates and the cleared
 *      badge / banner disappear from the rendered output.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const { mockApiRequest, sharedQueryClient } = vi.hoisted(() => {
  return {
    mockApiRequest: vi.fn(),
    sharedQueryClient: { current: null as unknown as import("@tanstack/react-query").QueryClient },
  };
});

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  sharedQueryClient.current = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    apiRequest: mockApiRequest,
    queryClient: sharedQueryClient.current,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import CertifiedPayrollReportView from "../CertifiedPayrollReport";

const QUERY_KEY = ["/api/payroll/pay-runs", "pr-1", "certified-report"];

function makeReport(opts: { withChanges: boolean }) {
  return {
    header: {
      contractorName: "Acme Construction",
      payrollNumber: "1",
      weekEndingDate: "2026-04-19",
      projectName: "Test Project",
    },
    employees: [
      {
        name: "Alex Carpenter",
        workClassification: "Carpenter",
        regularHours: 40,
        overtimeHours: 0,
        totalHours: 40,
        rateOfPay: 50,
        overtimeRate: 75,
        grossEarned: 2000,
        fica: 0,
        withholdingTax: 0,
        otherDeductions: 0,
        totalDeductions: 0,
        netWages: 2000,
        projectName: "Test Project",
        prevailingRate: 50,
        belowPrevailingWage: false,
        prevailingRateSource: "DOL_FEED" as const,
        recentRateChange: opts.withChanges
          ? { changeKind: "changed" as const, detectedAt: "2026-04-20T12:00:00Z" }
          : null,
      },
      {
        name: "Pat Electrician",
        workClassification: "Electrician",
        regularHours: 40,
        overtimeHours: 0,
        totalHours: 40,
        rateOfPay: 60,
        overtimeRate: 90,
        grossEarned: 2400,
        fica: 0,
        withholdingTax: 0,
        otherDeductions: 0,
        totalDeductions: 0,
        netWages: 2400,
        projectName: "Test Project",
        prevailingRate: 60,
        belowPrevailingWage: false,
        prevailingRateSource: "DOL_FEED" as const,
        recentRateChange: null,
      },
    ],
    totals: { totalGross: 4400, totalDeductions: 0, totalNet: 4400 },
    statementOfCompliance: {
      fringeBenefitsPaidToPlan: false,
      fringeBenefitsPaidInCash: false,
      noFringeBenefitsRequired: true,
    },
    recentRateChanges: opts.withChanges
      ? [
          {
            projectId: "proj-1",
            projectName: "Test Project",
            wageDecision: "WD-2026-1",
            count: 1,
            latestDetectedAt: "2026-04-20T12:00:00Z",
            classifications: ["Carpenter"],
          },
        ]
      : [],
  };
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  }
});

beforeEach(() => {
  mockApiRequest.mockReset();
  sharedQueryClient.current.clear();
});

afterEach(() => cleanup());

function renderView() {
  return render(
    <QueryClientProvider client={sharedQueryClient.current}>
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent>
          <CertifiedPayrollReportView payRunId="pr-1" payRunNumber="1" />
        </DialogContent>
      </Dialog>
    </QueryClientProvider>,
  );
}

describe("CertifiedPayrollReportView — recent rate changes (Task #1450)", () => {
  it("renders the per-row badge and the panel banner when an unacknowledged change is on the pay run", () => {
    sharedQueryClient.current.setQueryData(QUERY_KEY, makeReport({ withChanges: true }));

    renderView();

    expect(screen.getByTestId("badge-rate-changed-0")).toBeTruthy();
    expect(screen.queryByTestId("badge-rate-changed-1")).toBeNull();
    expect(screen.getByTestId("banner-certified-rates-changed")).toBeTruthy();
    expect(screen.getByTestId("row-recent-rate-change-proj-1")).toBeTruthy();
    expect(screen.getByTestId("button-acknowledge-rate-changes-proj-1")).toBeTruthy();
  });

  it("does not render any rate-change UI when there are no unacknowledged changes", () => {
    sharedQueryClient.current.setQueryData(QUERY_KEY, makeReport({ withChanges: false }));

    renderView();

    expect(screen.queryByTestId("badge-rate-changed-0")).toBeNull();
    expect(screen.queryByTestId("banner-certified-rates-changed")).toBeNull();
  });

  it("clicking Acknowledge POSTs to the project's acknowledge endpoint and the cleared report removes the badge and banner", async () => {
    sharedQueryClient.current.setQueryData(QUERY_KEY, makeReport({ withChanges: true }));

    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      // Swap the cached report for the cleared shape so the post-mutation
      // invalidate -> refetch reads fresh, change-free data without
      // hitting the network.
      if (
        method === "POST" &&
        url === "/api/projects/proj-1/prevailing-wage-summary/acknowledge-rate-changes"
      ) {
        sharedQueryClient.current.setQueryData(QUERY_KEY, makeReport({ withChanges: false }));
        return new Response(JSON.stringify({ acknowledged: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected apiRequest call: ${method} ${url}`);
    });

    renderView();

    expect(screen.getByTestId("badge-rate-changed-0")).toBeTruthy();
    expect(screen.getByTestId("banner-certified-rates-changed")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-acknowledge-rate-changes-proj-1"));

    await waitFor(() => {
      expect(screen.queryByTestId("banner-certified-rates-changed")).toBeNull();
    });
    expect(screen.queryByTestId("badge-rate-changed-0")).toBeNull();

    const ackCall = mockApiRequest.mock.calls.find(
      (c) =>
        c[0] === "POST" &&
        c[1] === "/api/projects/proj-1/prevailing-wage-summary/acknowledge-rate-changes",
    );
    expect(ackCall).toBeTruthy();
  });
});
