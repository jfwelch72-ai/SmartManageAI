import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface StandaloneResponse {
  id: string;
  title: string;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
}

async function devLogin(page: Page, role: string) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function createStandalone(
  page: Page,
  title: string,
): Promise<StandaloneResponse> {
  const res = await page.request.post(`${BASE_URL}/api/takeoff/standalone`, {
    data: { title, clientName: "PW Standalone Open WS Client" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as StandaloneResponse;
}

async function uploadStandaloneSheet(
  page: Page,
  takeoffId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
  // The standalone-sheet endpoint takes `imageUrl` (object key) and returns
  // a single sheet row — different shape from the bid-side `/plans` route.
  const res = await page.request.post(
    `${BASE_URL}/api/takeoff/standalone/${takeoffId}/sheets`,
    {
      data: {
        imageUrl: upload.objectKey,
        objectKey: upload.objectKey,
        sheetName: fileName,
      },
    },
  );
  expect(res.status()).toBe(201);
  return (await res.json()) as SheetResponse;
}

// Task #2550 — End-to-end coverage for the standalone-takeoff detail page's
// new "Open workspace" entry point + clickable sheet rows that deep-link
// into <TakeoffWorkspace> in standalone mode.
test.describe("Standalone Takeoff detail → Open Workspace (Task #2550)", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("Open workspace button is disabled with no sheets and shows the corrected empty-state copy", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const t = await createStandalone(page, `PW Standalone Empty ${Date.now()}`);

    await page.goto(`${BASE_URL}/takeoff/standalone/${t.id}`, {
      waitUntil: "domcontentloaded",
    });

    const openBtn = page.getByTestId("button-open-workspace");
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await expect(openBtn).toBeDisabled();

    const empty = page.getByTestId("text-sheets-empty");
    await expect(empty).toBeVisible();
    // The misleading "tag to a bid or project" guidance must be gone.
    await expect(empty).not.toContainText(/tag this takeoff to a bid or project/i);
    await expect(empty).toContainText(/Open workspace/i);
  });

  test("Open workspace button navigates to the standalone workspace", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const t = await createStandalone(page, `PW Standalone Open ${Date.now()}`);
    await uploadStandaloneSheet(page, t.id, "Open WS Sheet");

    await page.goto(`${BASE_URL}/takeoff/standalone/${t.id}`, {
      waitUntil: "domcontentloaded",
    });

    const openBtn = page.getByTestId("button-open-workspace");
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await expect(openBtn).toBeEnabled();
    await openBtn.click();

    await expect(page).toHaveURL(
      new RegExp(`/takeoff/standalone/${t.id}/workspace$`),
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("standalone-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("clicking a sheet row deep-links into the workspace with that sheet selected and a created measurement persists across reopen", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const t = await createStandalone(
      page,
      `PW Standalone SheetClick ${Date.now()}`,
    );
    const sheet = await uploadStandaloneSheet(page, t.id, "Click Target Sheet");

    // Navigate via the detail page sheet row (the new clickable surface).
    await page.goto(`${BASE_URL}/takeoff/standalone/${t.id}`, {
      waitUntil: "domcontentloaded",
    });
    const row = page.getByTestId(`sheet-row-${sheet.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    await expect(page).toHaveURL(
      new RegExp(
        `/takeoff/standalone/${t.id}/workspace\\?sheet=${encodeURIComponent(sheet.id)}`,
      ),
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("standalone-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`tab-sheet-${sheet.id}`)).toBeVisible({
      timeout: 15_000,
    });

    // Create a measurement against the selected standalone sheet via the
    // shared takeoff-measurements endpoint. This is the same path the
    // workspace's drawing tools take, but without the canvas dance — it
    // exercises the new standalone branch in `verifySheetAccess` and the
    // standalone-aware `/all-measurements` aggregator.
    const createRes = await page.request.post(
      `${BASE_URL}/api/takeoff/sheets/${sheet.id}/measurements`,
      {
        data: {
          type: "LINEAR",
          status: "DRAFT",
          label: "PW persistence linear",
          color: "#ff0000",
          points: [
            [100, 100],
            [200, 100],
          ],
        },
      },
    );
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { id: string };

    // Navigate back to the detail page, then reopen the workspace, and
    // verify the measurement we just created round-trips through the new
    // standalone all-measurements endpoint the workspace mounts on.
    await page.goto(`${BASE_URL}/takeoff/standalone/${t.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("button-open-workspace")).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByTestId("button-open-workspace").click();
    await expect(page.getByTestId("standalone-workspace-page")).toBeVisible({
      timeout: 15_000,
    });

    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${BASE_URL}/api/takeoff/standalone/${t.id}/all-measurements`,
          );
          if (res.status() !== 200) return [];
          const rows = (await res.json()) as Array<{ id: string }>;
          return rows.map((r) => r.id);
        },
        {
          message: "expected the created measurement to be visible after reopen",
          timeout: 10_000,
        },
      )
      .toContain(created.id);
  });
});
