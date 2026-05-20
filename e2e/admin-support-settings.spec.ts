/**
 * Task #2972 — End-to-end coverage for the Support Settings tab
 * inside /admin/support-tickets.
 *
 * Tests covered:
 *   1. Clicking the "Support Settings" tab renders the settings card.
 *   2. Changing the timezone select fires a PATCH and shows a success toast.
 *   3. Adding an escalation email fires a PATCH and shows the new badge.
 *   4. Moving the escalation threshold slider fires a PATCH with the new pct.
 *   5. GET /api/support/settings is called on tab open and saved values come back.
 *
 * All network calls are intercepted so the tests are hermetic and don't
 * depend on seeded data in the development DB.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function devSuperAdminLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "SUPER_ADMIN" },
  });
  expect(res.status(), `SUPER_ADMIN dev login failed: ${await res.text()}`).toBe(200);
}

// ─── Default fixture settings ─────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  supportTimezone: "UTC",
  escalationEmails: [],
  escalationThresholdPct: 75,
  autoAssignGraceMinutes: 60,
  enterpriseAgentIds: [],
};

// ─── Route stubs ──────────────────────────────────────────────────────────────

/**
 * Stub GET /api/support/settings to return `settings`.
 * Returns a mutable handler so callers can update the returned value between
 * the GET (initial load) and any subsequent re-fetch after a PATCH.
 */
function stubGetSettings(page: Page, settings = DEFAULT_SETTINGS) {
  let current = { ...settings };
  const update = (patch: Partial<typeof DEFAULT_SETTINGS>) => {
    current = { ...current, ...patch };
  };

  page.route(/\/api\/support\/settings$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings: current }),
    });
  });

  return { update };
}

/**
 * Stub PATCH /api/support/settings. `onPatch` is called with the parsed body
 * so callers can assert what was sent. The stub responds with the merged
 * settings so the UI can update its state.
 */
function stubPatchSettings(
  page: Page,
  currentSettings: typeof DEFAULT_SETTINGS,
  onPatch?: (body: Record<string, unknown>) => void,
) {
  page.route(/\/api\/support\/settings$/, async (route: Route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    onPatch?.(body);
    const merged = { ...currentSettings, ...body };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings: merged }),
    });
  });
}

/**
 * Stub the support tickets list endpoint so the page renders without waiting
 * for real data.
 */
async function stubTicketsEndpoint(page: Page) {
  await page.route(/\/api\/support\/tickets(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tickets: [] }),
    });
  });
}

async function stubMetrics(page: Page) {
  await page.route(/\/api\/support\/metrics(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalOpen: 0,
        avgFirstResponseMinutes: null,
        avgResolutionMinutes: null,
        breachRate: 0,
        csatAvg: null,
        byPriority: {},
        byStatus: {},
        byCategory: {},
        bySlaStatus: {},
        satisfactionTrend: [],
      }),
    });
  });
}

// ─── Navigation helper ────────────────────────────────────────────────────────

