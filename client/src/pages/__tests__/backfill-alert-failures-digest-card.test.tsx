// @vitest-environment jsdom
/**
 * Task #1483 — covers the BackfillAlertFailuresDigestCard component on
 * the admin transcript-backfill page. The card backs the in-app "Recent
 * alert failures" panel added in Task #1077; it mirrors the per-channel
 * rollup the daily digest email sends and lets admins jump straight from
 * a failure row to the originating backfill job.
 *
 * The integration coverage for the underlying endpoint lives in
 * `server/__tests__/crm-transcript-backfill-alert-failures-digest-endpoint.test.ts`;
 * this file pins the rendering + interaction contract so a regression in
 * the windowed tabs, the per-channel chips, or the job-link wiring is
 * caught at the component level.
 *
 * Coverage:
 *   - Default render shows the 24h tab active, total + per-channel
 *     chips, and one row per recent failure.
 *   - Switching to the 7d tab re-fetches against the 168h queryKey and
 *     swaps in the new dataset (different counts + rows).
 *   - Per-channel chips render the channel labels for slack/email rows.
 *   - Clicking the job-link button invokes onJumpToJob with the right
 *     job id from the row.
 *   - Empty-state line renders when the window has zero failures.
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

const dataByWindow: Record<number, unknown> = {
  24: {
    windowHours: 24,
    since: "2026-04-21T12:00:00.000Z",
    total: 3,
    slackCount: 2,
    emailCount: 1,
    recentFailures: [
      {
        jobId: "job-aaa",
        channel: "slack",
        recipientSummary: "hooks.slack.com",
        errorMessage: "404 not_found",
        attemptedAt: "2026-04-22T08:30:00.000Z",
      },
      {
        jobId: "job-bbb",
        channel: "email",
        recipientSummary: "ops@example.com",
        errorMessage: "smtp 550",
        attemptedAt: "2026-04-22T03:15:00.000Z",
      },
      {
        jobId: null,
        channel: "slack",
        recipientSummary: "hooks.slack.com",
        errorMessage: null,
        attemptedAt: "2026-04-21T22:05:00.000Z",
      },
    ],
  },
  168: {
    windowHours: 168,
    since: "2026-04-15T12:00:00.000Z",
    total: 11,
    slackCount: 7,
    emailCount: 4,
    recentFailures: [
      {
        jobId: "job-week-1",
        channel: "email",
        recipientSummary: "ops@example.com",
        errorMessage: "timeout",
        attemptedAt: "2026-04-19T08:30:00.000Z",
      },
    ],
  },
};

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  const useQuery = (options: { queryKey: unknown }) => {
    const queryKey = options.queryKey;
    let path = "";
    let windowHours = 24;
    if (Array.isArray(queryKey)) {
      const first = queryKey[0];
      const second = queryKey[1];
      if (typeof first === "string") path = first;
      if (typeof second === "number") windowHours = second;
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
      return { ...base, data: dataByWindow[windowHours] };
    }
    return { ...base, data: undefined };
  };
  return { ...actual, useQuery };
});

import { BackfillAlertFailuresDigestCard } from "../admin-transcript-backfill";

beforeEach(() => {
  cleanup();
});

describe("BackfillAlertFailuresDigestCard — default 24h render", () => {
  it("renders the total + per-channel chips and one row per recent failure", () => {
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping={false}
      />,
    );

    expect(screen.getByTestId("card-alert-failures-digest")).toBeTruthy();

    const totalBadge = screen.getByTestId("badge-failures-total");
    expect(totalBadge.textContent).toContain("3");
    const slackBadge = screen.getByTestId("badge-failures-slack-count");
    expect(slackBadge.textContent).toMatch(/Slack:\s*2/);
    const emailBadge = screen.getByTestId("badge-failures-email-count");
    expect(emailBadge.textContent).toMatch(/Email:\s*1/);

    // One row per recentFailures entry, in order.
    expect(screen.getByTestId("row-alert-failure-0")).toBeTruthy();
    expect(screen.getByTestId("row-alert-failure-1")).toBeTruthy();
    expect(screen.getByTestId("row-alert-failure-2")).toBeTruthy();

    // Per-channel chips inside each row.
    expect(
      screen.getByTestId("badge-failure-channel-0").textContent?.toLowerCase(),
    ).toContain("slack");
    expect(
      screen.getByTestId("badge-failure-channel-1").textContent?.toLowerCase(),
    ).toContain("email");

    // Job-link button only renders for rows with a jobId.
    expect(screen.getByTestId("link-failure-job-0")).toBeTruthy();
    expect(screen.getByTestId("link-failure-job-1")).toBeTruthy();
    // Row 2 has jobId === null, so no link button.
    expect(screen.queryByTestId("link-failure-job-2")).toBeNull();
  });
});

describe("BackfillAlertFailuresDigestCard — switching tabs", () => {
  it("re-renders the rollup when the 7d tab is clicked", async () => {
    const user = userEvent.setup();
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping={false}
      />,
    );

    // Sanity: 24h tab is active by default.
    expect(screen.getByTestId("badge-failures-total").textContent).toContain(
      "3",
    );

    await user.click(screen.getByTestId("tab-failures-window-7d"));

    // Rollup numbers come from the 7d dataset now.
    expect(screen.getByTestId("badge-failures-total").textContent).toContain(
      "11",
    );
    expect(
      screen.getByTestId("badge-failures-slack-count").textContent,
    ).toMatch(/Slack:\s*7/);
    expect(
      screen.getByTestId("badge-failures-email-count").textContent,
    ).toMatch(/Email:\s*4/);

    // The recent-failures list is the 7d sample (1 row).
    expect(screen.getByTestId("row-alert-failure-0")).toBeTruthy();
    expect(screen.queryByTestId("row-alert-failure-1")).toBeNull();
    expect(
      screen.getByTestId("badge-failure-channel-0").textContent?.toLowerCase(),
    ).toContain("email");
  });
});

describe("BackfillAlertFailuresDigestCard — job-link wiring", () => {
  it("invokes onJumpToJob with the row's job id when the link is clicked", async () => {
    const onJumpToJob = vi.fn();
    const user = userEvent.setup();
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={onJumpToJob}
        isJumping={false}
      />,
    );

    await user.click(screen.getByTestId("link-failure-job-0"));
    expect(onJumpToJob).toHaveBeenCalledTimes(1);
    expect(onJumpToJob).toHaveBeenCalledWith("job-aaa");

    await user.click(screen.getByTestId("link-failure-job-1"));
    expect(onJumpToJob).toHaveBeenCalledTimes(2);
    expect(onJumpToJob).toHaveBeenLastCalledWith("job-bbb");
  });

  it("disables the job-link button while an external jump is in flight", () => {
    render(
      <BackfillAlertFailuresDigestCard
        onJumpToJob={vi.fn()}
        isJumping
      />,
    );

    const link = screen.getByTestId("link-failure-job-0") as HTMLButtonElement;
    expect(link.disabled).toBe(true);
  });
});

describe("BackfillAlertFailuresDigestCard — empty window", () => {
  it("renders the dedicated empty-state line and no failure rows", async () => {
    // Swap the 24h dataset to an empty window for this test only.
    const original = dataByWindow[24];
    dataByWindow[24] = {
      windowHours: 24,
      since: "2026-04-21T12:00:00.000Z",
      total: 0,
      slackCount: 0,
      emailCount: 0,
      recentFailures: [],
    };
    try {
      render(
        <BackfillAlertFailuresDigestCard
          onJumpToJob={vi.fn()}
          isJumping={false}
        />,
      );

      expect(screen.getByTestId("badge-failures-total").textContent).toContain(
        "0",
      );
      expect(
        screen.getByTestId("text-alert-failures-digest-empty"),
      ).toBeTruthy();
      expect(screen.queryByTestId("row-alert-failure-0")).toBeNull();
      expect(screen.queryByTestId("list-alert-failures-digest")).toBeNull();
    } finally {
      dataByWindow[24] = original;
    }
  });
});
