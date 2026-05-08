// @vitest-environment jsdom
/**
 * Task #1085 — covers the new "Admin alert-failure email recipients" card
 * on the admin transcript-backfill page. The card surfaces each active
 * org admin's `alertFailureEmailMode` so ops leads can spot at a glance
 * who falls into which bucket without opening every admin profile, and
 * raises a visible warning when no admin is on the realtime stream (so a
 * misconfigured webhook would only be noticed via the next day's digest).
 *
 * @tanstack/react-query is mocked so we can hand-craft the response
 * without touching the network or QueryClient internals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) =>
    children as React.ReactElement,
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) =>
    React.createElement("a", { href, ...rest }, children) as React.ReactElement,
}));

import { BackfillAdminAlertFailureModesCard } from "../admin-transcript-backfill";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderCard() {
  return render(
    <TooltipProvider>
      <BackfillAdminAlertFailureModesCard />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  cleanup();
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

function setData(data: unknown) {
  useQueryMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
  });
}

describe("BackfillAdminAlertFailureModesCard", () => {
  it("renders one row per admin with their mode badge and no warning when at least one admin is on real-time", () => {
    setData({
      admins: [
        {
          id: "u-realtime",
          email: "ops@example.com",
          firstName: "Ops",
          lastName: "Lead",
          alertFailureEmailMode: "realtime",
          fallbackEnabled: true,
          fallbackMutedChannels: [],
        },
        {
          id: "u-both",
          email: "alex@example.com",
          firstName: "Alex",
          lastName: null,
          alertFailureEmailMode: "both",
          fallbackEnabled: true,
          fallbackMutedChannels: [],
        },
        {
          id: "u-digest",
          email: "calm@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "digest",
          fallbackEnabled: true,
          fallbackMutedChannels: [],
        },
      ],
      realtimeRecipientCount: 2,
      noRealtimeRecipients: false,
      slackRecipientCount: 2,
      emailRecipientCount: 2,
      fullyOptedOutCount: 0,
    });

    renderCard();

    expect(screen.queryByTestId("alert-no-realtime-recipients")).toBeNull();

    const realtimeBadge = screen.getByTestId(
      "badge-admin-alert-failure-mode-u-realtime",
    );
    expect(realtimeBadge.textContent).toMatch(/real-time only/i);

    const bothBadge = screen.getByTestId(
      "badge-admin-alert-failure-mode-u-both",
    );
    expect(bothBadge.textContent).toMatch(/real-time \+ digest/i);

    const digestBadge = screen.getByTestId(
      "badge-admin-alert-failure-mode-u-digest",
    );
    expect(digestBadge.textContent).toMatch(/digest only/i);

    // Falls back to the email when no name is set.
    const digestEmail = screen.getByTestId(
      "text-admin-alert-failure-mode-name-u-digest",
    );
    expect(digestEmail.textContent).toBe("calm@example.com");
  });

  it("flags the org when nobody is on the real-time stream", () => {
    setData({
      admins: [
        {
          id: "u-digest",
          email: "calm@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "digest",
          fallbackEnabled: true,
          fallbackMutedChannels: [],
        },
        {
          id: "u-none",
          email: "silent@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "none",
          fallbackEnabled: true,
          fallbackMutedChannels: [],
        },
      ],
      realtimeRecipientCount: 0,
      noRealtimeRecipients: true,
      slackRecipientCount: 0,
      emailRecipientCount: 0,
      fullyOptedOutCount: 0,
    });

    renderCard();

    const warning = screen.getByTestId("alert-no-realtime-recipients");
    expect(warning.textContent).toMatch(/no admin is on the real-time stream/i);
    expect(
      screen.getByTestId("badge-admin-alert-failure-mode-u-none").textContent,
    ).toMatch(/^None$/);
  });

  it("renders an empty-state copy when there are no active admins", () => {
    setData({
      admins: [],
      realtimeRecipientCount: 0,
      noRealtimeRecipients: false,
      slackRecipientCount: 0,
      emailRecipientCount: 0,
      fullyOptedOutCount: 0,
    });

    renderCard();

    expect(
      screen.getByTestId("text-admin-alert-failure-modes-empty").textContent,
    ).toMatch(/no active org admins/i);
    expect(screen.queryByTestId("alert-no-realtime-recipients")).toBeNull();
  });

  it("renders a loading indicator while the query is pending", () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
    });

    renderCard();

    expect(
      screen.getByTestId("status-loading-admin-alert-failure-modes"),
    ).toBeTruthy();
  });

  // Task #1102 — verify the per-row Slack-muted / email-muted / fallbacks-off
  // badges and the aggregate coverage tally render so admins can confirm
  // who is still on the page list after their teammates' opt-outs.
  it("surfaces fallback opt-outs, per-channel mutes, and the coverage tally (Task #1102)", () => {
    setData({
      admins: [
        {
          id: "u-opt-out",
          email: "silent@example.com",
          firstName: "Sil",
          lastName: "Ent",
          alertFailureEmailMode: "both",
          fallbackEnabled: false,
          fallbackMutedChannels: [],
        },
        {
          id: "u-slack-muted",
          email: "noslack@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "realtime",
          fallbackEnabled: true,
          fallbackMutedChannels: ["slack"],
        },
        {
          id: "u-email-muted",
          email: "noemail@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "both",
          fallbackEnabled: true,
          fallbackMutedChannels: ["email"],
        },
        {
          id: "u-clean",
          email: "page@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "both",
          fallbackEnabled: true,
          fallbackMutedChannels: [],
        },
      ],
      realtimeRecipientCount: 3,
      noRealtimeRecipients: false,
      slackRecipientCount: 2,
      emailRecipientCount: 2,
      fullyOptedOutCount: 1,
    });

    renderCard();

    expect(
      screen.getByTestId("badge-admin-fallback-opted-out-u-opt-out").textContent,
    ).toMatch(/fallbacks off/i);
    expect(
      screen.getByTestId("badge-admin-fallback-muted-slack-u-slack-muted").textContent,
    ).toMatch(/slack muted/i);
    expect(
      screen.getByTestId("badge-admin-fallback-muted-email-u-email-muted").textContent,
    ).toMatch(/email muted/i);
    // The fully opted-out admin shouldn't ALSO get a per-channel mute badge —
    // the global opt-out supersedes them.
    expect(
      screen.queryByTestId("badge-admin-fallback-muted-slack-u-opt-out"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-admin-fallback-muted-email-u-opt-out"),
    ).toBeNull();
    // Clean admin only carries the mode badge, no opt-out / mute badges.
    expect(
      screen.queryByTestId("badge-admin-fallback-opted-out-u-clean"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-admin-fallback-muted-slack-u-clean"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-admin-fallback-muted-email-u-clean"),
    ).toBeNull();

    // Aggregate tally renders the channel-by-channel coverage counts.
    expect(
      screen.getByTestId("text-coverage-slack-count").textContent,
    ).toMatch(/2 of 4/);
    expect(
      screen.getByTestId("text-coverage-email-count").textContent,
    ).toMatch(/2 of 4/);
    expect(
      screen.getByTestId("text-coverage-fully-opted-out-count").textContent,
    ).toMatch(/1 of 4/);
  });

  it("renders an error message when the query fails", () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
    });

    renderCard();

    expect(
      screen.getByTestId("text-admin-alert-failure-modes-error").textContent,
    ).toMatch(/failed to load/i);
  });
});
