import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

// Task #2092 — Smoke coverage for the bid takeoff route landing page,
// the standalone /takeoff/:bidCode workspace, and the "Open Full-Screen
// Takeoff" deep link from the bid Plans tab. These surfaces had no
// browser-level coverage (only API-level coverage in
// e2e/takeoff-workflow.spec.ts) and previously could regress silently
// when routing or the bid-vs-project context switch shifted. Mirrors
// e2e/takeoff-project-route-smoke.spec.ts (Task #2081).
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface BidResponse {
  id: string;
  code: string;
  name: string;
  status?: string;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  projectId: string | null;
  bidId: string | null;
  sheetIndex: number;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

async function createBid(page: Page, name: string): Promise<BidResponse> {
  const res = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name,
      clientName: "PW Takeoff Bid Client",
      bidAmount: "75000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

async function uploadBidSheet(
  page: Page,
  bidId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
  const planRes = await page.request.post(
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl: upload.objectKey,
        objectKey: upload.objectKey,
        fileName,
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  expect(planBody.sheets.length).toBeGreaterThan(0);
  return planBody.sheets[0];
}

test.describe("Bid takeoff route smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("clicking a bid on /takeoff opens the bid workspace with header", async ({
    page,
  }) => {
    const suffix = Date.now();
    const bid = await createBid(page, `PW Takeoff Bid Header ${suffix}`);

    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });
    const bidLink = page.getByTestId(`link-takeoff-bid-${bid.code}`);
    await expect(bidLink).toBeVisible({ timeout: 15_000 });
    await bidLink.click();

    await page.waitForURL(`**/takeoff/${bid.code}`, { timeout: 15_000 });

    // Bid context header should render ("Bid" back button, "Open Bid
    // Detail" button, bid name + code badge).
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("button-back-to-bid")).toBeVisible();
    await expect(page.getByTestId("button-back-to-bid")).toContainText("Bid");
    await expect(page.getByTestId("button-open-bid-detail")).toBeVisible();
    await expect(page.getByTestId("button-open-bid-detail")).toContainText(
      "Open Bid Detail",
    );
    await expect(page.getByTestId("text-takeoff-bid-title")).toContainText(
      bid.name,
    );
    await expect(page.getByTestId("badge-takeoff-bid-code")).toContainText(
      bid.code,
    );

    // The bid header uses the lucide FileText icon (vs the project
    // header's Folder), which is the visual cue distinguishing the two
    // contexts. lucide-react renders the icon as
    // <svg class="lucide lucide-file-text">.
    await expect(
      page
        .getByTestId("takeoff-workspace-page")
        .locator("svg.lucide-file-text")
        .first(),
    ).toBeVisible();

    // The "Bid" back link should target /bids/<code>. The Button is
    // rendered via `asChild`, so the data-testid is forwarded onto the
    // underlying <a> element by Radix's Slot.
    const backHref = await page
      .getByTestId("button-back-to-bid")
      .getAttribute("href");
    expect(backHref).toBe(`/bids/${bid.code}`);

    // Same for "Open Bid Detail".
    const openHref = await page
      .getByTestId("button-open-bid-detail")
      .getAttribute("href");
    expect(openHref).toBe(`/bids/${bid.code}`);
  });

  test("'Open Full-Screen Takeoff' on the bid Plans tab preserves selected sheet via ?sheet=", async ({
    page,
  }) => {
    const suffix = Date.now();
    const bid = await createBid(page, `PW Takeoff Bid Plans ${suffix}`);
    const sheet = await uploadBidSheet(
      page,
      bid.id,
      `PW Bid Plans Sheet ${suffix}`,
    );

    // Pre-seed the sheet selection in sessionStorage so the bid Plans
    // tab boots with this sheet selected without us having to drive the
    // sheet picker UI. BidPlansTab reads this exact key on mount (see
    // client/src/components/bid/BidPlansTab.tsx — the
    // `takeoff-sheet-${bid.id}` storage key).
    //
    // addInitScript runs before any page script on every navigation in
    // this context, so the value is in place when BidPlansTab
    // initializes.
    await page.addInitScript(
      ([key, value]) => {
        try {
          sessionStorage.setItem(key, value);
        } catch {
          // Ignore — sessionStorage may be unavailable in some contexts.
        }
      },
      [`takeoff-sheet-${bid.id}`, sheet.id] as const,
    );

    // The bid detail page defaults to step 1 (Plans & Takeoff), so a
    // plain navigation to /bids/<code> lands on the Plans tab.
    await page.goto(`${BASE_URL}/bids/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });

    const openWorkspaceBtn = page.getByTestId(
      "button-open-takeoff-workspace",
    );
    await expect(openWorkspaceBtn).toBeVisible({ timeout: 30_000 });

    // The button is a wouter <Link>, rendered as an <a>. Verify its
    // href includes the sheet query param before clicking so we get a
    // precise failure message if the deep link breaks. data-testid is
    // forwarded onto the underlying <a> by Radix Slot (Button asChild).
    const href = await openWorkspaceBtn.getAttribute("href");
    expect(href).toBe(`/takeoff/${bid.code}?sheet=${sheet.id}`);

    await openWorkspaceBtn.click();
    await page.waitForURL(`**/takeoff/${bid.code}?sheet=${sheet.id}`, {
      timeout: 15_000,
    });

    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("badge-takeoff-bid-code")).toContainText(
      bid.code,
    );

    const search = new URL(page.url()).search;
    expect(search).toContain(`sheet=${sheet.id}`);
  });
});