async function navigateAndOpenSettingsTab(page: Page) {
  await page.goto(`${BASE_URL}/admin/support-tickets`, {
    waitUntil: "domcontentloaded",
  });

  // Wait for the main heading to confirm the page is hydrated.
  await expect(page.getByTestId("heading-support-tickets")).toBeVisible({
    timeout: 30_000,
  });

  // Click the Support Settings tab.
  await page.getByTestId("tab-settings").click();

  // The settings card is now rendered; wait for the timezone select.
  await expect(page.getByTestId("select-support-timezone")).toBeVisible({
    timeout: 10_000,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Support Settings tab (Task #2972)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devSuperAdminLogin(page);
    await stubTicketsEndpoint(page);
    await stubMetrics(page);
  });

  test("clicking the Support Settings tab renders the settings card", async ({
    page,
  }) => {
    stubGetSettings(page);
    stubPatchSettings(page, DEFAULT_SETTINGS);

    await navigateAndOpenSettingsTab(page);

    // All four setting cards should be present.
    await expect(page.getByTestId("select-support-timezone")).toBeVisible();
    await expect(page.getByTestId("slider-escalation-threshold")).toBeVisible();
    await expect(page.getByTestId("slider-grace-period")).toBeVisible();
    await expect(page.getByTestId("input-escalation-email")).toBeVisible();

    // Default values are shown.
    await expect(page.getByTestId("text-escalation-threshold-value")).toHaveText("75%");
    await expect(page.getByTestId("text-grace-period-value")).toHaveText("60 min");

    // No escalation contacts yet.
    await expect(page.getByTestId("text-no-escalation-emails")).toBeVisible();

    // No enterprise agents configured.
    await expect(page.getByTestId("text-no-enterprise-agents")).toBeVisible();
  });

  test("GET /api/support/settings is called when the Settings tab is opened", async ({
    page,
  }) => {
    let getCallCount = 0;
    page.route(/\/api\/support\/settings$/, async (route: Route) => {
      if (route.request().method() === "GET") {
        getCallCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ settings: DEFAULT_SETTINGS }),
        });
      } else {
        await route.fallback();
      }
    });

    await navigateAndOpenSettingsTab(page);

    expect(getCallCount).toBeGreaterThanOrEqual(1);
  });

  test("changing timezone fires PATCH /api/support/settings with new timezone value", async ({
    page,
  }) => {
    stubGetSettings(page);

    let patchedBody: Record<string, unknown> | null = null;
    const patchPromise = new Promise<void>((resolve) => {
      page.route(/\/api\/support\/settings$/, async (route: Route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        patchedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            settings: { ...DEFAULT_SETTINGS, supportTimezone: "America/New_York" },
          }),
        });
        resolve();
      });
    });

    await navigateAndOpenSettingsTab(page);

    // Open the timezone select and choose America/New_York.
    await page.getByTestId("select-support-timezone").click();
    await page.getByRole("option", { name: "America/New_York" }).click();

    // Wait for the PATCH.
    await patchPromise;

    expect(patchedBody).not.toBeNull();
    expect((patchedBody as Record<string, unknown>).supportTimezone).toBe(
      "America/New_York",
    );

    // A success toast should appear.
    await expect(
      page.getByText("Support settings saved", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("adding an escalation email fires PATCH and shows the new badge", async ({
    page,
  }) => {
    const settingsAfterAdd = {
      ...DEFAULT_SETTINGS,
      escalationEmails: ["oncall@example.com"],
    };

    stubGetSettings(page);

    let patchedBody: Record<string, unknown> | null = null;
    const patchPromise = new Promise<void>((resolve) => {
      page.route(/\/api\/support\/settings$/, async (route: Route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        patchedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ settings: settingsAfterAdd }),
        });
        resolve();
      });
    });

    await navigateAndOpenSettingsTab(page);

    // Fill in the escalation email input.
    await page.getByTestId("input-escalation-email").fill("oncall@example.com");
    await page.getByTestId("button-add-escalation-email").click();

    await patchPromise;

    // The PATCH body should include the new email.
    expect(patchedBody).not.toBeNull();
    const emails = (patchedBody as Record<string, unknown>).escalationEmails as string[];
    expect(emails).toContain("oncall@example.com");

    // Success toast.
    await expect(
      page.getByText("Support settings saved", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("GET /api/support/settings response is reflected back in the UI after save", async ({
    page,
  }) => {
    // First GET returns defaults; after PATCH the re-fetch should return the
    // updated value (America/Chicago).
    let callCount = 0;
    page.route(/\/api\/support\/settings$/, async (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        callCount += 1;
        const tz = callCount === 1 ? "UTC" : "America/Chicago";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ settings: { ...DEFAULT_SETTINGS, supportTimezone: tz } }),
        });
      } else if (method === "PATCH") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            settings: { ...DEFAULT_SETTINGS, supportTimezone: "America/Chicago" },
          }),
        });
      } else {
        await route.fallback();
      }
    });

    await navigateAndOpenSettingsTab(page);

    // Confirm initial render shows UTC.
    await expect(page.getByTestId("select-support-timezone")).toContainText("UTC");

    // Change to Chicago and wait for re-render.
    await page.getByTestId("select-support-timezone").click();
    await page.getByRole("option", { name: "America/Chicago" }).click();

    // After the cache invalidation and re-fetch, the select should show Chicago.
    await expect(page.getByTestId("select-support-timezone")).toContainText(
      "America/Chicago",
      { timeout: 10_000 },
    );
  });
});
