/**
 * Task #3076 — E2E coverage for the Developer Docs page
 *
 * Tests covered:
 *   1. SUPER_ADMIN can fetch the module list via API.
 *   2. SUPER_ADMIN can fetch a module document via API.
 *   3. Unknown module returns 404.
 *   4. SUPER_ADMIN navigates to /developer-docs in the browser, sees the
 *      sidebar module list (data-testid="button-module-auth"), clicks the Auth
 *      module, and confirms the content panel renders
 *      (data-testid="article-module-content").
 *   5. FIELD_WORKER receives exactly 403 on every /api/dev-docs/* endpoint.
 *   6. FIELD_WORKER navigating to /developer-docs in the browser sees an
 *      "Access Denied" page — neither the module list nor the search input is
 *      rendered.
 *
 * Note: /developer-docs carries skipOnboardingCheck so that SUPER_ADMIN
 * platform admins (who have no organizationId) are not bounced to /onboarding.
 * This mirrors the pattern used on all other /admin/* routes.
 */
import { test, expect, type Page, type Browser } from "@playwright/test";
import { installCsrf, installCsrfOnRequest } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ModuleListResponse {
  modules: Array<{ id: string; title: string }>;
}

interface ModuleDocResponse {
  module: string;
  content: string;
}

async function devLogin(page: Page, role: string) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status(), `dev login (${role}) failed: ${await res.text()}`).toBe(200);
}

// ─── API-level tests — SUPER_ADMIN ───────────────────────────────────────────

test.describe("Developer Docs — API (SUPER_ADMIN)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "SUPER_ADMIN");
  });

  test("GET /api/dev-docs returns module list containing auth", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dev-docs`);
    expect(res.status(), `module list endpoint failed: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as ModuleListResponse;
    expect(Array.isArray(body.modules)).toBe(true);
    expect(body.modules.length).toBeGreaterThan(0);
    const ids = body.modules.map((m) => m.id);
    expect(ids).toContain("auth");
  });

  test("GET /api/dev-docs/auth returns module document with content", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dev-docs/auth`);
    expect(res.status(), `module doc endpoint failed: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as ModuleDocResponse;
    expect(body.module).toBe("auth");
    expect(typeof body.content).toBe("string");
    expect(body.content.length).toBeGreaterThan(0);
  });

  test("GET /api/dev-docs/:module returns 404 for unknown module", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dev-docs/nonexistent-module-xyz`);
    expect(res.status()).toBe(404);
  });
});

// ─── API-level tests — FIELD_WORKER denied ───────────────────────────────────

test.describe("Developer Docs — API (FIELD_WORKER denied)", () => {
  test("FIELD_WORKER gets 403 on all /api/dev-docs endpoints", async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    try {
      await installCsrfOnRequest(ctx.request, ctx);
      const loginRes = await ctx.request.post(`${BASE_URL}/api/dev/test-login`, {
        data: { role: "FIELD_WORKER" },
      });
      expect(loginRes.status(), `FIELD_WORKER dev login failed: ${await loginRes.text()}`).toBe(200);

      const endpoints = [
        "/api/dev-docs",
        "/api/dev-docs/auth",
        "/api/dev-docs/search?q=auth",
      ];

      for (const ep of endpoints) {
        const res = await ctx.request.get(`${BASE_URL}${ep}`);
        expect(
          res.status(),
          `${ep} should return 403 for FIELD_WORKER`,
        ).toBe(403);
      }
    } finally {
      await ctx.close();
    }
  });
});

// ─── UI tests — SUPER_ADMIN ───────────────────────────────────────────────────

test.describe("Developer Docs — UI (SUPER_ADMIN)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "SUPER_ADMIN");
  });

  test("module list loads and clicking Auth module shows content panel", async ({ page }) => {
    await page.goto(`${BASE_URL}/developer-docs`);
    await page.waitForLoadState("networkidle");

    // The sidebar module list must contain the Auth button.
    const authButton = page.getByTestId("button-module-auth");
    await expect(authButton).toBeVisible({ timeout: 10_000 });

    // The search input must also be visible.
    const searchInput = page.getByTestId("input-docs-search");
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Click the Auth module button.
    await authButton.click();

    // The content article panel must appear with non-empty text.
    const contentPanel = page.getByTestId("article-module-content");
    await expect(contentPanel).toBeVisible({ timeout: 10_000 });
    const text = await contentPanel.textContent();
    expect(text && text.trim().length).toBeGreaterThan(0);
  });
});

// ─── UI tests — FIELD_WORKER sees Access Denied ───────────────────────────────

test.describe("Developer Docs — UI (FIELD_WORKER denied)", () => {
  test("FIELD_WORKER navigating to /developer-docs sees Access Denied, not the docs UI", async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await installCsrf(page);

      const loginRes = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
        data: { role: "FIELD_WORKER" },
      });
      expect(loginRes.status(), `FIELD_WORKER dev login failed: ${await loginRes.text()}`).toBe(200);

      await page.goto(`${BASE_URL}/developer-docs`);
      await page.waitForLoadState("networkidle");

      // ProtectedRoute renders an "Access Denied" screen in-place for
      // unauthorized roles — the URL stays at /developer-docs but the
      // Developer Docs UI must not be rendered.
      const accessDeniedHeading = page.getByRole("heading", { name: "Access Denied" });
      await expect(accessDeniedHeading).toBeVisible({ timeout: 10_000 });

      // Neither the sidebar module list nor the search input should appear.
      await expect(page.getByTestId("button-module-auth")).not.toBeVisible();
      await expect(page.getByTestId("input-docs-search")).not.toBeVisible();
    } finally {
      await page.close();
      await ctx.close();
    }
  });
});
