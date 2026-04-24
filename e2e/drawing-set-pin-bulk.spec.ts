import { test, expect, type Page } from "@playwright/test";
import { authedRequest } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

// Task #1683 — UI tests for inline pin/unpin and the bulk-replace modal.

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
}

interface DrawingSetResponse {
  id: string;
  projectId: string;
  name: string;
  isPrimary: boolean;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  projectId: string | null;
  isActive: boolean | null;
}

interface PlanCreateResponse {
  sheets: SheetResponse[];
}

async function devLogin(page: Page, role = "ADMIN"): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function createProject(page: Page, suffix: number | string): Promise<ProjectResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/projects`, {
    data: { name: `PW DS Pin Bulk ${suffix}`, clientName: "DS Client", status: "PLANNING" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ProjectResponse;
}

async function createSheet(
  page: Page,
  projectId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL, label: fileName });
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/projects/${projectId}/takeoff/plans`,
    {
      data: {
        fileUrl: upload.objectKey,
        objectKey: upload.objectKey,
        fileName,
      },
    },
  );
  expect(res.status()).toBe(201);
  const body = (await res.json()) as PlanCreateResponse;
  expect(body.sheets.length).toBeGreaterThan(0);
  return body.sheets[0];
}

async function createDrawingSet(
  page: Page,
  projectId: string,
  name: string,
): Promise<DrawingSetResponse> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/projects/${projectId}/drawing-sets`,
    { data: { name } },
  );
  expect(res.status()).toBe(201);
  return (await res.json()) as DrawingSetResponse;
}

async function makeSetPrimary(page: Page, setId: string): Promise<void> {
  // Primary set is auto-selected by PlansTab, exposing inline pin controls.
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/projects/drawing-sets/${setId}/primary`,
  );
  expect(res.status()).toBe(200);
}

