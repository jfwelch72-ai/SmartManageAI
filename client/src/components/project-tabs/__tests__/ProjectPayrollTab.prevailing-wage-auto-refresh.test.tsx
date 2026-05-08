// @vitest-environment jsdom
/**
 * Task #1425 — locks down the self-scheduling refetch added to
 * `PrevailingWagePanel` in Task #1373. The "next auto-retry at <time>"
 * banner is supposed to refresh on its own once that time passes so
 * users don't have to babysit the page. These tests cover:
 *   - Positive: a near-future `wageDecisionNextRetryAt` on a failing
 *     project schedules a refetch shortly after the deadline elapses.
 *   - Negative: healthy projects (no `wageDecisionLastError`) and
 *     retry-exhausted projects do NOT schedule a refetch.
 *   - Cleanup: unmounting the panel cancels the pending timer so it
 *     never fires after the component is gone.
 *
 * Uses `vi.useFakeTimers()` so the deadline-based scheduling is
 * deterministic and the suite stays fast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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

// Same shim as the sibling DOL-override test — Radix Select uses
// pointer events / portals that don't behave well in jsdom. We don't
// drive the Select in this suite, but the panel renders one for
// classification rows so the shim keeps render errors away in case
// future fixtures grow rows.
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

const PROJECT_ID = "proj-auto-refresh-1";
const SUMMARY_KEY = ["/api/projects", PROJECT_ID, "prevailing-wage-summary"] as const;

type Summary = {
  projectId: string;
  wageDecision: string | null;
  wageDecisionCached: boolean | null;
  wageDecisionLastError?: string | null;
  wageDecisionNextRetryAt?: string | null;
  wageDecisionRetryExhausted?: boolean | null;
  classifications: never[];
};

function seedAndRender(summary: Summary) {
  const qc = mockQueryClientHolder.current!;
  // Wipe any state from prior tests so seeded data is the only source.
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

function summaryInvalidated(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.some((args: unknown[]) => {
    const arg0 = args[0] as { queryKey?: unknown } | undefined;
    if (!arg0 || !Array.isArray(arg0.queryKey)) return false;
    const key = arg0.queryKey as unknown[];
    return (
      key.length === SUMMARY_KEY.length &&
      key[0] === SUMMARY_KEY[0] &&
      key[1] === SUMMARY_KEY[1] &&
      key[2] === SUMMARY_KEY[2]
    );
  });
}

describe("PrevailingWagePanel — self-scheduling refetch (Task #1373/#1425)", () => {
  const NOW = new Date("2026-04-23T12:00:00.000Z").getTime();

  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue(new Response(null, { status: 200 }));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // Restore the spy on `invalidateQueries` so the next test starts
    // with a fresh call history (vi.spyOn re-uses the same mock when
    // called again on an already-spied method, and the QueryClient
    // singleton persists across tests via the module mock).
    vi.restoreAllMocks();
  });

  it("refetches the summary shortly after a pending wageDecisionNextRetryAt elapses", () => {
    const qc = mockQueryClientHolder.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    // Retry deadline is 5s out; the effect adds a 2s buffer so the
    // server-side retry has a chance to run before we re-fetch. The
    // actual delay is `max(due - now + 2000, 1000) = 7000ms`.
    const nextRetryAt = new Date(NOW + 5_000).toISOString();

    seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Simulated upstream timeout",
      wageDecisionNextRetryAt: nextRetryAt,
      wageDecisionRetryExhausted: false,
      classifications: [],
    });

    // Nothing has fired yet — the timer is just registered.
    expect(summaryInvalidated(invalidateSpy)).toBe(false);

    // Just shy of the buffered deadline: still no refetch.
    vi.advanceTimersByTime(6_999);
    expect(summaryInvalidated(invalidateSpy)).toBe(false);

    // Cross the deadline: the refetch should fire exactly once.
    vi.advanceTimersByTime(2);
    expect(summaryInvalidated(invalidateSpy)).toBe(true);
  });

  it("clamps the delay to at least 1s when wageDecisionNextRetryAt is already in the past", () => {
    const qc = mockQueryClientHolder.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    // A retry deadline that's already 10s in the past — could happen
    // if the user opened the page after the server-side retry was
    // supposed to fire. We must still kick a refetch (clamped to 1s
    // by the effect) instead of either hammering or ignoring.
    const nextRetryAt = new Date(NOW - 10_000).toISOString();

    seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Simulated upstream timeout",
      wageDecisionNextRetryAt: nextRetryAt,
      wageDecisionRetryExhausted: false,
      classifications: [],
    });

    expect(summaryInvalidated(invalidateSpy)).toBe(false);
    vi.advanceTimersByTime(999);
    expect(summaryInvalidated(invalidateSpy)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(summaryInvalidated(invalidateSpy)).toBe(true);
  });

  it("does NOT schedule a refetch for a healthy project (no wageDecisionLastError)", () => {
    const qc = mockQueryClientHolder.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      // Even with a stale retry timestamp lingering on the row, a
      // healthy project (no recent failure) must not schedule polls.
      wageDecisionNextRetryAt: new Date(NOW + 5_000).toISOString(),
      wageDecisionRetryExhausted: false,
      classifications: [],
    });

    vi.advanceTimersByTime(60_000);
    expect(summaryInvalidated(invalidateSpy)).toBe(false);
  });

  it("does NOT schedule a refetch when the auto-retry chain is exhausted", () => {
    const qc = mockQueryClientHolder.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Simulated upstream timeout",
      wageDecisionNextRetryAt: new Date(NOW + 5_000).toISOString(),
      // Exhausted means a human has to take action; auto-polling
      // would just spam the upstream API for nothing.
      wageDecisionRetryExhausted: true,
      classifications: [],
    });

    vi.advanceTimersByTime(60_000);
    expect(summaryInvalidated(invalidateSpy)).toBe(false);
  });

  it("does NOT schedule a refetch when wageDecisionNextRetryAt is missing", () => {
    const qc = mockQueryClientHolder.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Simulated upstream timeout",
      wageDecisionNextRetryAt: null,
      wageDecisionRetryExhausted: false,
      classifications: [],
    });

    vi.advanceTimersByTime(60_000);
    expect(summaryInvalidated(invalidateSpy)).toBe(false);
  });

  it("clears the scheduled timer when the panel unmounts", () => {
    const qc = mockQueryClientHolder.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { unmount } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: "Simulated upstream timeout",
      wageDecisionNextRetryAt: new Date(NOW + 5_000).toISOString(),
      wageDecisionRetryExhausted: false,
      classifications: [],
    });

    // Unmount before the buffered deadline (7s) fires. The cleanup
    // function returned by the useEffect must clearTimeout so the
    // refetch never runs against a stale component tree.
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(summaryInvalidated(invalidateSpy)).toBe(false);
  });
});
