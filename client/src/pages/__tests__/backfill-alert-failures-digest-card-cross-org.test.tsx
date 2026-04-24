// @vitest-environment jsdom
/**
 * Task #1519 — covers the SUPER_ADMIN cross-org breakdown branch of the
 * BackfillAlertFailuresDigestCard component (the "All orgs" tab and the
 * per-org "View this org" filter button) added in Task #1482.
 *
 * The single-org rendering contract is pinned in
 * `backfill-alert-failures-digest-card.test.tsx`. This file only adds the
 * pieces that depend on the `isSuperAdmin` / `onSelectOrg` props:
 *
 *   - The My-org / All-orgs scope toggle is HIDDEN for non-super-admins
 *     so org-scoped admins can't accidentally request a breakdown they
 *     aren't entitled to.
 *   - The toggle is RENDERED for super admins, defaults to "All orgs",
 *     and switching to "My org" re-fetches against the single-org
 *     queryKey (i.e. swaps shapes from `orgs[]` back to `recentFailures[]`).
 *   - Clicking the per-org "View this org" button invokes `onSelectOrg`
 *     with that org's id so the parent page can scope the history table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => new Response("{}", { status: 200 })),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));

// The card's queryKey is [path, windowHours, "all-orgs" | "my-org"].
// The third segment is what we toggle on to decide which dataset the
// mocked useQuery returns, so single-org and cross-org responses are
// completely separate fixtures and we can prove the tab actually
// re-fetches against a different cache key.
const crossOrgData = {
  crossOrg: true,
  windowHours: 24,
  since: "2026-04-21T12:00:00.000Z",
  total: 5,
  slackCount: 3,
  emailCount: 2,
  orgs: [
    {
      organizationId: "org-aaa",
      organizationName: "Acme Construction",
      organizationSlug: "acme",
      total: 3,
      slackCount: 2,
      emailCount: 1,
      recentFailures: [],
    },
    {
      organizationId: "org-bbb",
      organizationName: "Beacon Builders",
      organizationSlug: "beacon",
      total: 2,
      slackCount: 1,
      emailCount: 1,
      recentFailures: [],
    },
  ],
};

const singleOrgData = {
  windowHours: 24,
  since: "2026-04-21T12:00:00.000Z",
  total: 1,
  slackCount: 0,
  emailCount: 1,
  recentFailures: [
    {
      jobId: "job-mine",
      channel: "email",
      recipientSummary: "ops@example.com",
      errorMessage: "smtp 550",
      attemptedAt: "2026-04-22T03:15:00.000Z",
    },
  ],
};

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  const useQuery = (options: { queryKey: unknown }) => {
    const queryKey = options.queryKey;
    let path = "";
    let scope: "all-orgs" | "my-org" = "my-org";
    if (Array.isArray(queryKey)) {
      const [first, , third] = queryKey as unknown[];
      if (typeof first === "string") path = first;
      if (third === "all-orgs" || third === "my-org") scope = third;
    }
    const base = {
      isLoading: false,
      isError: false,
      isFetching: false,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    if (
      path === "/api/crm/calls/transcripts/backfill/alert-failures-digest"
    ) {
      return {
        ...base,
        data: scope === "all-orgs" ? crossOrgData : singleOrgData,
      };
    }
    return { ...base, data: undefined };
  };
  return { ...actual, useQuery };
});

import { BackfillAlertFailuresDigestCard } from "../admin-transcript-backfill";

beforeEach(() => {
  cleanup();
});

describe("BackfillAlertFailuresDigestCard — scope toggle visibility", () => {
  it("hides the My-org/All-orgs toggle for non-super-admins", () => {
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping={false}
        isSuperAdmin={false}
        onSelectOrg={vi.fn()}
      />,
    );

    // The scope-tabs group is the only thing the cross-org toggle adds; if
    // it's absent, org-scoped admins cannot opt into the platform view.
    expect(screen.queryByTestId("group-failures-scope")).toBeNull();
    expect(screen.queryByTestId("tab-failures-scope-all-orgs")).toBeNull();
    expect(screen.queryByTestId("tab-failures-scope-my-org")).toBeNull();
    // And without the cross-org flag the response is the single-org shape,
    // so the per-org list is not rendered either.
    expect(screen.queryByTestId("list-alert-failures-digest-orgs")).toBeNull();
  });

  it("renders the toggle for super admins and defaults to All orgs", () => {
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping={false}
        isSuperAdmin
        onSelectOrg={vi.fn()}
      />,
    );

    const allOrgsTab = screen.getByTestId("tab-failures-scope-all-orgs");
    const myOrgTab = screen.getByTestId("tab-failures-scope-my-org");
    expect(allOrgsTab.getAttribute("aria-selected")).toBe("true");
    expect(myOrgTab.getAttribute("aria-selected")).toBe("false");

    // Cross-org dataset is what the card requested by default for super admins.
    expect(screen.getByTestId("list-alert-failures-digest-orgs")).toBeTruthy();
    expect(
      screen.getByTestId("badge-failures-total").textContent,
    ).toContain("5");
    expect(
      screen.getByTestId("row-alert-failure-org-org-aaa"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("row-alert-failure-org-org-bbb"),
    ).toBeTruthy();
  });

  it("swaps to the single-org shape when the super admin selects 'My org'", async () => {
    const user = userEvent.setup();
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping={false}
        isSuperAdmin
        onSelectOrg={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("tab-failures-scope-my-org"));

    // Cross-org list is gone; single-org rollup numbers + recent failures
    // come from the `singleOrgData` fixture instead.
    expect(screen.queryByTestId("list-alert-failures-digest-orgs")).toBeNull();
    expect(
      screen.getByTestId("badge-failures-total").textContent,
    ).toContain("1");
    expect(
      screen.getByTestId("badge-failures-email-count").textContent,
    ).toMatch(/Email:\s*1/);
  });
});

describe("BackfillAlertFailuresDigestCard — 'View this org' filter", () => {
  it("invokes onSelectOrg with the row's organizationId when clicked", async () => {
    const onSelectOrg = vi.fn();
    const user = userEvent.setup();
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping={false}
        isSuperAdmin
        onSelectOrg={onSelectOrg}
      />,
    );

    await user.click(
      screen.getByTestId("button-filter-failure-org-org-aaa"),
    );
    expect(onSelectOrg).toHaveBeenCalledTimes(1);
    expect(onSelectOrg).toHaveBeenCalledWith("org-aaa");

    await user.click(
      screen.getByTestId("button-filter-failure-org-org-bbb"),
    );
    expect(onSelectOrg).toHaveBeenCalledTimes(2);
    expect(onSelectOrg).toHaveBeenLastCalledWith("org-bbb");
  });
});
