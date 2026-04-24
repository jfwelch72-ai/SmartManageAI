/**
 * Task #1761 — End-to-end coverage for the *full* takeoff markup history
 * wiring.
 *
 * Sibling to `takeoff-markup-undo.spec.ts` (Task #1741), which covers the
 * body-drag → Ctrl+Z and body-drag → popover Undo paths. Task #1757 lifted
 * the markup commit logic out of `TakeoffWorkspace.tsx` into the pure
 * `commitMarkupBodyDrag` / `commitMarkupResize` helpers and added unit
 * coverage for the mutation contract (the `previous: { points }` payload
 * that lets `updateMarkupMutation.onSuccess` push a `MARKUP_UPDATE` history
 * entry). What that work *cannot* prove is the user-visible round trip:
 *
 *   1. The TakeoffToolbar sidebar Undo button (`button-undo`) is wired to
 *      `takeoffHistory.undo()` and that an actual click on it pops the
 *      stack and re-issues the `previous` PATCH so the markup snaps back.
 *   2. The resize-handle path (`commitMarkupResize`) actually lands on the
 *      `useTakeoffHistory` stack and `Cmd/Ctrl+Z` (the
 *      `useTakeoffInteractions` keyboard handler) reverses the resize.
 *
 * Together with the existing `takeoff-markup-undo.spec.ts` body-drag
 * scenarios, this spec closes the remaining gap called out in #1761:
 * sidebar-button binding + resize-handle history + bubble-phase keyboard
 * handler are now exercised end-to-end.
 *
 * The seeding flow (HIGHLIGHT markup created via the API, sheet
 * pre-selected via sessionStorage, bid-plans tour suppressed via
 * localStorage) is intentionally identical to the sibling spec so any
 * future refactor of the workspace bootstrap only needs one mental model.
 */
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
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function listMarkups(
  page: Page,
  sheetId: string,
): Promise<MarkupResponse[]> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/markups`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as MarkupResponse[];
}

async function createMarkupApi(
  page: Page,
  body: {
    sheetId: string;
    tool: string;
    points: { x: number; y: number }[];
    color: string;
    thickness: number;
  },
): Promise<MarkupResponse> {
  const res = await page.request.post(`${BASE_URL}/api/takeoff/markups`, {
    data: body,
  });
  if (res.status() !== 201) {
    throw new Error(
      `Markup create failed (${res.status()}): ${await res.text()}`,
    );
  }
  return (await res.json()) as MarkupResponse;
}

async function getCanvasBox(page: Page) {
  const canvas = page.locator(".konvajs-content canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Konva canvas has no bounding box");
  return box;
}

async function clickOnCanvas(page: Page, point: { x: number; y: number }) {
  const box = await getCanvasBox(page);
  // Two move calls so WebKit reliably dispatches the initial mousemove
  // before the click sequence — mirrors the helper in
  // takeoff-markup-drawing.spec.ts / takeoff-markup-undo.spec.ts.
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
}

async function dragOnCanvas(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  browserName: string,
) {
  // WebKit / Firefox dispatch synthetic mousemoves less aggressively than
  // Chromium, so bump step counts and waits to keep Konva's drag pipeline
  // deterministic across engines (matches the sibling drawing/undo specs).
  const isChromium = browserName === "chromium";
  const interStep = isChromium ? 4 : 8;
  const finalStep = isChromium ? 12 : 20;
  const interWait = isChromium ? 25 : 50;
  const edgeWait = isChromium ? 60 : 120;

  const box = await getCanvasBox(page);
  const sx = box.x + start.x;
  const sy = box.y + start.y;
  await page.mouse.move(sx, sy);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(edgeWait);
  // Two short pre-moves clear Konva's drag-distance threshold without
  // collapsing into a click.
  await page.mouse.move(sx + 8, sy + 6, { steps: interStep });
  await page.waitForTimeout(interWait);
  await page.mouse.move(sx + 20, sy + 14, { steps: interStep });
  await page.waitForTimeout(interWait);
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: finalStep });
  await page.waitForTimeout(edgeWait);
  await page.mouse.up();
  await page.waitForTimeout(isChromium ? 120 : 200);
}

interface SeededWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
  markup: MarkupResponse;
  initialPoints: { x: number; y: number }[];
  centroid: { x: number; y: number };
}

// HIGHLIGHT renders as a filled `Rect` in MarkupRenderer with opacity
// 0.35, so a click anywhere inside its bounding box reliably hits the
// body — a much more robust selection target than stroke-only shapes.
// Its 2-point representation also makes the bottom-right corner handle
// trivially predictable (`points[1]`), which is exactly the handle we
// drag in the resize scenario below.
const HIGHLIGHT_POINTS: { x: number; y: number }[] = [
  { x: 240, y: 220 },
  { x: 380, y: 320 },
];
const HIGHLIGHT_CENTROID = {
  x: (HIGHLIGHT_POINTS[0].x + HIGHLIGHT_POINTS[1].x) / 2,
  y: (HIGHLIGHT_POINTS[0].y + HIGHLIGHT_POINTS[1].y) / 2,
};
const BODY_DRAG_DELTA = { dx: 90, dy: 60 };
const RESIZE_DRAG_DELTA = { dx: 90, dy: 60 };

async function seedWorkspace(
  page: Page,
  suffix: number,
): Promise<SeededWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Markup History Bid ${suffix}`,
      clientName: "PW Markup History Client",
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
        fileUrl: "https://example.com/markup-history-plan.pdf",
        fileName: "Markup History Sheet",
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  const sheetId = planBody.sheets[0].id;

  // Seed the HIGHLIGHT before the page mounts so the React-Query
  // initial fetch returns it and the Konva Stage renders it on the
  // first frame.
  const markup = await createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points: HIGHLIGHT_POINTS,
    color: "#3b82f6",
    thickness: 2,
  });

  // Look up the current user id so we can pre-mark the bid-plans tour
  // as completed. The TourProvider auto-launches a Joyride walkthrough
  // the first time a user opens any bid Plans surface; the resulting
  // modal blocks the canvas so neither click nor drag would land inside
  // the markup. Mirroring the production "user already saw the tour"
  // path keeps this suppression off the brittle-UI-workaround pile.
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;

  // Pre-select the sheet via sessionStorage so the workspace mounts
  // with a Stage on the very first render.
  await page.goto(`${BASE_URL}/bids/${bidCode}`);
  await page.evaluate(
    ({ sheetKey, sheetVal, tourKey }) => {
      sessionStorage.setItem(sheetKey, sheetVal);
      localStorage.setItem(tourKey, "1");
    },
    {
      sheetKey: `takeoff-sheet-${bidId}`,
      sheetVal: sheetId,
      tourKey: `bid-plans-tour-completed-${userId}`,
    },
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  await page
    .locator(".konvajs-content canvas")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  return {
    bidId,
    bidCode,
    sheetId,
    markup,
    initialPoints: HIGHLIGHT_POINTS,
    centroid: HIGHLIGHT_CENTROID,
  };
}

