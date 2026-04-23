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
] as const;

const ORDERED_CATEGORY_TESTIDS = [
  "feature-flag-category-core-platform",
  "feature-flag-category-integrations",
  "feature-flag-category-enterprise-compliance",
  "feature-flag-category-field-mobile",
  "feature-flag-category-hiring",
  "feature-flag-category-advanced-tech",
  "feature-flag-category-communications",
  "feature-flag-category-heavy-civil-dot",
];

interface MeResponse {
  user: { id: string; role: string; organizationId: string | null };
}

interface FlagsResponse {
  flags: Record<string, boolean>;
  keys: string[];
}

async function devLogin(req: APIRequestContext, role: string, linkOrg = false) {
  const res = await req.post(`${BASE_URL}/api/dev/test-login`, { data: { role, linkOrg } });
  expect(res.status(), `dev login (${role}) failed`).toBe(200);
}

async function ensureSandboxTradeType(browser: Browser, tradeType: string): Promise<string> {
  const ctx = await browser.newContext();
  try {
    await installCsrfOnRequest(ctx.request, ctx);
    await devLogin(ctx.request, "ADMIN");
    const me = (await (await ctx.request.get(`${BASE_URL}/api/auth/me`)).json()) as MeResponse;
    expect(me.user.organizationId).toBeTruthy();

    // Reset sandbox flags so we can verify the heavy-civil ones flip on after Apply.
    const reset: Record<string, boolean> = {};
    for (const flag of HEAVY_CIVIL_USER_FLAGS) reset[flag] = false;
    reset["HEAVY_CIVIL_PRESET"] = false;

    // SUPER_ADMIN is required for PATCH /:orgId — switch up.
    const saCtx = await browser.newContext();
    try {
      await installCsrfOnRequest(saCtx.request, saCtx);
      await devLogin(saCtx.request, "SUPER_ADMIN");
      const patchFlags = await saCtx.request.patch(
        `${BASE_URL}/api/feature-flags/${me.user.organizationId}`,
        { data: { flags: reset } },
      );
      expect(patchFlags.status(), `reset flags failed: ${await patchFlags.text()}`).toBe(200);
    } finally {
      await saCtx.close();
    }

    const res = await ctx.request.post(`${BASE_URL}/api/organization/update-trade-type`, {
      data: { tradeType, tradeName: tradeType.replace(/_/g, " ") },
    });
    expect([200, 409]).toContain(res.status());

    return me.user.organizationId!;
  } finally {
    await ctx.close();
  }
}

test.describe("Heavy Civil feature-flag UI", () => {
  test("SUPER_ADMIN sees Heavy Civil banner on a ROADWAY_CONSTRUCTION org and can apply preset", async ({
    browser,
  }) => {
    const orgId = await ensureSandboxTradeType(browser, "ROADWAY_CONSTRUCTION");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await installCsrf(page);
      await devLogin(page.request, "SUPER_ADMIN", true);

      await page.goto(`${BASE_URL}/admin/organizations/${orgId}`);

      // Open the Feature Flags tab.
      const flagsTab = page.getByRole("tab", { name: /feature flags/i });
      await flagsTab.waitFor({ state: "visible" });
      await flagsTab.click();

      const banner = page.getByTestId("heavy-civil-preset-banner");
      await expect(banner).toBeVisible();

      const applyBtn = page.getByTestId("button-apply-heavy-civil-preset");
      await expect(applyBtn).toBeVisible();
      await applyBtn.click();

      // Shared OrgFeaturePresetsTab opens a confirmation dialog before
      // actually applying the preset; confirm it.
      const confirmDialog = page.getByTestId("dialog-confirm-apply-preset");
      await expect(confirmDialog).toBeVisible();
      await page.getByTestId("button-confirm-apply-preset").click();

      // Dialog should close once the mutation settles.
      await expect(confirmDialog).toBeHidden({ timeout: 15_000 });

      // Each Heavy Civil flag should now be reported as enabled by the shared
      // OrgFeaturePresetsTab, which renders a read-only Badge with testid
      // `feature-flag-status-<KEY>` and text "On".
      for (const flag of HEAVY_CIVIL_USER_FLAGS) {
        const status = page.getByTestId(`feature-flag-status-${flag}`);
        await expect(status, `enabled badge for ${flag} should be visible`).toBeVisible({
          timeout: 10_000,
        });
        await expect
          .poll(async () => ((await status.textContent()) || "").trim(), {
            message: `flag ${flag} should be enabled (badge "On")`,
            timeout: 10_000,
          })
          .toBe("On");
      }

      // Server view should agree.
      const flagsRes = await page.request.get(`${BASE_URL}/api/feature-flags/${orgId}`);
      expect(flagsRes.status()).toBe(200);
      const body = (await flagsRes.json()) as FlagsResponse;
      for (const flag of HEAVY_CIVIL_USER_FLAGS) {
        expect(body.flags[flag], `server flag ${flag} should be true`).toBe(true);
      }
      expect(body.flags["HEAVY_CIVIL_PRESET"]).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("Feature flag categories render in declared order with descriptions", async ({ browser }) => {
    const orgId = await ensureSandboxTradeType(browser, "ROADWAY_CONSTRUCTION");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await installCsrf(page);
      await devLogin(page.request, "SUPER_ADMIN", true);
      await page.goto(`${BASE_URL}/admin/organizations/${orgId}`);

      const flagsTab = page.getByRole("tab", { name: /feature flags/i });
      await flagsTab.waitFor({ state: "visible" });
      await flagsTab.click();

      // Wait for any one category to render before measuring order.
      await page.getByTestId(ORDERED_CATEGORY_TESTIDS[0]).waitFor({ state: "visible" });

      const renderedOrder = await page.evaluate((all) => {
        const found: string[] = [];
        for (const id of all) {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el) found.push(id);
        }
        return found;
      }, ORDERED_CATEGORY_TESTIDS);

      expect(renderedOrder).toEqual(ORDERED_CATEGORY_TESTIDS);

      // Sanity check the DOM order matches the declared order via positional rects.
      const tops = await Promise.all(
        ORDERED_CATEGORY_TESTIDS.map(async (id) => {
          const box = await page.getByTestId(id).boundingBox();
          expect(box, `category ${id} has no bounding box`).not.toBeNull();
          return box!.y;
        }),
      );
      for (let i = 1; i < tops.length; i++) {
        expect(tops[i], `category ${ORDERED_CATEGORY_TESTIDS[i]} should appear after the previous one`).toBeGreaterThan(
          tops[i - 1],
        );
      }

      // Every rendered feature-flag row across every category should expose a
      // visible, non-empty description under its toggle.
      const flagKeys = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='feature-flag-row-']"))
          .map((el) => el.getAttribute("data-testid")?.replace("feature-flag-row-", "") || "")
          .filter(Boolean),
      );
      expect(flagKeys.length, "expected feature-flag rows to be rendered").toBeGreaterThan(0);

      for (const flag of flagKeys) {
        const desc = page.getByTestId(`feature-flag-description-${flag}`);
        await expect(desc, `description for ${flag} should be visible`).toBeVisible();
        const text = (await desc.textContent())?.trim() || "";
        expect(text.length, `description for ${flag} should be non-empty`).toBeGreaterThan(0);
      }
    } finally {
      await ctx.close();
    }
  });
});
