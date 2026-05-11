// Task #2786 — E2E coverage for calibration zone overlay rendering and
// click-to-select behaviour added in Task #2781.
//
// The calibration zone feature adds:
//   - Named zone polygons overlaid on the Konva canvas (CanvasStage.tsx)
//   - A CalibrationZonesPanel inside the InlineCalibrationDrawer showing zone
//     rows that sync bidirectionally with the canvas selection state
//
// These tests pin:
//   1. A seeded zone row appears inside the panel after opening the drawer (T).
//   2. Clicking a panel zone row selects it — the row gains the cyan ring.
//   3. Clicking a selected zone row again de-selects it — ring is removed.
//   4. The calibration-zones GET request is fired for the active sheet.
//   5. CRUD round-trip (POST → GET) confirming polygon_points shape via API.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

interface ZoneRow {
  id: string;
  sheet_id: string;
  name: string;
  polygon_points: Array<{ x: number; y: number }>;
  px_per_foot: number;
}

async function devLogin(page: Page, role = "ADMIN") {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status(), `devLogin failed: ${await res.text()}`).toBe(200);
}

async function seedTakeoffFixture(page: Page): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status(), `seed-takeoff-fixture failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function seedCalibrationZone(
  page: Page,
  sheetId: string,
  opts: {
    name?: string;
    pxPerFoot?: number;
    polygonPoints?: Array<{ x: number; y: number }>;
  } = {},
): Promise<ZoneRow> {
  const res = await page.request.post(
    `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration-zones`,
    {
      data: {
        name: opts.name ?? "E2E Test Zone",
        polygonPoints: opts.polygonPoints ?? [
          { x: 100, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 350 },
          { x: 100, y: 350 },
        ],
        pxPerFoot: opts.pxPerFoot ?? 12,
      },
    },
  );
  expect(res.status(), `seedCalibrationZone failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as ZoneRow;
}

async function gotoTakeoff(page: Page, bidCode: string, bidId: string, sheetId: string) {
  // Mirror the pattern from takeoff-bulk-delete-undo-toast.spec.ts:
  // 1. Navigate to the takeoff page so we're on the correct origin.
  // 2. Pre-set sessionStorage BEFORE the TakeoffWorkspace mounts with its
  //    initial `internalSelectedSheet` state — the workspace reads
  //    `sessionStorage['takeoff-sheet-${bidId}']` in its useState initializer.
  // 3. Reload so the workspace mounts fresh with the sheet already selected
  //    (avoids the race where the page-level useEffect writes sessionStorage
  //    after TakeoffWorkspace already read it as null).
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, val }: { key: string; val: string }) => {
      sessionStorage.setItem(key, val);
      // Collapse the sidebar so it doesn't overlap the calibration drawer.
      localStorage.setItem("takeoff-sidebar-collapsed", "true");
    },
    { key: `takeoff-sheet-${bidId}`, val: sheetId },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("unified-takeoff-ribbon").click();
}

