// @vitest-environment jsdom
/**
 * Task #1037 — frontend regression for the SUPER_ADMIN cross-org card on
 * the transcript backfill admin page (added by Task #1019). The card is
 * only rendered when the summary endpoint returns `crossOrg: true` and a
 * non-empty `runningJobs` array. A regression that hid the card or
 * dropped per-tenant rows would silently remove the only place a platform
 * admin can see runaway backfills happening in another org.
 *
 * The test mocks @tanstack/react-query so we can hand-craft the summary
 * response without touching the real network / QueryClient. All other
 * useQuery callers in the page receive empty stable data so nothing
 * triggers a fetch in jsdom.
 *
 * Task #1055 — also covers the org-picker switch from the cross-org view
 * to a single tenant. Radix's <Select> is unusable in jsdom (it relies
 * on PointerEvents, scrollIntoView and pointer capture that the
 * environment doesn't implement), so `@/components/ui/select` is mocked
 * with a tiny context-driven stand-in that exposes every <SelectItem>
 * as a clickable button while preserving the testids each item carries.
 * That lets us drive the picker via userEvent without re-implementing
 * Radix internals.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const crossOrgSummaryData = {
  pending: 42,
  activeJob: null,
  crossOrg: true,
  scopedOrganizationId: null,
  runningJobs: [
    {
      id: "job-A",
      status: "RUNNING",
      total: 10,
      processed: 3,
      succeeded: 2,
      failed: 1,
      errors: [],
      failedRecordingIds: [],
      startedAt: new Date("2026-01-01T12:00:00Z").toISOString(),
      completedAt: null,
      parentJobId: null,
      concurrency: 2,
      maxRecords: null,
      organization: { id: "org-A", name: "Acme Tenant", slug: "acme" },
    },
    {
      id: "job-B",
      status: "RUNNING",
      total: 20,
      processed: 5,
      succeeded: 5,
      failed: 0,
      errors: [],
      failedRecordingIds: [],
      startedAt: new Date("2026-01-01T13:00:00Z").toISOString(),
      completedAt: null,
      parentJobId: null,
      concurrency: 4,
      maxRecords: null,
      organization: { id: "org-B", name: "Beta Builders", slug: "beta" },
    },
  ],
};

// Task #1055 — when the picker narrows to org-A the server returns the
// scoped roll-up: cross-org flag clears, runningJobs is empty, and the
// own-org RUNNING backfill is surfaced via `activeJob` so the page can
// render its single-org progress panel.
const singleOrgSummaryData = {
  pending: 7,
  activeJob: {
    id: "job-A",
    status: "RUNNING",
    total: 10,
    processed: 3,
    succeeded: 2,
    failed: 1,
    errors: [],
    failedRecordingIds: [],
    startedAt: new Date("2026-01-01T12:00:00Z").toISOString(),
    completedAt: null,
    parentJobId: null,
    concurrency: 2,
    maxRecords: null,
  },
  crossOrg: false,
  scopedOrganizationId: "org-A",
  runningJobs: [],
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "super-1",
      role: "SUPER_ADMIN",
      organizationId: null,
      firstName: "Super",
      lastName: "Admin",
      email: "super@test.invalid",
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/admin/transcript-backfill", () => {}],
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => new Response("{}", { status: 200 })),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

// Task #1055 — replace the Radix-backed shadcn Select with a context-driven
// stand-in. Each <SelectItem value="x"> becomes a real <button> that fires
// the parent <Select>'s onValueChange when clicked, and the trigger props
// (notably its data-testid) flow through onto a wrapper div so existing
// queries keep working. This avoids dragging PointerEvent / scrollIntoView
// shims into the test setup just to flip a controlled value.
vi.mock("@/components/ui/select", () => {
  const Ctx = React.createContext<{ onValueChange?: (v: string) => void }>({});
  const Select = ({ onValueChange, children }: any) =>
    React.createElement(Ctx.Provider, { value: { onValueChange } }, children);
  const SelectTrigger = ({ children, ...rest }: any) =>
    React.createElement("div", rest, children);
  const SelectValue = ({ placeholder }: any) =>
    React.createElement("span", null, placeholder ?? null);
  const SelectContent = ({ children }: any) =>
    React.createElement(React.Fragment, null, children);
  const SelectItem = ({ value, children, ...rest }: any) => {
    const ctx = React.useContext(Ctx);
    return React.createElement(
      "button",
      {
        ...rest,
        type: "button",
        onClick: () => ctx.onValueChange?.(value),
      },
      children,
    );
  };
  const SelectGroup = ({ children }: any) =>
    React.createElement(React.Fragment, null, children);
  const SelectLabel = ({ children }: any) =>
    React.createElement("span", null, children);
  const SelectSeparator = () => null;
  const SelectScrollUpButton = () => null;
  const SelectScrollDownButton = () => null;
  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
    SelectScrollUpButton,
    SelectScrollDownButton,
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual: any = await vi.importActual("@tanstack/react-query");
  // Each useQuery call in the page is keyed by the endpoint path. We hand
  // each one a stable, non-loading response so the page renders past every
  // loading branch and the cross-org card actually mounts. Using the
  // queryKey to dispatch keeps the mock honest — a regression that
  // accidentally renames the summary endpoint key would fall through to
  // the default branch and drop the cross-org card.
  const useQuery = ({ queryKey, enabled }: any) => {
    const path = Array.isArray(queryKey) ? queryKey[0] : "";
    const base = {
      isLoading: false,
      isError: false,
      isFetching: false,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    if (enabled === false) {
      return { ...base, data: undefined };
    }
    if (path === "/api/crm/calls/transcripts/backfill") {
      // Two callers share this base path:
      //   * summaryQuery: keyed `[path, paramsObject]`
      //   * jobQuery:     keyed `[path, activeJobId]`
      const second = Array.isArray(queryKey) ? queryKey[1] : undefined;
      if (second && typeof second === "object") {
        // Task #1055 — when the picker narrows to a single org the page
        // sends `{ organizationId: "<id>" }`. Returning the scoped
        // payload here is what proves the queryKey actually changed
        // when the dropdown's value flipped.
        const orgId = (second as any).organizationId;
        if (orgId === "org-A") {
          return { ...base, data: singleOrgSummaryData };
        }
        return { ...base, data: crossOrgSummaryData };
      }
      return { ...base, data: undefined };
    }
    if (path === "/api/crm/calls/transcripts/backfill/history") {
      return { ...base, data: { total: 0, limit: 20, offset: 0, jobs: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/pending") {
      return { ...base, data: { total: 0, limit: 20, offset: 0, recordings: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/operators") {
      return { ...base, data: { operators: [] } };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-config") {
      return {
        ...base,
        data: {
          slack: { configured: false, valid: false },
          email: { configured: false, recipients: [] },
          // Task #1063 — env-var summary panel now also carries the
          // persisted last-test outcome and a fallback flag.
          lastTestAt: null,
          lastTestResult: null,
          usingEnvFallback: true,
        },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-settings") {
      return { ...base, data: { quietHours: null, recipients: [], suppressEmptyRuns: false } };
    }
    if (path === "/api/platform/organizations") {
      // Task #1055 — populate the platform org list so the picker
      // exposes a real org option to click.
      return {
        ...base,
        data: [
          { id: "org-A", name: "Acme Tenant", slug: "acme" },
          { id: "org-B", name: "Beta Builders", slug: "beta" },
        ],
      };
    }
    return { ...base, data: undefined };
  };
  const useMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
    error: null,
    data: undefined,
  });
  return { ...actual, useQuery, useMutation };
});

import AdminTranscriptBackfillPage from "@/pages/admin-transcript-backfill";

describe("AdminTranscriptBackfillPage cross-org running card (Task #1037)", () => {
  it("renders one row per running tenant with the org label and progress when crossOrg is true", () => {
    render(<AdminTranscriptBackfillPage />);

    // Card itself + count badge driven by runningJobs.length.
    const card = screen.getByTestId("card-cross-org-running");
    expect(card).toBeTruthy();
    expect(screen.getByTestId("badge-cross-org-running-count").textContent).toContain("2");

    // Per-tenant rows: each running job from a different org renders its
    // own row keyed by job id, with the org name surfaced in the row's
    // header. A regression that scoped runningJobs to one org or stripped
    // the organization payload would fail these assertions.
    const rowA = screen.getByTestId("cross-org-running-row-job-A");
    expect(within(rowA).getByTestId("cross-org-running-org-job-A").textContent).toContain(
      "Acme Tenant",
    );
    expect(within(rowA).getByTestId("cross-org-running-totals-job-A").textContent).toContain("3");
    expect(within(rowA).getByTestId("cross-org-running-totals-job-A").textContent).toContain("10");

    const rowB = screen.getByTestId("cross-org-running-row-job-B");
    expect(within(rowB).getByTestId("cross-org-running-org-job-B").textContent).toContain(
      "Beta Builders",
    );
    expect(within(rowB).getByTestId("cross-org-running-totals-job-B").textContent).toContain("5");
    expect(within(rowB).getByTestId("cross-org-running-totals-job-B").textContent).toContain("20");

    // Pending count must show the platform-wide total (42), and the
    // descriptor must reflect that this is a roll-up across every tenant
    // (regression guard for the cross-org copy on the pending card).
    expect(screen.getByTestId("text-pending-count").textContent).toContain("42");
    expect(screen.getByTestId("text-pending-scope").textContent?.toLowerCase()).toContain(
      "platform-wide",
    );
    expect(screen.getByTestId("title-pending").textContent?.toLowerCase()).toContain(
      "all organizations",
    );
  });

  // Task #1074 — the hint under the per-row Cancel button must explain
  // both outcomes (cooperative cancel vs heartbeat-staleness reap) and
  // mention the 5-minute threshold so support staff don't have to read
  // server code to interpret the two different toasts.
  it("renders a hint near the Cancel button explaining the cooperative-vs-reaped behavior and the 5-minute heartbeat window", () => {
    render(<AdminTranscriptBackfillPage />);
    const hint = screen.getByTestId("text-cross-org-cancel-hint");
    const text = (hint.textContent ?? "").toLowerCase();
    expect(text).toContain("cancel");
    expect(text).toContain("5 minute");
    expect(text).toContain("heartbeat");
    expect(text).toContain("reaped");
  });

  // Task #1055 — picking a specific org from the picker has to flip the
  // page out of the platform-wide view: the cross-org card should be
  // gone, the pending copy should drop "all organizations" / "platform-
  // wide" wording, and the single-org `activeJob` should render in the
  // job-progress panel. A regression in the `summaryParams` queryKey or
  // the `isCrossOrgSummary` derivation would break at least one of
  // these assertions.
  it("switches to the single-org view when an organization is picked from the dropdown", async () => {
    const user = userEvent.setup();
    render(<AdminTranscriptBackfillPage />);

    // Sanity: we start in the cross-org view (proven by the existing
    // test, but re-asserted here so a failure isolates this behavior).
    expect(screen.getByTestId("card-cross-org-running")).toBeTruthy();

    // The picker exposes one option per org plus the "all organizations"
    // sentinel. Click the org-A option to narrow the scope.
    await user.click(
      screen.getByTestId("select-history-organization-option-org-A"),
    );

    // Cross-org card must unmount — `isCrossOrgSummary` is now false.
    expect(screen.queryByTestId("card-cross-org-running")).toBeNull();

    // Pending card swaps to the single-org copy and count.
    expect(screen.getByTestId("text-pending-count").textContent).toContain("7");
    expect(screen.getByTestId("title-pending").textContent?.toLowerCase()).not.toContain(
      "all organizations",
    );
    const scopeText = screen.getByTestId("text-pending-scope").textContent?.toLowerCase() ?? "";
    expect(scopeText).not.toContain("platform-wide");
    expect(scopeText).toContain("pending");

    // Active job panel renders the scoped job pulled from the summary's
    // `activeJob` field (jobQuery has no data of its own in this mock).
    const progress = screen.getByTestId("card-progress");
    expect(progress).toBeTruthy();
    expect(within(progress).getByTestId("text-job-id").textContent).toContain("job-A");
    expect(within(progress).getByTestId("text-progress-summary").textContent).toContain("3");
    expect(within(progress).getByTestId("text-progress-summary").textContent).toContain("10");
  });
});
