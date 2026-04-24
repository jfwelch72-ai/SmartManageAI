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

// Task #1631 — bid-side and project-side markup toolbars share
// `<PlanMarkupToolbar>`, which exposes `button-markup-tool-<lower>` ids
// (e.g. `button-markup-tool-arrow`) instead of the takeoff-specific
// `button-tool-markup_arrow`. Translate from the takeoff Tool id used by
// the rest of this spec.
const MARKUP_TOOL_TESTID: Record<string, string> = {
  markup_arrow: "button-markup-tool-arrow",
  markup_text: "button-markup-tool-text",
  markup_rectangle: "button-markup-tool-rectangle",
  markup_cloud: "button-markup-tool-cloud",
  markup_highlight: "button-markup-tool-highlight",
  markup_freehand: "button-markup-tool-freehand",
};

async function selectMarkupTool(page: Page, toolId: string) {
  const testId = MARKUP_TOOL_TESTID[toolId];
  if (!testId) throw new Error(`Unknown markup tool: ${toolId}`);
  await page.getByTestId("button-markup-group").click();
  const toolBtn = page.getByTestId(testId);
  await toolBtn.waitFor({ state: "visible" });
  await toolBtn.click();
  // Popover should close after selecting a tool.
  await expect(page.getByTestId(testId)).toHaveCount(0, {
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
  browserName: string = "chromium",
) {
  // WebKit / Firefox dispatch synthetic mousemove events less aggressively than
  // Chromium when `steps` is small, which can starve Konva's mousemove handler
  // (especially for the FREEHAND tool that records every move). Bump step
  // counts and waits for the non-chromium engines to keep the canvas drawing
  // path deterministic.
  const isChromium = browserName === "chromium";
  const interStep = isChromium ? 4 : 8;
  const finalStep = isChromium ? 8 : 16;
  const interWait = isChromium ? 20 : 40;
  const edgeWait = isChromium ? 50 : 100;

  const box = await getCanvasBox(page);
  const sx = box.x + start.x;
  const sy = box.y + start.y;
  // Hover first so WebKit registers the cursor inside the canvas before the
  // synthetic mousedown.
  await page.mouse.move(sx, sy);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(edgeWait);
  for (const p of intermediate) {
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: interStep });
    await page.waitForTimeout(interWait);
  }
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: finalStep });
  await page.waitForTimeout(edgeWait);
  await page.mouse.up();
  await page.waitForTimeout(isChromium ? 100 : 150);
}

