// @vitest-environment jsdom
/**
 * Task #1182 — verifies the NotificationsWidget renders certified payroll
 * digest entries with the formatted project/variant breakdown and a
 * deep-link to /payroll/certified-history with the digest's date range
 * applied. Plain REMINDER notifications continue to render the original
 * truncated text layout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mockApiRequest,
    queryClient: new QueryClient(),
    getQueryFn: () => async () => digestNotifications,
  };
});

import { NotificationsWidget } from "../NotificationsWidget";

const digestNotifications = [
  {
    id: "n-digest-1",
    userId: "u1",
    organizationId: "o1",
    type: "REMINDER",
    title: "Weekly certified payroll digest: 4 reports",
    message:
      "Certified payroll PDFs generated 2026-04-13 – 2026-04-19: 4 reports across 2 projects.\n\nBridge Repair — WH-347: 3\nBridge Repair — A1-131: 1",
    relatedEntityType: "CERTIFIED_PAYROLL_DIGEST",
    relatedEntityId: "2026-04-13|2026-04-19",
    isRead: false,
    createdAt: new Date("2026-04-20T10:00:00Z").toISOString(),
  },
  {
    id: "n-plain-1",
    userId: "u1",
    organizationId: "o1",
    type: "REMINDER",
    title: "Site walkthrough reminder",
    message: "Walk site at 9am tomorrow",
    relatedEntityType: null,
    relatedEntityId: null,
    isRead: false,
    createdAt: new Date("2026-04-20T11:00:00Z").toISOString(),
  },
];

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/notifications"], digestNotifications);
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <NotificationsWidget />
      </Router>
    </QueryClientProvider>,
  );
}

describe("NotificationsWidget — certified payroll digest", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the digest header, breakdown table rows, and deep-link", () => {
    renderWidget();

    expect(screen.getByTestId("text-digest-title-n-digest-1").textContent).toBe(
      "Weekly certified payroll digest: 4 reports",
    );
    expect(
      screen.getByTestId("text-digest-header-n-digest-1").textContent ?? "",
    ).toMatch(
      /Certified payroll PDFs generated 2026-04-13 – 2026-04-19: 4 reports across 2 projects\./,
    );

    expect(screen.getByTestId("table-digest-breakdown-n-digest-1")).toBeTruthy();

    const row0 = screen.getByTestId("row-digest-breakdown-n-digest-1-0");
    expect(row0.textContent).toContain("Bridge Repair");
    expect(row0.textContent).toContain("WH-347");
    expect(row0.textContent).toContain("3");

    const row1 = screen.getByTestId("row-digest-breakdown-n-digest-1-1");
    expect(row1.textContent).toContain("A1-131");
    expect(row1.textContent).toContain("1");

    const link = screen
      .getByTestId("link-digest-history-n-digest-1")
      .closest("a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe(
      "/payroll/certified-history?startDate=2026-04-13&endDate=2026-04-19",
    );
  });

  it("renders non-digest notifications using the plain layout", () => {
    renderWidget();

    const plain = screen.getByTestId("notification-item-n-plain-1");
    expect(plain.textContent).toContain("Site walkthrough reminder");
    expect(plain.textContent).toContain("Walk site at 9am tomorrow");
    expect(screen.queryByTestId("table-digest-breakdown-n-plain-1")).toBeNull();
    expect(screen.queryByTestId("link-digest-history-n-plain-1")).toBeNull();
  });
});