async function openCalibrationDrawer(page: Page) {
  await page.keyboard.press("t");
  await expect(page.getByTestId("inline-calibration-drawer")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Calibration zone overlay — panel rendering and click-to-select", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("seeded zone row appears in the CalibrationZonesPanel inside the calibration drawer", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    const zone = await seedCalibrationZone(page, sheetIds[0], { name: "North Wing" });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);

    // Open the inline calibration drawer (T shortcut). The CalibrationZonesPanel
    // is embedded at the bottom of the drawer — it fetches and renders zone rows
    // for the current sheet.
    await openCalibrationDrawer(page);

    // The zones section toggle is always visible in the drawer.
    const toggle = page.getByTestId("button-calibration-zones-toggle");
    await expect(toggle).toBeVisible({ timeout: 8_000 });

    // The zone row should be visible (panel starts expanded).
    const zoneRow = page.getByTestId(`calibration-zone-row-${zone.id}`);
    await expect(zoneRow).toBeVisible({ timeout: 8_000 });

    // Verify the zone name text renders inside the row.
    await expect(page.getByTestId(`text-zone-name-${zone.id}`)).toContainText("North Wing");

    // Verify the scale reads back the seeded px/ft value.
    await expect(page.getByTestId(`text-zone-scale-${zone.id}`)).toContainText("12.00 px/ft");
  });

  test("clicking a zone row selects it — row gains the cyan ring", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    const zone = await seedCalibrationZone(page, sheetIds[0], { name: "Select Test Zone" });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    const zoneRow = page.getByTestId(`calibration-zone-row-${zone.id}`);
    await expect(zoneRow).toBeVisible({ timeout: 8_000 });

    // The row should NOT have the selected ring class initially.
    await expect(zoneRow).not.toHaveClass(/ring-1/);

    // Click the row to select the zone.
    await zoneRow.click();

    // After clicking, the ZoneRow renders with the selected state:
    // `ring-1 ring-cyan-400/60` class is applied when `isSelected === true`.
    await expect(zoneRow).toHaveClass(/ring-1/, { timeout: 5_000 });
  });

  test("clicking a selected zone row de-selects it — ring is removed", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    const zone = await seedCalibrationZone(page, sheetIds[0], { name: "Toggle Zone" });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    const zoneRow = page.getByTestId(`calibration-zone-row-${zone.id}`);
    await expect(zoneRow).toBeVisible({ timeout: 8_000 });

    // First click — select.
    await zoneRow.click();
    await expect(zoneRow).toHaveClass(/ring-1/, { timeout: 5_000 });

    // Second click — de-select. The `onSelect` handler passes `null` when
    // the same zone is clicked again.
    await zoneRow.click();
    await expect(zoneRow).not.toHaveClass(/ring-1/);
  });

  test("panel shows zone count badge when zones exist", async ({ page }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await seedCalibrationZone(page, sheetIds[0], { name: "Badge Zone 1" });
    await seedCalibrationZone(page, sheetIds[0], { name: "Badge Zone 2" });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    const toggle = page.getByTestId("button-calibration-zones-toggle");
    await expect(toggle).toBeVisible({ timeout: 8_000 });
    // The panel renders a badge showing the zone count when > 0.
    await expect(toggle).toContainText("2", { timeout: 8_000 });
  });

  test("collapsing and re-expanding the zones section hides/shows zone rows", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    const zone = await seedCalibrationZone(page, sheetIds[0], { name: "Collapsible Zone" });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    const toggle = page.getByTestId("button-calibration-zones-toggle");
    await expect(toggle).toBeVisible({ timeout: 8_000 });

    const zoneRow = page.getByTestId(`calibration-zone-row-${zone.id}`);
    await expect(zoneRow).toBeVisible({ timeout: 8_000 });

    // Collapse the section.
    await toggle.click();
    await expect(zoneRow).not.toBeVisible({ timeout: 3_000 });

    // Re-expand.
    await toggle.click();
    await expect(zoneRow).toBeVisible({ timeout: 3_000 });
  });

  test("panel shows empty-state message when no zones exist for the sheet", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    const toggle = page.getByTestId("button-calibration-zones-toggle");
    await expect(toggle).toBeVisible({ timeout: 8_000 });

    // When no zones exist the panel renders a "No zones yet" message.
    await expect(
      page.getByText(/no zones yet/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("calibration-zones GET is fired for the active sheet when the workspace loads", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);

    // Collect calibration-zone GET URLs via page.on('request') which survives
    // the full navigate → evaluate → reload cycle inside gotoTakeoff.
    // (page.waitForRequest misses the event when it fires during a reload.)
    const firedUrls: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "GET" &&
        req.url().includes(`/api/takeoff/sheets/${sheetIds[0]}/calibration-zones`)
      ) {
        firedUrls.push(req.url());
      }
    });

    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);

    // The CalibrationZonesPanel fires the GET on mount (via TanStack Query).
    // If it happened before gotoTakeoff returned, firedUrls is already non-empty.
    // Otherwise give React up to 5 s to settle and fire it.
    if (firedUrls.length === 0) {
      await page
        .waitForRequest(
          (req) =>
            req.method() === "GET" &&
            req.url().includes(`/api/takeoff/sheets/${sheetIds[0]}/calibration-zones`),
          { timeout: 5_000 },
        )
        .then((req) => firedUrls.push(req.url()))
        .catch(() => {});
    }

    expect(
      firedUrls.length,
      `calibration-zones GET was not fired for sheet ${sheetIds[0]}`,
    ).toBeGreaterThan(0);
    expect(firedUrls[0]).toContain(sheetIds[0]);
  });

  test("multiple zones for the same sheet all appear as individual rows in the panel", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    const zoneA = await seedCalibrationZone(page, sheetIds[0], { name: "Zone Alpha", pxPerFoot: 10 });
    const zoneB = await seedCalibrationZone(page, sheetIds[0], { name: "Zone Beta", pxPerFoot: 20 });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    await expect(page.getByTestId(`calibration-zone-row-${zoneA.id}`)).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId(`calibration-zone-row-${zoneB.id}`)).toBeVisible({
      timeout: 8_000,
    });

    // Verify scale values.
    await expect(page.getByTestId(`text-zone-scale-${zoneA.id}`)).toContainText("10.00 px/ft");
    await expect(page.getByTestId(`text-zone-scale-${zoneB.id}`)).toContainText("20.00 px/ft");
  });

  test("selecting one zone de-selects another — only one ring is active at a time", async ({
    page,
  }) => {
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    const zoneA = await seedCalibrationZone(page, sheetIds[0], { name: "Zone One" });
    const zoneB = await seedCalibrationZone(page, sheetIds[0], { name: "Zone Two" });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await openCalibrationDrawer(page);

    const rowA = page.getByTestId(`calibration-zone-row-${zoneA.id}`);
    const rowB = page.getByTestId(`calibration-zone-row-${zoneB.id}`);
    await expect(rowA).toBeVisible({ timeout: 8_000 });
    await expect(rowB).toBeVisible({ timeout: 8_000 });

    // The zone rows live in the calibration drawer which is a fixed-height
    // panel. When two zones exist the second row may overflow the browser
    // viewport. Dispatch DOM clicks via evaluate() to bypass Playwright's
    // viewport-containment check while still firing the React onClick handler.
    const clickLocator = async (loc: Locator) =>
      loc.evaluate((el: HTMLElement) => el.click());

    // Select Zone One.
    await clickLocator(rowA);
    await expect(rowA).toHaveClass(/ring-1/, { timeout: 5_000 });
    await expect(rowB).not.toHaveClass(/ring-1/);

    // Select Zone Two — Zone One must lose its ring.
    await clickLocator(rowB);
    await expect(rowB).toHaveClass(/ring-1/, { timeout: 5_000 });
    await expect(rowA).not.toHaveClass(/ring-1/);
  });

  test("canvas-zone-polygon overlay: DOM mirror renders and canvas click-to-select updates the panel ring", async ({
    page,
  }) => {
    // 1. RENDER: data-testid="canvas-zone-polygon-<id>" in DOM confirms the
    //    zone is wired into workspace state and the SVG mirror is mounted.
    // 2. CANVAS CLICK: clicking the real Konva <canvas> at the zone centroid
    //    exercises the full hit-test path (Line.onClick → setSelectedCalibration-
    //    ZoneId → panel ring-1). DOM mirror provides stable coordinate lookup.
    //    CanvasStage renders zones without pdfImage (Task #2786) so Konva
    //    hit-testing works in the seed-only test environment.
    await devLogin(page);
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    // Seed the zone well to the right of the navigation sidebar (~280 px wide)
    // so Playwright's real pointer click can land on the Konva canvas without
    // being intercepted. Centroid will be at x=650, y=200 in canvas space.
    const zone = await seedCalibrationZone(page, sheetIds[0], {
      name: "Canvas Overlay Zone",
      polygonPoints: [
        { x: 500, y: 100 },
        { x: 800, y: 100 },
        { x: 800, y: 300 },
        { x: 500, y: 300 },
      ],
    });
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // 1. RENDER assertion: DOM mirror polygon must appear once zones load.
    const mirrorPolygon = page.getByTestId(`canvas-zone-polygon-${zone.id}`);
    await expect(mirrorPolygon).toHaveCount(1, { timeout: 8_000 });

    // 2. CANVAS click-to-select via the real Konva canvas.
    //
    //    Read the polygon centroid from the DOM mirror's `points` attribute.
    //    The mirror stores vertices already transformed to stage screen-space
    //    (x * stageScale + stagePosition.x). We click the Konva <canvas>
    //    element at that position, which exercises the full real interaction
    //    path: Playwright pointer event → canvas hit-test layer → Line.onClick
    //    → onSelectCalibrationZone → setSelectedCalibrationZoneId → panel ring.
    const pointsAttr = await mirrorPolygon.getAttribute("points");
    const pts = (pointsAttr ?? "").trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

    // The Konva stage renders to the first visible <canvas> inside the viewport.
    const konvaCanvas = page.locator('[data-testid="takeoff-canvas-viewport"] canvas').first();
    await expect(konvaCanvas).toBeVisible({ timeout: 8_000 });
    // Position (cx, cy) is in CSS-pixel canvas-element space. The zone centroid
    // (x=650, y=200 with default stage transform) is to the right of the
    // navigation sidebar so Playwright's pointer click reaches the canvas.
    await konvaCanvas.click({ position: { x: cx, y: cy } });

    // The CalibrationZonesPanel zone row must now carry the selection ring.
    await openCalibrationDrawer(page);
    const zoneRow = page.getByTestId(`calibration-zone-row-${zone.id}`);
    await expect(zoneRow).toBeVisible({ timeout: 8_000 });
    await expect(zoneRow).toHaveClass(/ring-1/, { timeout: 5_000 });

    // No uncaught JS errors during the full zone-fetch → Konva-render →
    // canvas-click → selection → panel-ring cycle.
    expect(errors.filter((e) => !/ResizeObserver/.test(e))).toHaveLength(0);
  });
});

