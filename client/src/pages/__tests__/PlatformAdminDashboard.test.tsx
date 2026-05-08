// @vitest-environment jsdom
/**
 * Task #1594 — covers the integrated platform-ops surfaces on the
 * `/admin` landing page (PlatformAdminDashboard):
 *
 *   (a) The transcript-backfill tile is present for SUPER_ADMIN.
 *   (b) The "Background jobs" section header appears above the three
 *       jobs tiles in the documented order: counters → one-shot →
 *       trends.
 *   (c) The quiet-orgs badge renders with the count when the digest
 *       endpoint returns a non-empty `quietOrgs` array.
 *   (d) The badge is absent when `quietOrgs` is empty.
 *   (e) An ADMIN (non-super) user does not see the tile *or* the badge,
 *       and the digest endpoint is not called for them (the badge query
 *       is gated by `enabled: isSuper`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-testid={`link-${href}`}>{children}</a>
  ),
}));

let mockUser: { firstName: string; lastName: string; role: string } | null = {
  firstName: "Pat",
  lastName: "Ops",
  role: "SUPER_ADMIN",
};
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn(),
    organizationName: "SmartManageAI",
  }),
}));

const apiRequestMock = vi.fn(
  async () => new Response(JSON.stringify({}), { status: 200 }),
);
vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

let quietOrgsFixture: Array<{ organizationId: string }> = [];
const platformStatsFixture = {
  totalOrganizations: 3,
  totalUsers: 12,
  activeUsers: 8,
  newOrganizationsLast30Days: 1,
  organizationsByTrade: [],
  usersByRole: [],
};
const platformHealthFixture = {
  status: "healthy",
  uptimeSeconds: 60,
  memoryUsageMb: 100,
  responseTimeMs: 5,
  checks: {},
};
const subStatsFixture = {
  totalSubscriptions: 0,
  estimatedMrr: 0,
  byPlanTier: [],
  byStatus: [],
  addonStats: [],
};

const digestQueriesEnabledFor: string[] = [];
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  const useQuery = (options: { queryKey: unknown; enabled?: boolean }) => {
    const queryKey = options.queryKey;
    const base = {
      isLoading: false,
      isError: false,
      isFetching: false,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    if (Array.isArray(queryKey)) {
      const first = queryKey[0];
      if (first === "/api/platform/stats") {
        return { ...base, data: platformStatsFixture };
      }
      if (first === "/api/platform/health") {
        return { ...base, data: platformHealthFixture };
      }
      if (first === "/api/platform/subscriptions/stats") {
        return { ...base, data: subStatsFixture };
      }
      if (
        first === "/api/crm/calls/transcripts/backfill/alert-failures-digest"
      ) {
        if (options.enabled === false) {
          return { ...base, data: undefined };
        }
        digestQueriesEnabledFor.push(mockUser?.role ?? "(no-user)");
        return {
          ...base,
          data: { quietOrgs: quietOrgsFixture },
        };
      }
    }
    return { ...base, data: undefined };
  };
  return { ...actual, useQuery };
});

import PlatformAdminDashboard from "../PlatformAdminDashboard";

beforeEach(() => {
  cleanup();
  apiRequestMock.mockClear();
  digestQueriesEnabledFor.length = 0;
  mockUser = {
    firstName: "Pat",
    lastName: "Ops",
    role: "SUPER_ADMIN",
  };
  quietOrgsFixture = [];
});

describe("PlatformAdminDashboard — SUPER_ADMIN integration", () => {
  it("renders the transcript-backfill tile and Background jobs grouping in the documented order", () => {
    render(<PlatformAdminDashboard />);

    // (a) Transcript-backfill tile is present for SUPER_ADMIN.
    expect(
      screen.getByTestId("link-admin-transcript-backfill"),
    ).toBeTruthy();

    // (b) Background jobs section header + three tiles in order:
    // counters → one-shot → trends.
    const section = screen.getByTestId("section-admin-background-jobs");
    expect(section).toBeTruthy();
    expect(screen.getByTestId("heading-background-jobs").textContent).toContain(
      "Background jobs",
    );

    const counters = screen.getByTestId("link-admin-job-metrics");
    const oneShot = screen.getByTestId("link-admin-one-shot-jobs");
    const trends = screen.getByTestId("link-admin-jobs-metrics");
    // All three live inside the section.
    expect(section.contains(counters)).toBe(true);
    expect(section.contains(oneShot)).toBe(true);
    expect(section.contains(trends)).toBe(true);
    // Documented order is counters → one-shot → trends.
    const positions = [counters, oneShot, trends].map((el) =>
      // DOCUMENT_POSITION_FOLLOWING (4) means "el follows the previous"
      Array.from(section.querySelectorAll("[data-testid^='link-admin-']")).indexOf(el),
    );
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  it("renders the quiet-orgs badge with the count when the digest reports silent tenants", () => {
    quietOrgsFixture = [
      { organizationId: "org-aaa" },
      { organizationId: "org-bbb" },
    ];
    render(<PlatformAdminDashboard />);
    const badge = screen.getByTestId("badge-transcript-backfill-quiet-orgs");
    expect(badge.textContent).toContain("2");
    expect(badge.textContent?.toLowerCase()).toContain("quiet org");
  });

  it("hides the quiet-orgs badge when the digest returns an empty quietOrgs array", () => {
    quietOrgsFixture = [];
    render(<PlatformAdminDashboard />);
    expect(
      screen.queryByTestId("badge-transcript-backfill-quiet-orgs"),
    ).toBeNull();
    // The tile itself is still visible for SUPER_ADMIN.
    expect(
      screen.getByTestId("link-admin-transcript-backfill"),
    ).toBeTruthy();
  });
});

describe("PlatformAdminDashboard — non-super ADMIN gating", () => {
  it("hides the transcript-backfill tile and never enables the digest query for ADMIN", () => {
    mockUser = {
      firstName: "Sam",
      lastName: "OrgAdmin",
      role: "ADMIN",
    };
    quietOrgsFixture = [
      { organizationId: "org-aaa" },
      { organizationId: "org-bbb" },
    ];
    render(<PlatformAdminDashboard />);

    expect(
      screen.queryByTestId("link-admin-transcript-backfill"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-transcript-backfill-quiet-orgs"),
    ).toBeNull();
    // The digest query was constructed but `enabled: false` short-circuits
    // it — no fetch is recorded for the ADMIN role.
    expect(digestQueriesEnabledFor).not.toContain("ADMIN");
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
