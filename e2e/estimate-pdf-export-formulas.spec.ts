// Task #2089 — End-to-end coverage for the new "Export PDF with formulas"
// toggle in `client/src/components/EstimatePdfExportButton.tsx`. The
// component was previously verified only by backend unit tests
// (`server/__tests__/estimate-pdf-service.test.ts` and
// `server/__tests__/estimate-export-routes.test.ts`); this spec drives
// the popover in a real browser to prove that:
//
//   1. Clicking the "Export PDF" trigger opens the popover.
//   2. Clicking "Download PDF" with the toggle off fires
//      `window.open("/api/estimates/:id/export/pdf", "_blank")` — i.e. the
//      query string is empty.
//   3. Toggling "Step-by-step formula breakdowns" then clicking
//      "Download PDF" fires `window.open` against the same URL but
//      with `?includeFormulas=true` appended.
//   4. The two URLs the popover targets actually return different PDFs
//      from the server — the formulas variant is meaningfully larger
//      because it adds a "Calculation Breakdowns" page (mirrors the
//      `withFormulas.length > without.length + 500` assertion in
//      `estimate-pdf-service.test.ts`).
//
// We override `window.open` before each click so the test never has to
// race a popup window, a download event, or browser-specific PDF
// rendering. The captured URLs are then re-fetched directly via
// `page.request` (which carries the same auth + CSRF cookies the
// browser would have used) so the size assertion is on the real
// server-rendered PDF bytes — exactly what the user would have
// downloaded.

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
 * Replace `window.open` with a recorder. The `EstimatePdfExportButton`
 * fires `window.open(url, "_blank")` when the user clicks "Download
 * PDF"; capturing the URL avoids the cross-engine flakiness of waiting
 * for a popup that immediately turns into a PDF download.
 */
async function captureWindowOpens(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __pdfOpens: string[]; open: typeof window.open };
    w.__pdfOpens = [];
    w.open = ((url?: string | URL) => {
      w.__pdfOpens.push(typeof url === "string" ? url : String(url ?? ""));
      return null as unknown as Window;
    }) as typeof window.open;
  });
}

async function readWindowOpens(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __pdfOpens?: string[] }).__pdfOpens ?? [],
  );
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

    // --- Seed: bid + estimate + one calculator-driven line item ----------
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

    // Install the window.open recorder once the page has finished
    // bootstrapping the React tree. We only need to do this once: the
    // override survives both popover round-trips because we never
    // navigate away.
    await captureWindowOpens(page);

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
    await confirmButton.click();

    // Clicking confirm closes the popover (the component flips
    // `setOpen(false)` after firing window.open). Wait for it to
    // collapse so the next round-trip starts from a clean state.
    await expect(switchToggle).toBeHidden();

    // --- Round 2: Download with the toggle ON ---------------------------
    await exportButton.click();
    await expect(switchToggle).toBeVisible();
    await switchToggle.click();
    await expect(switchToggle).toHaveAttribute("data-state", "checked");
    await confirmButton.click();
    await expect(switchToggle).toBeHidden();

    // --- Assert the URLs the popover handed to window.open --------------
    const opens = await readWindowOpens(page);
    expect(opens).toHaveLength(2);

    const [withoutUrl, withUrl] = opens;
    const expectedBase = `/api/estimates/${estimate.id}/export/pdf`;
    expect(withoutUrl).toBe(expectedBase);
    expect(withUrl).toBe(`${expectedBase}?includeFormulas=true`);

    // --- Re-fetch both PDFs server-side and compare bytes ---------------
    // `page.request` shares the browser context's auth + CSRF cookies, so
    // these GETs hit the same protected route the popup would have hit.
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
});
