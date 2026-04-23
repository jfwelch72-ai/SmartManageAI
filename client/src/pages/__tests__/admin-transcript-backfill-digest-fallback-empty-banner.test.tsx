// @vitest-environment jsdom
/**
 * Task #1150 — covers the org-wide "Daily alert-failure digest is going to
 * nobody" banner on the admin transcript-backfill page's recent alert
 * deliveries card. The banner is driven by the existing
 * `fallbackMuteSummary.digest.eligibleRecipientCount === 0` signal that the
 * deliveries endpoint already returns, so it should appear regardless of
 * whether any delivery row is currently failing — that's the whole point
 * of the proactive warning.
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

describe("BackfillAlertDeliveriesCard — empty digest fallback banner", () => {
  it("renders the org-wide banner when no admin is opted into the daily digest", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 4 },
      },
    });

    renderCard();

    const banner = screen.getByTestId("banner-digest-fallback-empty");
    expect(banner).toBeTruthy();
    expect(
      screen.getByTestId("text-digest-fallback-empty-title").textContent,
    ).toMatch(/digest is going to nobody/i);
    const link = screen.getByTestId(
      "link-digest-fallback-empty-settings",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/settings/notifications#section-alert-failure-fallback-prefs",
    );
  });

  it("renders the banner even when the deliveries list has successful rows (proactive warning)", () => {
    setDeliveriesData({
      deliveries: [
        {
          id: "del-ok",
          jobId: null,
          channel: "slack",
          status: "success",
          recipientSummary: "hooks.slack.com",
          errorMessage: null,
          attemptedAt: new Date().toISOString(),
        },
      ],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 1 },
      },
    });

    renderCard();

    expect(screen.getByTestId("banner-digest-fallback-empty")).toBeTruthy();
    expect(screen.getByTestId("row-alert-delivery-del-ok")).toBeTruthy();
  });

  it("hides the banner when at least one admin is still eligible for the digest", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        digest: { eligibleRecipientCount: 1, streamMutedAdminCount: 3 },
      },
    });

    renderCard();

    expect(screen.queryByTestId("banner-digest-fallback-empty")).toBeNull();
  });

  it("hides the banner when the summary omits the digest block entirely (legacy response)", () => {
    setDeliveriesData({
      deliveries: [],
      fallbackMuteSummary: {
        slack: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
        email: { mutedAdminCount: 0, effectiveRecipientCount: 2 },
      },
    });

    renderCard();

    expect(screen.queryByTestId("banner-digest-fallback-empty")).toBeNull();
  });

  it("hides the banner when fallbackMuteSummary is missing from the response", () => {
    setDeliveriesData({ deliveries: [] });

    renderCard();

    expect(screen.queryByTestId("banner-digest-fallback-empty")).toBeNull();
  });
});