test.describe("Calibration zone CRUD API — polygon_points contract (via page.request)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("POST creates a zone and GET returns correct polygon_points {x,y} array shape", async ({
    page,
  }) => {
    await devLogin(page);
    const { sheetIds } = await seedTakeoffFixture(page);
    const sheetId = sheetIds[0];

    const polygon = [
      { x: 50, y: 75 },
      { x: 250, y: 75 },
      { x: 250, y: 225 },
      { x: 50, y: 225 },
    ];

    const postRes = await page.request.post(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration-zones`,
      {
        data: { name: "API Contract Zone", polygonPoints: polygon, pxPerFoot: 14.5 },
      },
    );
    expect(postRes.status()).toBe(201);
    const created = (await postRes.json()) as ZoneRow;

    expect(created.id).toBeTruthy();
    expect(created.name).toBe("API Contract Zone");
    expect(Array.isArray(created.polygon_points)).toBe(true);
    expect(created.polygon_points).toHaveLength(4);
    expect(created.polygon_points[0]).toMatchObject({ x: 50, y: 75 });
    expect(created.polygon_points[3]).toMatchObject({ x: 50, y: 225 });
    expect(Number(created.px_per_foot)).toBeCloseTo(14.5, 4);

    // Round-trip via GET to confirm the DB persisted the JSONB correctly.
    const getRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetId}/calibration-zones`,
    );
    expect(getRes.status()).toBe(200);
    const zones = (await getRes.json()) as ZoneRow[];
    const found = zones.find((z) => z.id === created.id);
    expect(found).toBeTruthy();
    expect(found!.polygon_points).toHaveLength(4);
    for (const pt of found!.polygon_points) {
      expect(typeof pt.x).toBe("number");
      expect(typeof pt.y).toBe("number");
    }
  });

  test("PATCH updates polygon_points and the new shape round-trips correctly", async ({
    page,
  }) => {
    await devLogin(page);
    const { sheetIds } = await seedTakeoffFixture(page);
    const zone = await seedCalibrationZone(page, sheetIds[0], { name: "Patch Polygon Zone" });

    const newPolygon = [
      { x: 10, y: 20 },
      { x: 180, y: 20 },
      { x: 180, y: 130 },
      { x: 10, y: 130 },
      { x: 5, y: 75 },
    ];

    const patchRes = await page.request.patch(
      `${BASE_URL}/api/takeoff/calibration-zones/${zone.id}`,
      { data: { polygonPoints: newPolygon } },
    );
    expect(patchRes.status()).toBe(200);
    const updated = (await patchRes.json()) as ZoneRow;
    expect(updated.polygon_points).toHaveLength(5);
    expect(updated.polygon_points[4]).toMatchObject({ x: 5, y: 75 });
  });

  test("DELETE removes the zone and subsequent GET excludes it", async ({ page }) => {
    await devLogin(page);
    const { sheetIds } = await seedTakeoffFixture(page);
    const zone = await seedCalibrationZone(page, sheetIds[0], { name: "Delete Via E2E" });

    const delRes = await page.request.delete(
      `${BASE_URL}/api/takeoff/calibration-zones/${zone.id}`,
    );
    expect(delRes.status()).toBe(200);

    const getRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheetIds[0]}/calibration-zones`,
    );
    expect(getRes.status()).toBe(200);
    const zones = (await getRes.json()) as ZoneRow[];
    expect(zones.find((z) => z.id === zone.id)).toBeUndefined();
  });
});
