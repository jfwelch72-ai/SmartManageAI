// Task #2794 — End-to-end coverage for the "Draw Zone Polygon" feature
// (Task #2784).
//
// Spec contract:
//   1. Opening the calibration drawer (T) and clicking "Draw Zone Polygon"
//      activates zone-drawing mode — the canvas clicks are routed to the
//      vertex accumulator instead of the normal measurement flow.
//   2. Placing 4 canvas clicks records 4 vertices in the active-banner
//      counter.
//   3. A double-click closes the polygon and transitions the drawer to the
//      "save form" state (DrawZoneSection with pending zone points).
//   4. Filling in a name + px/ft and clicking "Save zone" fires
//      POST /api/takeoff/sheets/:id/calibration-zones with the correct body,
//      after which the zone appears as a row in the CalibrationZonesPanel.
//   5. The "Cancel" button during drawing reverts to the idle idle state.

import { test, expect, type Locator, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { konvaZoneClick, konvaZoneDblClick } from "./helpers/konvaZone";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// ---------------------------------------------------------------------------
// Shared helpers (mirror the takeoff-typed-dim-and-calibration spec pattern)
// ---------------------------------------------------------------------------

async function devLogin(page: Page, role: string) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
}

async function seedTakeoffFixture(page: Page): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function gotoTakeoff(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // Close the right sidebar so it doesn't overlay the canvas or ribbon.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Focus the ribbon so the workspace's shortcut listeners are active.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

/** Open the inline calibration drawer via the T shortcut and ensure a
 * sheet is selected so that `DrawZoneSection` (and its
 * `button-draw-zone-polygon` child) renders.
 *
 * Flow:
 *  1. Press T — the drawer opens regardless of sheet selection (calibration
 *     step text renders unconditionally).
 *  2. If no sheet is selected yet the sheet-selector trigger shows
 *     "Select a sheet…".  Click it and pick the first option.
 *  3. Wait for `button-draw-zone-polygon` — it is gated by `sheetId` so
 *     it only appears once a sheet is active.
 *
 * Note: the Konva canvas check is intentionally done AFTER T is pressed.
 * The Konva stage only mounts after the workspace enters calibration mode
 * and sheets have been loaded — waiting for it before T would time out.
 */
async function openCalibrationDrawer(page: Page) {
  // 1. Open the drawer.
  await page.keyboard.press("t");
  await expect(page.getByTestId("inline-calibration-drawer")).toBeVisible({
    timeout: 8_000,
  });

  // 2. Select a sheet if none is selected yet.
  //    The SheetSelectorBar Select trigger carries data-testid="select-sheet".
  //    When nothing is selected its text content includes the placeholder.
  const sheetTrigger = page.getByTestId("select-sheet");
  await expect(sheetTrigger).toBeVisible({ timeout: 6_000 });

  const triggerText = await sheetTrigger.textContent().catch(() => "");
  if (!triggerText || triggerText.includes("Select a sheet")) {
    // Open the Radix dropdown.
    await sheetTrigger.click();
    // SelectContent is portaled into the workspace root via
    // container={workspaceRef.current}.  Radix renders items as role="option".
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toBeVisible({ timeout: 6_000 });
    await firstOption.click();
  }

  // 3. DrawZoneSection is now visible — confirm button is present.
  //    (Actual scrolling happens in clickDrawZoneBtn right before each click.)
  await expect(page.getByTestId("button-draw-zone-polygon")).toBeVisible({
    timeout: 8_000,
  });
}

/** Click the "Draw Zone Polygon" button regardless of viewport position.
 *
 * The button lives at the bottom of a tall scrollable drawer panel and
 * can sit outside the browser viewport.  Playwright's click() — even with
 * force:true — still rejects elements whose bounding rect is off-screen.
 * We work around this by invoking the element's own `.click()` method
 * directly inside the page context via page.evaluate, which bypasses every
 * viewport / actionability constraint.
 */
async function clickDrawZoneBtn(page: Page) {
  const clicked = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="button-draw-zone-polygon"]',
    ) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return true;
  });
  if (!clicked) {
    throw new Error("button-draw-zone-polygon not found in DOM");
  }
}

/** Click the "Cancel" button inside the zone-drawing active banner.
 *
 * Like `clickDrawZoneBtn`, the cancel button lives at the bottom of the
 * scrollable calibration drawer and may be outside the viewport.  We use
 * the same page.evaluate approach to bypass Playwright's viewport check.
 */
