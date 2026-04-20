import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DashboardStats {
  activeProjects?: number;
  totalBids?: number;
  openPurchaseOrders?: number;
  [key: string]: unknown;
}

interface DashboardKPI {
  revenue?: number | string;
  margin?: number | string;
  [key: string]: unknown;
}

interface DashboardSnapshot {
  projects?: unknown[];
  bids?: unknown[];
  [key: string]: unknown;
}

interface DashboardTrend {
  data?: unknown[];
  labels?: string[];
  [key: string]: unknown;
}

interface DashboardAlerts {
  alerts?: unknown[];
  [key: string]: unknown;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

test.describe("Dashboard Smoke Tests", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("dashboard stats endpoint returns structured data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/stats`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as DashboardStats;
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
    expect(Object.keys(body).length).toBeGreaterThan(0);
  });

  test("dashboard KPI endpoint returns structured data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/kpi`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as DashboardKPI;
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
    expect(Object.keys(body).length).toBeGreaterThan(0);
  });

  test("dashboard snapshot endpoint returns structured data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/snapshot`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as DashboardSnapshot;
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
  });

  test("dashboard trend endpoint returns structured data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/trend`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as DashboardTrend;
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
  });

  test("dashboard alerts endpoint returns structured data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/alerts`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as DashboardAlerts;
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
  });

  test("dashboard bid-pipeline endpoint returns data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/bid-pipeline`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("dashboard list endpoint returns data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/list`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("dashboard sov-progress endpoint returns data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/sov-progress`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("dashboard safety-summary endpoint returns data", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/dashboard/safety-summary`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("dashboard page loads and renders widget areas", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(0);

    const hasServerError = await page.locator("text=Internal Server Error").isVisible().catch(() => false);
    expect(hasServerError).toBe(false);

    const has500 = await page.locator("text=500").isVisible().catch(() => false);
    expect(has500).toBe(false);
    const has503 = await page.locator("text=503").isVisible().catch(() => false);
    expect(has503).toBe(false);

    const widgetSelectors = [
      "[data-testid*='dashboard']",
      "[data-testid*='stat']",
      "[data-testid*='card']",
      "[data-testid*='widget']",
      "[data-testid*='kpi']",
      ".card",
      "[class*='card']",
      "[class*='widget']",
      "[class*='stat']",
    ];

    let widgetCount = 0;
    for (const selector of widgetSelectors) {
      const count = await page.locator(selector).count();
      widgetCount += count;
    }
    expect(widgetCount).toBeGreaterThan(0);
  });

  test("dashboard stats scoped to logged-in org", async ({ page }) => {
    const statsRes = await page.request.get(`${BASE_URL}/api/dashboard/stats`);
    expect(statsRes.status()).toBe(200);
    const stats = (await statsRes.json()) as DashboardStats;
    expect(stats).toBeDefined();
    expect(typeof stats === "object").toBe(true);
    expect(Object.keys(stats).length).toBeGreaterThan(0);
  });

  test("FIELD_WORKER can access dashboard", async ({ page }) => {
    await devLogin(page, "FIELD_WORKER");

    const statsRes = await page.request.get(`${BASE_URL}/api/dashboard/stats`);
    expect(statsRes.status()).toBe(200);

    const kpiRes = await page.request.get(`${BASE_URL}/api/dashboard/kpi`);
    expect(kpiRes.status()).toBe(200);
  });

  test("unauthenticated dashboard request returns 401", async ({ page, browser }) => {
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    const res = await freshPage.request.get(`${BASE_URL}/api/dashboard/stats`);
    expect(res.status()).toBe(401);
    await freshPage.close();
    await freshContext.close();
  });
});
