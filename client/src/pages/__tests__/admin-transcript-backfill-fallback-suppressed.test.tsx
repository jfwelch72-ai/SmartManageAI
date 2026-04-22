// @vitest-environment jsdom
/**
 * Task #1079 — covers the "Fallback suppressed (channel muted by N admins)"
 * badge on the admin transcript-backfill page's recent alert deliveries
 * card. The server returns a per-channel `fallbackMuteSummary` alongside
 * each delivery row; when a failure row's channel has zero effective
 * recipients AND at least one admin actively muted it, the row should
 * render the warning badge so the reviewer realizes the silence is
 * org-wide. Successful rows and failure rows on a still-monitored channel
 * must NOT render the badge.
 *
 * @tanstack/react-query is mocked so we can hand-craft the alert-deliveries
 * response without touching the network or QueryClient internals — the
 * card's only dependency on the library is `useQuery`/`useMutation`.
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

import { BackfillAlertDeliveriesCard } from "../admin-transcript-backfill";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderCard() {
  return render(
    <TooltipProvider>
      <BackfillAlertDeliveriesCard />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  cleanup();
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

function setDeliveriesData(data: unknown) {
  useQueryMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
  });
}

describe("BackfillAlertDeliveriesCard — fallback suppressed badge", () => {
  it("renders muted-by-N-admins badge on a slack failure row when no admin still receives the fan-out", () => {
    setDeliveriesData({
      deliveries: [
        {
          id: "del-1",
          jobId: "job-1",
          channel: "slack",
          status: "failure",
          recipientSummary: "hooks.slack.com",
          errorMessage: "404 not_found",
          attemptedAt: new Date().toISOString(),
        },
        {
          id: "del-2",
          jobId: "job-2",
          channel: "email",
          status: "failure",
          recipientSummary: "ops@example.com",
          errorMessage: "smtp timeout",
          attemptedAt: new Date().toISOString(),
        },
        {
          id: "del-3",
          jobId: "job-3",
          channel: "slack",
          status: "success",
          recipientSummary: "hooks.slack.com",
          errorMessage: null,
          attemptedAt: new Date().toISOString(),
        },
      ],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 3, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 1, effectiveRecipientCount: 2 },
      },
    });

    renderCard();

    const badge = screen.getByTestId("badge-fallback-suppressed-del-1");
    expect(badge.textContent).toMatch(/muted by 3 admins/i);

    // Email failure still has effective recipients — no badge.
    expect(screen.queryByTestId("badge-fallback-suppressed-del-2")).toBeNull();
    // Success row never renders the badge.
    expect(screen.queryByTestId("badge-fallback-suppressed-del-3")).toBeNull();
  });

  it("uses singular wording when exactly one admin muted the channel", () => {
    setDeliveriesData({
      deliveries: [
        {
          id: "del-solo",
          jobId: null,
          channel: "email",
          status: "failure",
          recipientSummary: "ops@example.com",
          errorMessage: "bounce",
          attemptedAt: new Date().toISOString(),
        },
      ],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
      },
    });

    renderCard();

    const badge = screen.getByTestId("badge-fallback-suppressed-del-solo");
    expect(badge.textContent).toMatch(/muted by 1 admin\)/i);
  });

  it("does not render the badge when no admin muted the channel even if recipient list is empty", () => {
    setDeliveriesData({
      deliveries: [
        {
          id: "del-x",
          jobId: null,
          channel: "slack",
          status: "failure",
          recipientSummary: "hooks.slack.com",
          errorMessage: "boom",
          attemptedAt: new Date().toISOString(),
        },
      ],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
      },
    });

    renderCard();

    expect(screen.getByTestId("row-alert-delivery-del-x")).toBeTruthy();
    expect(screen.queryByTestId("badge-fallback-suppressed-del-x")).toBeNull();
  });

  it("gracefully omits the badge when fallbackMuteSummary is missing from the response", () => {
    setDeliveriesData({
      deliveries: [
        {
          id: "del-legacy",
          jobId: null,
          channel: "slack",
          status: "failure",
          recipientSummary: "hooks.slack.com",
          errorMessage: "boom",
          attemptedAt: new Date().toISOString(),
        },
      ],
    });

    renderCard();

    expect(screen.getByTestId("row-alert-delivery-del-legacy")).toBeTruthy();
    expect(
      screen.queryByTestId("badge-fallback-suppressed-del-legacy"),
    ).toBeNull();
  });
});
