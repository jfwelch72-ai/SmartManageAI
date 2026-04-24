/**
 * Task #1700 — End-to-end coverage for the
 * "You receive failure alerts for" panel inside
 * `client/src/components/settings/NotificationPrefsSection.tsx`.
 *
 * The backing endpoint (`GET /api/me/failure-alert-routes`,
 * Task #1675) already has hermetic unit tests covering grouping,
 * dedupe, role-tagging and OFF filtering. This Playwright spec
 * pins down the *frontend* contract so a future restructure of
 * the ~2900-line settings file can't silently break the panel:
 *
 *   1. PM-style payload renders one row per project, each
 *      log-type badge carries the role label (PM / last editor /
 *      both), and the project link points at `/projects/<code>`
 *      (the human project code, NOT the uuid).
 *   2. An empty payload renders the dedicated empty-state copy
 *      (`text-failure-alert-routes-empty`) and never falls back
 *      to the populated list.
 *
 * We stub `/api/me/failure-alert-routes` instead of seeding real
 * project + schedule rows because:
 *   - The backend grouping/role logic is already hermetically
 *     covered upstream.
 *   - Stubbing keeps the test deterministic: we exercise the
 *     loading → list / empty branches without depending on the
 *     state of the dev sandbox DB (any prior test that left an
 *     active schedule on the dev admin's project would otherwise
 *     pollute the empty-state assertion).
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const FAILURE_ALERT_ROUTES_URL = /\/api\/me\/failure-alert-routes(\?.*)?$/;

interface FailureAlertRoute {
  projectId: string;
  projectCode: string;
  projectName: string;
  logTypes: Array<{
    logType: "RFI" | "SUBMITTAL";
    cadence: string;
    asPm: boolean;
    asLastEditor: boolean;
  }>;
}

async function devAdminLogin(page: Page): Promise<void> {
  // Use the dev-only quick-login. ADMIN gets linked to the dev
  // sandbox org automatically, which is the only thing /settings
  // requires (the panel itself is org-agnostic).
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status(), `dev test-login failed: ${await res.text()}`).toBe(200);
}

async function stubFailureAlertRoutes(
  page: Page,
  routes: FailureAlertRoute[],
): Promise<void> {
  await page.route(FAILURE_ALERT_ROUTES_URL, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ routes }),
    });
  });
}

async function gotoNotificationPrefs(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/settings/notifications`);
  // The card is rendered alongside this h2 in the same section,
  // so waiting for it guarantees the panel has had a chance to
  // mount before we assert on its sub-elements.
  await expect(page.getByTestId("text-section-title-notifications")).toBeVisible();
}

test.describe("Notification settings — 'You receive failure alerts for' panel (Task #1700)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
  });

  test("renders one row per project with role-tagged badges and a deep-link to /projects/<code>", async ({
    page,
  }) => {
    // Two projects to also smoke-test the stable name-sorted order
    // the backend produces (Aspen Bridge before Zephyr Tower) and
    // the per-row badge rendering for combined PM+lastEditor and
    // PM-only roles.
    const ASPEN_PROJECT_ID = "proj-aspen-1700";
    const ASPEN_PROJECT_CODE = "ASP-1700";
    const ZEPHYR_PROJECT_ID = "proj-zephyr-1700";
    const ZEPHYR_PROJECT_CODE = "ZPH-1700";

    await stubFailureAlertRoutes(page, [
      {
        projectId: ASPEN_PROJECT_ID,
        projectCode: ASPEN_PROJECT_CODE,
        projectName: "Aspen Bridge Replacement",
        logTypes: [
          { logType: "RFI", cadence: "DAILY", asPm: true, asLastEditor: true },
          { logType: "SUBMITTAL", cadence: "WEEKLY", asPm: true, asLastEditor: false },
        ],
      },
      {
        projectId: ZEPHYR_PROJECT_ID,
        projectCode: ZEPHYR_PROJECT_CODE,
        projectName: "Zephyr Tower Mechanical",
        logTypes: [
          { logType: "RFI", cadence: "DAILY", asPm: false, asLastEditor: true },
        ],
      },
    ]);

    await gotoNotificationPrefs(page);

    // Card shell + heading are present.
    await expect(page.getByTestId("card-failure-alert-routes")).toBeVisible();
    await expect(page.getByTestId("text-failure-alert-routes-title")).toHaveText(
      "You receive failure alerts for",
    );

    // Populated branch: list, not empty-state, must be in the DOM.
    await expect(page.getByTestId("list-failure-alert-routes")).toBeVisible();
    await expect(page.getByTestId("text-failure-alert-routes-empty")).toHaveCount(0);

    // Row-per-project: one <li> per stubbed project.
    const aspenRow = page.getByTestId(`row-failure-alert-route-${ASPEN_PROJECT_ID}`);
    const zephyrRow = page.getByTestId(`row-failure-alert-route-${ZEPHYR_PROJECT_ID}`);
    await expect(aspenRow).toBeVisible();
    await expect(zephyrRow).toBeVisible();

    // The component renders rows in the order the endpoint returns,
    // and the endpoint guarantees a stable name-sorted output. Pin
    // that contract down here so a future client-side reorder (e.g.
    // sorting by role) can't silently shuffle the list and break
    // the muscle memory of the daily-driver users.
    const renderedRowIds = await page
      .getByTestId(/^row-failure-alert-route-/)
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
    expect(renderedRowIds).toEqual([
      `row-failure-alert-route-${ASPEN_PROJECT_ID}`,
      `row-failure-alert-route-${ZEPHYR_PROJECT_ID}`,
    ]);

    // Deep-link points at `/projects/<code>` (NOT the projectId).
    // We check the rendered href on the <a> the wouter Link emits
    // because that's what the browser will actually navigate to.
    const aspenLink = page.getByTestId(`link-failure-alert-route-${ASPEN_PROJECT_ID}`);
    await expect(aspenLink).toHaveAttribute("href", `/projects/${ASPEN_PROJECT_CODE}`);
    await expect(aspenLink).toHaveText("Aspen Bridge Replacement");

    const zephyrLink = page.getByTestId(`link-failure-alert-route-${ZEPHYR_PROJECT_ID}`);
    await expect(zephyrLink).toHaveAttribute("href", `/projects/${ZEPHYR_PROJECT_CODE}`);

    // Role-tagged badges: the testid encodes <projectId>-<logType>,
    // and the visible text encodes the role. Combined PM+lastEditor
    // collapses to "PM, last editor"; PM-only stays "PM"; lastEditor-
    // only stays "Last editor". Asserting on the visible text catches
    // regressions where the role-collapsing logic is dropped.
    const aspenRfiBadge = page.getByTestId(
      `badge-failure-alert-route-${ASPEN_PROJECT_ID}-RFI`,
    );
    await expect(aspenRfiBadge).toBeVisible();
    await expect(aspenRfiBadge).toContainText("RFI");
    await expect(aspenRfiBadge).toContainText("PM, last editor");

    const aspenSubmittalBadge = page.getByTestId(
      `badge-failure-alert-route-${ASPEN_PROJECT_ID}-SUBMITTAL`,
    );
    await expect(aspenSubmittalBadge).toBeVisible();
    await expect(aspenSubmittalBadge).toContainText("SUBMITTAL");
    await expect(aspenSubmittalBadge).toContainText("PM");
    // Guard against the role label silently widening to the
    // combined "PM, last editor" form when only `asPm` is true.
    await expect(aspenSubmittalBadge).not.toContainText("last editor");

    const zephyrRfiBadge = page.getByTestId(
      `badge-failure-alert-route-${ZEPHYR_PROJECT_ID}-RFI`,
    );
    await expect(zephyrRfiBadge).toBeVisible();
    await expect(zephyrRfiBadge).toContainText("Last editor");
    // Conversely, the lastEditor-only row must not display "PM".
    // We constrain the check to the badge itself because the row
    // could legitimately mention "PM" elsewhere in the future.
    await expect(zephyrRfiBadge).not.toContainText(/\bPM\b/);
  });

  test("renders the empty-state copy when the user is not on any active route", async ({
    page,
  }) => {
    await stubFailureAlertRoutes(page, []);
    await gotoNotificationPrefs(page);

    // Card still mounts.
    await expect(page.getByTestId("card-failure-alert-routes")).toBeVisible();

    // Empty-state branch: dedicated copy is shown and the populated
    // list / individual rows are NOT rendered (the component picks
    // exactly one of the two branches via an early return).
    const empty = page.getByTestId("text-failure-alert-routes-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText(
      "You aren't currently a failure-alert recipient on any project.",
    );
    await expect(page.getByTestId("list-failure-alert-routes")).toHaveCount(0);
    await expect(page.getByTestId("skeleton-failure-alert-routes")).toHaveCount(0);
  });
});
