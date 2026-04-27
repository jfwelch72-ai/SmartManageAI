// Task #2089 — End-to-end coverage for the new "Export PDF with formulas"
// toggle in `client/src/components/EstimatePdfExportButton.tsx`. The
// component was previously verified only by backend unit tests
// (`server/__tests__/estimate-pdf-service.test.ts` and
// `server/__tests__/estimate-export-routes.test.ts`); this spec drives
// the popover in a real browser to prove that:
//
//   1. Clicking the "Export PDF" trigger opens the popover.
//   2. Clicking "Download PDF" with the toggle off fires a request to
//      `/api/estimates/:id/export/pdf` — i.e. the query string is empty.
//   3. Toggling "Step-by-step formula breakdowns" then clicking
//      "Download PDF" fires a request against the same URL but with
//      `?includeFormulas=true` appended.
//   4. The two URLs the popover targets actually return different PDFs
//      from the server — the formulas variant is meaningfully larger
//      because it adds a "Calculation Breakdowns" page (mirrors the
//      `withFormulas.length > without.length + 500` assertion in
//      `estimate-pdf-service.test.ts`).
//
// Task #2102 — The popover used to call `window.open` and assume
// success. It now fetches the PDF in-page (so it can detect non-2xx
// responses and surface a toast). The first test was updated to listen
// for the actual GET requests instead of stubbing `window.open`. A
// second test was added to cover the failure path: a 500 from the
// route should produce a "Couldn't generate PDF" toast and leave the
// popover open so the user can retry without re-toggling settings.

import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

/**
 * Capture the URLs of every PDF export GET the page makes. The
 * `EstimatePdfExportButton` now uses `fetch` (so it can detect
 * failures); recording the request URL gives us the same signal the
 * old `window.open` spy did, without depending on the implementation
 * detail of how the download is triggered.
 */
function recordExportRequests(page: Page, estimateId: string): string[] {
  const captured: string[] = [];
  const prefix = `/api/estimates/${estimateId}/export/pdf`;
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    const u = new URL(req.url());
    if (u.pathname + (u.search || "") === prefix || u.pathname === prefix) {
      captured.push(u.pathname + (u.search || ""));
    }
  });
  return captured;
}

