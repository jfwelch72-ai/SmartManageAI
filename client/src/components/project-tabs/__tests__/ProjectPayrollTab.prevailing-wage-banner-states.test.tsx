// @vitest-environment jsdom
/**
 * Task #1462 — covers the visible banner states of `PrevailingWagePanel`
 * (in `ProjectPayrollTab.tsx` around line 668). Task #1425 already locked
 * down the timer-based auto-refetch behaviour; this suite locks down the
 * banner *copy* itself plus the call-to-action button shown in each
 * distinct state, so a regression in either the wording or the
 * conditional that picks one state over another would fail loudly.
 *
 * Banner states under test:
 *   1. Healthy / cached, freshly synced — no failure banner of any kind.
 *   2. Transient failure with a future `wageDecisionNextRetryAt` —
 *      amber "auto-sync retrying in background" banner with the
 *      "Next auto-retry at <time>" sub-line and a "Retry sync" button.
 *   3. Generic failure with no pending retry timestamp (and not
 *      exhausted) — red "auto-sync failed" banner with a plain
 *      "Retry sync" button and no next-retry sub-line.
 *   4. Retry chain exhausted — red "auto-retry exhausted - manual
 *      action required" banner with the escalated "Retry sync now"
 *      primary button and the "We've exhausted all N attempts" copy.
 *   5. Successful re-sync after a prior failure (the failure cleared
 *      out: `wageDecisionLastError` is null again) — no failure banner;
 *      the inline "Re-sync" button comes back next to the cached badge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockApiRequest, mockQueryClientHolder } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockQueryClientHolder: { current: null as QueryClient | null },
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: async () => null,
      },
      mutations: { retry: false },
    },
  });
  mockQueryClientHolder.current = queryClient;
  return {
    apiRequest: mockApiRequest,
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Same Radix Select shim as the sibling auto-refresh suite — Radix's
// real Select uses pointer events / portals that don't behave well in
// jsdom. We don't drive the Select here, but the panel renders one for
// classification rows so the shim keeps render errors away.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectCtx = React.createContext<{
    value: string;
    onValueChange: (v: string) => void;
  }>({ value: "", onValueChange: () => {} });
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <SelectCtx.Provider value={{ value, onValueChange }}>{children}</SelectCtx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children, ...rest }: any) => {
      const ctx = React.useContext(SelectCtx);
      return (
        <button
          type="button"
          onClick={() => ctx.onValueChange(value)}
          data-selected={ctx.value === value ? "true" : "false"}
          {...rest}
        >
          {children}
        </button>
      );
    },
  };
});

import ProjectPayrollTab from "../ProjectPayrollTab";

const PROJECT_ID = "proj-banner-states-1";
const SUMMARY_KEY = ["/api/projects", PROJECT_ID, "prevailing-wage-summary"] as const;
const NOW = new Date("2026-04-23T12:00:00.000Z").getTime();

type Summary = {
  projectId: string;
  wageDecision: string | null;
  wageDecisionCached: boolean | null;
  wageDecisionLastError?: string | null;
  wageDecisionLastSyncAt?: string | null;
  wageDecisionLastAttemptAt?: string | null;
  wageDecisionNextRetryAt?: string | null;
  wageDecisionRetryExhausted?: boolean | null;
  wageDecisionRetryCount?: number | null;
  wageDecisionMaxRetries?: number | null;
  wageDecisionStaleAfterDays?: number | null;
  wageDecisionRatesCached?: number | null;
  classifications: never[];
};

function seedAndRender(summary: Summary) {
  const qc = mockQueryClientHolder.current!;
  qc.clear();
  qc.setQueryData(["/api/projects", PROJECT_ID, "payroll-summary"], {
    laborCostToDate: 0,
    budget: 0,
    laborVsBudget: 0,
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    overtimePercent: 0,
    totalEntries: 0,
    workers: [],
  });
  qc.setQueryData(SUMMARY_KEY, summary);
  qc.setQueryData(["/api/labor-rates/classifications"], []);
  return render(
    <QueryClientProvider client={qc}>
      <ProjectPayrollTab projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

describe("PrevailingWagePanel — banner state messaging (Task #1462)", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue(new Response(null, { status: 200 }));
    // Pin Date.now so retryPending math is deterministic. Use fake
    // timers so the panel's self-scheduling refetch doesn't actually
    // fire during the test (the auto-refresh suite covers that path).
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("State 1: healthy cached project shows no failure banner and exposes the inline Re-sync button", () => {
    const { queryByTestId, getByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      wageDecisionLastSyncAt: new Date(NOW - 60_000).toISOString(),
      wageDecisionRetryExhausted: false,
      wageDecisionRatesCached: 12,
      classifications: [],
    });

    // None of the three failure-banner variants should be on the page.
    expect(queryByTestId("banner-wage-decision-sync-failed")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-pending")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-exhausted")).toBeNull();
    // The inline header "Re-sync" button (only rendered when there is
    // no active failure banner) should be present.
    expect(getByTestId("button-resync-wage-decision")).toBeTruthy();
    // Retry-only button should not exist outside a failure state.
    expect(queryByTestId("button-retry-wage-decision-sync")).toBeNull();
  });

  it("State 2: transient failure with a pending retry shows the amber banner, the Next auto-retry sub-line, and 'Retry sync'", () => {
    const nextRetryAtIso = new Date(NOW + 5 * 60_000).toISOString();
    const { getByTestId, queryByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Upstream DOL feed timed out after 30s",
      wageDecisionLastAttemptAt: new Date(NOW - 30_000).toISOString(),
      wageDecisionNextRetryAt: nextRetryAtIso,
      wageDecisionRetryExhausted: false,
      wageDecisionRetryCount: 1,
      wageDecisionMaxRetries: 4,
      classifications: [],
    });

    // The amber "retrying in background" banner — and only that one.
    const banner = getByTestId("banner-wage-decision-retry-pending");
    expect(queryByTestId("banner-wage-decision-sync-failed")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-exhausted")).toBeNull();

    // Headline copy is the reassuring "retrying in background" variant.
    expect(within(banner).getByText("Davis-Bacon auto-sync retrying in background")).toBeTruthy();

    // Body surfaces the upstream error verbatim.
    expect(within(banner).getByTestId("text-wage-decision-sync-error").textContent)
      .toContain("Upstream DOL feed timed out after 30s");

    // The "Next auto-retry at <time> (attempt N of M)" sub-line is
    // shown with the next-attempt index = retryCount + 1 and the cap.
    const nextRetry = within(banner).getByTestId("text-wage-decision-next-retry");
    expect(nextRetry.textContent).toContain("Next auto-retry at");
    expect(nextRetry.textContent).toContain(new Date(nextRetryAtIso).toLocaleString());
    expect(nextRetry.textContent).toContain("(attempt 2 of 4)");
    expect(nextRetry.textContent).toContain("we'll keep trying automatically");

    // The retry button is the soft "Retry sync" variant — NOT the
    // escalated "Retry sync now" copy used when retries are exhausted.
    const retryBtn = within(banner).getByTestId("button-retry-wage-decision-sync");
    expect(retryBtn.textContent).toContain("Retry sync");
    expect(retryBtn.textContent).not.toContain("Retry sync now");

    // The inline header Re-sync button is suppressed while a failure
    // banner is showing (retry CTA lives inside the banner instead).
    expect(queryByTestId("button-resync-wage-decision")).toBeNull();
  });

  it("State 3: generic failure with no pending retry timestamp shows the red 'auto-sync failed' banner and a plain Retry sync button", () => {
    const { getByTestId, queryByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "HTTP 503 from sam.gov",
      wageDecisionLastAttemptAt: new Date(NOW - 90_000).toISOString(),
      // No next retry timestamp at all and not exhausted → falls through
      // to the generic "auto-sync failed" variant.
      wageDecisionNextRetryAt: null,
      wageDecisionRetryExhausted: false,
      classifications: [],
    });

    const banner = getByTestId("banner-wage-decision-sync-failed");
    expect(queryByTestId("banner-wage-decision-retry-pending")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-exhausted")).toBeNull();

    expect(within(banner).getByText("Davis-Bacon auto-sync failed")).toBeTruthy();
    expect(within(banner).getByTestId("text-wage-decision-sync-error").textContent)
      .toContain("HTTP 503 from sam.gov");

    // Without a pending retry the next-retry sub-line is absent.
    expect(queryByTestId("text-wage-decision-next-retry")).toBeNull();
    expect(queryByTestId("text-wage-decision-retry-exhausted")).toBeNull();

    // CTA is the plain "Retry sync" button — not the escalated form.
    const retryBtn = within(banner).getByTestId("button-retry-wage-decision-sync");
    expect(retryBtn.textContent).toContain("Retry sync");
    expect(retryBtn.textContent).not.toContain("Retry sync now");
  });

  it("State 4: retry-exhausted state shows the red 'manual action required' banner and the escalated 'Retry sync now' button", () => {
    const { getByTestId, queryByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Upstream DOL feed returned 500",
      wageDecisionLastAttemptAt: new Date(NOW - 120_000).toISOString(),
      // Even with a future timestamp lingering on the row, the
      // exhausted flag must take precedence and route us to the
      // "manual action required" copy.
      wageDecisionNextRetryAt: new Date(NOW + 60_000).toISOString(),
      wageDecisionRetryExhausted: true,
      wageDecisionRetryCount: 4,
      wageDecisionMaxRetries: 4,
      classifications: [],
    });

    const banner = getByTestId("banner-wage-decision-retry-exhausted");
    expect(queryByTestId("banner-wage-decision-retry-pending")).toBeNull();
    expect(queryByTestId("banner-wage-decision-sync-failed")).toBeNull();

    expect(within(banner).getByText(
      "Davis-Bacon auto-retry exhausted - manual action required",
    )).toBeTruthy();
    expect(within(banner).getByTestId("text-wage-decision-sync-error").textContent)
      .toContain("Upstream DOL feed returned 500");

    // The "we've exhausted all N attempts" sub-line uses maxRetries.
    const exhaustedLine = within(banner).getByTestId("text-wage-decision-retry-exhausted");
    expect(exhaustedLine.textContent).toContain("exhausted all 4 automatic retry attempts");
    expect(exhaustedLine.textContent).toContain("Please run a manual sync below");

    // No "Next auto-retry at..." sub-line in the exhausted state — the
    // user is the one who has to act, the system has given up.
    expect(queryByTestId("text-wage-decision-next-retry")).toBeNull();

    // CTA escalates to "Retry sync now" (and the default button
    // variant — visually emphasized — but we only assert the copy
    // here since variant is a styling detail).
    const retryBtn = within(banner).getByTestId("button-retry-wage-decision-sync");
    expect(retryBtn.textContent).toContain("Retry sync now");
  });

  it("State 5: successful re-sync after a prior failure clears the banner and brings the inline Re-sync button back", () => {
    // Simulates the user (or the auto-retry) recovering from a prior
    // failure: the server has nulled out wageDecisionLastError, bumped
    // wageDecisionLastSyncAt, and reset the retry bookkeeping. From
    // the panel's perspective this is functionally identical to the
    // healthy state (no failure banner) — but we assert it with the
    // "previously failed" fixture shape on purpose so a future
    // regression that, say, kept showing the banner whenever
    // wageDecisionRetryCount > 0 would fail this case.
    const { queryByTestId, getByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      wageDecisionLastSyncAt: new Date(NOW - 5_000).toISOString(),
      wageDecisionLastAttemptAt: new Date(NOW - 5_000).toISOString(),
      // Bookkeeping from the prior failed run is still on the row but
      // must NOT cause a banner now that the latest attempt succeeded.
      wageDecisionNextRetryAt: new Date(NOW - 60_000).toISOString(),
      wageDecisionRetryExhausted: false,
      wageDecisionRetryCount: 2,
      wageDecisionMaxRetries: 4,
      classifications: [],
    });

    expect(queryByTestId("banner-wage-decision-sync-failed")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-pending")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-exhausted")).toBeNull();
    expect(queryByTestId("text-wage-decision-next-retry")).toBeNull();
    expect(queryByTestId("text-wage-decision-retry-exhausted")).toBeNull();

    // The header "Re-sync" affordance is back now that the failure
    // banner (which would otherwise own the retry CTA) is gone.
    expect(getByTestId("button-resync-wage-decision")).toBeTruthy();
    expect(queryByTestId("button-retry-wage-decision-sync")).toBeNull();
  });
});
