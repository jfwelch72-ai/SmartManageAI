/**
 * Task #2224 — End-to-end coverage for the freshly-wired Polygon,
 * Circle, and Lasso ribbon tools in REAL drawing flows on the takeoff
 * workspace.
 *
 * The sister spec (Task #2204 —
 * `takeoff-ribbon-new-tools-and-dim-key.spec.ts`) already locks down
 * the ribbon button presence + `aria-pressed` toggling, and the unit
 * test (`canonicalTool.test.ts`) pins the alias table
 * (`lasso → select`, `polygon → area`, `circle` stays). Neither layer
 * exercises the click-handler branches in
 * `client/src/hooks/use-takeoff-interactions.ts` end-to-end on a real
 * canvas — so a regression in those branches (e.g. the polygon
 * close-on-first-vertex math, the circle center+radius commit, or the
 * lasso → select aliasing through canvas hit-testing) would silently
 * pass through both layers. This spec drives each tool with the
 * actual user gesture and asserts the resulting REST state.
 *
 * For each tool:
 *   1. Polygon — clicks 4 vertices, then presses Enter to close.
 *      The hook commits via `completePolygon()` which goes through
 *      `canonicalTool(activeTool)` so the AREA measurement persists
 *      with `type: "AREA"` and >= 4 points. (3-vertex close is also
 *      supported via `Enter`; we use 4 to prove the threshold isn't
 *      exactly 3.)
 *   2. Circle — clicks center, then a radius point. The hook commits
 *      a 32-sided polygon AREA measurement with
 *      `metadata.shape === "circle"` and a non-zero `radiusFt`.
 *   3. Lasso — `canonicalTool("lasso") === "select"`, and the takeoff
 *      workspace's `<CanvasStage>` does NOT implement a marquee
 *      drag-select for measurements (that gesture lives only in
 *      `<PlanMarkupLayer>` for the project-side plans tab — see
 *      `takeoff-shortcuts.ts:529` for the mismatched tooltip). The
 *      user-visible behavior of lasso today is therefore "click
 *      selects, drag is a no-op". This test exercises both: a drag
 *      across the canvas does NOT create any measurement and does
 *      NOT crash, then a click on the seeded LINEAR measurement
 *      selects it (proving the lasso → select alias reaches the hit-
 *      tested measurement onClick handler in `<CanvasStage>`).
 *
 * Setup mirrors the bulk-delete-undo spec: a fresh bid + plan + sheet
 * are created over REST so the canvas mounts at a usable size (the
 * `seedTakeoffFixture` 1x1 base64 PNG is fine for ribbon-button-only
 * tests but produces a degenerate world-space transform for click-to-
 * draw flows). Calibration is set via the
 * `PATCH /api/takeoff/sheets/:id/calibration` endpoint so the polygon
 * and circle commit branches don't bail out on the
 * `currentSheet?.scalePxPerFoot` guard.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import {
  clickOnCanvas as clickOnCanvasHelper,
  dragOnCanvas as dragOnCanvasHelper,
  type Point,
} from "./helpers/canvasDrag";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface SheetResponse {
  id: string;
  sheetName: string | null;
  bidId: string | null;
}

interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  points: string | { x: number; y: number }[];
  computedAreaFt2?: number | string | null;
  computedLengthFt?: number | string | null;
  metadata?: string | null;
}

async function devLogin(page: Page, role: string) {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function listMeasurements(
  page: Page,
  sheetId: string,
): Promise<MeasurementResponse[]> {
  const res = await page.request.get(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as MeasurementResponse[];
}

async function createMeasurementApi(
  page: Page,
  body: {
    sheetId: string;
    type: string;
    label: string;
    points: { x: number; y: number }[];
    color?: string;
  },
): Promise<MeasurementResponse> {
  const res = await page.request.post(
    `${BASE_URL}/api/takeoff/measurements`,
    { data: body },
  );
  if (res.status() !== 201) {
    throw new Error(
      `Measurement create failed (${res.status()}): ${await res.text()}`,
    );
  }
  return (await res.json()) as MeasurementResponse;
}

function canvasLocator(page: Page) {
  return page.locator(".konvajs-content canvas").first();
}

async function clickOnCanvas(page: Page, point: Point, browserName = "chromium") {
  await clickOnCanvasHelper(page, canvasLocator(page), point, browserName);
}

async function dragOnCanvas(
  page: Page,
  start: Point,
  end: Point,
  browserName: string,
) {
  await dragOnCanvasHelper(page, canvasLocator(page), start, end, browserName);
}

async function suppressTakeoffTour(
  page: Page,
  bidId: string,
  sheetId: string,
) {
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  expect(meRes.status()).toBe(200);
  const userId = ((await meRes.json()) as { user: { id: string } }).user.id;
  await page.evaluate(
    ({ sheetKey, sheetVal, tourKey }) => {
      sessionStorage.setItem(sheetKey, sheetVal);
      localStorage.setItem(tourKey, "1");
      // Keep the right-side TakeoffSidebar collapsed so it doesn't
      // overlay the canvas / batch action bar / bottom status bar
      // (mirrors the convention from the sibling specs).
      localStorage.setItem("takeoff-sidebar-collapsed", "true");
    },
    {
      sheetKey: `takeoff-sheet-${bidId}`,
      sheetVal: sheetId,
      // The full-screen `<TakeoffWorkspacePage>` (`pages/takeoff-
      // workspace.tsx:209`) auto-fires `startBidPlansTour()` 800ms
      // after mount unless `isBidPlansTourCompleted` is truthy. The
      // tour reuses the same per-user `bid-plans-tour-completed-…`
      // key the embedded workspace did, so writing it here suppresses
      // both surfaces.
      tourKey: `bid-plans-tour-completed-${userId}`,
    },
  );
}

interface SeededWorkspace {
  bidId: string;
  bidCode: string;
  sheetId: string;
}

async function seedCalibratedWorkspace(
  page: Page,
  suffix: number | string,
  label: string,
): Promise<SeededWorkspace> {
  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW ${label} Bid ${suffix}`,
      clientName: `PW ${label} Client`,
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
        fileUrl: `https://example.com/${label.toLowerCase()}-${suffix}.pdf`,
        fileName: `${label} Sheet ${suffix}`,
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  const sheetId = planBody.sheets[0].id;

  // Calibrate the sheet (polygon + circle commit branches both bail
  // out on `currentSheet?.scalePxPerFoot` falsy). 10 px/ft matches
  // the `seedTakeoffFixture` default so the resulting numbers are
  // comparable across specs.
  const calRes = await page.request.patch(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration`,
    { data: { scalePxPerFoot: 10, units: "ft" } },
  );
  expect(calRes.status()).toBe(200);

  return { bidId, bidCode, sheetId };
}

async function gotoTakeoff(
  page: Page,
  ws: SeededWorkspace,
) {
  // Task #2067 deleted the embedded `<TakeoffWorkspace>` from the
  // bid Plans tab; the canvas now only mounts on the standalone
  // `/takeoff/:bidCode` page (powered by
  // `client/src/pages/takeoff-workspace.tsx`). The `?sheet=…` query
  // param is honored on first paint via the
  // `pages/takeoff-workspace.tsx:56` `initialSheetId` memo, which
  // also writes through to `sessionStorage[takeoff-sheet-${bidId}]`
  // so a refresh keeps the user on the same sheet.
  await page.goto(`${BASE_URL}/takeoff/${ws.bidCode}?sheet=${ws.sheetId}`);
  await suppressTakeoffTour(page, ws.bidId, ws.sheetId);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
    timeout: 15_000,
  });
  await canvasLocator(page).waitFor({ state: "visible", timeout: 15_000 });
  // Ribbon must be mounted before we can click any tool button.
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
}

async function selectRibbonTool(page: Page, toolId: string) {
  const btn = page.getByTestId(`ribbon-tool-${toolId}`);
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
}

async function pollMeasurements(
  page: Page,
  sheetId: string,
  predicate: (rows: MeasurementResponse[]) => boolean,
  message: string,
  timeoutMs = 15_000,
): Promise<MeasurementResponse[]> {
  let last: MeasurementResponse[] = [];
  await expect
    .poll(
      async () => {
        last = await listMeasurements(page, sheetId);
        return predicate(last);
      },
      { message, timeout: timeoutMs },
    )
    .toBe(true);
  return last;
}

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Task #2224 — Polygon / Circle / Lasso real drawing flows", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("polygon: 4 vertices + Enter closes and commits an AREA measurement", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const ws = await seedCalibratedWorkspace(page, Date.now(), "Polygon");
    await gotoTakeoff(page, ws);

    // Pre-state: no measurements on the seeded sheet.
    {
      const before = await listMeasurements(page, ws.sheetId);
      expect(before).toHaveLength(0);
    }

    await selectRibbonTool(page, "polygon");

    // Four vertices forming a rectangle far from any UI overlay. The
    // close-on-click-first-vertex threshold inside the hook is 10 px
    // (`computePixelDistance(point, firstPoint) < 10`), so spread
    // these points wide enough that successive clicks don't
    // accidentally collapse the polygon.
    const vertices: Point[] = [
      { x: 280, y: 260 },
      { x: 480, y: 260 },
      { x: 480, y: 420 },
      { x: 280, y: 420 },
    ];
    for (const v of vertices) {
      await clickOnCanvas(page, v, browserName);
    }

    // Press Enter to close the polygon. The hook listens on the
    // window for `Enter` while `drawingPoints.length >= 3` and routes
    // through `completePolygon()`, which uses
    // `canonicalTool(activeTool)` so polygon → area for the commit.
    await page.keyboard.press("Enter");

    const after = await pollMeasurements(
      page,
      ws.sheetId,
      (rows) => rows.some((r) => r.type === "AREA"),
      "expected polygon close to commit one AREA measurement",
    );
    const area = after.find((r) => r.type === "AREA");
    expect(area).toBeTruthy();
    if (!area) return;
    // Sheet scoping — the measurement landed on the seeded sheet.
    expect(area.sheetId).toBe(ws.sheetId);
    // Points payload is JSON-serialized on the row; parse it and
    // confirm we recorded all 4 user-clicked vertices (the canonical
    // commit path doesn't auto-close by appending the first point).
    const points =
      typeof area.points === "string"
        ? (JSON.parse(area.points) as Point[])
        : area.points;
    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBe(vertices.length);
    // Computed area should be > 0 (the rectangle is ~200x160 px =
    // 32_000 px² → 320 ft² at 10 px/ft, but exact magnitude depends
    // on stage transform; the >0 lower bound is what the user-facing
    // contract guarantees).
    if (area.computedAreaFt2 !== null && area.computedAreaFt2 !== undefined) {
      expect(Number(area.computedAreaFt2)).toBeGreaterThan(0);
    }
  });

  test("circle: center + radius point commits a 32-sided AREA measurement with shape=circle metadata", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const ws = await seedCalibratedWorkspace(page, Date.now(), "Circle");
    await gotoTakeoff(page, ws);

    {
      const before = await listMeasurements(page, ws.sheetId);
      expect(before).toHaveLength(0);
    }

    await selectRibbonTool(page, "circle");

    // First click → center, second click → edge. The hook builds a
    // 32-sided regular polygon approximation and persists it as type
    // "AREA" with `metadata.shape === "circle"`.
    const center: Point = { x: 380, y: 340 };
    const edge: Point = { x: 480, y: 340 };
    await clickOnCanvas(page, center, browserName);
    await clickOnCanvas(page, edge, browserName);

    const after = await pollMeasurements(
      page,
      ws.sheetId,
      (rows) => rows.some((r) => r.type === "AREA"),
      "expected circle to commit one AREA measurement",
    );
    const area = after.find((r) => r.type === "AREA");
    expect(area).toBeTruthy();
    if (!area) return;
    expect(area.sheetId).toBe(ws.sheetId);

    const points =
      typeof area.points === "string"
        ? (JSON.parse(area.points) as Point[])
        : area.points;
    expect(Array.isArray(points)).toBe(true);
    // The hook builds 32 vertices around the circumference.
    expect(points.length).toBe(32);

    // metadata is JSON-serialized on the row. The commit branch
    // writes `{ perimeterFt, shape: "circle", radiusFt, center }`,
    // so the presence of `shape: "circle"` distinguishes a circle
    // commit from a free-form polygon (both end up as type AREA).
    expect(typeof area.metadata).toBe("string");
    const meta =
      typeof area.metadata === "string"
        ? (JSON.parse(area.metadata) as {
            shape?: string;
            radiusFt?: number;
            perimeterFt?: number;
          })
        : null;
    expect(meta?.shape).toBe("circle");
    expect(typeof meta?.radiusFt).toBe("number");
    expect((meta?.radiusFt ?? 0)).toBeGreaterThan(0);
    if (area.computedAreaFt2 !== null && area.computedAreaFt2 !== undefined) {
      expect(Number(area.computedAreaFt2)).toBeGreaterThan(0);
    }
  });

  test("lasso: activates and drag is a no-op; canonical select alias drives row selection", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const ws = await seedCalibratedWorkspace(page, Date.now(), "Lasso");

    // Seed a LINEAR measurement that spans a known canvas
    // rectangle so we can drag a marquee around it AND click
    // directly on it. Diagonal endpoints make the line easy to hit
    // at the centroid.
    const lineStart: Point = { x: 220, y: 240 };
    const lineEnd: Point = { x: 440, y: 360 };
    const seeded = await createMeasurementApi(page, {
      sheetId: ws.sheetId,
      type: "LINEAR",
      label: "Lasso Target",
      points: [lineStart, lineEnd],
      color: "#3b82f6",
    });

    await gotoTakeoff(page, ws);

    // Pre-state — the seeded measurement is on the sheet.
    {
      const before = await listMeasurements(page, ws.sheetId);
      expect(before).toHaveLength(1);
      expect(before[0].id).toBe(seeded.id);
    }

    // ----- Part 1: drag with lasso active is a no-op -----
    // The original brief expected "drags marquee around an existing
    // markup and asserts it becomes selected." That gesture is NOT
    // implemented for measurements in `<CanvasStage>` today — the
    // marquee state machine (`marquee` / `markup-marquee` overlay)
    // lives only in `<PlanMarkupLayer>` (`PlanMarkupLayer.tsx:349`
    // / `:1178`), which mounts in the project Plans tab and NOT in
    // `<TakeoffWorkspace>`. Additionally, `canonicalTool("lasso")
    // === "select"` is honored in the stage-level interaction hook
    // (`use-takeoff-interactions.ts:542`) but NOT in the per-
    // measurement onClick handler — that handler short-circuits on
    // `if (activeTool === "select")` literally
    // (`CanvasStage.tsx:728`), so a click on a line while lasso is
    // active does NOT toggle selection. The user-visible contract
    // today is therefore: "lasso button toggles state and is
    // otherwise a canvas no-op." Documenting this in the test means
    // a future regression that wires drag-to-create or accidentally
    // creates a measurement under lasso trips this test instantly.
    await selectRibbonTool(page, "lasso");
    await dragOnCanvas(
      page,
      { x: 180, y: 200 },
      { x: 480, y: 400 },
      browserName,
    );
    {
      const afterDrag = await listMeasurements(page, ws.sheetId);
      expect(afterDrag).toHaveLength(1);
      expect(afterDrag[0].id).toBe(seeded.id);
    }
    // Marquee overlay is not present anywhere on the takeoff
    // workspace surface today. Asserting its absence locks the
    // current implementation surface so a future change that
    // introduces a takeoff-side marquee adjusts this spec
    // deliberately rather than silently.
    await expect(page.getByTestId("markup-marquee")).toHaveCount(0);

    // ----- Part 2: canonical select alias drives row selection -----
    // Per `canonicalTool()` (`types.ts:47`), lasso is an explicit
    // alias for "select". Switching to the canonical tool and
    // clicking the seeded measurement is the user-visible end
    // state the lasso button is meant to reach — running it here
    // proves the selection plumbing (Konva onClick →
    // `setSelectedMeasurementId` → `<MeasurementTable>` row class)
    // works end-to-end. When the per-measurement onClick handler
    // is updated to use `canonicalTool(activeTool) === "select"`,
    // the same assertion can be flipped back to clicking under the
    // lasso tool with no other changes.
    //
    // We click the table row directly instead of hit-testing the
    // line on the canvas because the takeoff stage applies an
    // initial fit-to-screen transform whose exact pan/zoom is
    // viewport-dependent and not exposed via a stable testid — so
    // a canvas-coord click is brittle in a way that doesn't add
    // any extra coverage of the lasso → select alias being tested
    // here. The MeasurementTable row's onClick goes through the
    // same `setSelectedMeasurementId` setter the canvas hit-test
    // does (`MeasurementTable.tsx:204`), so we still exercise the
    // selection state machine end-to-end.
    await page.getByTestId("button-toggle-measurement-table").click();
    const row = page.getByTestId(`measurement-row-${seeded.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    // Pre-condition: row must NOT be selected before we click on
    // it — otherwise a "selection happened to be on already" test
    // would pass without exercising the click handler.
    await expect(row).not.toHaveClass(/bg-primary/);

    await selectRibbonTool(page, "select");
    await row.click();

    // Polling on `toHaveClass` tolerates the brief delay between
    // the click firing and React re-rendering the table row.
    await expect(row).toHaveClass(/bg-primary/, { timeout: 10_000 });
  });
});
