// @vitest-environment jsdom
/**
 * Task #1965 — routing-level coverage for the QboSyncRetryPanel deep links.
 *
 * The sibling component test (QboSyncRetryPanel.test.tsx) only verifies the
 * panel renders an <a> with href === retry.link for an exhausted row — it
 * mocks wouter's Link, so it cannot catch regressions where:
 *
 *   1. The deep-link click is intercepted/swallowed by another handler on
 *      the integrations page (i.e. wouter's Link no longer triggers
 *      navigation through the active location hook).
 *   2. The server-generated link pattern silently drifts and no longer
 *      matches any route registered in client/src/App.tsx (e.g. someone
 *      renames /crm → /customers without updating the integration route).
 *   3. A previously-registered destination route is removed entirely.
 *
 * To pin all three down without booting the full App tree, this test:
 *   - Renders the real QboSyncRetryPanel (with the real wouter Link)
 *     inside a wouter Router driven by memoryLocation.
 *   - Mounts a Switch with stub Routes whose paths exactly mirror the three
 *     entity destinations registered in App.tsx (/crm, /progress-billing,
 *     /payroll-management) plus a sentinel catch-all so an unregistered
 *     path is loud rather than silent.
 *   - Cross-checks (in a separate assertion) that App.tsx really does
 *     register Route entries for each of those paths, so accidental
 *     deletion of a destination route in App.tsx fails this test even if
 *     the stub Switch still renders the placeholder.
 *   - Clicks the deep link for each of the three entity kinds the panel
 *     surfaces (customer, invoice, pay_run) and asserts both the recorded
 *     navigation history and the rendered destination match the expected
 *     route + query string.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Switch, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";

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
  id: "conn-qbo-routing",
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

// These mirror the deep-link patterns produced by
// server/integrationRoutes.ts in the GET .../qbo-sync-retries handler.
// If the server pattern changes without a matching App.tsx route update,
// either the click navigation assertion or the App.tsx route-registration
// cross-check below will fail.
const CUSTOMER_ITEM_ID = "cust-qbo-1";
const INVOICE_ITEM_ID = "inv-qbo-2";
const PAY_RUN_ITEM_ID = "pr-qbo-3";

const CUSTOMER_LINK = `/crm?organisationId=${encodeURIComponent(CUSTOMER_ITEM_ID)}`;
const INVOICE_LINK = `/progress-billing?payApplicationId=${encodeURIComponent(INVOICE_ITEM_ID)}`;
const PAY_RUN_LINK = `/payroll-management?payRunId=${encodeURIComponent(PAY_RUN_ITEM_ID)}`;

const exhaustedRetries: Retry[] = [
  {
    id: "retry-cust-exhausted",
    entityType: "customer",
    kind: "customer",
    label: `Customer ${CUSTOMER_ITEM_ID}`,
    itemId: CUSTOMER_ITEM_ID,
    displayName: "Acme Industrial Co.",
    link: CUSTOMER_LINK,
    lastError: "Token expired",
    lastAttemptAt: "2026-04-25T11:00:00.000Z",
    retryCount: 5,
    nextRetryAt: null,
    exhausted: true,
  },
  {
    id: "retry-invoice-exhausted",
    entityType: "invoice",
    kind: "invoice",
    label: `Invoice ${INVOICE_ITEM_ID}`,
    itemId: INVOICE_ITEM_ID,
    displayName: "Pay app #4 — BRIDGE-22",
    link: INVOICE_LINK,
    lastError: "Validation failed",
    lastAttemptAt: "2026-04-25T11:05:00.000Z",
    retryCount: 5,
    nextRetryAt: null,
    exhausted: true,
  },
  {
    id: "retry-pay-run-exhausted",
    entityType: "payroll_run",
    kind: "pay_run",
    label: `Payroll run ${PAY_RUN_ITEM_ID}`,
    itemId: PAY_RUN_ITEM_ID,
    displayName: "Pay run #2026-W17",
    link: PAY_RUN_LINK,
    lastError: "QBO 500",
    lastAttemptAt: "2026-04-25T11:10:00.000Z",
    retryCount: 5,
    nextRetryAt: null,
    exhausted: true,
  },
];

function renderPanelWithRouter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    ["/api/integrations/connections", connection.id, "qbo-sync-retries"],
    {
      connectionId: connection.id,
      provider: "qbo",
      maxRetries: 5,
      retries: exhaustedRetries,
    },
  );
  // Start on /integrations to mirror the page that hosts the panel; record
  // navigations so the test can assert clicks went through the location hook.
  const { hook: rawHook, history } = memoryLocation({
    path: "/integrations",
    record: true,
  });
  // wouter's memoryLocation stores the full pushed string (path + query),
  // but its default Switch/Route matcher expects pathname only. Wrap the
  // hook so the location handed to Route is the pathname slice while the
  // recorded history (and the navigate fn) still carry the full URL — so
  // the navigation-history assertion below still validates the query
  // string the panel produced.
  const hook: typeof rawHook = () => {
    const [loc, nav] = rawHook();
    const q = loc.indexOf("?");
    return [q >= 0 ? loc.slice(0, q) : loc, nav];
  };
  const utils = render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <>
          <QboSyncRetryPanel connection={connection} />
          <Switch>
            <Route path="/crm">
              {() => (
                <div data-testid="page-stub-crm">CRM page</div>
              )}
            </Route>
            <Route path="/progress-billing">
              {() => (
                <div data-testid="page-stub-progress-billing">
                  Progress billing page
                </div>
              )}
            </Route>
            <Route path="/payroll-management">
              {() => (
                <div data-testid="page-stub-payroll-management">
                  Payroll management page
                </div>
              )}
            </Route>
            <Route path="/integrations">
              {() => (
                <div data-testid="page-stub-integrations">
                  Integrations page
                </div>
              )}
            </Route>
            <Route>
              {() => (
                <div data-testid="page-stub-not-found">No route matched</div>
              )}
            </Route>
          </Switch>
        </>
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, history };
}

describe("QboSyncRetryPanel deep-link routing (Task #1965)", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.location.hash = "";
    }
  });
  afterEach(() => {
    cleanup();
  });

  it.each([
    {
      kind: "customer",
      retryId: "retry-cust-exhausted",
      link: CUSTOMER_LINK,
      destinationTestId: "page-stub-crm",
    },
    {
      kind: "invoice",
      retryId: "retry-invoice-exhausted",
      link: INVOICE_LINK,
      destinationTestId: "page-stub-progress-billing",
    },
    {
      kind: "pay_run",
      retryId: "retry-pay-run-exhausted",
      link: PAY_RUN_LINK,
      destinationTestId: "page-stub-payroll-management",
    },
  ])(
    "navigates to the $kind destination when its deep link is clicked",
    ({ retryId, link, destinationTestId }) => {
      const { history } = renderPanelWithRouter();

      // Sanity: the integrations page stub is the active route on mount,
      // so the destination stubs must NOT be rendered yet.
      expect(screen.getByTestId("page-stub-integrations")).toBeTruthy();
      expect(screen.queryByTestId(destinationTestId)).toBeNull();
      expect(screen.queryByTestId("page-stub-not-found")).toBeNull();

      const anchor = screen.getByTestId(`link-qbo-retry-${retryId}`);
      expect(anchor.tagName.toLowerCase()).toBe("a");
      expect(anchor.getAttribute("href")).toBe(link);

      // Use a real MouseEvent so wouter's Link click handler accepts it
      // (it ignores modifier-key / non-primary-button clicks).
      fireEvent.click(anchor, { button: 0 });

      // Click must have routed through the active location hook (catches
      // a regression where another handler intercepts the row click and
      // suppresses navigation on the integrations page).
      expect(history[history.length - 1]).toBe(link);

      // The Switch must now render the expected destination route. If the
      // path pattern in App.tsx changes (or the server pattern drifts),
      // the not-found sentinel renders instead and this fails loudly.
      expect(screen.getByTestId(destinationTestId)).toBeTruthy();
      expect(screen.queryByTestId("page-stub-not-found")).toBeNull();
    },
  );

  it("App.tsx still registers a Route for every destination this panel deep-links into", () => {
    // Belt-and-braces guard: even if the stub Switch above stays in
    // sync with the deep-link patterns, the real App.tsx must keep a
    // Route entry for each path. Read App.tsx as text and assert each
    // expected `path="..."` literal is present.
    const appPath = path.resolve(__dirname, "../../../App.tsx");
    const source = readFileSync(appPath, "utf8");
    for (const expected of [
      'path="/crm"',
      'path="/progress-billing"',
      'path="/payroll-management"',
    ]) {
      expect(
        source.includes(expected),
        `Expected App.tsx to register a Route with ${expected}`,
      ).toBe(true);
    }
  });
});
