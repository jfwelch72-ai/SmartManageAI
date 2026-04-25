// @vitest-environment jsdom
/**
 * Task #1946 — focused component test for the new label/link branches in
 * QboSyncRetryPanel that Task #1941 introduced. These four code paths are
 * currently only exercised by the integrations route's e2e test, so this
 * file pins them down at the component level so a regression in the
 * panel's row rendering is caught even if the route test is unaffected:
 *
 *   1. exhausted + displayName + link → wraps the row in a wouter Link
 *      whose href is the deep link
 *   2. active retry with a displayName → plain label, no Link wrapper
 *   3. no displayName → falls back to the raw `label` string
 *   4. when displayName is present, the muted raw `itemId` is rendered
 *      alongside it as a suffix (and is omitted when displayName is null)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    className,
    "data-testid": testId,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "data-testid"?: string;
  }) => (
    <a href={href} className={className} data-testid={testId}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { QboSyncRetryPanel } from "../QboSyncRetryPanel";
import type { Connection } from "../types";

const connection: Connection = {
  id: "conn-qbo-1",
  provider: "qbo",
  displayName: "QuickBooks (Acme)",
  status: "active",
  lastSyncAt: null,
  lastSyncError: null,
  createdAt: "2026-04-01T00:00:00.000Z",
};

type Retry = {
  id: string;
  entityType: string;
  kind: "customer" | "invoice" | "pay_run" | "scheduled_op";
  label: string;
  itemId: string | null;
  displayName: string | null;
  link: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  exhausted: boolean;
};

function renderPanel(retries: Retry[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    ["/api/integrations/connections", connection.id, "qbo-sync-retries"],
    {
      connectionId: connection.id,
      provider: "qbo",
      maxRetries: 5,
      retries,
    },
  );
  return render(
    <QueryClientProvider client={qc}>
      <QboSyncRetryPanel connection={connection} />
    </QueryClientProvider>,
  );
}

describe("QboSyncRetryPanel row rendering (Task #1941 branches)", () => {
  beforeEach(() => {
    // Anchor focus effect inspects window.location.hash; default to none.
    if (typeof window !== "undefined") {
      window.location.hash = "";
    }
  });
  afterEach(() => {
    cleanup();
  });

  it("wraps an exhausted row with a deep-link in a wouter Link to retry.link", () => {
    renderPanel([
      {
        id: "retry-exhausted-1",
        entityType: "customer",
        kind: "customer",
        label: "Customer cust-123",
        itemId: "cust-123",
        displayName: "Acme Industrial Co.",
        link: "/customers/cust-123",
        lastError: "Token expired",
        lastAttemptAt: "2026-04-25T11:00:00.000Z",
        retryCount: 5,
        nextRetryAt: null,
        exhausted: true,
      },
    ]);

    const link = screen.getByTestId("link-qbo-retry-retry-exhausted-1");
    expect(link).toBeTruthy();
    expect(link.tagName.toLowerCase()).toBe("a");
    expect(link.getAttribute("href")).toBe("/customers/cust-123");

    const label = screen.getByTestId("text-qbo-retry-label-retry-exhausted-1");
    expect(label.textContent).toBe("Acme Industrial Co.");
    // The label text lives inside the link, not a bare span.
    expect(link.contains(label)).toBe(true);

    // Muted raw ID suffix is present because displayName is set.
    expect(
      screen.getByTestId("text-qbo-retry-id-retry-exhausted-1").textContent,
    ).toBe("cust-123");
  });

  it("renders a plain label (no Link) for an active retry with displayName", () => {
    renderPanel([
      {
        id: "retry-active-1",
        entityType: "invoice",
        kind: "invoice",
        label: "Invoice inv-555",
        itemId: "inv-555",
        displayName: "Invoice #2026-0042",
        link: "/invoices/inv-555",
        lastError: "Rate limit",
        lastAttemptAt: "2026-04-25T11:30:00.000Z",
        retryCount: 2,
        nextRetryAt: "2026-04-25T11:45:00.000Z",
        exhausted: false,
      },
    ]);

    // Active retries never wrap the label in a Link, even if a deep link
    // is available — the link only appears once auto-retry is exhausted.
    expect(screen.queryByTestId("link-qbo-retry-retry-active-1")).toBeNull();

    const label = screen.getByTestId("text-qbo-retry-label-retry-active-1");
    expect(label.tagName.toLowerCase()).toBe("span");
    expect(label.textContent).toBe("Invoice #2026-0042");

    // Muted raw ID suffix shows alongside the displayName.
    expect(
      screen.getByTestId("text-qbo-retry-id-retry-active-1").textContent,
    ).toBe("inv-555");
  });

  it("falls back to the raw `label` when displayName is missing", () => {
    renderPanel([
      {
        id: "retry-no-name-1",
        entityType: "scheduled_op",
        kind: "scheduled_op",
        label: "Nightly chart-of-accounts sync",
        itemId: "op-789",
        displayName: null,
        link: null,
        lastError: null,
        lastAttemptAt: null,
        retryCount: 1,
        nextRetryAt: "2026-04-25T12:00:00.000Z",
        exhausted: false,
      },
    ]);

    expect(screen.queryByTestId("link-qbo-retry-retry-no-name-1")).toBeNull();
    expect(
      screen.getByTestId("text-qbo-retry-label-retry-no-name-1").textContent,
    ).toBe("Nightly chart-of-accounts sync");

    // No displayName ⇒ no muted raw-ID suffix beside the label.
    expect(screen.queryByTestId("text-qbo-retry-id-retry-no-name-1")).toBeNull();
  });

  it("does not render the deep link when an exhausted row has no link or no displayName", () => {
    renderPanel([
      // Exhausted but missing displayName — must fall back to the raw
      // label and stay outside any Link wrapper.
      {
        id: "retry-exhausted-no-name",
        entityType: "pay_run",
        kind: "pay_run",
        label: "Pay run pr-001",
        itemId: "pr-001",
        displayName: null,
        link: "/pay-runs/pr-001",
        lastError: "boom",
        lastAttemptAt: "2026-04-25T10:00:00.000Z",
        retryCount: 5,
        nextRetryAt: null,
        exhausted: true,
      },
      // Exhausted with displayName but no deep link — label must render
      // as a plain span, not a Link.
      {
        id: "retry-exhausted-no-link",
        entityType: "pay_run",
        kind: "pay_run",
        label: "Pay run pr-002",
        itemId: "pr-002",
        displayName: "Weekly payroll · 2026-W17",
        link: null,
        lastError: "boom",
        lastAttemptAt: "2026-04-25T10:00:00.000Z",
        retryCount: 5,
        nextRetryAt: null,
        exhausted: true,
      },
    ]);

    // Neither row should have produced a Link wrapper.
    expect(
      screen.queryByTestId("link-qbo-retry-retry-exhausted-no-name"),
    ).toBeNull();
    expect(
      screen.queryByTestId("link-qbo-retry-retry-exhausted-no-link"),
    ).toBeNull();

    // First row falls back to raw label text.
    expect(
      screen.getByTestId("text-qbo-retry-label-retry-exhausted-no-name")
        .textContent,
    ).toBe("Pay run pr-001");

    // Second row uses displayName and shows the raw-ID suffix.
    expect(
      screen.getByTestId("text-qbo-retry-label-retry-exhausted-no-link")
        .textContent,
    ).toBe("Weekly payroll · 2026-W17");
    expect(
      screen.getByTestId("text-qbo-retry-id-retry-exhausted-no-link")
        .textContent,
    ).toBe("pr-002");
  });
});
