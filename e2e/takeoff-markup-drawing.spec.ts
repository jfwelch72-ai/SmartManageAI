import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface SheetResponse {
  id: string;
  sheetName: string | null;
  bidId: string | null;
}

interface MarkupResponse {
  id: string;
  sheetId: string;
  tool: string;
  text?: string | null;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

async function listMarkups(page: Page, sheetId: string): Promise<MarkupResponse[]> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/markups`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as MarkupResponse[];
}

async function selectMarkupTool(page: Page, toolId: string) {
  await page.getByTestId("button-markup-group").click();
  const toolBtn = page.getByTestId(`button-tool-${toolId}`);
  await toolBtn.waitFor({ state: "visible" });
  await toolBtn.click();
  // Popover should close after selecting a tool.
  await expect(page.getByTestId(`button-tool-${toolId}`)).toHaveCount(0, {
    timeout: 5000,
  });
}

async function getCanvasBox(page: Page) {
  const canvas = page.locator(".konvajs-content canvas").first();
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Konva canvas has no bounding box");
  return box;
}

async function dragOnCanvas(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  intermediate: { x: number; y: number }[] = [],
) {
  const box = await getCanvasBox(page);
  const sx = box.x + start.x;
  const sy = box.y + start.y;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(50);
  for (const p of intermediate) {
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 4 });
    await page.waitForTimeout(20);
  }
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 8 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function clickOnCanvas(page: Page, point: { x: number; y: number }) {
  const box = await getCanvasBox(page);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function waitForMarkupCount(
  page: Page,
  sheetId: string,
  expected: number,
) {
  await expect
    .poll(async () => (await listMarkups(page, sheetId)).length, {
      message: `expected markup count to reach ${expected}`,
      timeout: 10_000,
    })
    .toBe(expected);
}

test.describe("Takeoff markup drawing - Playwright E2E", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("draws all six markup tools on the canvas and persists them", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    // Create bid + plan + sheet via API for speed.
    const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: {
        name: `PW Markup Bid ${suffix}`,
        clientName: "PW Markup Client",
        bidAmount: "50000",
      },
    });
    expect(bidRes.status()).toBe(201);
    const bid = await bidRes.json();
    const bidId: string = bid.id;
    const bidCode: string = bid.code;

    const planRes = await page.request.post(
      `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
      {
        data: {
          fileUrl: "https://example.com/markup-plan.pdf",
          fileName: "Markup Test Sheet",
        },
      },
    );
    expect(planRes.status()).toBe(201);
    const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
    const sheetId = planBody.sheets[0].id;

    // Pre-select the sheet by seeding sessionStorage so the workspace
    // mounts with a Stage on the very first render.
    await page.goto(`${BASE_URL}/bids/${bidCode}`);
    await page.evaluate(
      ({ key, value }) => {
        sessionStorage.setItem(key, value);
      },
      { key: `takeoff-sheet-${bidId}`, value: sheetId },
    );
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // The Konva Stage only renders once a sheet is selected.
    const canvas = page.locator(".konvajs-content canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 15_000 });

    let expectedCount = 0;

    // 1) ARROW
    await selectMarkupTool(page, "markup_arrow");
    await dragOnCanvas(page, { x: 120, y: 120 }, { x: 240, y: 200 });
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 2) RECTANGLE
    await selectMarkupTool(page, "markup_rectangle");
    await dragOnCanvas(page, { x: 260, y: 130 }, { x: 360, y: 230 });
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 3) CLOUD
    await selectMarkupTool(page, "markup_cloud");
    await dragOnCanvas(page, { x: 120, y: 240 }, { x: 240, y: 320 });
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 4) HIGHLIGHT
    await selectMarkupTool(page, "markup_highlight");
    await dragOnCanvas(page, { x: 260, y: 250 }, { x: 380, y: 330 });
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 5) FREEHAND - many intermediate points so the path is captured.
    await selectMarkupTool(page, "markup_freehand");
    const freehandIntermediate = Array.from({ length: 8 }, (_, i) => ({
      x: 130 + i * 12,
      y: 360 + Math.round(Math.sin(i / 1.5) * 20),
    }));
    await dragOnCanvas(
      page,
      { x: 120, y: 360 },
      { x: 240, y: 360 },
      freehandIntermediate,
    );
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 6) TEXT - mouse down opens a floating input.
    await selectMarkupTool(page, "markup_text");
    await clickOnCanvas(page, { x: 300, y: 380 });
    const textInput = page.getByTestId("input-markup-text");
    await textInput.waitFor({ state: "visible" });
    await textInput.fill("E2E label");
    await page.getByTestId("button-save-markup-text").click();
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // Verify each markup type was persisted with the right tool tag.
    const all = await listMarkups(page, sheetId);
    const tools = all.map((m) => m.tool).sort();
    expect(tools).toEqual(
      ["ARROW", "CLOUD", "FREEHAND", "HIGHLIGHT", "RECTANGLE", "TEXT"].sort(),
    );

    // Sanity-check shapes:
    const arrow = all.find((m) => m.tool === "ARROW")!;
    expect(arrow.points.length).toBeGreaterThanOrEqual(2);
    const rect = all.find((m) => m.tool === "RECTANGLE")!;
    expect(rect.points.length).toBeGreaterThanOrEqual(2);
    const freehand = all.find((m) => m.tool === "FREEHAND")!;
    expect(freehand.points.length).toBeGreaterThanOrEqual(3);
    const text = all.find((m) => m.tool === "TEXT")!;
    expect(text.text).toBe("E2E label");
    expect(text.points.length).toBe(1);

    // Reload the workspace and confirm the persisted markups render again
    // (the takeoff page re-fetches /markups and feeds them back into the
    // Konva Stage). This guards against regressions where saving works
    // but the re-render path drops the new shapes.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(".konvajs-content canvas")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const reloaded = await listMarkups(page, sheetId);
    expect(reloaded.length).toBe(6);
  });
});
