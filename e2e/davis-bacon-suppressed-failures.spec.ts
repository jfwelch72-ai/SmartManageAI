/**
 * Task #1384 — End-to-end coverage for the integrations-page panel that
 * surfaces, in real time, how many Davis-Bacon auto-sync failure alerts
 * the coalescing window has absorbed since the last delivered email.
 *
 * The flow exercises the persistence path admins actually see during an
 * active SAM.gov outage:
 *   1. Log in as ADMIN and create a Davis-Bacon connection (devMode).
 *   2. Stage a streak of 37 absorbed failures on the connection's
 *      `metadata.failureNotification` row via the dev-only seed
 *      endpoint.
 *   3. Visit /integrations and assert the panel renders the aggregate
 *      header + per-decision count/timestamp.
 *   4. Clear the streak (simulating a successful sync overwriting the
 *      row's metadata) and assert the panel auto-clears on next refresh.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devAdminLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status()).toBe(200);
}

async function createDavisBaconConnection(page: Page): Promise<string> {
  const res = await page.request.post(`${BASE_URL}/api/integrations/connections`, {
    data: { provider: "dol_davis_bacon", devMode: true },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  return body.id as string;
}

async function seedSuppressed(
  page: Page,
  connectionId: string,
  decisionNumber: string,
  suppressedCount: number,
) {
  const since = Date.now() - 30 * 60_000;
  const res = await page.request.post(
    `${BASE_URL}/api/integrations/dev/davis-bacon/seed-suppressed-failure`,
    {
      data: {
        connectionId,
        decisionNumber,
        suppressedCount,
        suppressedSince: since,
        lastNotifiedAt: since - 60_000,
      },
    },
  );
  expect(res.status()).toBe(200);
}

async function clearSuppressed(page: Page, connectionId: string, decisionNumber: string) {
  const res = await page.request.post(
    `${BASE_URL}/api/integrations/dev/davis-bacon/seed-suppressed-failure`,
    { data: { connectionId, decisionNumber, clear: true } },
  );
  expect(res.status()).toBe(200);
}

test.describe("Davis-Bacon suppressed-failures panel", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
  });

  test("shows the absorbed-failure count + 'since' timestamp and clears on recovery", async ({ page }) => {
    const connectionId = await createDavisBaconConnection(page);
    const decisionNumber = `CA${Date.now()}`;

    // Stage a streak of 37 absorbed failures.
    await seedSuppressed(page, connectionId, decisionNumber, 37);

    // Verify the API surfaces the streak. This is the data the panel
    // renders, and asserting it independently of the DOM keeps the test
    // resilient to UI re-styling.
    const apiRes = await page.request.get(
      `${BASE_URL}/api/integrations/davis-bacon/suppressed-failures`,
    );
    expect(apiRes.status()).toBe(200);
    const apiBody = (await apiRes.json()) as {
      items: Array<{
        connectionId: string;
        decisionNumber: string;
        suppressedCount: number;
        suppressedSince: number | null;
      }>;
    };
    const entry = apiBody.items.find(
      (i) => i.connectionId === connectionId && i.decisionNumber === decisionNumber,
    );
    expect(entry).toBeTruthy();
    expect(entry!.suppressedCount).toBe(37);
    expect(entry!.suppressedSince).not.toBeNull();

    // Now drive the actual UI.
    await page.goto(`${BASE_URL}/integrations`);
    const panel = page.getByTestId(`panel-davis-bacon-suppressed-failures-${connectionId}`);
    await expect(panel).toBeVisible();
    await expect(
      page.getByTestId(`text-davis-bacon-suppressed-summary-${connectionId}`),
    ).toContainText("37 failure alerts suppressed");
    await expect(
      page.getByTestId(`text-davis-bacon-suppressed-count-${decisionNumber}`),
    ).toHaveText("37");

    // Simulate the next successful sync clearing the row's metadata, then
    // confirm the panel auto-clears on the next poll/refresh.
    await clearSuppressed(page, connectionId, decisionNumber);
    await page.reload();
    await expect(
      page.getByTestId(`panel-davis-bacon-suppressed-failures-${connectionId}`),
    ).toHaveCount(0);
  });
});
