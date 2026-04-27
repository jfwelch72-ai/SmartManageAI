import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface BidResponse {
  id: string;
  code: string;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  scalePxPerFoot: number | null;
}

async function devLogin(page: Page, role: string) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function createBid(page: Page, label: string): Promise<BidResponse> {
  const res = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: label,
      clientName: "PW Standalone Takeoff Client",
      bidAmount: "75000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

async function uploadSheet(
  page: Page,
  bidId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
  const res = await page.request.post(
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl: upload.objectKey,
        objectKey: upload.objectKey,
        fileName,
      },
    },
  );
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { sheets: SheetResponse[] };
  expect(body.sheets.length).toBeGreaterThan(0);
  return body.sheets[0];
}

async function seedSelectedSheet(page: Page, bidId: string, sheetId: string) {
  await page.evaluate(
    ({ key, value }) => {
      sessionStorage.setItem(key, value);
    },
    { key: `takeoff-sheet-${bidId}`, value: sheetId },
  );
}

// Suppress the bid-plans Joyride tour so its full-page overlay doesn't
// intercept clicks on the sidebar / CTA. Same approach as
// `e2e/takeoff-markup-keyboard-delete.spec.ts`.
async function suppressBidPlansTour(page: Page) {
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;
  await page.evaluate((tourKey) => {
    localStorage.setItem(tourKey, "1");
  }, `bid-plans-tour-completed-${userId}`);
}