async function seedBidWithCalculatorLineItem(page: Page, suffix: number) {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW PDF Formula Toggle ${suffix}`,
      clientName: "PW PDF Formula Client",
      bidAmount: "20000",
    },
  });
  expect(bidRes.status(), await bidRes.text()).toBe(201);
  const bid = (await bidRes.json()) as { id: string; code: string };

  const estimateRes = await page.request.post(
    `${BASE_URL}/api/bids/${bid.id}/estimate`,
    { data: {} },
  );
  expect(estimateRes.status(), await estimateRes.text()).toBe(201);
  const estimate = (await estimateRes.json()) as { id: string };

  // The line item carries concrete + rebar inputs, which is exactly
  // what the unit test in `estimate-pdf-service.test.ts` uses to
  // exercise the "Calculation Breakdowns" page. The POST handler
  // re-runs `calculateMaterials` and persists the canonical
  // `calculatedConcreteYards` / `calculatedRebarCount` results, so
  // the PDF route's `buildLineItemFormulaBreakdowns` finds enough
  // data to render at least two formula blocks.
  const lineItemRes = await page.request.post(
    `${BASE_URL}/api/estimates/${estimate.id}/line-items`,
    {
      data: {
        category: "CONCRETE",
        description: "Slab on grade with rebar",
        quantity: "100",
        unit: "SF",
        materialCost: "1000",
        laborCost: "500",
        laborHours: "10",
        equipmentCost: "0",
        equipmentHours: "0",
        consumablesCost: "0",
        subcontractCost: "0",
        overheadAllocation: "0",
        profitAllocation: "0",
        // Material calculator inputs — these drive the formula
        // breakdown section that the toggle gates.
        concreteDepthInches: 4,
        concreteWasteFactor: 10,
        requiresRebar: true,
        rebarSpacingInches: 12,
        rebarLengthFeet: 20,
        rebarWasteFactor: 10,
      },
    },
  );
  expect(lineItemRes.status(), await lineItemRes.text()).toBe(201);

  return { bid, estimate };
}

test.describe('Estimate PDF export — "Step-by-step formula breakdowns" toggle', () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("popover toggle changes the export URL and the resulting PDF", async ({
    page,
  }) => {
    const suffix = Date.now();
    const { bid, estimate } = await seedBidWithCalculatorLineItem(page, suffix);

    // --- UI: open the bid estimate page ---------------------------------
    // Same caveat as `takeoff-workflow.spec.ts`: the GlobalSSEProvider
    // opens a long-lived EventSource on auth, so `networkidle` never
    // settles inside the 60s test timeout. Use a content assertion to
    // wait for the page to be ready instead.
    await page.goto(`${BASE_URL}/bids/${bid.code}/estimate`, {
      waitUntil: "domcontentloaded",
    });
    const exportButton = page.locator('[data-testid="button-export-estimate-pdf"]');
    await expect(exportButton).toBeVisible({ timeout: 15_000 });
    await expect(exportButton).toBeEnabled();

    // Start recording PDF export requests before the user interacts
    // with the popover. The listener stays attached for the rest of
    // the test, so both round-trips are captured into the same array.
    const captured = recordExportRequests(page, estimate.id);

    // --- Round 1: Download with the toggle OFF --------------------------
    await exportButton.click();
    const switchToggle = page.locator(
      '[data-testid="switch-export-include-formulas"]',
    );
    await expect(switchToggle).toBeVisible();
    // Sanity: the switch defaults to off — the popover's `useState(false)`.
    await expect(switchToggle).toHaveAttribute("data-state", "unchecked");

    const confirmButton = page.locator(
      '[data-testid="button-export-estimate-pdf-confirm"]',
    );
    await expect(confirmButton).toBeVisible();

    const firstReq = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`/api/estimates/${estimate.id}/export/pdf`),
    );
    await confirmButton.click();
    await firstReq;

    // Clicking confirm closes the popover (the component flips
    // `setOpen(false)` after the download succeeds). Wait for it to
    // collapse so the next round-trip starts from a clean state.
    await expect(switchToggle).toBeHidden();

    // --- Round 2: Download with the toggle ON ---------------------------
    await exportButton.click();
    await expect(switchToggle).toBeVisible();
    await switchToggle.click();
    await expect(switchToggle).toHaveAttribute("data-state", "checked");

    const secondReq = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`includeFormulas=true`),
    );
    await confirmButton.click();
    await secondReq;
    await expect(switchToggle).toBeHidden();

    // --- Assert the URLs the popover hit --------------------------------
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const expectedBase = `/api/estimates/${estimate.id}/export/pdf`;
    const withoutUrl = captured.find((u) => u === expectedBase);
    const withUrl = captured.find(
      (u) => u === `${expectedBase}?includeFormulas=true`,
    );
    expect(withoutUrl, `captured: ${JSON.stringify(captured)}`).toBe(
      expectedBase,
    );
    expect(withUrl, `captured: ${JSON.stringify(captured)}`).toBe(
      `${expectedBase}?includeFormulas=true`,
    );

    // --- Re-fetch both PDFs server-side and compare bytes ---------------
    // `page.request` shares the browser context's auth + CSRF cookies, so
    // these GETs hit the same protected route the in-page fetch did.
    const withoutRes = await page.request.get(`${BASE_URL}${withoutUrl}`);
    expect(withoutRes.status()).toBe(200);
    expect(withoutRes.headers()["content-type"]).toMatch(/application\/pdf/);
    const withoutBody = await withoutRes.body();
    expect(withoutBody.slice(0, 4).toString()).toBe("%PDF");

    const withRes = await page.request.get(`${BASE_URL}${withUrl}`);
    expect(withRes.status()).toBe(200);
    expect(withRes.headers()["content-type"]).toMatch(/application\/pdf/);
    const withBody = await withRes.body();
    expect(withBody.slice(0, 4).toString()).toBe("%PDF");

    // The "Calculation Breakdowns" page adds one PDF page worth of
    // text (a header + two formula blocks for our concrete/rebar line
    // item). The unit test in `estimate-pdf-service.test.ts` asserts a
    // ≥500-byte delta against the same data; we use the same threshold
    // here so a regression that silently drops the section gets caught
    // end-to-end too.
    expect(withBody.length).toBeGreaterThan(withoutBody.length + 500);
  });

  // Task #2102 — Failure path. The previous implementation called
  // `window.open` and assumed success, leaving users staring at a
  // blank tab when the export route returned 4xx/5xx. The popover now
  // fetches the PDF in-page; non-2xx responses must produce a toast
  // and keep the popover open so the user can retry without losing
  // their toggle state.
  test("shows a toast and keeps the popover open when the export fails", async ({
    page,
  }) => {
    const suffix = Date.now();
    const { bid, estimate } = await seedBidWithCalculatorLineItem(page, suffix);

    // Disable the PWA service worker for this page. WebKit's
    // service-worker layer intercepts `fetch` *before* `page.route`
    // sees it, so a SW-cached PDF response can sneak past our 500
    // stub and the failure path never runs. Stubbing
    // `navigator.serviceWorker.register` to a no-op stops the
    // worker from ever taking control of this navigation.
    await page.addInitScript(() => {
      const nav = navigator as unknown as {
        serviceWorker?: {
          register?: (...args: unknown[]) => Promise<unknown>;
          getRegistration?: () => Promise<undefined>;
          getRegistrations?: () => Promise<unknown[]>;
        };
      };
      if (nav.serviceWorker) {
        nav.serviceWorker.register = () =>
          Promise.reject(new Error("disabled for test"));
        nav.serviceWorker.getRegistration = () => Promise.resolve(undefined);
        nav.serviceWorker.getRegistrations = () => Promise.resolve([]);
      }
    });

    // Stub the export route to a 500 so the test doesn't depend on a
    // real server fault. We register the route on the browser context
    // (so it survives any reload) and use a regex match because some
    // engines normalize the URL differently than Playwright's glob
    // matcher. The pattern covers both query-string variants.
    const exportPathRegex = new RegExp(
      `/api/estimates/${estimate.id}/export/pdf(\\?|$)`,
    );
    let interceptCount = 0;
    await page.context().route(exportPathRegex, async (route) => {
      interceptCount += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated outage" }),
      });
    });

    await page.goto(`${BASE_URL}/bids/${bid.code}/estimate`, {
      waitUntil: "domcontentloaded",
    });
    const exportButton = page.locator(
      '[data-testid="button-export-estimate-pdf"]',
    );
    await expect(exportButton).toBeVisible({ timeout: 15_000 });
    await expect(exportButton).toBeEnabled();

    // --- Open the popover, flip the toggle so we can prove it isn't
    // reset by the failure, and click Download.
    await exportButton.click();
    const switchToggle = page.locator(
      '[data-testid="switch-export-include-formulas"]',
    );
    await expect(switchToggle).toBeVisible();
    await switchToggle.click();
    await expect(switchToggle).toHaveAttribute("data-state", "checked");

    const confirmButton = page.locator(
      '[data-testid="button-export-estimate-pdf-confirm"]',
    );
    await confirmButton.click();

    // The toast describes the failure. We match on the title (stable
    // user-facing string) and the simulated error body should surface
    // in the description.
    await expect(
      page.getByText("Couldn't generate PDF").first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Simulated outage/i).first(),
    ).toBeVisible();

    // Popover stays open and the toggle still reflects the user's
    // pre-failure choice — they can retry without re-toggling.
    await expect(switchToggle).toBeVisible();
    await expect(switchToggle).toHaveAttribute("data-state", "checked");
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toBeEnabled();

    // The button text resets out of the loading state once the fetch
    // settles, so a retry click works immediately.
    await expect(confirmButton).toContainText("Download PDF");

    expect(interceptCount).toBeGreaterThanOrEqual(1);
  });
});
