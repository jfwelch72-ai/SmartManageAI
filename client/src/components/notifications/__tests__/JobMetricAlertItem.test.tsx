// @vitest-environment jsdom
/**
 * Task #2023 — verifies the JobMetricAlertItem snooze banner: when an
 * alert is currently snoozed (`snoozedUntil` in the future), the bell
 * row replaces the snooze dropdown with a persistent "Snoozed until X
 * by Y" banner and an "Unsnooze" button that hits the existing
 * `/events/:id/unsnooze` endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { format } from "date-fns";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => undefined,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { JobMetricAlertItem } from "../JobMetricAlertItem";

function makeNotification() {
  return {
    id: "n-pool-health-1",
    userId: "u1",
    organizationId: "o1",
    type: "GENERAL",
    title: "pool_health · spike",
    message: "waitingSaturated jumped to 12 (baseline 1)",
    relatedEntityType: "job_metric_alert",
    relatedEntityId: "pool_health:waitingSaturated:spike",
    isRead: false,
    createdAt: new Date("2026-04-25T10:00:00Z").toISOString(),
  } as any;
}

function renderItem(activeSnoozes: any[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/admin/metrics/jobs/alerts/active-snoozes"], {
    snoozes: activeSnoozes,
  });
  const { hook } = memoryLocation({ path: "/" });
  const utils = render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <JobMetricAlertItem notification={makeNotification()} onDismiss={vi.fn()} />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe("JobMetricAlertItem — snooze banner (Task #2023)", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("hides the snooze dropdown and renders the snoozed banner + unsnooze button when matching key is active", async () => {
    const snoozedUntil = Date.now() + 4 * 60 * 60 * 1000; // 4 hours out
    renderItem([
      {
        job: "pool_health",
        counter: "waitingSaturated",
        kind: "spike",
        eventId: "evt-snooze-target",
        snoozedUntil,
        snoozedById: "admin-1",
        snoozedByName: "Jane Doe",
      },
    ]);

    const banner = await screen.findByTestId("banner-snoozed-n-pool-health-1");
    expect(banner.textContent).toContain("Snoozed until");
    expect(banner.textContent).toContain("by Jane Doe");
    // The format helper switches based on same-day, so just sanity check
    // the rendered time matches what date-fns produces from the same ts.
    const sameDay =
      new Date().toDateString() === new Date(snoozedUntil).toDateString();
    const expectedTime = sameDay
      ? format(new Date(snoozedUntil), "h:mm a")
      : format(new Date(snoozedUntil), "MMM d, h:mm a");
    expect(banner.textContent).toContain(expectedTime);

    expect(
      screen.queryByTestId("button-snooze-notification-n-pool-health-1"),
    ).toBeNull();
    expect(
      screen.getByTestId("button-unsnooze-notification-n-pool-health-1"),
    ).toBeTruthy();
  });

  it("shows the snooze dropdown when the matching key has no active snooze", () => {
    renderItem([]);
    expect(
      screen.queryByTestId("banner-snoozed-n-pool-health-1"),
    ).toBeNull();
    expect(
      screen.queryByTestId("button-unsnooze-notification-n-pool-health-1"),
    ).toBeNull();
    expect(
      screen.getByTestId("button-snooze-notification-n-pool-health-1"),
    ).toBeTruthy();
  });

  it("ignores active snoozes whose key does not match the notification", () => {
    const snoozedUntil = Date.now() + 2 * 60 * 60 * 1000;
    renderItem([
      {
        job: "different_job",
        counter: "exhausted",
        kind: "spike",
        eventId: "evt-other",
        snoozedUntil,
        snoozedById: "admin-2",
        snoozedByName: "Other Admin",
      },
    ]);
    expect(
      screen.queryByTestId("banner-snoozed-n-pool-health-1"),
    ).toBeNull();
    expect(
      screen.getByTestId("button-snooze-notification-n-pool-health-1"),
    ).toBeTruthy();
  });

  it("treats expired snoozes as inactive", () => {
    renderItem([
      {
        job: "pool_health",
        counter: "waitingSaturated",
        kind: "spike",
        eventId: "evt-expired",
        snoozedUntil: Date.now() - 60_000,
        snoozedById: "admin-1",
        snoozedByName: "Jane Doe",
      },
    ]);
    expect(
      screen.queryByTestId("banner-snoozed-n-pool-health-1"),
    ).toBeNull();
    expect(
      screen.getByTestId("button-snooze-notification-n-pool-health-1"),
    ).toBeTruthy();
  });

  it("clicking Unsnooze posts to the existing /events/:id/unsnooze endpoint", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ ok: true }),
    } as any);

    renderItem([
      {
        job: "pool_health",
        counter: "waitingSaturated",
        kind: "spike",
        eventId: "evt-snooze-target",
        snoozedUntil: Date.now() + 60 * 60 * 1000,
        snoozedById: "admin-1",
        snoozedByName: "Jane Doe",
      },
    ]);

    const btn = await screen.findByTestId(
      "button-unsnooze-notification-n-pool-health-1",
    );
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/admin/metrics/jobs/alerts/events/evt-snooze-target/unsnooze",
      );
    });
  });
});