async function clickCancelZoneBtn(page: Page) {
  const clicked = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="button-draw-zone-cancel"]',
    ) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return true;
  });
  if (!clicked) {
    throw new Error("button-draw-zone-cancel not found in DOM");
  }
}

/** Canvas locator — same selector used by the other takeoff specs. */
function canvas(page: Page): Locator {
  return page.locator(".konvajs-content canvas").first();
}

// Zone canvas click/dblclick helpers are imported from ./helpers/konvaZone.
// See that file for full documentation, including the Konva private-API
// dependency note and the upgrade instructions.

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Draw Zone Polygon flow", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("clicking 'Draw Zone Polygon' activates drawing mode and shows the active banner", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await openCalibrationDrawer(page);

    // The draw button should be visible in idle state.
    await expect(page.getByTestId("button-draw-zone-polygon")).toBeVisible();

    // Click it → zone drawing mode activates.
    await clickDrawZoneBtn(page);

    // The active banner replaces the button.
    await expect(page.getByTestId("draw-zone-active-banner")).toBeVisible({
      timeout: 4_000,
    });
    await expect(
      page.getByTestId("button-draw-zone-polygon"),
    ).toHaveCount(0);
    // The banner tells the user to click vertices.
    await expect(page.getByTestId("draw-zone-active-banner")).toContainText(
      "Click vertices",
    );
  });

  test("cancelling zone drawing returns to idle state (Draw Zone button reappears)", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await openCalibrationDrawer(page);

    await clickDrawZoneBtn(page);
    await expect(page.getByTestId("draw-zone-active-banner")).toBeVisible({
      timeout: 4_000,
    });

    // Cancel lives at the bottom of the drawer — use evaluate to bypass
    // the viewport constraint (same approach as clickDrawZoneBtn).
    await clickCancelZoneBtn(page);

    // Back to idle — draw button is visible, banner is gone.
    await expect(page.getByTestId("button-draw-zone-polygon")).toBeVisible({
      timeout: 4_000,
    });
    await expect(page.getByTestId("draw-zone-active-banner")).toHaveCount(0);
  });

  test("double-clicking after 4 canvas clicks closes the polygon and shows the save form", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await openCalibrationDrawer(page);

    // Activate zone drawing.
    await clickDrawZoneBtn(page);
    await expect(page.getByTestId("draw-zone-active-banner")).toBeVisible({
      timeout: 4_000,
    });

    const cvs = canvas(page);
    await expect(cvs).toBeVisible({ timeout: 10_000 });

    // Place 4 vertices by dispatching mousedown directly on the canvas
    // element, bypassing any DOM overlays inside the Konva container.
    await konvaZoneClick(page, cvs, 200, 150);
    await konvaZoneClick(page, cvs, 350, 150);
    await konvaZoneClick(page, cvs, 350, 280);
    await konvaZoneClick(page, cvs, 200, 280);

    // Double-click to close the polygon.
    await konvaZoneDblClick(page, cvs, 200, 280);

    // The save form should now be visible.
    await expect(page.getByTestId("draw-zone-save-form")).toBeVisible({
      timeout: 6_000,
    });
    // The form should report 4 vertices.
    await expect(page.getByTestId("draw-zone-save-form")).toContainText(
      "4 vertices",
    );
    // The drawing banner must be gone.
    await expect(page.getByTestId("draw-zone-active-banner")).toHaveCount(0);
  });

  test("saving the drawn zone POSTs the correct payload and the zone appears in the panel", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await openCalibrationDrawer(page);

    // Activate zone drawing and place 4 vertices.
    await clickDrawZoneBtn(page);
    await expect(page.getByTestId("draw-zone-active-banner")).toBeVisible({
      timeout: 4_000,
    });

    const cvs = canvas(page);
    await expect(cvs).toBeVisible({ timeout: 10_000 });

    await konvaZoneClick(page, cvs, 200, 150);
    await konvaZoneClick(page, cvs, 350, 150);
    await konvaZoneClick(page, cvs, 350, 280);
    await konvaZoneClick(page, cvs, 200, 280);

    // Double-click to close.
    await konvaZoneDblClick(page, cvs, 200, 280);
    await expect(page.getByTestId("draw-zone-save-form")).toBeVisible({
      timeout: 6_000,
    });

    // Fill in the name.
    const nameInput = page.getByTestId("input-draw-zone-name");
    await nameInput.fill("Detail Inset A");

    // Fill in the px/ft value.
    const pxInput = page.getByTestId("input-draw-zone-pxperfoot");
    await pxInput.fill("24");

    // Listen for the POST response before clicking Save so we don't race it.
    // Capturing the *response* lets us verify both the request body shape and
    // the server-assigned zone ID (needed for the panel assertion below).
    const zoneResponseP = page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" &&
        new RegExp(
          `/api/takeoff/sheets/${sheetIds[0]}/calibration-zones$`,
        ).test(resp.url()),
      { timeout: 12_000 },
    );

    // The save button may sit below the visible area of the drawer, so use
    // the same scrollIntoView + .click() approach as clickDrawZoneBtn.
    const clicked = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="button-draw-zone-save"]',
      ) as HTMLElement | null;
      if (!el) return false;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.click();
      return true;
    });
    if (!clicked) throw new Error("button-draw-zone-save not found in DOM");

    const zoneResponse = await zoneResponseP;

    // Verify the request body shape.
    const body = zoneResponse.request().postDataJSON() as {
      name?: string;
      polygonPoints?: Array<{ x: number; y: number }>;
      pxPerFoot?: number;
    };
    expect(body.name).toBe("Detail Inset A");
    expect(body.pxPerFoot).toBe(24);
    expect(Array.isArray(body.polygonPoints)).toBe(true);
    expect(body.polygonPoints!.length).toBe(4);
    for (const pt of body.polygonPoints!) {
      expect(typeof pt.x).toBe("number");
      expect(typeof pt.y).toBe("number");
    }

    // After a successful save the CalibrationZonesPanel must show the new
    // zone row.  The row's test-id is `calibration-zone-row-{id}` — extract
    // the id from the JSON response so we can assert the exact element.
    const created = (await zoneResponse.json()) as { id?: string };
    expect(created.id).toBeTruthy();
    await expect(
      page.locator(`[data-testid="calibration-zone-row-${created.id}"]`),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("closing the polygon by clicking near the first vertex (snap-to-close) also shows the save form", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await openCalibrationDrawer(page);

    await clickDrawZoneBtn(page);
    await expect(page.getByTestId("draw-zone-active-banner")).toBeVisible({
      timeout: 4_000,
    });

    const cvs = canvas(page);
    await expect(cvs).toBeVisible({ timeout: 10_000 });

    // Place 3 vertices.
    await konvaZoneClick(page, cvs, 300, 200);
    await konvaZoneClick(page, cvs, 400, 200);
    await konvaZoneClick(page, cvs, 400, 300);

    // Click very close to the first vertex to trigger snap-to-close.
    //
    // Why this reliably triggers snap-close:
    //   • The 1×1 px test-plan auto-fits to stageScale = MAX_SCALE = 10.
    //   • Canvas-relative pixel (305, 200) is 5 px right of the first click
    //     (300, 200) in screen space.
    //   • At stageScale=10 that is 5/10 = 0.5 world units apart.
    //   • `isNearFirstVertex` threshold = ZONE_CLOSE_THRESHOLD_PX / stageScale
    //     = 15 / 10 = 1.5 world units.
    //   • 0.5 < 1.5 → snap fires, the polygon closes, the save form appears.
    //
    // No fallback: if snap-to-close is broken this test must fail.
    await konvaZoneClick(page, cvs, 305, 200);

    await expect(page.getByTestId("draw-zone-save-form")).toBeVisible({
      timeout: 6_000,
    });
  });

  test("discarding the pending polygon returns to idle state", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await openCalibrationDrawer(page);

    await clickDrawZoneBtn(page);

    const cvs = canvas(page);
    await expect(cvs).toBeVisible({ timeout: 10_000 });

    // Place vertices and close via double-click.
    await konvaZoneClick(page, cvs, 200, 150);
    await konvaZoneClick(page, cvs, 350, 150);
    await konvaZoneClick(page, cvs, 350, 280);
    await konvaZoneDblClick(page, cvs, 350, 280);

    await expect(page.getByTestId("draw-zone-save-form")).toBeVisible({
      timeout: 6_000,
    });

    // Click Discard — the form should disappear and the draw button reappears.
    // The discard button may be below the viewport; use the same pattern as
    // clickDrawZoneBtn to bypass Playwright's visible-in-viewport requirement.
    const discarded = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="button-draw-zone-cancel-save"]',
      ) as HTMLElement | null;
      if (!el) return false;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.click();
      return true;
    });
    if (!discarded) throw new Error("button-draw-zone-cancel-save not found in DOM");

    await expect(page.getByTestId("button-draw-zone-polygon")).toBeVisible({
      timeout: 4_000,
    });
    await expect(page.getByTestId("draw-zone-save-form")).toHaveCount(0);
  });
});