// Task #2074 — End-to-end coverage for the standalone Takeoff workspace
// added in Task #2067:
//   - the new top-level page at /takeoff/:bidCode
//   - the bid Plans tab CTA + sheet-click navigation
//   - the fullscreenScaleModal mode of <PlanScaleModal>
//   - a smoke test that the BIM split view in the bid Plans tab still works
test.describe("Standalone Takeoff workspace - Playwright E2E", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("opens /takeoff/:bidCode and renders the workspace header for the bid", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, `PW Standalone Direct ${suffix}`);
    const sheet = await uploadSheet(page, bid.id, "Direct Nav Sheet");

    // Pre-seed sessionStorage so <TakeoffWorkspace> mounts with the sheet
    // already selected on the very first render. Mirrors the pattern used
    // by `e2e/takeoff-markup-drawing.spec.ts` to sidestep the
    // page-effect-vs-child-mount ordering inside <TakeoffWorkspacePage>.
    await page.goto(`${BASE_URL}/bids/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await seedSelectedSheet(page, bid.id, sheet.id);

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("badge-takeoff-bid-code")).toHaveText(
      bid.code,
    );
    // The top bar should link back to the bid detail page.
    await expect(page.getByTestId("button-back-to-bid")).toBeVisible();
    // The seeded sheet should be selected and its tab visible.
    await expect(page.getByTestId(`tab-sheet-${sheet.id}`)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("bid Plans tab CTA opens the standalone Takeoff workspace", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, `PW Standalone CTA ${suffix}`);
    // Sheet not strictly required for the CTA, but having one is realistic.
    await uploadSheet(page, bid.id, "CTA Sheet");

    await page.goto(`${BASE_URL}/bids/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Plans tab is the default step on /bids/:code, so the CTA pane is the
    // initial right-hand pane (no doc selected, not in split view).
    const cta = page.getByTestId("button-open-takeoff-workspace");
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("takeoff-cta-pane")).toBeVisible();

    await cta.click();

    await expect(page).toHaveURL(
      new RegExp(`/takeoff/${bid.code}(?:\\?.*)?$`),
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("badge-takeoff-bid-code")).toHaveText(
      bid.code,
    );
  });

  test("clicking a sheet in the bid Plans tab opens the standalone workspace with that sheet selected", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, `PW Standalone SheetClick ${suffix}`);
    const sheet = await uploadSheet(page, bid.id, "Click Target Sheet");

    await page.goto(`${BASE_URL}/bids/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // The sidebar entry only appears after the sheets query resolves.
    const sidebarSheet = page.getByTestId(`sheet-${sheet.id}`);
    await expect(sidebarSheet).toBeVisible({ timeout: 15_000 });

    await sidebarSheet.click();

    // Sidebar click navigates to the standalone workspace with the
    // selected sheet encoded in the query string.
    await expect(page).toHaveURL(
      new RegExp(
        `/takeoff/${bid.code}\\?sheet=${encodeURIComponent(sheet.id)}`,
      ),
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });

    // The standalone page persists the deep-linked sheet into the same
    // `takeoff-sheet-${bidId}` sessionStorage slot the workspace reads on
    // mount. Verify the bridge actually wrote the value.
    await expect
      .poll(
        async () =>
          page.evaluate(
            (key) => sessionStorage.getItem(key),
            `takeoff-sheet-${bid.id}`,
          ),
        {
          message: "expected the deep-linked sheet to be persisted",
          timeout: 10_000,
        },
      )
      .toBe(sheet.id);

    // After a reload the workspace remounts and reads sessionStorage in
    // its lazy `useState` initializer, so the deep-linked sheet ends up
    // selected (and its tab rendered in the workspace tab bar).
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`tab-sheet-${sheet.id}`)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("fullscreen scale modal accepts a custom scale and persists it", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, `PW Standalone Scale ${suffix}`);
    const sheet = await uploadSheet(page, bid.id, "Scale Target Sheet");

    // Sanity: sheet starts uncalibrated.
    expect(sheet.scalePxPerFoot).toBeNull();

    // Pre-seed the selected sheet so the standalone workspace's
    // "Set/Add Scale" button (gated on a selected sheet) is visible
    // immediately on first render. Also collapse the right takeoff
    // sidebar so it doesn't overlay (and intercept clicks on) the
    // top-bar "Add Scale" button — the sidebar is positioned with
    // `absolute right-0` and a 360px width at this viewport.
    await page.goto(`${BASE_URL}/bids/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await seedSelectedSheet(page, bid.id, sheet.id);
    await page.evaluate(() => {
      localStorage.setItem("takeoff-sidebar-collapsed", "true");
    });

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });

    const addScale = page.getByTestId("button-add-scale");
    await expect(addScale).toBeVisible({ timeout: 15_000 });
    await addScale.click();

    // The standalone page passes `fullscreenScaleModal`, which switches
    // <PlanScaleModal> to its full-viewport variant. Verify the fullscreen
    // testid (not the compact one) renders.
    await expect(
      page.getByTestId("dialog-plan-scale-fullscreen"),
    ).toBeVisible();
    await expect(page.getByTestId("dialog-plan-scale")).toHaveCount(0);

    // Switch to the Custom tab and enter a known ratio: 2 in = 4 ft.
    // (2 in × 96 px/in) / (4 ft × 12 in/ft) = 192 / 48 = 4 px/ft.
    await page.getByTestId("tab-custom").click();
    await page.getByTestId("input-custom-drawing").fill("2");
    await page.getByTestId("input-custom-feet").fill("4");

    const done = page.getByTestId("button-scale-done");
    await expect(done).toBeEnabled();
    await done.click();

    // Modal closes after applying.
    await expect(
      page.getByTestId("dialog-plan-scale-fullscreen"),
    ).toHaveCount(0, { timeout: 5_000 });

    // Verify via API that the calibration PATCH actually landed.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${BASE_URL}/api/bids/${bid.id}/takeoff/sheets`,
          );
          if (res.status() !== 200) return null;
          const sheets = (await res.json()) as SheetResponse[];
          const updated = sheets.find((s) => s.id === sheet.id);
          return updated?.scalePxPerFoot ?? null;
        },
        {
          message: "expected sheet to have a custom scale persisted",
          timeout: 10_000,
        },
      )
      .toBeCloseTo(4.0, 1);
  });

  test("BIM split view in the bid Plans tab still renders both panes", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, `PW Standalone BIM Split ${suffix}`);
    // A sheet on the takeoff side is realistic (the workspace renders its
    // empty state otherwise) but not strictly required for the split-view
    // chrome to mount — the smoke test only asserts both panels appear.
    await uploadSheet(page, bid.id, "Split View Sheet");

    // Register a BIM document so `bimDocuments.length > 0` and the
    // "Split View (3D + 2D)" button shows up. The dev-sandbox org has all
    // feature flags (including BIM_VIEWER) enabled by /api/dev/test-login,
    // so `bimEnabled` is true. We don't need a real IFC payload — the
    // BimViewer is wrapped in a WidgetErrorBoundary + Suspense, so a failed
    // 3D parse can't tear down the split-view panes.
    const bimUpload = await uploadFixturePdf(page, {
      baseUrl: BASE_URL,
      label: "PW Standalone BIM Doc",
    });
    const docRes = await page.request.post(
      `${BASE_URL}/api/bids/${bid.code}/documents`,
      {
        data: {
          title: "Standalone BIM Smoke Doc",
          fileName: "smoke-model.ifc",
          fileUrl: bimUpload.objectKey,
          objectKey: bimUpload.objectKey,
          fileSize: bimUpload.fileSize,
          mimeType: "model/ifc",
          type: "BIM",
        },
      },
    );
    expect(docRes.status()).toBe(201);

    await page.goto(`${BASE_URL}/bids/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await suppressBidPlansTour(page);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const splitBtn = page.getByTestId("button-split-view");
    await expect(splitBtn).toBeVisible({ timeout: 15_000 });
    await splitBtn.click();

    // Both panes of the BIM split view should mount.
    await expect(page.getByTestId("split-view-takeoff")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("split-view-bim")).toBeVisible();

    // The "Exit Split" affordance should be available, confirming the top
    // bar of the takeoff pane mounted as expected.
    await expect(page.getByTestId("button-exit-split-view")).toBeVisible();
  });
});
