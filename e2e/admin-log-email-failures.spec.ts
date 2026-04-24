/**
 * Task #1666 — UI coverage for the org-wide "Scheduled email failures"
 * dashboard.
 *
 * The page lists every project schedule whose most recent attempt was a
 * FAILURE or NO_RECIPIENTS, and exposes a "View history" affordance per
 * row that opens a popover rendering the same recent attempts table the
 * per-project settings card uses (extracted into
 * `client/src/components/log-email/RecentAttempts.tsx`).
 *
 * We stub both the org-wide failures GET and the per-schedule attempts
 * GET so the test is hermetic — neither response depends on real cron
 * activity having taken place in the test DB.
 *
 * Backend coverage for the failures endpoint itself lives in
 * `server/__tests__/log-email-schedule-failures.test.ts`.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devAdminLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status()).toBe(200);
}

const PROJECT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const FAILURES = [
  {
    scheduleId: "sched-a",
    projectId: PROJECT_A_ID,
    projectName: "Bridge 7 Reconstruction",
    projectCode: "BR-7",
    logType: "RFI",
    cadence: "DAILY",
    lastAttemptAt: "2026-04-22T08:00:00.000Z",
    lastAttemptStatus: "FAILURE",
    lastAttemptError: "SMTP transport rejected: 550 Bounced",
    lastAttemptRecipientCount: 3,
    consecutiveFailureCount: 4,
  },
  {
    scheduleId: "sched-b",
    projectId: PROJECT_B_ID,
    projectName: "Tower 9 East",
    projectCode: "TW-9",
    logType: "SUBMITTAL",
    cadence: "WEEKLY",
    lastAttemptAt: "2026-04-21T08:00:00.000Z",
    lastAttemptStatus: "NO_RECIPIENTS",
    lastAttemptError: "No recipients on the distribution list",
    lastAttemptRecipientCount: 0,
    consecutiveFailureCount: 1,
  },
];

const PROJECT_A_ATTEMPTS = [
  {
    id: "att-a-1",
    status: "FAILURE",
    error: "SMTP transport rejected: 550 Bounced",
    recipientCount: 3,
    triggerType: "CRON",
    triggeredById: null,
    triggeredByLabel: "Scheduled run",
    createdAt: "2026-04-22T08:00:00.000Z",
  },
  {
    id: "att-a-2",
    status: "SUCCESS",
    error: null,
    recipientCount: 3,
    triggerType: "MANUAL",
    triggeredById: "user-99",
    triggeredByLabel: "Jane Doe",
    createdAt: "2026-04-21T08:00:00.000Z",
  },
];

async function stubEndpoints(page: Page) {
  await page.route(/\/api\/log-email-schedule-failures(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ failures: FAILURES }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/${PROJECT_A_ID}/log-email-schedules/RFI/attempts(\\?.*)?$`),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ attempts: PROJECT_A_ATTEMPTS }),
      });
    },
  );
}

test.describe("Admin scheduled email failures dashboard (Task #1666)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
    await stubEndpoints(page);
  });

  test("lists failing schedules and surfaces recent attempts in a per-row View history popover", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/log-email-failures`, {
      waitUntil: "domcontentloaded",
    });

    // Heading + table render
    await expect(page.getByTestId("heading-log-email-failures")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("table-log-email-failures")).toBeVisible();

    // Both failure rows present
    const rowAKey = `${PROJECT_A_ID}-RFI`;
    const rowBKey = `${PROJECT_B_ID}-SUBMITTAL`;
    await expect(page.getByTestId(`row-failure-${rowAKey}`)).toBeVisible();
    await expect(page.getByTestId(`row-failure-${rowBKey}`)).toBeVisible();

    // Project metadata + status copy (FAILURE → "Failed", NO_RECIPIENTS → "No recipients")
    await expect(page.getByTestId(`text-project-name-${rowAKey}`)).toHaveText(
      "Bridge 7 Reconstruction",
    );
    await expect(page.getByTestId(`badge-failure-status-${rowAKey}`)).toContainText(
      /Failed/,
    );
    await expect(page.getByTestId(`badge-failure-status-${rowBKey}`)).toContainText(
      /No recipients/,
    );
    // Consecutive-failure count comes through unmodified
    await expect(
      page.getByTestId(`text-consecutive-failures-${rowAKey}`),
    ).toHaveText("4");

    // Open the View history popover for project A and verify the
    // attempts come from the existing per-project endpoint. The
    // attempt rows reuse the `row-attempt-<scope>-<id>` testid from
    // the shared component.
    await page.getByTestId(`button-view-history-${rowAKey}`).click();
    const attemptRow = page.getByTestId(`row-attempt-${rowAKey}-att-a-1`);
    await expect(attemptRow).toBeVisible();
    await expect(
      page.getByTestId(`row-attempt-${rowAKey}-att-a-2`),
    ).toBeVisible();
    // Status badges from the shared component are keyed off the
    // attempt id, not the row scope.
    await expect(page.getByTestId(`badge-attempt-status-att-a-1`)).toContainText(
      /Failed/,
    );
    await expect(page.getByTestId(`badge-attempt-status-att-a-2`)).toContainText(
      /Sent/,
    );
  });

  test("disables Resend now with a per-row cooldown countdown after a successful click (Task #1716)", async ({
    page,
  }) => {
    // Stub the send-now endpoint to return a SUCCESS outcome so the
    // mutation's onSuccess path fires and the cooldown starts.
    await page.route(
      new RegExp(
        `/api/projects/${PROJECT_A_ID}/log-email-schedules/RFI/send-now$`,
      ),
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            result: { status: "SUCCESS", error: null, recipientCount: 3 },
          }),
        });
      },
    );

    await page.goto(`${BASE_URL}/admin/log-email-failures`, {
      waitUntil: "domcontentloaded",
    });

    const rowAKey = `${PROJECT_A_ID}-RFI`;
    const button = page.getByTestId(`button-resend-now-${rowAKey}`);
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveText(/Resend now/);
    await expect(button).toBeEnabled();

    await button.click();

    // After the success response the button should disable itself and
    // swap to the "Cooldown Ns…" countdown label. We don't assert the
    // exact remaining seconds (timing-sensitive) — just that the
    // countdown copy appears and the button is disabled.
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(/Cooldown \d+s…/, { timeout: 5_000 });
  });

  test("renders the empty state when there are no failures", async ({ page }) => {
    // Override the stub from beforeEach to return an empty list.
    await page.route(
      /\/api\/log-email-schedule-failures(\?.*)?$/,
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ failures: [] }),
        });
      },
    );

    await page.goto(`${BASE_URL}/admin/log-email-failures`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("empty-log-email-failures")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("table-log-email-failures")).toHaveCount(0);
  });
});
