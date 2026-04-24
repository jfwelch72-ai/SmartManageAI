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

interface StubHandles {
  /** How many times the GET attempts endpoint has been hit. */
  getAttemptsHits: () => number;
  /** How many times the POST send-now endpoint has been hit. */
  getSendNowHits: () => number;
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

async function stubScheduleEndpoints(page: Page, opts: StubOpts): Promise<StubHandles> {
  let attemptsHits = 0;
  let sendNowHits = 0;
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
      attemptsHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ attempts: ATTEMPTS }),
      });
    },
  );

  // Task #1714 — POST send-now stub. The Retry button on each
  // FAILURE row is wired to the same mutation as the card's main
  // "Send now" button, so all retry-driven traffic lands here.
  // Returning a SUCCESS shape lets the card's onSuccess path fire
  // (success toast + cache invalidation of both the schedule list
  // and the per-schedule attempts list).
  await page.route(
    new RegExp(`/api/projects/${opts.projectId}/log-email-schedules/RFI/send-now$`),
    async (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sendNowHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { status: "SUCCESS", error: null, recipientCount: 3 },
          schedule: {
            id: "sched-rfi-stub",
            organizationId: "org-stub",
            projectId: opts.projectId,
            logType: "RFI",
            cadence: "DAILY",
            weekday: 1,
            hour: 8,
            timezone: "UTC",
            lastSentAt: "2026-04-23T08:00:00.000Z",
            lastAttemptAt: "2026-04-23T08:00:00.000Z",
            lastAttemptStatus: "SUCCESS",
            lastAttemptError: null,
            lastAttemptRecipientCount: 3,
            consecutiveFailureCount: 0,
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-23T08:00:00.000Z",
          },
        }),
      });
    },
  );

  return {
    getAttemptsHits: () => attemptsHits,
    getSendNowHits: () => sendNowHits,
  };
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

  /**
   * Task #1714 — end-to-end coverage for the per-row Retry button
   * added in Task #1664. The button reuses the card's `sendNowMutation`
   * (POST .../send-now) and on success fires the same toast +
   * invalidates both the schedule list and the per-schedule attempts
   * list. Without this spec, a regression in that wiring (e.g.
   * passing the wrong logType, dropping the cache invalidation) would
   * only be caught by manual QA.
   */
  test("clicking Retry on a failure row issues the send-now POST and re-fetches the attempts list", async ({
    page,
  }) => {
    const project = await createProject(page);
    const handles = await stubScheduleEndpoints(page, { projectId: project.id });

    await page.goto(`${BASE_URL}/projects/${project.code}?tab=progress-reports`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("card-log-email-schedule")).toBeVisible({
      timeout: 30_000,
    });

    // Open the collapsible so the FAILURE row (and its Retry button)
    // mounts. The body lazy-loads via React Query so wait until the
    // stubbed attempt rows arrive before continuing.
    await page.getByTestId("button-toggle-attempt-history-rfi").click();
    await expect(
      page.getByTestId(`row-attempt-rfi-${ATTEMPTS[0].id}`),
    ).toBeVisible();
    // First fetch from the lazy load — the post-retry refetch should
    // bump this counter.
    expect(handles.getAttemptsHits()).toBeGreaterThanOrEqual(1);
    const attemptsBefore = handles.getAttemptsHits();

    // SUCCESS row has no Retry button — the action column only renders
    // a button on FAILURE rows. Guard that here so the test fails fast
    // if the retry contract ever leaks onto non-failure rows.
    await expect(
      page.getByTestId(`button-retry-attempt-${ATTEMPTS[1].id}`),
    ).toHaveCount(0);

    const retry = page.getByTestId(`button-retry-attempt-${ATTEMPTS[0].id}`);
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    // Click Retry and verify the POST landed at the same endpoint
    // the card's main "Send now" button uses.
    await Promise.all([
      page.waitForRequest(
        (req) =>
          req.method() === "POST" &&
          /\/api\/projects\/[^/]+\/log-email-schedules\/RFI\/send-now$/.test(
            req.url(),
          ),
      ),
      retry.click(),
    ]);
    expect(handles.getSendNowHits()).toBe(1);

    // Success toast — the card's onSuccess path renders a "Log emailed"
    // toast (LOG_TYPE_LABELS[RFI]) when the stubbed result is SUCCESS.
    await expect(page.getByText(/Log emailed/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // The attempts query is invalidated on success, so React Query
    // should hit the GET attempts endpoint again. Poll instead of
    // asserting once — invalidation → refetch is async.
    await expect
      .poll(() => handles.getAttemptsHits(), { timeout: 10_000 })
      .toBeGreaterThan(attemptsBefore);
  });

  /**
   * Task #1714 — the project settings card disables Retry while
   * there are unsaved cadence edits in the same row, mirroring the
   * `disabledReason: "Save your unsaved changes first…"` guard the
   * card's main "Send now" button already has. Without this guard a
   * user could change the cadence in the row, click Retry, and
   * unintentionally send with the *saved* (stale) configuration.
   */
  test("disables Retry while there are unsaved cadence edits in the row", async ({
    page,
  }) => {
    const project = await createProject(page);
    const handles = await stubScheduleEndpoints(page, { projectId: project.id });

    await page.goto(`${BASE_URL}/projects/${project.code}?tab=progress-reports`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("card-log-email-schedule")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("button-toggle-attempt-history-rfi").click();
    const retry = page.getByTestId(`button-retry-attempt-${ATTEMPTS[0].id}`);
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    // Dirty the row by switching cadence DAILY → WEEKLY. Radix
    // renders the SelectContent into a portal, so click the trigger
    // first then the option by its testid.
    await page.getByTestId("select-cadence-rfi").click();
    await page.getByTestId("option-cadence-rfi-weekly").click();

    // The card's `dirty` flag flips and is propagated through to the
    // shared RecentAttemptsTable as `retry.disabled` — the button
    // should disable and surface the Save-first hint via its title
    // attribute.
    await expect(retry).toBeDisabled();
    await expect(retry).toHaveAttribute(
      "title",
      /Save your unsaved changes first/i,
    );

    // Defensive: a disabled click must NOT fire the POST. Force the
    // click past the disabled guard so we're testing the actual
    // pointer-events / disabled wiring rather than Playwright
    // refusing to click on our behalf.
    await retry.click({ force: true }).catch(() => undefined);
    // Wait for *any* send-now POST with a short timeout. Expect the
    // wait to time out — that's how we prove no request was issued.
    // More robust than a single-instant counter check because the
    // fetch could be in-flight at the moment we sample.
    const sawPost = await page
      .waitForRequest(
        (req) =>
          req.method() === "POST" &&
          /\/api\/projects\/[^/]+\/log-email-schedules\/RFI\/send-now$/.test(
            req.url(),
          ),
        { timeout: 1_000 },
      )
      .then(() => true)
      .catch(() => false);
    expect(sawPost).toBe(false);
    expect(handles.getSendNowHits()).toBe(0);
  });
});
