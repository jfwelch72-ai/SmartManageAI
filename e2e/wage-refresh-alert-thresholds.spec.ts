/**
 * Task #1495 — End-to-end coverage for the wage-refresh alert
 * threshold editor on the Job Metrics dashboard.
 *
 * Drives the full operator flow:
 *   1. SUPER_ADMIN signs in and navigates to /admin/job-metrics.
 *   2. The wage_decision_stale_refresh card renders with the
 *      "Built-in default" badge for both stall + spike sub-cards.
 *   3. Operator edits the stall threshold, saves, sees the
 *      "Override active" badge plus a "Reset to default" button.
 *   4. Operator clicks "Reset to default" and the badge reverts
 *      to "Built-in default".
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const WAGE_REFRESH_JOB = "wage_decision_stale_refresh";

async function devSuperAdminLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "SUPER_ADMIN", linkOrg: true },
  });
  expect(res.status()).toBe(200);
}

interface AlertsRule {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
}

interface AlertsResponse {
  rules: AlertsRule[];
}

async function clearWageRefreshOverrides(page: Page) {
  const res = await page.request.get(`${BASE_URL}/api/admin/metrics/jobs/alerts`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as AlertsResponse;
  for (const rule of body.rules) {
    if (rule.job !== WAGE_REFRESH_JOB) continue;
    const del = await page.request.delete(
      `${BASE_URL}/api/admin/metrics/jobs/alerts/rules/${rule.id}`,
    );
    expect([200, 404]).toContain(del.status());
  }
}

test.describe("Wage refresh alert threshold editor (Task #1495)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devSuperAdminLogin(page);
    await clearWageRefreshOverrides(page);
  });

  test.afterEach(async ({ page }) => {
    await clearWageRefreshOverrides(page).catch(() => undefined);
  });

  test("renders default → save override → reset to default", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/job-metrics`);

    // The card is gated on the alerts query loading, so wait for it
    // explicitly before asserting on its sub-elements.
    const card = page.getByTestId("card-wage-refresh-alert-thresholds");
    await expect(card).toBeVisible();

    // Default state: both stall and spike show the "Built-in default" badge.
    await expect(page.getByTestId("badge-stall-default")).toBeVisible();
    await expect(page.getByTestId("badge-spike-default")).toBeVisible();
    await expect(page.getByTestId("badge-stall-override")).toHaveCount(0);
    await expect(page.getByTestId("badge-spike-override")).toHaveCount(0);

    // The "Reset to default" buttons only render when an override exists.
    await expect(page.getByTestId("button-reset-wage-stall")).toHaveCount(0);

    // Edit the stall threshold to a value that is clearly distinct
    // from the built-in (36h). 17h is well outside any per-job default
    // and lets us assert the rendered "Built-in:" label is unchanged
    // while the override owns the input value.
    const stallInput = page.getByTestId("input-wage-stall-threshold");
    await stallInput.fill("17");

    const saveStall = page.getByTestId("button-save-wage-stall");
    await expect(saveStall).toBeEnabled();
    await saveStall.click();

    // Override-active badge appears once the mutation settles & the
    // alerts query is invalidated/refetched.
    await expect(page.getByTestId("badge-stall-override")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("badge-stall-default")).toHaveCount(0);
    await expect(page.getByTestId("button-reset-wage-stall")).toBeVisible();

    // Spike side is untouched — should still be "Built-in default".
    await expect(page.getByTestId("badge-spike-default")).toBeVisible();

    // Backend sanity: a row exists for the wage refresh stall.
    const afterSave = await page.request.get(
      `${BASE_URL}/api/admin/metrics/jobs/alerts`,
    );
    expect(afterSave.status()).toBe(200);
    const savedBody = (await afterSave.json()) as AlertsResponse;
    const stallRow = savedBody.rules.find(
      (r) => r.job === WAGE_REFRESH_JOB && r.kind === "stall",
    );
    expect(stallRow).toBeTruthy();

    // Click "Reset to default" — override is removed and the default
    // badge re-appears.
    await page.getByTestId("button-reset-wage-stall").click();
    await expect(page.getByTestId("badge-stall-default")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("badge-stall-override")).toHaveCount(0);
    await expect(page.getByTestId("button-reset-wage-stall")).toHaveCount(0);

    // Backend sanity: no wage refresh rule remains.
    const afterReset = await page.request.get(
      `${BASE_URL}/api/admin/metrics/jobs/alerts`,
    );
    expect(afterReset.status()).toBe(200);
    const finalBody = (await afterReset.json()) as AlertsResponse;
    expect(finalBody.rules.find((r) => r.job === WAGE_REFRESH_JOB)).toBeUndefined();
  });
});