async function listItems(page: Page, setId: string): Promise<Array<{ id: string; sheetId: string }>> {
  const res = await page.request.get(
    `${BASE_URL}/api/projects/drawing-sets/${setId}/items`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as Array<{ id: string; sheetId: string }>;
}

test.describe("Task #1683 — Drawing-set pin/unpin and bulk modal (UI)", () => {
  test("inline pin/unpin updates badges in place and bulk modal pins/clears all", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = Date.now();

    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const sheet1 = await createSheet(page, project.id, `PW DS Pin Sheet 1 ${suffix}`);
    const sheet2 = await createSheet(page, project.id, `PW DS Pin Sheet 2 ${suffix}`);
    const set = await createDrawingSet(page, project.id, `PW DS Pin Set ${suffix}`);
    await makeSetPrimary(page, set.id);

    // Stub document stream with a minimal valid 1-page PDF so the PDF preview
    // doesn't hit object storage in CI and pdf.js can parse the response.
    const MINIMAL_PDF = Buffer.from(
      "%PDF-1.1\n" +
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \n" +
        "0000000009 00000 n \n0000000052 00000 n \n0000000095 00000 n \n" +
        "trailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n",
    );
    await page.route(/\/api\/projects\/[^/]+\/documents\/[^/]+\/stream$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/pdf", body: MINIMAL_PDF }),
    );

    await page.goto(`${BASE_URL}/projects/${project.code}?tab=plans`, {
      waitUntil: "domcontentloaded",
    });

    // Record main-frame navigations after initial goto to assert no reloads.
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    const initialUrl = page.url();

    const sheet1Row = page.getByTestId(`sheet-${sheet1.id}`);
    const sheet2Row = page.getByTestId(`sheet-${sheet2.id}`);
    await expect(sheet1Row).toBeVisible({ timeout: 30_000 });
    await expect(sheet2Row).toBeVisible();

    // Initial state: nothing pinned.
    await expect(page.getByTestId(`badge-pinned-${sheet1.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`badge-pinned-${sheet2.id}`)).toHaveCount(0);
    expect(await listItems(page, set.id)).toHaveLength(0);

    // Hover gating: pin button is attached but ~transparent until row hover.
    // Use threshold-based assertions so CSS transition timing variance across
    // CI environments doesn't cause spurious failures.
    const pinBtn1 = page.getByTestId(`button-pin-sheet-${sheet1.id}`);
    await pinBtn1.waitFor({ state: "attached" });
    expect(
      await pinBtn1.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
    ).toBeLessThan(0.5);
    await sheet1Row.hover();
    await expect
      .poll(async () =>
        pinBtn1.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
      , { timeout: 2_000 })
      .toBeGreaterThan(0.5);

    // Inline pin. dispatchEvent avoids actionability flakiness from
    // background polling re-renders on the dev server.
    await pinBtn1.dispatchEvent("click");
    await expect(page.getByTestId(`badge-pinned-${sheet1.id}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId(`button-unpin-sheet-${sheet1.id}`)).toHaveCount(1);
    await expect(page.getByTestId(`button-pin-sheet-${sheet1.id}`)).toHaveCount(0);
    expect(await listItems(page, set.id)).toHaveLength(1);

    // Inline unpin.
    const unpinBtn1 = page.getByTestId(`button-unpin-sheet-${sheet1.id}`);
    await unpinBtn1.waitFor({ state: "attached" });
    await unpinBtn1.dispatchEvent("click");
    await expect(page.getByTestId(`badge-pinned-${sheet1.id}`)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`button-pin-sheet-${sheet1.id}`)).toHaveCount(1);
    expect(await listItems(page, set.id)).toHaveLength(0);

    // Open the bulk-manage modal.
    await page.getByTestId("tab-drawing-sets").dispatchEvent("click");
    const setCard = page.getByTestId(`card-drawing-set-${set.id}`);
    await expect(setCard).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`button-manage-set-${set.id}`).dispatchEvent("click");
    const dialog = page.getByTestId("dialog-manage-set-items");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("text-no-pinned-sheets")).toBeVisible();

    // "Pin all active sheets".
    const pinAllBtn = page.getByTestId("button-pin-all-active");
    await expect(pinAllBtn).toBeVisible();
    await expect(pinAllBtn).toContainText(/Pin all active sheets \(\d+\)/);
    await pinAllBtn.dispatchEvent("click");

    // Modal updates in place: count text reflects new total, empty state gone.
    await expect(page.getByTestId("text-no-pinned-sheets")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-pinned-count")).toHaveText(
      "Currently Pinned (2)",
      { timeout: 10_000 },
    );
    await expect
      .poll(async () => (await listItems(page, set.id)).length, { timeout: 10_000 })
      .toBe(2);

    // Close modal, return to plans — both rows now show the pinned badge.
    // `force: true` bypasses the actionability wait that hangs on the dev
    // server's constant re-renders.
    await page.getByTestId("button-close-manage-set").click({ force: true });
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId("tab-plans").dispatchEvent("click");
    await expect(page.getByTestId(`badge-pinned-${sheet1.id}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId(`badge-pinned-${sheet2.id}`)).toBeVisible();

    // "Clear all pinned".
    await page.getByTestId("tab-drawing-sets").dispatchEvent("click");
    await expect(setCard).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`button-manage-set-${set.id}`).dispatchEvent("click");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const clearBtn = page.getByTestId("button-clear-all-pinned");
    await expect(clearBtn).toBeEnabled();
    await clearBtn.dispatchEvent("click");

    await expect(page.getByTestId("text-no-pinned-sheets")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("text-pinned-count")).toHaveText(
      "Currently Pinned (0)",
      { timeout: 10_000 },
    );
    await expect
      .poll(async () => (await listItems(page, set.id)).length, { timeout: 10_000 })
      .toBe(0);

    // Close modal, badges gone in plans list too.
    await page.getByTestId("button-close-manage-set").click({ force: true });
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId("tab-plans").dispatchEvent("click");
    await expect(page.getByTestId(`badge-pinned-${sheet1.id}`)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`badge-pinned-${sheet2.id}`)).toHaveCount(0);

    // No full-page reload happened — UI updated via React Query invalidation.
    expect(navigations).toEqual([]);
    expect(page.url()).toBe(initialUrl);
  });
});