async function selectMarkup(page: Page, centroid: { x: number; y: number }) {
  // Default activeTool is "select", so clicking on the HIGHLIGHT body
  // sets `selectedMarkupIds` to `{ markupId }` and re-renders the Konva
  // Group with `draggable: true`. The properties edit panel opening is
  // the canonical signal that selection took effect.
  await clickOnCanvas(page, centroid);
  await page
    .getByTestId("panel-markup-properties")
    .waitFor({ state: "visible", timeout: 10_000 });
  // Give React one extra frame to flush the `draggable: true` re-render
  // and the corner-handle Rects (rendered alongside the shape only when
  // `isOnlySelected && tool !== "TEXT"`).
  await page.waitForTimeout(150);
}

async function waitForPointsToChange(
  page: Page,
  sheetId: string,
  markupId: string,
  initial: { x: number; y: number }[],
) {
  await expect
    .poll(
      async () => {
        const list = await listMarkups(page, sheetId);
        const m = list.find((x) => x.id === markupId);
        if (!m) return null;
        // Compare both points so we catch resize *and* body-drag PATCHes
        // — body drag translates every point, resize moves only one.
        return m.points;
      },
      {
        message: "expected the drag PATCH to land for the takeoff markup",
        timeout: 15_000,
      },
    )
    .not.toEqual(initial);
}

async function waitForPointsToMatch(
  page: Page,
  sheetId: string,
  markupId: string,
  expected: { x: number; y: number }[],
  message: string,
) {
  await expect
    .poll(
      async () => {
        const list = await listMarkups(page, sheetId);
        const m = list.find((x) => x.id === markupId);
        if (!m) return null;
        return m.points;
      },
      { message, timeout: 15_000 },
    )
    .toEqual(expected);
}

