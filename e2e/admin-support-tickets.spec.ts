/**
 * Task #2818 — End-to-end coverage for the super-admin support ticket triage
 * page at /admin/support-tickets.
 *
 * The tests below cover the four core workflows the spec calls out:
 *   1. Table renders tickets (or shows an empty state gracefully).
 *   2. Applying a status filter updates the table.
 *   3. Clicking a row opens the detail Sheet with ticket information.
 *   4. Changing ticket status in the Sheet triggers a success toast.
 *
 * All network calls are intercepted so the tests are hermetic and don't
 * depend on seeded data in the development DB.
 *
 * Backend coverage for the GET /api/support/tickets and
 * PATCH /api/support/tickets/:id endpoints lives in the server-side
 * integration tests under server/support/__tests__/.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devSuperAdminLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "SUPER_ADMIN" },
  });
  expect(res.status(), `SUPER_ADMIN dev login failed: ${await res.text()}`).toBe(200);
}

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const TICKET_OPEN = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  organizationId: "org-alpha",
  userId: "user-1",
  submitterEmail: "alice@example.com",
  submitterName: "Alice Alpha",
  subject: "Cannot export PDF report",
  body: "Every time I click the export button the page hangs indefinitely.",
  route: "/reports",
  userAgent: "Mozilla/5.0",
  status: "open",
  priority: "high",
  tier: "pro",
  assignedTo: null,
  slaFirstResponseDueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  slaResolutionDueAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  slaFirstResponseBreached: 0,
  slaResolutionBreached: 0,
  firstResponseAt: null,
  resolvedAt: null,
  metadata: {},
  createdAt: "2026-05-10T09:00:00.000Z",
  updatedAt: "2026-05-10T09:00:00.000Z",
};

const TICKET_RESOLVED = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  organizationId: "org-beta",
  userId: "user-2",
  submitterEmail: "bob@example.com",
  submitterName: "Bob Beta",
  subject: "Login fails after password reset",
  body: "After resetting my password I can no longer log in.",
  route: "/login",
  userAgent: "Mozilla/5.0",
  status: "resolved",
  priority: "urgent",
  tier: "enterprise",
  assignedTo: null,
  slaFirstResponseDueAt: "2026-05-09T10:00:00.000Z",
  slaResolutionDueAt: "2026-05-09T18:00:00.000Z",
  slaFirstResponseBreached: 0,
  slaResolutionBreached: 0,
  firstResponseAt: "2026-05-09T09:30:00.000Z",
  resolvedAt: "2026-05-09T16:00:00.000Z",
  metadata: {},
  createdAt: "2026-05-09T08:00:00.000Z",
  updatedAt: "2026-05-09T16:00:00.000Z",
};

const ALL_TICKETS = [TICKET_OPEN, TICKET_RESOLVED];

// ---------------------------------------------------------------------------
// Route stubs
// ---------------------------------------------------------------------------

async function stubTicketsEndpoint(page: Page, tickets = ALL_TICKETS) {
  await page.route(/\/api\/support\/tickets(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const statusFilter = url.searchParams.get("status");
    const priorityFilter = url.searchParams.get("priority");

    let filtered = tickets;
    if (statusFilter) filtered = filtered.filter((t) => t.status === statusFilter);
    if (priorityFilter) filtered = filtered.filter((t) => t.priority === priorityFilter);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tickets: filtered }),
    });
  });
}

async function stubPatchEndpoint(
  page: Page,
  ticketId: string,
  patchedTicket: typeof TICKET_OPEN,
) {
  await page.route(
    new RegExp(`/api/support/tickets/${ticketId}$`),
    async (route: Route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(patchedTicket),
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Admin support ticket triage page (Task #2818)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devSuperAdminLogin(page);
  });

  test("renders the ticket table with all tickets when no filter is applied", async ({
    page,
  }) => {
    await stubTicketsEndpoint(page);

    await page.goto(`${BASE_URL}/admin/support-tickets`, {
      waitUntil: "domcontentloaded",
    });

    // Heading is visible
    await expect(page.getByTestId("heading-support-tickets")).toBeVisible({
      timeout: 30_000,
    });

    // Both ticket rows appear
    await expect(
      page.getByTestId(`row-ticket-${TICKET_OPEN.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`row-ticket-${TICKET_RESOLVED.id}`),
    ).toBeVisible();

    // Subject text is shown
    await expect(
      page.getByTestId(`text-ticket-subject-${TICKET_OPEN.id}`),
    ).toHaveText(TICKET_OPEN.subject);

    // Ticket count footer reflects the two loaded tickets
    await expect(page.getByTestId("text-ticket-count")).toContainText("2 tickets");
  });

  test("shows the empty state gracefully when no tickets match", async ({
    page,
  }) => {
    await stubTicketsEndpoint(page, []);

    await page.goto(`${BASE_URL}/admin/support-tickets`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("heading-support-tickets")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("empty-state-tickets")).toBeVisible();
    // No ticket rows
    await expect(page.getByTestId(`row-ticket-${TICKET_OPEN.id}`)).toHaveCount(0);
  });

  test("applying a status filter rerequests tickets and updates the table", async ({
    page,
  }) => {
    await stubTicketsEndpoint(page);

    await page.goto(`${BASE_URL}/admin/support-tickets`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the initial table to render
    await expect(
      page.getByTestId(`row-ticket-${TICKET_OPEN.id}`),
    ).toBeVisible({ timeout: 30_000 });

    // Capture the next GET request that carries the status filter
    const filterRequestPromise = page.waitForRequest((req) => {
      if (req.method() !== "GET") return false;
      const u = new URL(req.url());
      return (
        u.pathname.endsWith("/api/support/tickets") &&
        u.searchParams.get("status") === "open"
      );
    });

    // Open the status filter select and choose "Open"
    await page.getByTestId("select-status-filter").click();
    await page.getByTestId("status-option-open").click();

    await filterRequestPromise;

    // After filtering the resolved ticket is gone; the open one remains
    await expect(
      page.getByTestId(`row-ticket-${TICKET_OPEN.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`row-ticket-${TICKET_RESOLVED.id}`),
    ).toHaveCount(0);

    // Ticket count reflects the filtered result
    await expect(page.getByTestId("text-ticket-count")).toContainText("1 ticket");
  });

  test("clicking a row opens the detail Sheet showing ticket information", async ({
    page,
  }) => {
    await stubTicketsEndpoint(page);

    await page.goto(`${BASE_URL}/admin/support-tickets`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByTestId(`row-ticket-${TICKET_OPEN.id}`),
    ).toBeVisible({ timeout: 30_000 });

    // Click the open ticket row
    await page.getByTestId(`row-ticket-${TICKET_OPEN.id}`).click();

    // The Sheet should become visible with the ticket subject in its heading
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet).toContainText(TICKET_OPEN.subject);

    // Submitter name and email are shown in the sheet body
    await expect(sheet).toContainText(TICKET_OPEN.submitterName!);
    await expect(sheet).toContainText(TICKET_OPEN.submitterEmail);

    // Status and priority selects carry the correct current values
    await expect(page.getByTestId("select-ticket-status")).toContainText(/Open/i);
    await expect(page.getByTestId("select-ticket-priority")).toContainText(/High/i);
  });

  test("changing status in the Sheet calls the PATCH endpoint and shows a success toast", async ({
    page,
  }) => {
    await stubTicketsEndpoint(page);

    const resolvedTicket = { ...TICKET_OPEN, status: "in_progress" as const };
    await stubPatchEndpoint(page, TICKET_OPEN.id, resolvedTicket);

    await page.goto(`${BASE_URL}/admin/support-tickets`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByTestId(`row-ticket-${TICKET_OPEN.id}`),
    ).toBeVisible({ timeout: 30_000 });

    // Open the detail sheet
    await page.getByTestId(`row-ticket-${TICKET_OPEN.id}`).click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Capture the outgoing PATCH request
    const patchPromise = page.waitForRequest((req) => {
      return (
        req.method() === "PATCH" &&
        req.url().endsWith(`/api/support/tickets/${TICKET_OPEN.id}`)
      );
    });

    // Click the status select and pick "In Progress"
    await page.getByTestId("select-ticket-status").click();
    await page.getByRole("option", { name: /in progress/i }).click();

    // Wait for the PATCH to be sent
    await patchPromise;

    // A "Ticket updated" success toast should appear.
    // Use exact text to avoid matching the aria-live echo span whose text is
    // "Notification Ticket updated" (a different string).
    await expect(
      page.getByText("Ticket updated", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
