import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DevLoginResponse {
  user: { id: string; role: string; email: string };
}

async function devSuperAdminLogin(page: Page): Promise<DevLoginResponse> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    // linkOrg=true associates the dev SUPER_ADMIN with the dev sandbox org so
    // /settings/* doesn't redirect an org-less SA to /onboarding.
    data: { role: "SUPER_ADMIN", linkOrg: true },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as DevLoginResponse;
}

async function resetQuietHoursState(page: Page) {
  // Deterministic preconditions: quiet hours OFF, digest default ON.
  const res = await page.request.patch(`${BASE_URL}/api/auth/profile`, {
    data: {
      jobMetricAlertQuietHoursEnabled: false,
      jobMetricAlertQuietHoursStart: "22:00",
      jobMetricAlertQuietHoursEnd: "07:00",
      jobMetricAlertQuietHoursTimezone: "UTC",
      jobMetricAlertQuietHoursWeekdays: null,
      jobMetricAlertQuietHoursDigestEnabled: true,
    },
  });
  expect([200, 204]).toContain(res.status());
}

async function gotoNotificationPrefs(page: Page) {
  await page.goto(`${BASE_URL}/settings/notifications`);
  await expect(page.getByTestId("text-section-title-notifications")).toBeVisible();
}

async function expectSwitchState(page: Page, testId: string, checked: boolean) {
  const sw = page.getByTestId(testId);
  await expect(sw).toBeVisible();
  await expect(sw).toHaveAttribute("data-state", checked ? "checked" : "unchecked");
}

test.describe("Quiet-hours digest toggle", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devSuperAdminLogin(page);
    await resetQuietHoursState(page);
  });

  test("digest row is gated by quietEnabled and persists across reload", async ({ page }) => {
    await gotoNotificationPrefs(page);

    // Digest row should NOT be in the DOM while quiet hours are off.
    await expect(page.getByTestId("row-job-metric-alert-quiet-hours-digest")).toHaveCount(0);

    // Enable quiet hours via the same backend the UI calls. The PATCH that the
    // master toggle fires is exactly this payload, so the resulting state is
    // identical to a user click and avoids brittle DOM coupling to the
    // master-toggle widget.
    const enableRes = await page.request.patch(`${BASE_URL}/api/auth/profile`, {
      data: {
        jobMetricAlertQuietHoursEnabled: true,
        jobMetricAlertQuietHoursStart: "22:00",
        jobMetricAlertQuietHoursEnd: "07:00",
        jobMetricAlertQuietHoursTimezone: "UTC",
        jobMetricAlertQuietHoursWeekdays: null,
      },
    });
    expect([200, 204]).toContain(enableRes.status());

    await page.reload();
    await expect(page.getByTestId("text-section-title-notifications")).toBeVisible();

    // Digest row + switch are now visible, and switch defaults to checked.
    await expect(page.getByTestId("row-job-metric-alert-quiet-hours-digest")).toBeVisible();
    await expectSwitchState(page, "switch-job-metric-alert-quiet-hours-digest", true);

    // Toggle digest OFF via the UI and assert the silenced toast.
    await page.getByTestId("switch-job-metric-alert-quiet-hours-digest").click();
    // Match the toast title element specifically — the toast text also gets
    // re-announced inside an aria-live region, so a plain getByText would
    // resolve to two elements and trip Playwright's strict mode.
    await expect(
      page.locator('[data-component-name="ToastTitle"]').getByText("Quiet-hours digest silenced"),
    ).toBeVisible();
    await expectSwitchState(page, "switch-job-metric-alert-quiet-hours-digest", false);

    // Reload and confirm OFF state persisted (server returned the new value).
    await page.reload();
    await expect(page.getByTestId("text-section-title-notifications")).toBeVisible();
    await expect(page.getByTestId("row-job-metric-alert-quiet-hours-digest")).toBeVisible();
    await expectSwitchState(page, "switch-job-metric-alert-quiet-hours-digest", false);

    // Toggle back ON via the UI and assert the enabled toast.
    await page.getByTestId("switch-job-metric-alert-quiet-hours-digest").click();
    await expect(
      page.locator('[data-component-name="ToastTitle"]').getByText("Quiet-hours digest enabled"),
    ).toBeVisible();
    await expectSwitchState(page, "switch-job-metric-alert-quiet-hours-digest", true);

    // Reload one more time and confirm ON state persisted.
    await page.reload();
    await expect(page.getByTestId("text-section-title-notifications")).toBeVisible();
    await expect(page.getByTestId("row-job-metric-alert-quiet-hours-digest")).toBeVisible();
    await expectSwitchState(page, "switch-job-metric-alert-quiet-hours-digest", true);
  });
});
