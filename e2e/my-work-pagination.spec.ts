import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// Need enough items so that >=2 "Load more" clicks are required to drain
// the list. The backend default page size is 200, so 450 CRM tasks plus
// the seeder's mixed-source TASK rows (~15%) yields ~517 items across
// three pages — page 1 (200), page 2 (200), page 3 (~117).
const SEED_COUNT = 450;

interface MyWorkItem {
  id: string;
  type: string;
}
interface MyWorkResponse {
  items: MyWorkItem[];
  nextCursor: string | null;
  counts: {
    total: number;
    overdue: number;
    today: number;
    thisWeek: number;
    later: number;
    completedThisWeek: number;
    byType: Record<string, number>;
  };
}

async function devLogin(page: Page, role: string) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function bulkSeed(page: Page, count: number) {
  const res = await page.request.post(`${BASE_URL}/api/dev/seed-my-work-bulk`, {
    data: { count },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    created: number;
    createdByType: { CRM_TASK: number; TASK: number };
  };
  // The seeder asks for `count` CRM tasks plus a mixed-source TASK fraction
  // (~15%). Both buckets must be non-empty so we exercise the multi-source
  // merge in /api/me/work, not just one table.
  expect(body.createdByType.CRM_TASK).toBe(count);
  expect(body.createdByType.TASK).toBeGreaterThan(0);
  expect(body.created).toBe(body.createdByType.CRM_TASK + body.createdByType.TASK);
}

async function bulkClear(page: Page) {
  await page.request
    .post(`${BASE_URL}/api/dev/clear-my-work-bulk`)
    .catch(() => undefined);
}

test.describe("My Work pagination — power user", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "MANAGER");
    await bulkSeed(page, SEED_COUNT);
  });

  test.afterEach(async ({ page }) => {
    await bulkClear(page);
  });

  test("API: cursor pagination drains all seeded items without duplicates and keeps counts stable", async ({ page }) => {
    const seen = new Set<string>();
    const ids: string[] = [];

    const firstRes = await page.request.get(`${BASE_URL}/api/me/work?status=ALL&limit=200`);
    expect(firstRes.status()).toBe(200);
    const first = (await firstRes.json()) as MyWorkResponse;
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.counts.total).toBeGreaterThanOrEqual(SEED_COUNT);
    // Confirm both source buckets are populated — proves pagination is
    // exercising the multi-source merge, not just a single table.
    expect(first.counts.byType.CRM_TASK).toBeGreaterThanOrEqual(SEED_COUNT);
    expect(first.counts.byType.TASK).toBeGreaterThan(0);
    expect(first.nextCursor).not.toBeNull();
    const baselineCounts = first.counts;

    for (const item of first.items) {
      const key = `${item.type}:${item.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      ids.push(key);
    }

    let cursor: string | null = first.nextCursor;
    let pages = 1;
    while (cursor && pages < 10) {
      const res = await page.request.get(
        `${BASE_URL}/api/me/work?status=ALL&limit=200&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(res.status()).toBe(200);
      const body = (await res.json()) as MyWorkResponse;
      expect(body.items.length).toBeGreaterThan(0);
      // Subsequent pages omit counts intentionally — total is 0 there. Only
      // the first page's counts are authoritative.
      for (const item of body.items) {
        const key = `${item.type}:${item.id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        ids.push(key);
      }
      cursor = body.nextCursor;
      pages++;
    }

    expect(pages).toBeGreaterThanOrEqual(2);
    // We must drain at least one full page beyond the first — verifies the
    // cursor advanced and additional pages loaded successfully.
    expect(seen.size).toBeGreaterThan(200);

    // Counts on the first page should be stable when re-fetched.
    const reRes = await page.request.get(`${BASE_URL}/api/me/work?status=ALL&limit=200`);
    const re = (await reRes.json()) as MyWorkResponse;
    expect(re.counts.total).toBe(baselineCounts.total);
    expect(re.counts.byType.CRM_TASK).toBe(baselineCounts.byType.CRM_TASK);
  });

  test("UI: Load more adds new rows twice and KPI counts stay stable", async ({ page }) => {
    test.setTimeout(90_000);
    // Seeded items default to PENDING (an "open" status), so the default
    // status=OPEN view will show them — no need to change the filter.
    await page.goto(`${BASE_URL}/my-work`);
    await page.waitForSelector('[data-testid="page-my-work"]', { timeout: 30_000 });

    // The push-notification banner can intercept clicks at the bottom of the
    // viewport — hide it for the duration of this test.
    await page.addStyleTag({
      content: '[data-testid="banner-push-notification"]{display:none !important;}',
    });

    // Wait for the table to populate (Load More container only renders when
    // there is at least one page of items and a next page available).
    await page.waitForSelector('[data-testid="load-more-container"]', { timeout: 20_000 });

    // Row test ids in my-work.tsx use `row-${item.type.toLowerCase()}-${item.id}`.
    // The /my-work page is the only place rendering rows with that prefix, so
    // a broad selector is safe and covers every source type.
    const visibleIds = async (): Promise<string[]> =>
      page.$$eval('[data-testid^="row-"]', (els) =>
        els.map((e) => (e as HTMLElement).getAttribute("data-testid") ?? "").filter(Boolean),
      );

    const overdue1 = await page.locator('[data-testid="kpi-overdue"]').innerText();
    const today1 = await page.locator('[data-testid="kpi-today"]').innerText();
    const week1 = await page.locator('[data-testid="kpi-week"]').innerText();

    const initialIds = await visibleIds();
    expect(initialIds.length).toBeGreaterThan(0);

    // Click Load more — first time. Use force:true to bypass any transient
    // overlay (push banner, toast halo, etc.) that may intercept the click.
    const loadMore = page.locator('[data-testid="button-load-more"]');
    await expect(loadMore).toBeEnabled();
    await loadMore.scrollIntoViewIfNeeded();
    await loadMore.click({ force: true });
    await expect
      .poll(async () => (await visibleIds()).length, { timeout: 20_000 })
      .toBeGreaterThan(initialIds.length);

    const afterFirstIds = await visibleIds();

    // Click Load more — second time. With 450 seeded items and a 200-page
    // backend default, two pages remain after click 1, so the button stays
    // enabled.
    await expect(loadMore).toBeEnabled();
    await loadMore.scrollIntoViewIfNeeded();
    await loadMore.click({ force: true });
    await expect
      .poll(async () => (await visibleIds()).length, { timeout: 20_000 })
      .toBeGreaterThan(afterFirstIds.length);
    const afterSecondIds = await visibleIds();

    // No duplicate row ids across all pages.
    const unique = new Set(afterSecondIds);
    expect(unique.size).toBe(afterSecondIds.length);

    // KPI counts should remain stable after pagination.
    const overdue2 = await page.locator('[data-testid="kpi-overdue"]').innerText();
    const today2 = await page.locator('[data-testid="kpi-today"]').innerText();
    const week2 = await page.locator('[data-testid="kpi-week"]').innerText();
    expect(overdue2).toBe(overdue1);
    expect(today2).toBe(today1);
    expect(week2).toBe(week1);
  });
});
