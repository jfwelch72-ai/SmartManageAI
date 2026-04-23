import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { installCsrf, installCsrfOnRequest } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const HEAVY_CIVIL_USER_FLAGS = [
  "DOT_PAY_ITEMS",
  "DBE_TRACKING",
  "WH_347_PAYROLL",
  "HAUL_TICKETS",
  "DAILY_INSPECTOR_REPORTS",
  "SWPPP_INSPECTIONS",
  "SURETY_BONDS",
  "BUY_AMERICA",
  "MASS_HAUL_ANALYZER",
  "DOT_PROGRESS_ESTIMATE",
] as const;

interface MeResponse {
  user: { id: string; role: string; organizationId: string | null };
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  keys: string[];
}

async function devLogin(req: APIRequestContext, role: string, linkOrg = false) {
  const res = await req.post(`${BASE_URL}/api/dev/test-login`, { data: { role, linkOrg } });
  expect(res.status(), `dev login (${role}) failed: ${await res.text()}`).toBe(200);
}

/**
 * Reset the dev sandbox org to a clean known state for the apply-preset test:
 *   - Trade type is GENERAL_CONTRACTOR (so ROADWAY_CONSTRUCTION is "non-current"
 *     and the diff list will be non-empty).
 *   - All Heavy-Civil flags are OFF (so applying the Roadway preset visibly
 *     flips them ON, and the badges + server state both reflect the change).
 * Returns the org id of the dev sandbox.
 */
async function resetSandboxForPresetTest(browser: Browser): Promise<string> {
  const adminCtx = await browser.newContext();
  let orgId: string;
  try {
    await installCsrfOnRequest(adminCtx.request, adminCtx);
    await devLogin(adminCtx.request, "ADMIN");
    const me = (await (await adminCtx.request.get(`${BASE_URL}/api/auth/me`)).json()) as MeResponse;
    expect(me.user.organizationId).toBeTruthy();
    orgId = me.user.organizationId!;

    const tradeRes = await adminCtx.request.post(
      `${BASE_URL}/api/organization/update-trade-type`,
      { data: { tradeType: "GENERAL_CONTRACTOR", tradeName: "General Contractor" } },
    );
    expect([200, 409]).toContain(tradeRes.status());
  } finally {
    await adminCtx.close();
  }

  const saCtx = await browser.newContext();
  try {
    await installCsrfOnRequest(saCtx.request, saCtx);
    await devLogin(saCtx.request, "SUPER_ADMIN");

    const reset: Record<string, boolean> = {};
    for (const flag of HEAVY_CIVIL_USER_FLAGS) reset[flag] = false;
    reset["HEAVY_CIVIL_PRESET"] = false;

    const patchFlags = await saCtx.request.patch(
      `${BASE_URL}/api/feature-flags/${orgId}`,
      { data: { flags: reset } },
    );
    expect(patchFlags.status(), `reset flags failed: ${await patchFlags.text()}`).toBe(200);
  } finally {
    await saCtx.close();
  }

  return orgId;
}

test.describe("Org ADMIN trade preset apply flow (Company Settings)", () => {
  test("ADMIN selects ROADWAY_CONSTRUCTION, sees diff, confirms, and flags update", async ({
    browser,
  }) => {
    const orgId = await resetSandboxForPresetTest(browser);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await installCsrf(page);
      await devLogin(page.request, "ADMIN");

      // Sanity: the UI session must be scoped to the same sandbox org we
      // just reset, otherwise the diff/badge assertions below would be
      // checking the wrong organization.
      const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
      expect(meRes.status()).toBe(200);
      const me = (await meRes.json()) as MeResponse;
      expect(me.user.organizationId).toBe(orgId);

      await page.goto(`${BASE_URL}/company-settings?tab=feature-presets`);

      await expect(
        page.getByRole("heading", { name: /Feature Flags & Trade Presets/i }),
      ).toBeVisible();

      const trigger = page.getByTestId("select-trade-preset");
      await expect(trigger).toBeVisible();
      await trigger.click();

      const roadwayOption = page.getByTestId("select-item-trade-preset-ROADWAY_CONSTRUCTION");
      await expect(roadwayOption, "ROADWAY_CONSTRUCTION must be a selectable trade preset").toBeVisible();
      await roadwayOption.click();

      await page.getByTestId("button-apply-trade-preset").click();

      const dialog = page.getByTestId("dialog-confirm-apply-preset");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/Roadway/i);

      const diffList = page.getByTestId("list-preset-diff");
      await expect(diffList, "diff list should be rendered").toBeVisible();
      const diffRows = page.locator('[data-testid^="diff-row-"]');
      await expect(diffRows.first(), "diff list should be non-empty").toBeVisible();
      const diffCount = await diffRows.count();
      expect(diffCount, "diff list should have at least one row").toBeGreaterThan(0);

      await page.getByTestId("button-confirm-apply-preset").click();

      await expect(page.getByText(/Preset applied/i).first()).toBeVisible({ timeout: 10_000 });
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      for (const flag of HEAVY_CIVIL_USER_FLAGS) {
        const badge = page.getByTestId(`feature-flag-status-${flag}`);
        await expect(badge, `badge for ${flag} should be visible`).toBeVisible();
        await expect(badge, `badge for ${flag} should read "On" after applying preset`).toHaveText(
          /^On$/,
          { timeout: 10_000 },
        );
      }

      const flagsRes = await page.request.get(`${BASE_URL}/api/feature-flags`);
      expect(flagsRes.status()).toBe(200);
      const body = (await flagsRes.json()) as FlagsResponse;
      for (const flag of HEAVY_CIVIL_USER_FLAGS) {
        expect(body.flags[flag], `server flag ${flag} should be true after apply`).toBe(true);
      }
      expect(body.flags["HEAVY_CIVIL_PRESET"]).toBe(true);
    } finally {
      await ctx.close();
    }

    // Quick read of orgId to silence unused-var warnings in case test exits early.
    expect(orgId).toBeTruthy();
  });
});
