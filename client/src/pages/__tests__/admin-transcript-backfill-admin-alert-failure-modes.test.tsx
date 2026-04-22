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
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
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
        },
        {
          id: "u-both",
          email: "alex@example.com",
          firstName: "Alex",
          lastName: null,
          alertFailureEmailMode: "both",
        },
        {
          id: "u-digest",
          email: "calm@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "digest",
        },
      ],
      realtimeRecipientCount: 2,
      noRealtimeRecipients: false,
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
        },
        {
          id: "u-none",
          email: "silent@example.com",
          firstName: null,
          lastName: null,
          alertFailureEmailMode: "none",
        },
      ],
      realtimeRecipientCount: 0,
      noRealtimeRecipients: true,
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
