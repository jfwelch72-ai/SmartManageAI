// @vitest-environment jsdom
/**
 * Task #1500 — covers the panel-level "Davis-Bacon rates changed
 * recently" banner inside `PrevailingWagePanel`
 * (in `ProjectPayrollTab.tsx` around line 995). Task #1462 already
 * locked down the failure-banner copy; this sibling suite locks down
 * the rates-changed banner so a regression in:
 *   - the count phrasing ("N classification" vs "N classifications"),
 *   - the optional "on <date>" sub-phrase,
 *   - the per-row vs aggregate fallback that decides whether the
 *     banner shows at all,
 *   - or the Acknowledge call-to-action wiring,
 * would fail loudly instead of slipping through.
 *
 * Banner states under test:
 *   (a) Per-row `recentRateChange` data present on multiple rows —
 *       count comes from the row count and the "on <date>" sub-phrase
 *       uses the most recent per-row `detectedAt`.
 *   (b) Only the aggregate `wageDecisionRecentChangeCount` present
 *       (no per-row data) with `wageDecisionRecentChangeAt` driving
 *       the timestamp; banner falls back to the aggregate count and
 *       uses the singular noun when the count is exactly one.
 *   (c) No recent changes anywhere — banner is hidden, Acknowledge
 *       button is not on the page.
 *   (d) Clicking "Acknowledge changes" fires the acknowledge POST
 *       to the project's prevailing-wage-summary endpoint with an
 *       empty body (the "ack everything" payload).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
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

// Same Radix Select shim as the sibling banner-states suite — Radix's
// real Select uses pointer events / portals that don't behave well in
// jsdom. We don't drive the Select here, but the panel renders one
// per classification row so the shim keeps render errors away.
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

const PROJECT_ID = "proj-rates-changed-1";
const SUMMARY_KEY = ["/api/projects", PROJECT_ID, "prevailing-wage-summary"] as const;
const NOW = new Date("2026-04-23T12:00:00.000Z").getTime();

type RecentChange = {
  changeKind: "added" | "changed" | "removed";
  oldBaseRate: number | null;
  newBaseRate: number | null;
  oldFringeRate: number | null;
  newFringeRate: number | null;
  oldTotalRate: number | null;
  newTotalRate: number | null;
  detectedAt: string | null;
};

type Classification = {
  classificationId: string;
  classificationName: string;
  wageRate: number;
  fringeRate: number | null;
  totalRate: number | null;
  overtimeMultiplier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  wageDecision: string | null;
  source: "PROJECT_OVERRIDE" | "DOL_FEED";
  dolFeedName?: string | null;
  recentRateChange?: RecentChange | null;
};

type Summary = {
  projectId: string;
  wageDecision: string | null;
  wageDecisionCached: boolean | null;
  wageDecisionLastError?: string | null;
  wageDecisionLastSyncAt?: string | null;
  wageDecisionRetryExhausted?: boolean | null;
  wageDecisionRatesCached?: number | null;
  wageDecisionRecentChangeCount?: number | null;
  wageDecisionRecentChangeAt?: string | null;
  classifications: Classification[];
};

function makeClassification(
  id: string,
  name: string,
  recentRateChange: RecentChange | null = null,
): Classification {
  return {
    classificationId: id,
    classificationName: name,
    wageRate: 45.5,
    fringeRate: 12.25,
    totalRate: 57.75,
    overtimeMultiplier: "1.5",
    effectiveDate: new Date(NOW - 30 * 86_400_000).toISOString(),
    expirationDate: null,
    wageDecision: "CA20260001",
    source: "DOL_FEED",
    dolFeedName: name,
    recentRateChange,
  };
}

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
  // Seed the saved-mappings query so SavedDolMappingsSection doesn't
  // resolve to the default-fetcher's null value (which would NPE on
  // `mappings.length` once the mutation invalidation forces a re-render).
  qc.setQueryData(
    ["/api/labor-rates/dol-classification-mappings", { projectId: PROJECT_ID }],
    [],
  );
  return render(
    <QueryClientProvider client={qc}>
      <ProjectPayrollTab projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

describe("PrevailingWagePanel — rates-changed banner (Task #1500)", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    // Default acknowledge POST returns a JSON body the mutation can parse.
    mockApiRequest.mockResolvedValue(
      new Response(JSON.stringify({ acknowledged: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(a) shows the banner with the per-row count + most-recent detectedAt when row data is present", () => {
    const olderDetectedAt = new Date(NOW - 2 * 86_400_000).toISOString();
    const newerDetectedAt = new Date(NOW - 6 * 60 * 60_000).toISOString();
    const { getByTestId, queryByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      wageDecisionLastSyncAt: new Date(NOW - 60_000).toISOString(),
      // Aggregate fields intentionally absent so we prove the per-row
      // path is the source of truth when classifications carry data.
      wageDecisionRecentChangeCount: null,
      wageDecisionRecentChangeAt: null,
      classifications: [
        makeClassification("cls-a", "Carpenter", {
          changeKind: "changed",
          oldBaseRate: 44, newBaseRate: 45.5,
          oldFringeRate: 12, newFringeRate: 12.25,
          oldTotalRate: 56, newTotalRate: 57.75,
          detectedAt: olderDetectedAt,
        }),
        makeClassification("cls-b", "Electrician", {
          changeKind: "changed",
          oldBaseRate: 50, newBaseRate: 51.25,
          oldFringeRate: 13, newFringeRate: 13.5,
          oldTotalRate: 63, newTotalRate: 64.75,
          detectedAt: newerDetectedAt,
        }),
        // A third row with no rate change must NOT be counted.
        makeClassification("cls-c", "Laborer", null),
      ],
    });

    const banner = getByTestId("banner-wage-decision-rates-changed");
    expect(within(banner).getByText("Davis-Bacon rates changed recently")).toBeTruthy();

    const countText = within(banner).getByTestId("text-recent-rate-change-count");
    // Two rows carry recentRateChange → plural "classifications".
    expect(countText.textContent).toBe("2 classifications");

    // The "on <date>" sub-phrase uses the most-recent per-row
    // detectedAt (newerDetectedAt), formatted via toLocaleString().
    const atText = within(banner).getByTestId("text-recent-rate-change-at");
    expect(atText.textContent).toBe(new Date(newerDetectedAt).toLocaleString());
    expect(banner.textContent).toContain(" on ");
    expect(banner.textContent).toContain(
      "Review certified payrolls and pay items before your next submission",
    );

    // The Acknowledge CTA is present and not in its loading state.
    const ackBtn = within(banner).getByTestId("button-acknowledge-rate-changes");
    expect(ackBtn.textContent).toContain("Acknowledge changes");
    expect(ackBtn.textContent).not.toContain("Acknowledging...");

    // Sanity: the failure banners are not on the page in this state.
    expect(queryByTestId("banner-wage-decision-sync-failed")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-pending")).toBeNull();
    expect(queryByTestId("banner-wage-decision-retry-exhausted")).toBeNull();
  });

  it("(b) falls back to the aggregate count + aggregate timestamp when no per-row data is provided, with singular phrasing for count=1", () => {
    const aggregateAt = new Date(NOW - 36 * 60 * 60_000).toISOString();
    const { getByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      wageDecisionLastSyncAt: new Date(NOW - 60_000).toISOString(),
      wageDecisionRecentChangeCount: 1,
      wageDecisionRecentChangeAt: aggregateAt,
      // No classification rows carry recentRateChange — exercise the
      // aggregate-only fallback path.
      classifications: [
        makeClassification("cls-only", "Ironworker", null),
      ],
    });

    const banner = getByTestId("banner-wage-decision-rates-changed");
    const countText = within(banner).getByTestId("text-recent-rate-change-count");
    // Singular form when the aggregate count is exactly 1.
    expect(countText.textContent).toBe("1 classification");
    expect(countText.textContent).not.toContain("classifications");

    const atText = within(banner).getByTestId("text-recent-rate-change-at");
    expect(atText.textContent).toBe(new Date(aggregateAt).toLocaleString());
  });

  it("(c) hides the banner entirely when neither per-row data nor an aggregate count is present", () => {
    const { queryByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      wageDecisionLastSyncAt: new Date(NOW - 60_000).toISOString(),
      wageDecisionRecentChangeCount: 0,
      wageDecisionRecentChangeAt: null,
      classifications: [
        makeClassification("cls-only", "Ironworker", null),
      ],
    });

    expect(queryByTestId("banner-wage-decision-rates-changed")).toBeNull();
    expect(queryByTestId("text-recent-rate-change-count")).toBeNull();
    expect(queryByTestId("text-recent-rate-change-at")).toBeNull();
    expect(queryByTestId("button-acknowledge-rate-changes")).toBeNull();
  });

  it("(d) clicking 'Acknowledge changes' fires the acknowledge POST to the project's prevailing-wage-summary endpoint", async () => {
    const { getByTestId } = seedAndRender({
      projectId: PROJECT_ID,
      wageDecision: "CA20260001",
      wageDecisionCached: true,
      wageDecisionLastError: null,
      wageDecisionLastSyncAt: new Date(NOW - 60_000).toISOString(),
      wageDecisionRecentChangeCount: 3,
      wageDecisionRecentChangeAt: new Date(NOW - 60 * 60_000).toISOString(),
      classifications: [
        makeClassification("cls-only", "Ironworker", null),
      ],
    });

    const ackBtn = getByTestId("button-acknowledge-rate-changes");
    fireEvent.click(ackBtn);

    // The mutation calls apiRequest("POST", "/api/projects/:id/.../acknowledge-rate-changes", {})
    // when no specific classification list is passed. We let the
    // microtask run via real timers so the mutation can fire.
    vi.useRealTimers();
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });
    const [method, url, body] = mockApiRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/prevailing-wage-summary/acknowledge-rate-changes`,
    );
    // "Acknowledge everything" payload — the click handler passes
    // `undefined`, so the mutationFn sends an empty object body.
    expect(body).toEqual({});
  });
});