async function clickOnCanvas(page: Page, point: { x: number; y: number }) {
  const box = await getCanvasBox(page);
  // Two move calls so WebKit reliably dispatches the initial mousemove before
  // the click sequence.
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
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
    browserName,
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
    await dragOnCanvas(page, { x: 120, y: 120 }, { x: 240, y: 200 }, [], browserName);
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 2) RECTANGLE
    await selectMarkupTool(page, "markup_rectangle");
    await dragOnCanvas(page, { x: 260, y: 130 }, { x: 360, y: 230 }, [], browserName);
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 3) CLOUD
    await selectMarkupTool(page, "markup_cloud");
    await dragOnCanvas(page, { x: 120, y: 240 }, { x: 240, y: 320 }, [], browserName);
    expectedCount += 1;
    await waitForMarkupCount(page, sheetId, expectedCount);

    // 4) HIGHLIGHT
    await selectMarkupTool(page, "markup_highlight");
    await dragOnCanvas(page, { x: 260, y: 250 }, { x: 380, y: 330 }, [], browserName);
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
      browserName,
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

    // === EDIT a markup =====================================================
    // Switch back to the Select tool so clicking a shape opens the edit
    // panel (the renderer only sets `listening` on shapes when the active
    // tool is "select"). Then click inside the rectangle (drawn at world
    // coords (260,130)->(360,230)) at its centroid.
    await page.getByTestId("button-tool-select").click();
    await clickOnCanvas(page, { x: 310, y: 180 });
    const editPanel = page.getByTestId("panel-markup-properties");
    await editPanel.waitFor({ state: "visible", timeout: 10_000 });

    // Change the rectangle's color and thickness, then save. The color
    // input is React-controlled, so we use the native value setter so
    // React's internal value tracker actually fires onChange (just
    // setting `.value` and dispatching events is a no-op here). The
    // thickness picker is now a row of preset buttons (matching the
    // toolbar presets in MARKUP_TOOLBAR_THICKNESSES) so we click the
    // button for the desired preset.
    const newRectColor = "#00aa55";
    const newRectThickness = 4;
    const setReactInputValue = async (
      locator: ReturnType<typeof editPanel.getByTestId>,
      value: string,
    ) => {
      await locator.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(input, v);
        else input.value = v;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    };
    await setReactInputValue(
      editPanel.getByTestId("input-markup-color"),
      newRectColor,
    );
    await editPanel
      .getByTestId(`button-markup-thickness-${newRectThickness}`)
      .click();
    await page.getByTestId("button-save-markup-edit").click();
    await editPanel.waitFor({ state: "hidden", timeout: 10_000 });

    // Confirm the rectangle edit landed via the API before reloading.
    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, sheetId);
          const r = list.find((m) => m.tool === "RECTANGLE");
          return r ? { color: r.color, thickness: r.thickness } : null;
        },
        {
          message: "rectangle edit (color+thickness) should persist",
          timeout: 10_000,
        },
      )
      .toEqual({ color: newRectColor, thickness: newRectThickness });

    // Now edit the TEXT markup's label. We seed selection by setting the
    // edit-draft state via a click; because the Konva Text glyph is small
    // (~12px tall) we sweep a few offsets around the anchor (300, 380)
    // until the panel opens, instead of relying on a single pixel-perfect
    // click on a glyph stroke.
    const newTextLabel = "Edited E2E label";
    const textHitOffsets = [
      { x: 304, y: 386 },
      { x: 308, y: 386 },
      { x: 302, y: 384 },
      { x: 306, y: 388 },
      { x: 312, y: 386 },
      { x: 300, y: 386 },
    ];
    let textPanelOpen = false;
    for (const offset of textHitOffsets) {
      await clickOnCanvas(page, offset);
      try {
        await editPanel.waitFor({ state: "visible", timeout: 1500 });
        // Confirm we selected the TEXT (panel shows the Label input only
        // for TEXT markups). If not, dismiss and try again.
        const labelInputCount = await editPanel
          .getByTestId("input-markup-text")
          .count();
        if (labelInputCount > 0) {
          textPanelOpen = true;
          break;
        }
        await page
          .getByTestId("button-cancel-markup-edit")
          .click()
          .catch(() => undefined);
        await editPanel
          .waitFor({ state: "hidden", timeout: 2000 })
          .catch(() => undefined);
      } catch {
        // panel didn't open; try the next offset
      }
    }
    expect(textPanelOpen).toBe(true);

    await editPanel.getByTestId("input-markup-text").fill(newTextLabel);
    await page.getByTestId("button-save-markup-edit").click();
    await editPanel.waitFor({ state: "hidden", timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, sheetId);
          return list.find((m) => m.tool === "TEXT")?.text ?? null;
        },
        { message: "text label edit should persist", timeout: 10_000 },
      )
      .toBe(newTextLabel);

    // Reload the workspace and confirm the persisted markups (including
    // the edits) render again. The takeoff page re-fetches /markups and
    // feeds them back into the Konva Stage; this guards against
    // regressions where saving works but the re-render path drops the
    // new shapes or the edited fields.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(".konvajs-content canvas")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const reloaded = await listMarkups(page, sheetId);
    expect(reloaded.length).toBe(6);
    const reloadedRect = reloaded.find((m) => m.tool === "RECTANGLE")!;
    expect(reloadedRect.color).toBe(newRectColor);
    expect(reloadedRect.thickness).toBe(newRectThickness);
    const reloadedText = reloaded.find((m) => m.tool === "TEXT")!;
    expect(reloadedText.text).toBe(newTextLabel);
  });
});
