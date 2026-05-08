// @vitest-environment jsdom
/**
 * Task #1146 — covers the top-of-card "Realtime alert fan-out reaches
 * nobody" banner on the admin transcript-backfill page's recent alert
 * deliveries card. The banner promotes the existing per-row "Fallback
 * suppressed" signal to a card-level warning whenever BOTH the Slack
 * and email realtime channels would reach zero admins because every
 * eligible admin actively muted them. The "no admins at all" case
 * (mutedAdminCount === 0 on both channels) must NOT trigger the banner
 * to avoid noisy false positives on brand-new orgs.
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

describe("BackfillAlertDeliveriesCard — realtime fan-out silenced banner", () => {
  it("renders the card-level banner when both Slack and email realtime fan-outs reach zero admins due to mutes", () => {
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
      ],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 2, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 3, effectiveRecipientCount: 0 },
      },
    });

    renderCard();

    const banner = screen.getByTestId("alert-realtime-fanout-silenced");
    expect(banner.textContent).toMatch(/reaches nobody/i);
    const detail = screen.getByTestId("text-realtime-fanout-silenced-detail");
    expect(detail.textContent).toMatch(/Slack muted by 2 admins/);
    expect(detail.textContent).toMatch(/email muted by 3 admins/);
    // Settings link is wired to the same anchor as the per-row badge.
    expect(
      screen.getByTestId("link-realtime-fanout-silenced-settings"),
    ).toBeTruthy();
  });

  it("uses singular admin wording when exactly one admin muted a channel", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
      },
    });

    renderCard();

    const detail = screen.getByTestId("text-realtime-fanout-silenced-detail");
    expect(detail.textContent).toMatch(/Slack muted by 1 admin;/);
    expect(detail.textContent).toMatch(/email muted by 1 admin\)/);
  });

  it("does NOT render the banner when only one channel is silenced (the other still has recipients)", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 2, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 4 },
      },
    });

    renderCard();

    expect(
      screen.queryByTestId("alert-realtime-fanout-silenced"),
    ).toBeNull();
  });

  it("does NOT render the banner when both channels are empty but no admin actively muted them (org has no eligible admins)", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
      },
    });

    renderCard();

    expect(
      screen.queryByTestId("alert-realtime-fanout-silenced"),
    ).toBeNull();
  });

  it("calls out the empty digest fallback in the banner copy when the daily rollup is also silenced", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 2, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
        digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 3 },
      },
    });

    renderCard();

    const detail = screen.getByTestId("text-realtime-fanout-silenced-detail");
    expect(detail.textContent).toMatch(/daily-digest fallback is also empty/i);
    expect(detail.textContent).toMatch(/tomorrow's rollup won't catch them/i);
  });

  it("omits the digest sentence when the digest stream still has eligible recipients", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 2, effectiveRecipientCount: 0 },
        email: { mutedAdminCount: 1, effectiveRecipientCount: 0 },
        digest: { eligibleRecipientCount: 2, streamMutedAdminCount: 1 },
      },
    });

    renderCard();

    const detail = screen.getByTestId("text-realtime-fanout-silenced-detail");
    expect(detail.textContent).not.toMatch(/daily-digest fallback is also empty/i);
  });

  it("does NOT render the banner when the response omits fallbackMuteSummary entirely", () => {
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

    expect(
      screen.queryByTestId("alert-realtime-fanout-silenced"),
    ).toBeNull();
  });
});
