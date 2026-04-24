/**
 * Task #1741 — End-to-end browser coverage for the takeoff-side markup
 * body-drag Undo (Task #1724).
 *
 * Sibling to `plan-markup-group-drag.spec.ts` (Task #1707), which exercises
 * the project-side group-drag undo. Unit tests already cover the wiring on
 * `<PlanMarkupToolbar />` (`PlanMarkupToolbar.undo.test.tsx`), but nothing
 * proves end-to-end that the takeoff workspace's body-drag pipeline
 * (TakeoffWorkspace.onBodyDragEnd → setLastMarkupMoveSnapshot →
 * undoLastMarkupMove) actually round-trips through the global Cmd/Ctrl+Z
 * handler.
 *
 * Scenario:
 *   - Drag a takeoff markup, hit Ctrl+Z, assert the markup snaps back.
 *
 * Note (Task #1822): The original spec also covered an in-popover Undo
 * button click. Task #1742 routed markup body moves through the unified
 * `useTakeoffHistory` stack and *removed* the `onUndoLastMove` prop the
 * takeoff workspace used to forward to its embedded `<PlanMarkupToolbar>`;
 * the popover Undo button (`button-markup-undo-move`) is therefore no
 * longer rendered inside the takeoff workspace, so that scenario was
 * deleted. The equivalent sidebar Undo button click is covered by
 * `takeoff-markup-history-wiring.spec.ts` (Task #1761).
 *
 * Markups are seeded via the API so the test is deterministic and does not
 * depend on the canvas drawing flow already covered by
 * `takeoff-markup-drawing.spec.ts`.
 *
 * Cross-engine coverage (Task #1822): the Playwright config declares
 * `chromium`, `firefox`, and `webkit` projects and the CI workflow runs
 * `npm run test:e2e` (which fans out across all three) on Ubuntu where the
 * required system libraries are present.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import {
  clickOnCanvas as clickOnCanvasHelper,
  dragOnCanvas as dragOnCanvasHelper,
  type DragOptions,
  type Point,
} from "./helpers/canvasDrag";

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
    throw new Error(`Markup create failed (${res.status()}): ${await res.text()}`);
  }
  return (await res.json()) as MarkupResponse;
}

function canvasLocator(page: Page) {
  return page.locator(".konvajs-content canvas").first();
}

async function clickOnCanvas(page: Page, point: Point) {
  await clickOnCanvasHelper(page, canvasLocator(page), point);
}

async function dragOnCanvas(
  page: Page,
  start: Point,
  end: Point,
  browserName: string,
  options: DragOptions = {},
) {
  await dragOnCanvasHelper(
    page,
    canvasLocator(page),
    start,
    end,
    browserName,
    options,
  );
}

interface SeededWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
  markup: MarkupResponse;
  initialPoints: { x: number; y: number }[];
  centroid: { x: number; y: number };
}

// HIGHLIGHT renders as a filled `Rect` (see MarkupRenderer.tsx) with opacity
// 0.35, so a click anywhere inside its bounding box reliably hits the body
// — a much more robust selection target than the stroke-only RECTANGLE/ARROW
// shapes.
const HIGHLIGHT_POINTS: { x: number; y: number }[] = [
  { x: 240, y: 220 },
  { x: 380, y: 320 },
];
const HIGHLIGHT_CENTROID = {
  x: (HIGHLIGHT_POINTS[0].x + HIGHLIGHT_POINTS[1].x) / 2,
  y: (HIGHLIGHT_POINTS[0].y + HIGHLIGHT_POINTS[1].y) / 2,
};
const DRAG_DELTA = { dx: 90, dy: 60 };

async function seedWorkspace(page: Page, suffix: number): Promise<SeededWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Markup Undo Bid ${suffix}`,
      clientName: "PW Markup Undo Client",
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
        fileUrl: "https://example.com/markup-undo-plan.pdf",
        fileName: "Markup Undo Sheet",
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
  // (`Navigate the plan` → `Calibrate first` → …) the first time a user
  // opens any bid Plans surface; the resulting modal blocks the canvas
  // so neither `clickOnCanvas` nor `dragOnCanvas` would land inside the
  // markup body. Joyride's buttons don't expose stable test ids, so
  // we suppress the tour by setting its localStorage completion key
  // (`bid-plans-tour-completed-<userId>`) before the workspace mounts.
  // Mirrors the production "user already saw the tour" path so the
  // suppression isn't a brittle UI workaround.
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  // /api/auth/me returns `{ user: {...}, organizationName, organizationOnboardingStatus }`
  // — the user object lives one level deep, so reach in for the id.
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;

  // Pre-select the sheet via sessionStorage so the workspace mounts
  // with a Stage on the very first render (mirrors the drawing spec).
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

  // Wait for the Konva Stage to materialize.
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
  // Default activeTool is "select" (TakeoffWorkspace.tsx:93), so a click on
  // the HIGHLIGHT body sets `selectedMarkupIds` to `{ markupId }` and
  // re-renders the Konva Group with `draggable: true`. Wait briefly so the
  // re-render lands before we issue the drag mousedown.
  await clickOnCanvas(page, centroid);
  // The properties edit panel opens for single-select; its presence is the
  // canonical signal that selection took effect.
  await page
    .getByTestId("panel-markup-properties")
    .waitFor({ state: "visible", timeout: 10_000 });
  // Give React one extra frame to flush the `draggable: true` re-render.
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
        // Compare the first point — body drag translates every point by
        // the same delta, so the first point alone is a sufficient
        // change-detector.
        return { x: m.points[0].x, y: m.points[0].y };
      },
      {
        message: "expected body-drag PATCH to land for the takeoff markup",
        timeout: 15_000,
      },
    )
    .not.toEqual({ x: initial[0].x, y: initial[0].y });
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

// Disable Playwright video capture for this spec at the file level — the
// Replit container doesn't ship ffmpeg by default and the suite-wide
// retention setting would fail the test before any assertion runs.
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff markup body-drag undo - Task #1741", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("Ctrl+Z restores the markup to its original points after a body drag", async ({
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
    // origin; on dragEnd the workspace snapshots the pre-move points
    // and fires `updateMarkupMutation`.
    const dragEnd = {
      x: centroid.x + DRAG_DELTA.dx,
      y: centroid.y + DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, centroid, dragEnd, browserName);

    // Wait until the forward PATCH actually lands on the server.
    await waitForPointsToChange(page, sheetId, markup.id, initialPoints);

    // The global Cmd/Ctrl+Z handler is mounted only when
    // `lastMarkupMoveSnapshot` is non-null, which is set synchronously
    // in onBodyDragEnd. The PATCH-landed wait above gives React a few
    // hundred ms to flush the listener-attaching useEffect.
    await page.keyboard.press("Control+z");

    // Undo re-issues `updateMarkupMutation` with the captured pre-move
    // points; assert the markup actually round-trips back via the API.
    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      initialPoints,
      "expected Ctrl+Z to restore the markup's original points",
    );
  });

  // Note (Task #1822): the original "Popover Undo button restores the
  // markup after a body drag" scenario was removed because Task #1742
  // dropped the `onUndoLastMove` prop the takeoff workspace used to
  // forward to its embedded `<PlanMarkupToolbar>` — `button-markup-undo-move`
  // no longer renders inside the takeoff popover. The sidebar Undo button
  // click that replaced it is covered by
  // `takeoff-markup-history-wiring.spec.ts`.
});
