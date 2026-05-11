/**
 * Shared helpers for zone-polygon drawing e2e tests.
 *
 * These utilities dispatch raw MouseEvents directly on the Konva canvas element
 * (bypassing Playwright's normal locator click path) because:
 *
 *   1. The calibration drawer renders DOM overlays inside the Konva stage
 *      container.  `page.mouse.down()` / `locator.dispatchEvent` both hit
 *      the topmost DOM element at the viewport coordinate — which may be the
 *      overlay, not the canvas — so Konva never receives the pointer event.
 *
 *   2. Playwright's `locator.dispatchEvent` serialises the init dict over the
 *      CDP bridge and does NOT inject `view: window`, causing Konva's
 *      `getPointerPosition()` to read zero coordinates (every vertex lands at
 *      world (0,0) and snap-close fires immediately on the 4th click).
 *
 *   Using `page.evaluate` with `view: window` ensures correct clientX/clientY
 *   and bubbles through the Konva stage listeners.
 *
 * ---
 * KONVA PRIVATE-API DEPENDENCY
 * ---
 * `window.Konva._mouseInDblClickWindow` is an *internal* flag in Konva v9.
 * It is NOT part of the public API.  If a Konva upgrade removes or renames it:
 *   1. Search the new Konva source for `_mouseInDblClickWindow`.
 *   2. Update the `page.evaluate` calls in `konvaZoneClick` and
 *      `konvaZoneDblClick` to use the renamed flag (or the new mechanism).
 *
 * Without the reset in `konvaZoneClick`, Konva's 400 ms double-click window
 * stays open between synthetic single-clicks, causing every mouseup after the
 * first to fire a spurious `pointerdblclick` → zone close.
 */

import type { Locator, Page } from "@playwright/test";

// Extend the browser's Window so page.evaluate references are fully typed.
declare global {
  interface Window {
    /** Konva v9 global — present after the bundle loads via _injectGlobal. */
    Konva?: { _mouseInDblClickWindow: boolean };
  }
}

/** Dispatch a single synthetic MouseEvent on the Konva canvas element. */
async function dispatchKonvaMouseEvent(
  page: Page,
  type: "mousedown" | "mouseup",
  clientX: number,
  clientY: number,
  buttons: number,
): Promise<void> {
  await page.evaluate(
    ({ t, cx, cy, btns }) => {
      const canvas = document.querySelector(
        ".konvajs-content canvas",
      ) as HTMLElement | null;
      if (!canvas) throw new Error("konvajs canvas not found");
      canvas.dispatchEvent(
        new MouseEvent(t, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: btns,
          clientX: cx,
          clientY: cy,
        }),
      );
    },
    { t: type, cx: clientX, cy: clientY, btns: buttons },
  );
}

/**
 * Place a single zone vertex at (`relX`, `relY`) relative to the canvas.
 *
 * After the mouseup, resets `Konva._mouseInDblClickWindow` so that rapid
 * successive calls do not trigger a spurious double-click close.
 */
export async function konvaZoneClick(
  page: Page,
  cvs: Locator,
  relX: number,
  relY: number,
): Promise<void> {
  const box = await cvs.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box for konvaZoneClick");
  const clientX = box.x + relX;
  const clientY = box.y + relY;

  await dispatchKonvaMouseEvent(page, "mousedown", clientX, clientY, 1);
  await page.waitForTimeout(50);
  await dispatchKonvaMouseEvent(page, "mouseup", clientX, clientY, 0);

  // Reset Konva's dblclick-window flag so the next single-click doesn't
  // accidentally fire onDblClick.  See file-level comment for upgrade notes.
  await page.evaluate(() => {
    if (window.Konva) window.Konva._mouseInDblClickWindow = false;
  });
  await page.waitForTimeout(50);
}

/**
 * Double-click the canvas at (`relX`, `relY`) to close the zone polygon.
 *
 * Konva v9 detects double-clicks by watching for *two rapid mousedown→mouseup
 * pairs*.  The second mouseup checks `Konva._mouseInDblClickWindow` (set to
 * `true` on the first mouseup) and fires `pointerdblclick` → `onDblClick`.
 *
 * Both mousedowns also fire `onMouseDown` → `handleZoneCanvasClick`, appending
 * a vertex each time.  `handleZoneCanvasDblClick` compensates by slicing the
 * last two off before calling `applyZoneDblClick` — so the final vertex count
 * equals the number of intentional `konvaZoneClick` calls.
 *
 *   N konvaZoneClicks → N points in state
 *   konvaZoneDblClick → mousedown×2 adds 2 → state has N+2
 *                       second mouseup fires onDblClick
 *                       handler slices -2 → applyZoneDblClick(N pts) ✓
 */
export async function konvaZoneDblClick(
  page: Page,
  cvs: Locator,
  relX: number,
  relY: number,
): Promise<void> {
  const box = await cvs.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box for konvaZoneDblClick");
  const clientX = box.x + relX;
  const clientY = box.y + relY;

  // First click: mousedown → mouseup.
  // Konva's _pointerup: _mouseInDblClickWindow=false → sets it to true,
  // starts 400 ms timer.  No pointerdblclick yet.
  await dispatchKonvaMouseEvent(page, "mousedown", clientX, clientY, 1);
  await page.waitForTimeout(30);
  await dispatchKonvaMouseEvent(page, "mouseup", clientX, clientY, 0);
  await page.waitForTimeout(30);

  // Second click: mousedown → mouseup.
  // Konva's _pointerup: _mouseInDblClickWindow=true → fires pointerdblclick
  // → onDblClick → handleZoneCanvasDblClick.
  await dispatchKonvaMouseEvent(page, "mousedown", clientX, clientY, 1);
  await page.waitForTimeout(30);
  await dispatchKonvaMouseEvent(page, "mouseup", clientX, clientY, 0);
  await page.waitForTimeout(50);
}
