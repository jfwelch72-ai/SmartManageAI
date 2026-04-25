// @vitest-environment jsdom
/**
 * Task #2022 — verifies the compact `JobMetricAlertBellItem` rendered
 * inside the global notification bell exposes the same Snooze
 * 1h/4h/24h controls as the dashboard widget item, POSTs to
 * `/api/admin/metrics/jobs/alerts/snooze-by-key` with the parsed
 * `(job, counter, kind)` tuple, and dismisses the unread bell row on
 * success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const { mockApiRequest, mockToast } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { JobMetricAlertBellItem } from "../JobMetricAlertItem";
import type { Notification } from "@shared/schema";

function makeAlert(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-jma-1",
    userId: "user-1",
    organizationId: "org-1",
    type: "ALERT",
    title: "pool_health spike",
    message: "transcript_backfill pool_health spiked above 90% saturation",
    isRead: false,
    relatedEntityId: "transcript_backfill:pool_health:spike",
    relatedEntityType: "job_metric_alert",
    metadata: null,
    createdAt: new Date("2026-04-25T10:00:00Z") as unknown as Notification["createdAt"],
    ...overrides,
  } as Notification;
}

function renderItem(props: {
  notification?: Notification;
  onDismiss?: () => void;
  onNavigate?: () => void;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/dashboard", record: true });
  const utils = render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <JobMetricAlertBellItem
          notification={props.notification ?? makeAlert()}
          onDismiss={props.onDismiss}
          onNavigate={props.onNavigate}
        />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, hook };
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockToast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("JobMetricAlertBellItem", () => {
  it("renders title, message, deep-link to /admin/job-metrics, and snooze trigger", () => {
    renderItem({});

    expect(screen.getByTestId("text-alert-title-notif-jma-1").textContent).toBe(
      "pool_health spike",
    );
    expect(
      screen.getByTestId("text-alert-message-notif-jma-1").textContent,
    ).toContain("pool_health spiked");

    const link = screen.getByTestId("link-alert-notification-notif-jma-1");
    expect(link.getAttribute("href")).toBe("/admin/job-metrics");

    expect(
      screen.getByTestId("button-snooze-notification-notif-jma-1"),
    ).toBeTruthy();
  });

  it("opens the snooze menu and POSTs the (job, counter, kind) tuple to snooze-by-key", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ ok: true }) });
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderItem({ onDismiss });

    await user.click(
      screen.getByTestId("button-snooze-notification-notif-jma-1"),
    );

    const fourHour = await screen.findByTestId(
      "option-snooze-notification-notif-jma-1-4h",
    );
    await user.click(fourHour);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/admin/metrics/jobs/alerts/snooze-by-key",
      {
        job: "transcript_backfill",
        counter: "pool_health",
        kind: "spike",
        hours: 4,
      },
    );
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Snoozed for 4h" }),
    );
  });

  it("preserves the stall sentinel by sending counter=null when relatedEntityId encodes `_`", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ ok: true }) });
    const user = userEvent.setup();
    renderItem({
      notification: makeAlert({
        id: "notif-stall-1",
        relatedEntityId: "weekly_digest:_:stall",
        title: "weekly_digest stall",
      }),
    });

    await user.click(
      screen.getByTestId("button-snooze-notification-notif-stall-1"),
    );
    await user.click(
      await screen.findByTestId(
        "option-snooze-notification-notif-stall-1-1h",
      ),
    );

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/admin/metrics/jobs/alerts/snooze-by-key",
      { job: "weekly_digest", counter: null, kind: "stall", hours: 1 },
    );
  });

  it("dismiss button marks the notification as read without snoozing", () => {
    const onDismiss = vi.fn();
    renderItem({ onDismiss });

    fireEvent.click(
      screen.getByTestId("button-dismiss-notification-notif-jma-1"),
    );
    expect(onDismiss).toHaveBeenCalled();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("clicking the deep-link calls onNavigate so the bell popover closes", () => {
    const onNavigate = vi.fn();
    const onDismiss = vi.fn();
    renderItem({ onDismiss, onNavigate });

    fireEvent.click(
      screen.getByTestId("link-alert-notification-notif-jma-1"),
    );

    expect(onNavigate).toHaveBeenCalled();
    // Unread row also marks itself read on navigate.
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders nothing snooze-related for malformed alert keys (still shows row)", () => {
    renderItem({
      notification: makeAlert({
        id: "notif-bad-key",
        relatedEntityId: "not-a-valid-key",
      }),
    });

    expect(screen.getByTestId("text-alert-title-notif-bad-key")).toBeTruthy();
    expect(
      screen.queryByTestId("button-snooze-notification-notif-bad-key"),
    ).toBeNull();
  });
});