async function clickSidebarUndo(page: Page) {
  // The sidebar Undo button (`TakeoffToolbar.tsx`, `button-undo`) is a
  // `TinyBtn` wrapped in a shadcn `<Tooltip>`. As soon as a markup is
  // selected the toolbar's Tooltip primitives render their hovering
  // tip; depending on focus order it can land directly on top of the
  // Undo icon, in which case Playwright's actionability check refuses
  // to click. Dispatching `click` directly on the resolved button
  // bypasses the pointer-overlay intercept while still exercising the
  // React `onClick` handler that calls `takeoffHistory.undo()` —
  // which is exactly what we're trying to verify. Same trick the
  // sibling popover-undo spec uses for the in-popover button.
  const undo = page.getByTestId("button-undo");
  await undo.waitFor({ state: "visible", timeout: 10_000 });
  await expect(undo).toBeEnabled();
  await undo.dispatchEvent("click");
}

// Disable Playwright video capture for this spec at the file level — the
// Replit container doesn't ship ffmpeg by default and the suite-wide
// retention setting would fail the test before any assertion runs.
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff markup history wiring - Task #1761", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("Sidebar Undo button restores the markup after a body drag", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markup, initialPoints, centroid } = await seedWorkspace(
      page,
      Date.now(),
    );

    await selectMarkup(page, centroid);

    // Drag the HIGHLIGHT body by a known delta. Konva translates the
    // dragged Group natively while `markupBodyDragRef` captures the
    // origin; on dragEnd `commitMarkupBodyDrag` fires
    // `updateMarkupMutation` with `previous: { points }`, which causes
    // `updateMarkupMutation.onSuccess` to push a `MARKUP_UPDATE` entry
    // onto the shared `useTakeoffHistory` stack.
    const dragEnd = {
      x: centroid.x + BODY_DRAG_DELTA.dx,
      y: centroid.y + BODY_DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, centroid, dragEnd, browserName);

    // Wait until the forward PATCH actually lands on the server so the
    // sidebar Undo button is guaranteed to have an entry to pop.
    await waitForPointsToChange(page, sheetId, markup.id, initialPoints);

    // Click the sidebar Undo (`button-undo` in TakeoffToolbar). If the
    // sidebar binding ever drops `takeoffHistory.undo()` (the wiring
    // this test guards), the markup will not snap back and the
    // `waitForPointsToMatch` below will time out.
    await clickSidebarUndo(page);

    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      initialPoints,
      "expected sidebar Undo to restore the markup's original points",
    );
  });

  test("Ctrl+Z restores the markup after a corner resize-handle drag", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markup, initialPoints, centroid } = await seedWorkspace(
      page,
      Date.now() + 1,
    );

    await selectMarkup(page, centroid);

    // The HIGHLIGHT renders four bounding-box corner handles at the
    // raw point coordinates (see TakeoffWorkspace.tsx — the
    // RECTANGLE/HIGHLIGHT/CLOUD branch of the resize handle render).
    // The bottom-right handle sits exactly at `points[1]`; dragging it
    // by `RESIZE_DRAG_DELTA` triggers `commitMarkupResize` which fires
    // `updateMarkupMutation` with `previous: { points: origPts }` —
    // the contract that makes the resize land on the history stack.
    const brHandle = initialPoints[1];
    const resizeEnd = {
      x: brHandle.x + RESIZE_DRAG_DELTA.dx,
      y: brHandle.y + RESIZE_DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, brHandle, resizeEnd, browserName);

    // Wait until the resize PATCH actually lands. Body-drag translates
    // both points; a corner resize moves only `points[1]`, so we
    // explicitly assert `points[0]` stayed put while `points[1]`
    // moved — this catches the regression where a resize accidentally
    // fans out into a body-drag-style translate.
    await waitForPointsToChange(page, sheetId, markup.id, initialPoints);
    const after = await listMarkups(page, sheetId);
    const movedMarkup = after.find((m) => m.id === markup.id);
    expect(movedMarkup, "resized markup should still exist").toBeTruthy();
    expect(movedMarkup!.points[0]).toEqual(initialPoints[0]);
    expect(movedMarkup!.points[1]).not.toEqual(initialPoints[1]);

    // The bubble-phase Cmd/Ctrl+Z handler in `useTakeoffInteractions`
    // calls `takeoffHistory.undo()`, which pops the resize's
    // MARKUP_UPDATE entry and re-issues the PATCH with the captured
    // pre-resize points. If `commitMarkupResize` ever drops `origPts`
    // (or the keyboard handler is unwired), the markup will not snap
    // back and the `waitForPointsToMatch` below will time out.
    await page.keyboard.press("Control+z");

    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      initialPoints,
      "expected Ctrl+Z to restore the markup's pre-resize points",
    );
  });
});
