import { test, expect, type APIRequestContext } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(req: APIRequestContext, role: string) {
  const res = await req.post(`${BASE_URL}/api/dev/test-login`, { data: { role } });
  expect(res.status(), `dev login (${role}) failed: ${await res.text()}`).toBe(200);
}

test.describe("Bid Network trade picker (Task #2122)", () => {
  test("Required Trades picker surfaces heavy-civil trades from the canonical enum", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await installCsrf(page);
      await devLogin(page.request, "ADMIN");

      await page.goto(`${BASE_URL}/bid-network`);
      await expect(page.getByTestId("button-create-bid-request").first()).toBeVisible({ timeout: 15_000 });

      await page.getByTestId("button-create-bid-request").first().click();

      const heavyCivilBadges: Array<{ testId: string; label: string }> = [
        { testId: "badge-trade-sanitary_sewer", label: "Sanitary Sewer" },
        { testId: "badge-trade-structural_steel", label: "Structural Steel" },
        { testId: "badge-trade-fire_protection_systems", label: "Fire Protection Systems" },
        { testId: "badge-trade-roadway_construction", label: "Roadway Construction" },
      ];

      for (const { testId, label } of heavyCivilBadges) {
        const badge = page.getByTestId(testId);
        await expect(badge, `expected heavy-civil badge ${testId} to render`).toBeVisible();
        await expect(badge).toHaveText(label);
      }

      const target = page.getByTestId("badge-trade-sanitary_sewer");
      const beforeClass = (await target.getAttribute("class")) ?? "";
      await target.click();
      await expect
        .poll(async () => (await target.getAttribute("class")) ?? "")
        .not.toBe(beforeClass);
    } finally {
      await ctx.close();
    }
  });
});
