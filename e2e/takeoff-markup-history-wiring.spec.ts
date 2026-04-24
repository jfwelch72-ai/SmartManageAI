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
 *
 * Task #1823 extends this spec with the two corners of the same wiring
 * that previously had only unit-level coverage:
 *
 *   3. **Redo** — `button-redo` in `TakeoffToolbar` and the
 *      Ctrl+Y / Ctrl+Shift+Z bindings in `use-takeoff-interactions.ts`
 *      both forward to `takeoffHistory.redo()`. The redo half of
 *      `useTakeoffHistory` is unit-tested but a broken sidebar binding
 *      or a missing keyboard handler would silently ship without an
 *      end-to-end check. Two new scenarios drag, undo, then redo via
 *      each binding and assert the markup ends up back at the dragged
 *      location.
 *   4. **Multi-select body drag** — `commitMarkupBodyDrag` has a
 *      separate branch (Task #1752) that batches a multi-selection
 *      through `bulkUpdateMarkupsMutation` and pushes a single
 *      `MARKUP_UPDATE_BATCH` history entry only after the bulk PATCH
 *      resolves (Task #1759). The bulk mutation contract is unit-
 *      tested, but nothing previously proved that an actual two-markup
 *      Shift+click group drag round-trips back through Undo. The new
 *      scenario seeds two HIGHLIGHTs, multi-selects via Shift+click,
 *      drags the group, and asserts both members snap back when the
 *      sidebar Undo replays the bulk batch.
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
    throw new Error(
      `Markup create failed (${res.status()}): ${await res.text()}`,
    );
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

async function clickSidebarRedo(page: Page) {
  // Mirrors `clickSidebarUndo`: the sidebar Redo button
  // (`TakeoffToolbar.tsx`, `button-redo`) is a `TinyBtn` wrapped in a
  // shadcn `<Tooltip>` whose hovering tip can intercept the pointer.
  // After an Undo lands the button transitions from disabled →
  // enabled (its `disabled` prop is `!takeoffHistory.canRedo || isPending`),
  // so we explicitly assert the enabled state to catch a regression
  // that strands the button in `disabled` even though redo is wired —
  // a failure mode the unit tests around `useTakeoffHistory` cannot
  // see because they call `redo()` directly without the toolbar in
  // the loop. `dispatchEvent("click")` then fires the React onClick
  // handler that invokes `takeoffHistory.redo()`.
  const redo = page.getByTestId("button-redo");
  await redo.waitFor({ state: "visible", timeout: 10_000 });
  await expect(redo).toBeEnabled();
  await redo.dispatchEvent("click");
}

async function createSecondHighlightApi(
  page: Page,
  sheetId: string,
  points: { x: number; y: number }[],
): Promise<MarkupResponse> {
  // Multi-select scenarios need a sibling HIGHLIGHT on the same sheet
  // so the body drag drives the `siblingIds.length > 0` branch of
  // `commitMarkupBodyDrag` (the bulk-mutation + MARKUP_UPDATE_BATCH
  // path covered by Tasks #1752 / #1755 / #1759). We seed via the API
  // for the same reason the primary HIGHLIGHT is seeded that way:
  // deterministic placement without relying on the canvas drawing
  // flow.
  return createMarkupApi(page, {
    sheetId,
    tool: "HIGHLIGHT",
    points,
    color: "#10b981",
    thickness: 2,
  });
}

async function shiftClickOnCanvas(
  page: Page,
  point: { x: number; y: number },
) {
  // Shift+click adds a markup to `selectedMarkupIds` instead of
  // replacing the set. The Konva click handler in TakeoffWorkspace
  // reads the modifier off `window.event.shiftKey` (see Task #1736),
  // so the modifier must be physically held through the native click
  // dispatch — `mouse.click({ modifiers: ["Shift"] })` is not enough
  // because Playwright issues a synthetic-only modifier overlay that
  // doesn't propagate to `window.event` for Konva's listener.
  // Mirrors the plan-side `plan-markup-group-drag.spec.ts` pattern.
  const box = await canvasLocator(page).boundingBox();
  if (!box) throw new Error("Konva canvas has no bounding box");
  await page.keyboard.down("Shift");
  try {
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Shift");
  }
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

  // Task #1823 — Redo wiring (sidebar button half).
  test("Sidebar Redo restores the dragged markup after Undo of a body drag", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markup, initialPoints, centroid } = await seedWorkspace(
      page,
      Date.now() + 2,
    );

    await selectMarkup(page, centroid);

    // Drag the body by a known delta and snapshot the post-drag points
    // returned by the server. We assert against this exact payload after
    // Redo so the test catches a regression where Redo replays the wrong
    // snapshot (e.g. the `before` instead of the `after`).
    const dragEnd = {
      x: centroid.x + BODY_DRAG_DELTA.dx,
      y: centroid.y + BODY_DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, centroid, dragEnd, browserName);
    await waitForPointsToChange(page, sheetId, markup.id, initialPoints);
    const afterDrag = await listMarkups(page, sheetId);
    const draggedPoints = afterDrag.find((m) => m.id === markup.id)!.points;
    // Sanity: every point should have moved (body drag translates all
    // points by the same delta). If only one moved, we accidentally
    // routed through the resize path and the rest of the assertion
    // would still pass for the wrong reason.
    expect(draggedPoints[0]).not.toEqual(initialPoints[0]);
    expect(draggedPoints[1]).not.toEqual(initialPoints[1]);

    // Undo first so there's something on the redo stack. We use the
    // sidebar Undo so the round trip exercises the same toolbar wiring
    // covered by the original #1761 scenario above.
    await clickSidebarUndo(page);
    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      initialPoints,
      "expected sidebar Undo to restore the markup's original points before Redo",
    );

    // Now Redo via the sidebar button. If the `button-redo` onClick
    // ever drops the `takeoffHistory.redo()` call (the wiring this
    // test guards), the markup will not move forward and the
    // `waitForPointsToMatch` below will time out. The exact-match
    // assertion against `draggedPoints` (not just "different from
    // initial") also catches a regression where Redo replays a stale
    // or wrong snapshot.
    await clickSidebarRedo(page);
    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      draggedPoints,
      "expected sidebar Redo to restore the dragged-to points after Undo",
    );
  });

  // Task #1823 — Redo wiring (Ctrl+Y keyboard half). The bubble-phase
  // handler in `use-takeoff-interactions.ts` matches both `Ctrl+Y` and
  // `Ctrl+Shift+Z`; we assert the `Ctrl+Y` form here because that is
  // the canonical Windows redo binding the toolbar tooltip advertises
  // (`Redo (Ctrl+Y)`). A separate assertion of `Ctrl+Shift+Z` would
  // exercise the same handler line and would not add coverage.
  test("Ctrl+Y restores the dragged markup after Ctrl+Z of a body drag", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { sheetId, markup, initialPoints, centroid } = await seedWorkspace(
      page,
      Date.now() + 3,
    );

    await selectMarkup(page, centroid);

    const dragEnd = {
      x: centroid.x + BODY_DRAG_DELTA.dx,
      y: centroid.y + BODY_DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, centroid, dragEnd, browserName);
    await waitForPointsToChange(page, sheetId, markup.id, initialPoints);
    const afterDrag = await listMarkups(page, sheetId);
    const draggedPoints = afterDrag.find((m) => m.id === markup.id)!.points;

    // Ctrl+Z first to populate the redo stack (the global keyboard
    // handler is mounted by `useTakeoffInteractions` and routes to
    // `takeoffHistory.undo()`).
    await page.keyboard.press("Control+z");
    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      initialPoints,
      "expected Ctrl+Z to restore the markup's original points before Redo",
    );

    // Ctrl+Y → `takeoffHistory.redo()` → re-issues the markup PATCH
    // with the dragged-to points. If the keyboard binding regresses
    // (e.g. the `key === 'y'` arm is dropped or the `event.preventDefault()`
    // ordering swallows the dispatch) the `waitForPointsToMatch` below
    // will time out.
    await page.keyboard.press("Control+y");
    await waitForPointsToMatch(
      page,
      sheetId,
      markup.id,
      draggedPoints,
      "expected Ctrl+Y to restore the dragged-to points after Ctrl+Z",
    );
  });

  // Task #1823 — Multi-select group drag → Undo round trip. Drives the
  // `siblingIds.length > 0` branch of `commitMarkupBodyDrag`: a single
  // `bulkUpdateMarkupsMutation.mutateAsync` PATCH carries both members
  // (Task #1752), and a single `MARKUP_UPDATE_BATCH` history entry is
  // pushed only after the bulk PATCH resolves (Task #1759). The undo
  // path replays `applyMarkupBatchSnapshots` against the bulk endpoint
  // (Task #1764), restoring every member's pre-drag points in one
  // round-trip. If any link in that chain breaks — the bulk PATCH
  // fails, the batch history entry is skipped, or the undo fan-out
  // misses a sibling — at least one of the two `waitForPointsToMatch`
  // assertions below times out.
  test("Sidebar Undo restores both markups after a multi-select group drag", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);

    // Seed the first HIGHLIGHT through `seedWorkspace`, then add a
    // second one on the same sheet via the API. Placing the second
    // HIGHLIGHT to the right of the first leaves a clean 60 px gutter
    // between their bounding boxes so a click on either centroid never
    // accidentally lands inside the other.
    await devLogin(page, "ADMIN");
    const { sheetId, markup: markupA, initialPoints: pointsA, centroid: centroidA } =
      await seedWorkspace(page, Date.now() + 4);

    const POINTS_B: { x: number; y: number }[] = [
      { x: 480, y: 220 },
      { x: 620, y: 320 },
    ];
    const CENTROID_B = {
      x: (POINTS_B[0].x + POINTS_B[1].x) / 2,
      y: (POINTS_B[0].y + POINTS_B[1].y) / 2,
    };
    const markupB = await createSecondHighlightApi(page, sheetId, POINTS_B);

    // The seeded sheet was loaded *before* markup B was POSTed, so
    // React-Query's cached markup list is missing it. Refetching by
    // navigating away and back would reset other state; the cleanest
    // fix is to invalidate the cached list via a reload, which
    // triggers a fresh GET on mount.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(".konvajs-content canvas")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    // Click markup A (selects it alone — properties panel opens with
    // "Edit markup" header), then Shift+click markup B to extend the
    // selection. The header flipping to "Edit 2 markups" is the
    // canonical signal that `selectedMarkupIds.size === 2`, and is
    // what gates the body drag onto the multi-select branch.
    await selectMarkup(page, centroidA);
    await shiftClickOnCanvas(page, CENTROID_B);
    await expect(page.getByTestId("text-markup-edit-header")).toHaveText(
      "Edit 2 markups",
      { timeout: 10_000 },
    );
    // Give Konva one extra frame to flush the second member's
    // `name="markup-drag-member-..."` Group prop so `onBodyDragStart`
    // can find it via `layer.findOne(...)`. Without this the group
    // drag occasionally falls back to a single-markup commit on
    // slower machines.
    await page.waitForTimeout(150);

    // Drag markup A's body. The dragged Group is markup A; markup B
    // is translated imperatively in `onBodyDragMove` by the same dx/dy
    // and committed through the bulk PATCH branch.
    const dragEnd = {
      x: centroidA.x + BODY_DRAG_DELTA.dx,
      y: centroidA.y + BODY_DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, centroidA, dragEnd, browserName);

    // Wait until both members report moved points on the server. We
    // poll the *list* (not just one markup) so we never race the bulk
    // PATCH lands → cache invalidates → fresh GET arrives sequence.
    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, sheetId);
          const a = list.find((m) => m.id === markupA.id);
          const b = list.find((m) => m.id === markupB.id);
          if (!a || !b) return null;
          return { a: a.points, b: b.points };
        },
        {
          message:
            "expected the bulk group-drag PATCH to land for both selected markups",
          timeout: 15_000,
        },
      )
      .not.toEqual({ a: pointsA, b: POINTS_B });

    // Sanity: both members must have translated by the same delta.
    // This catches a regression where the bulk PATCH accidentally
    // applies a per-markup transform (e.g. each member moved to the
    // same absolute position) instead of a uniform translate.
    const afterDrag = await listMarkups(page, sheetId);
    const aMoved = afterDrag.find((m) => m.id === markupA.id)!;
    const bMoved = afterDrag.find((m) => m.id === markupB.id)!;
    const aDx = aMoved.points[0].x - pointsA[0].x;
    const aDy = aMoved.points[0].y - pointsA[0].y;
    const bDx = bMoved.points[0].x - POINTS_B[0].x;
    const bDy = bMoved.points[0].y - POINTS_B[0].y;
    expect(aDx).toBeCloseTo(bDx, 1);
    expect(aDy).toBeCloseTo(bDy, 1);
    // Both members must have actually moved (>0 delta) — guards
    // against a no-op PATCH that would still satisfy the equality
    // check above with zeros.
    expect(Math.abs(aDx) + Math.abs(aDy)).toBeGreaterThan(0);

    // Click the sidebar Undo. The single `MARKUP_UPDATE_BATCH` entry
    // for the gesture replays via `applyMarkupBatchSnapshots`, which
    // (Task #1764) collapses into one bulk PATCH back to the
    // pre-drag points.
    await clickSidebarUndo(page);

    // Both members must snap back. We assert each one separately so
    // the failure message identifies which side of the batch broke.
    await waitForPointsToMatch(
      page,
      sheetId,
      markupA.id,
      pointsA,
      "expected sidebar Undo to restore markup A's pre-group-drag points",
    );
    await waitForPointsToMatch(
      page,
      sheetId,
      markupB.id,
      POINTS_B,
      "expected sidebar Undo to restore markup B's pre-group-drag points",
    );
  });

  // Task #1859 — Multi-select group drag → Undo → Redo round trip. The
  // sibling test above proves the Undo half of the
  // `MARKUP_UPDATE_BATCH` history entry (`markupBatchBefore` replayed
  // through the bulk PATCH endpoint). The Redo half —
  // `applyMarkupBatchSnapshots(entry.markupBatchAfter)` in
  // `useTakeoffHistory.redo` — has only unit-level coverage, so a
  // regression that swapped `markupBatchAfter` for `markupBatchBefore`
  // (or dropped the bulk fan-out for the redo path) would not fail the
  // existing e2e suite. This scenario drags the group, Undoes it, then
  // Redoes it via the sidebar button and asserts both members land
  // back at the post-drag positions.
  test("Sidebar Redo restores both markups after Undo of a multi-select group drag", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);

    await devLogin(page, "ADMIN");
    const { sheetId, markup: markupA, initialPoints: pointsA, centroid: centroidA } =
      await seedWorkspace(page, Date.now() + 5);

    const POINTS_B: { x: number; y: number }[] = [
      { x: 480, y: 220 },
      { x: 620, y: 320 },
    ];
    const CENTROID_B = {
      x: (POINTS_B[0].x + POINTS_B[1].x) / 2,
      y: (POINTS_B[0].y + POINTS_B[1].y) / 2,
    };
    const markupB = await createSecondHighlightApi(page, sheetId, POINTS_B);

    // Mirror the sibling Undo test: refetch via reload so the cached
    // markup list picks up markup B (created after first mount).
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(".konvajs-content canvas")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    await selectMarkup(page, centroidA);
    await shiftClickOnCanvas(page, CENTROID_B);
    await expect(page.getByTestId("text-markup-edit-header")).toHaveText(
      "Edit 2 markups",
      { timeout: 10_000 },
    );
    // Same one-frame wait as the Undo sibling so Konva flushes the
    // `name="markup-drag-member-..."` Group prop on the second member
    // before the drag begins.
    await page.waitForTimeout(150);

    // Drag the group by a known delta and snapshot the post-drag
    // positions returned by the server. Redo must replay these *exact*
    // points (the `markupBatchAfter` snapshots) — asserting equality
    // against this payload (rather than just "not equal to original")
    // is what catches a regression where the redo branch accidentally
    // replays `markupBatchBefore`.
    const dragEnd = {
      x: centroidA.x + BODY_DRAG_DELTA.dx,
      y: centroidA.y + BODY_DRAG_DELTA.dy,
    };
    await dragOnCanvas(page, centroidA, dragEnd, browserName);

    await expect
      .poll(
        async () => {
          const list = await listMarkups(page, sheetId);
          const a = list.find((m) => m.id === markupA.id);
          const b = list.find((m) => m.id === markupB.id);
          if (!a || !b) return null;
          return { a: a.points, b: b.points };
        },
        {
          message:
            "expected the bulk group-drag PATCH to land for both selected markups",
          timeout: 15_000,
        },
      )
      .not.toEqual({ a: pointsA, b: POINTS_B });

    const afterDrag = await listMarkups(page, sheetId);
    const aDragged = afterDrag.find((m) => m.id === markupA.id)!.points;
    const bDragged = afterDrag.find((m) => m.id === markupB.id)!.points;
    // Sanity: the drag must have translated every point on every
    // member (not just one corner of one shape). If the gesture
    // accidentally routed through the resize path or only committed
    // the dragged-Group's points, the Redo assertion below could
    // pass for the wrong reason.
    expect(aDragged[0]).not.toEqual(pointsA[0]);
    expect(aDragged[1]).not.toEqual(pointsA[1]);
    expect(bDragged[0]).not.toEqual(POINTS_B[0]);
    expect(bDragged[1]).not.toEqual(POINTS_B[1]);

    // Undo first so there's a `MARKUP_UPDATE_BATCH` entry on the redo
    // stack. We use the sidebar Undo so the round trip exercises the
    // same toolbar wiring covered by the sibling Undo test above.
    await clickSidebarUndo(page);
    await waitForPointsToMatch(
      page,
      sheetId,
      markupA.id,
      pointsA,
      "expected sidebar Undo to restore markup A's pre-group-drag points before Redo",
    );
    await waitForPointsToMatch(
      page,
      sheetId,
      markupB.id,
      POINTS_B,
      "expected sidebar Undo to restore markup B's pre-group-drag points before Redo",
    );

    // Now Redo via the sidebar button. The redo branch of
    // `MARKUP_UPDATE_BATCH` calls
    // `applyMarkupBatchSnapshots(entry.markupBatchAfter)`, which fans
    // back out through the bulk PATCH endpoint to restore the
    // post-drag points for *every* member. If the redo branch ever
    // replays `markupBatchBefore` (no-op against the pre-drag state)
    // or drops the bulk fan-out (only one member moves), at least one
    // of the two `waitForPointsToMatch` assertions below will time
    // out. The exact-payload match against the captured `aDragged` /
    // `bDragged` (rather than "not equal to pre-drag") is the
    // assertion that catches a snapshot-swap regression.
    await clickSidebarRedo(page);

    await waitForPointsToMatch(
      page,
      sheetId,
      markupA.id,
      aDragged,
      "expected sidebar Redo to restore markup A's post-group-drag points",
    );
    await waitForPointsToMatch(
      page,
      sheetId,
      markupB.id,
      bDragged,
      "expected sidebar Redo to restore markup B's post-group-drag points",
    );
  });
});
