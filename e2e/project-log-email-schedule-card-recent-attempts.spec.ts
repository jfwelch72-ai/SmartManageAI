/**
 * Task #1692 — UI coverage for the per-project "Recent attempts"
 * collapsible inside `ProjectLogEmailScheduleCard.tsx`.
 *
 * Task #1666 extracted the collapsible body out of the project
 * settings card into a shared `@/components/log-email/RecentAttempts`
 * module so both this card AND the org-wide "scheduled email failures"
 * dashboard could reuse it. The dashboard side already has Playwright
 * coverage in `admin-log-email-failures.spec.ts`; this spec pins down
 * the project settings card side so a future refactor of either call
 * site can't silently break the in-card audit trail.
 *
 * The card lives on the Reports tab of the project detail page
 * (`<ProjectReportsTab>`), gated behind hasManagementAccess. We
 * navigate via `?tab=progress-reports` so the card mounts immediately
 * without having to script a tab click.
 *
 * To stay hermetic — the cron writes attempts into the DB on real
 * runs and we don't want a flaky test depending on prior cron
 * activity — we stub:
 *   - `GET .../log-email-schedules`             → controlled schedule rows
 *   - `GET .../log-email-schedules/RFI/attempts` → controlled attempt rows
 * and create a real project so the rest of the project-detail page
 * (`/api/projects/:code`, recipients, etc.) can fetch normally.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
}

let suffixCounter = 0;
function uniqueSuffix(): string {
  suffixCounter += 1;
  return `${Date.now()}-${suffixCounter}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function devAdminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status(), `dev test-login failed: ${await res.text()}`).toBe(200);
}

async function createProject(page: Page): Promise<ProjectResponse> {
  const res = await page.request.post(`${BASE_URL}/api/projects`, {
    data: {
      name: `LogEmail Card Recent Attempts ${uniqueSuffix()}`,
      clientName: "Recent Attempts E2E",
    },
  });
  expect(res.status(), `create project failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as ProjectResponse;
}

interface StubOpts {
  projectId: string;
}

const ATTEMPTS = [
  {
    id: "att-recent-1",
    status: "FAILURE",
    error: "SMTP transport rejected: 550 Bounced",
    recipientCount: 3,
    triggerType: "CRON",
    triggeredById: null,
    triggeredByLabel: "Scheduled run",
    createdAt: "2026-04-22T08:00:00.000Z",
  },
  {
    id: "att-recent-2",
    status: "SUCCESS",
    error: null,
    recipientCount: 3,
    triggerType: "MANUAL",
    triggeredById: "user-99",
    triggeredByLabel: "Jane Doe",
    createdAt: "2026-04-21T08:00:00.000Z",
  },
];

async function stubScheduleEndpoints(page: Page, opts: StubOpts) {
  // The card's outer query — needs at least one schedule with a
  // non-null id, otherwise the `<RecentAttemptsCollapsible>` is not
  // rendered (matches the production guard in the card).
  await page.route(
    new RegExp(`/api/projects/${opts.projectId}/log-email-schedules(\\?.*)?$`),
    async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schedules: [
            {
              id: "sched-rfi-stub",
              organizationId: "org-stub",
              projectId: opts.projectId,
              logType: "RFI",
              cadence: "DAILY",
              weekday: 1,
              hour: 8,
              timezone: "UTC",
              lastSentAt: "2026-04-21T08:00:00.000Z",
              lastAttemptAt: "2026-04-22T08:00:00.000Z",
              lastAttemptStatus: "FAILURE",
              lastAttemptError: "SMTP transport rejected: 550 Bounced",
              lastAttemptRecipientCount: 3,
              consecutiveFailureCount: 2,
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-22T08:00:00.000Z",
            },
            {
              id: "sched-submittal-stub",
              organizationId: "org-stub",
              projectId: opts.projectId,
              logType: "SUBMITTAL",
              cadence: "OFF",
              weekday: 1,
              hour: 8,
              timezone: "UTC",
              lastSentAt: null,
              lastAttemptAt: null,
              lastAttemptStatus: null,
              lastAttemptError: null,
              lastAttemptRecipientCount: null,
              consecutiveFailureCount: 0,
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-01T00:00:00.000Z",
            },
          ],
          failureThreshold: 3,
        }),
      });
    },
  );

  // The lazy-loaded body of the collapsible. Stubbed so the test
  // doesn't depend on actual cron history existing for the project.
  await page.route(
    new RegExp(`/api/projects/${opts.projectId}/log-email-schedules/RFI/attempts(\\?.*)?$`),
    async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ attempts: ATTEMPTS }),
      });
    },
  );
}

test.describe("Project settings card — Recent attempts collapsible (Task #1692)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
  });

  test("expands the shared collapsible and renders the stubbed attempt rows", async ({
    page,
  }) => {
    const project = await createProject(page);
    await stubScheduleEndpoints(page, { projectId: project.id });

    await page.goto(`${BASE_URL}/projects/${project.code}?tab=progress-reports`, {
      waitUntil: "domcontentloaded",
    });

    // Card mounts after the project query resolves; allow extra time
    // because the project detail page fans out a number of queries on
    // first render.
    const card = page.getByTestId("card-log-email-schedule");
    await expect(card).toBeVisible({ timeout: 30_000 });

    // The collapsible is keyed off `schedule.logType.toLowerCase()`,
    // so the toggle for the RFI row is `…-rfi`. It must render
    // collapsed by default — no attempt rows yet.
    const toggle = page.getByTestId("button-toggle-attempt-history-rfi");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId(`row-attempt-rfi-${ATTEMPTS[0].id}`)).toHaveCount(0);

    // Expand. The body lazy-loads via React Query, so the attempt
    // rows from the stubbed endpoint should appear after fetch
    // resolution.
    await toggle.click();

    const failureRow = page.getByTestId(`row-attempt-rfi-${ATTEMPTS[0].id}`);
    await expect(failureRow).toBeVisible();
    await expect(page.getByTestId(`row-attempt-rfi-${ATTEMPTS[1].id}`)).toBeVisible();

    // Status badges from the shared component are keyed off the
    // attempt id (NOT the row scope), matching the contract used by
    // the org-wide failures dashboard's popover.
    await expect(
      page.getByTestId(`badge-attempt-status-${ATTEMPTS[0].id}`),
    ).toContainText(/Failed/);
    await expect(
      page.getByTestId(`badge-attempt-status-${ATTEMPTS[1].id}`),
    ).toContainText(/Sent/);

    // Collapsing again hides the rows — confirms the trigger toggles
    // both directions, not just opens.
    await toggle.click();
    await expect(failureRow).toHaveCount(0);
  });
});
