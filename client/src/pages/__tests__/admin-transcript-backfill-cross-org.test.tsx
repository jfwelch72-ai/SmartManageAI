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
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";

const summaryData = {
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
      //   * jobQuery:     keyed `[path, activeJobId]` (only enabled when an
      //                   id is set, so this branch only fires for the
      //                   summary one in this test).
      const second = Array.isArray(queryKey) ? queryKey[1] : undefined;
      if (second && typeof second === "object") {
        return { ...base, data: summaryData };
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
        },
      };
    }
    if (path === "/api/crm/calls/transcripts/backfill/notification-settings") {
      return { ...base, data: { quietHours: null, recipients: [], suppressEmptyRuns: false } };
    }
    if (path === "/api/platform/organizations") {
      return { ...base, data: [] };
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
});
