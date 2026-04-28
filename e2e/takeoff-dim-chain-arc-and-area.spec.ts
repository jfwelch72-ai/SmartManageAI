// Task #2269 — End-to-end coverage for the typed-length **chain mode**
// (Repeat / chain switch) on NON-LINEAR draw tools.
//
// The sister spec at `e2e/takeoff-dim-chain-and-tab-reopen.spec.ts`
// (Task #2227) pins down chain behavior end-to-end for the LINEAR tool
// only. The same chain-mode wiring applies to every draw tool that
// resolves a click through `resolvePoint` in
// `client/src/hooks/use-takeoff-interactions.ts` — i.e. any tool whose
// next vertex gets clamped via `applyFixedLength(pt, anchor, lengthPx)`
// when `pendingDimLengthFt > 0`. In this codebase that is:
//
//   - `linear` / `linear_with_drop` / `pitched_linear` / `dimension`
//   - `arc` (3 sequential vertices)
//   - `area` / `polygon` / `volume` / `pitched_area` / `surface_area`
//   - `circle` (2 vertices: center + edge)
//   - `segment` / `deduct`
//
// A regression in any of those branches (e.g. a future refactor that
// moves `applyFixedLength` into the LINEAR-only branch, or that drops
// `dimInputRepeatRef.current` from `onConsumeDimLength` so chain mode
// silently degrades to one-shot mode) would slip through the existing
// LINEAR-only spec. This file extends the contract to ARC (3-point
// curve commit) and AREA (multi-vertex polygon commit through
// `completePolygon` via the window-level Enter handler).
//
// Setup mirrors the LINEAR chain spec exactly: same `dev/test-login`
// flow, same `seed-takeoff-fixture` (sheet pre-calibrated to
// `scalePxPerFoot: 10` per `server/devSeedEnterprise.ts:885`), and the
// same `unified-takeoff-ribbon` + Verify/Measure ribbon-group
// open-then-click choreography.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// 12.5 ft × 10 px/ft = 125 px on the seeded sheet — same magnitude the
// LINEAR chain spec uses, so cross-spec drift is obvious if either
// test's expectation moves.
const LOCKED_LENGTH_FT = 12.5;
const EXPECTED_PX = 125;
// `applyFixedLength` projects the cursor onto the anchor→cursor ray
// at exactly `lengthPx`, but the round-trip through Konva's stage
// transform + the React/Konva pointer event pipeline rounds at a few
// places (subpixel transforms, integer pointer coords). The LINEAR
// chain spec uses ±1 px and that's been stable across browsers, so we
// reuse the same tolerance here.
const PX_TOLERANCE = 1;

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

async function seedTakeoffFixture(page: Page): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function gotoTakeoff(
  page: Page,
  bidCode: string,
  bidId?: string,
  sheetId?: string,
) {
  // The seeded takeoff fixture creates sheets but the workspace does
  // NOT auto-select one — without `?sheet=<id>` the canvas never
  // mounts and the page stays on the "Start Your Takeoff" empty
  // state. The standalone takeoff page reads `?sheet=` only via a
  // post-mount `useEffect` that writes through to `sessionStorage`
  // — by then the inner workspace has already initialized its
  // `selectedSheetId` from sessionStorage (which was empty), so
  // the deep link silently falls back to "no sheet". The sister
  // polygon/circle/lasso spec works around this by seeding the
  // sessionStorage key BEFORE the workspace mounts and then
  // reloading; we mirror that here.
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  if (bidId && sheetId) {
    await page.evaluate(
      ({ key, val }) => {
        sessionStorage.setItem(key, val);
        // Mirror sister specs — keep the right-side TakeoffSidebar
        // collapsed so its overlay never intercepts ribbon clicks.
        localStorage.setItem("takeoff-sidebar-collapsed", "true");
      },
      { key: `takeoff-sheet-${bidId}`, val: sheetId },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // Match the LINEAR chain spec — close the right sidebar so its
  // overlay doesn't intercept clicks against the rightmost ribbon
  // groups, where Verify (and the Dim Input button) live.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Same focus-the-ribbon trick — the workspace-level Enter handler
  // for closing polygons is a window-level keydown listener
  // (`use-takeoff-interactions.ts:1285`), and Tab-to-reopen is
  // workspace-level too. Focusing the ribbon (a body-scoped target)
  // ensures keystrokes reach those handlers instead of being trapped
  // by some other focused control.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

async function openDimInputDialog(page: Page) {
  // The Dim Input button lives in the Verify ribbon group. The group
  // is expanded by default on a 1600×1000 viewport, but a previous
  // test run might have persisted a `collapsed[verify]=true` entry to
  // localStorage (the ribbon-shortcuts spec exercises that path), so
  // we MUST check the current state of the tools row before deciding
  // whether to click the toggle. Naively clicking the toggle whenever
  // it's visible would COLLAPSE an already-expanded group and hide
  // the very button we're trying to click.
  const tools = page.getByTestId("ribbon-group-tools-verify");
  if ((await tools.count()) === 0) {
    await page.getByTestId("ribbon-group-toggle-verify").click();
    await expect(tools).toBeVisible({ timeout: 5_000 });
  }
  const dimInputBtn = page.getByTestId("ribbon-tool-dim-input");
  await expect(dimInputBtn).toBeVisible({ timeout: 10_000 });
  await dimInputBtn.click();
  await expect(page.getByTestId("dialog-dim-input")).toBeVisible({
    timeout: 5_000,
  });
}

async function selectMeasureTool(page: Page, toolId: "arc" | "area") {
  // Same precaution as `openDimInputDialog` — only click the toggle
  // if the measure tools are currently collapsed; clicking otherwise
  // would COLLAPSE the group and hide every measurement tool.
  const measureTools = page.getByTestId("ribbon-group-tools-measure");
  if ((await measureTools.count()) === 0) {
    await page.getByTestId("ribbon-group-toggle-measure").click();
    await expect(measureTools).toBeVisible({ timeout: 5_000 });
  }
  const btn = page.getByTestId(`ribbon-tool-${toolId}`);
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  // `aria-pressed=true` confirms the ribbon committed the tool — without
  // this, a click that misses (e.g. obscured by the verify popover) would
  // race the canvas click below.
  await expect(btn).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
}

async function lockChainLength(page: Page, lengthFt: number) {
  await openDimInputDialog(page);
  const repeatSwitch = page.getByTestId("switch-dim-repeat");
  // Chain switch persists across reloads via localStorage, so it may
  // already be on. Force it to checked.
  if ((await repeatSwitch.getAttribute("data-state")) !== "checked") {
    await repeatSwitch.click();
  }
  await expect(repeatSwitch).toHaveAttribute("data-state", "checked");
  await page.getByTestId("input-dim-length").fill(String(lengthFt));
  // Apply button copy flips to "Chain Length" when chain mode is on —
  // the copy itself is the user-facing confirmation that the toggle
  // wired through.
  const applyBtn = page.getByTestId("button-dim-apply");
  await expect(applyBtn).toContainText("Chain Length");
  await applyBtn.click();
  await expect(page.getByTestId("dialog-dim-input")).toHaveCount(0);

  // Lock chip must immediately render in chained state at the locked
  // length — proves Apply pushed the value into TakeoffWorkspace.
  const chip = page.getByTestId("indicator-dim-lock");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-state", "chained");
  await expect(page.getByTestId("text-dim-lock-length")).toHaveText(
    `${lengthFt.toFixed(2)} ft`,
  );
}

async function expectChipStillChained(page: Page) {
  const chip = page.getByTestId("indicator-dim-lock");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-state", "chained");
  await expect(page.getByTestId("text-dim-lock-length")).toHaveText(
    `${LOCKED_LENGTH_FT.toFixed(2)} ft`,
  );
}

interface CommitBody {
  sheetId?: string;
  type?: string;
  points?: Array<{ x: number; y: number }>;
}

function captureNextCommit(page: Page): Promise<CommitBody> {
  // Returns a promise that resolves to the parsed POST body of the
  // NEXT measurement-create request. Caller registers the listener
  // BEFORE firing the canvas clicks (no `await` here), then `await`s
  // the returned promise AFTER the commit-triggering click. This is
  // the same pattern the LINEAR chain spec uses with
  // `page.waitForRequest(...)` inline.
  return page
    .waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements/.test(req.url()),
      { timeout: 15_000 },
    )
    .then((req) => req.postDataJSON() as CommitBody);
}

function segmentPx(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Wider viewport than Playwright's 1280×720 default so the Verify and
// Measure ribbon groups (which `NARROW_DEFAULT_COLLAPSED_GROUPS` collapses
// at the default size — `UnifiedTakeoffRibbon.tsx:297`) render their
// tool buttons inline. The sister polygon/circle/lasso spec uses the
// same viewport for the same reason.
test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Takeoff Dim Input — chain mode on ARC + AREA (Task #2269)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("chain mode keeps each AREA polygon vertex locked across two consecutive shapes", async ({
    page,
  }) => {
    // Functional contract: with chain mode on and 12.5 ft locked,
    // every vertex click on the AREA tool must commit at exactly
    // 125 px from the prior vertex (modulo angle-rotation rounding),
    // AND the lock chip must stay `data-state="chained"` across the
    // intra-polygon clicks AND across the boundary between two
    // consecutive polygons. The first vertex of each polygon is
    // unconstrained because `resolvePoint` only invokes
    // `applyFixedLength` when there is an existing `drawingPoints`
    // anchor — so checking that the SECOND polygon's interior
    // segments are also 125 px proves the lock survived the first
    // polygon's `completePolygon` commit (the `Enter` keydown path).
    //
    // Without the chain-mode gate
    // (`if (dimInputRepeatRef.current) return;` in
    // `onConsumeDimLength`), the SECOND vertex of polygon #1 would
    // commit correctly but the THIRD vertex onward would snap to
    // the cursor distance instead of the locked length, and the
    // chip would disappear after the second click.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);

    // Switch to AREA. The "polygon" ribbon entry would also work —
    // both go through `tool === "area"` after `canonicalTool`. We
    // pick "area" explicitly so a future split between the polygon
    // and area branches doesn't quietly pass without us noticing.
    await selectMeasureTool(page, "area");
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ---------- Polygon #1 ----------
    // Four cursor positions whose RESOLVED (post-`applyFixedLength`)
    // vertices stay well outside the close-on-first-vertex threshold
    // (10 px in image space — `use-takeoff-interactions.ts:771-772`).
    // Two pitfalls drove the final coordinate choice:
    //
    //   1. The naive choice of a 200 px square (cursors at the corners
    //      of a 200 px box) does NOT work: each clamped segment is
    //      only 125 px, so when the path doubles back, the resolved
    //      fourth point can land within 10 px of the first depending
    //      on rounding. We use a "snake" trajectory that monotonically
    //      moves AWAY from the first vertex — every subsequent
    //      resolved vertex is provably > EXPECTED_PX from v1, so
    //      close-on-first can never accidentally fire and Enter is
    //      the only commit path.
    //   2. The seeded sheet renders into a Konva canvas roughly
    //      ~600 px tall at our 1600x1000 viewport, so click coords
    //      with y ≥ ~580 land within a few pixels of the canvas's
    //      bottom edge. Konva's React-side hit detection does not
    //      reliably register clicks that close to the boundary
    //      (mouseDown fires but the synthesized stage-click never
    //      reaches `handleStageClick`), which would silently drop a
    //      vertex and leave the polygon with one fewer point than the
    //      test asked for. We keep every cursor y ≤ 400 so every
    //      click is comfortably inside the canvas.
    //
    // Resolved coordinates (computed with `applyFixedLength` projecting
    // each cursor onto the prior anchor's ray at exactly 125 image px):
    //   v1 = (200, 100)            (raw, no anchor)
    //   v2 = (325, 100)            (125 px right of v1)
    //   v3 ≈ (388, 208)            (125 px from v2, mostly downward)
    //   v4 ≈ (507, 245)            (125 px from v3, mostly rightward)
    // |v4 - v1| ≈ 340 px — comfortably outside the 10 px threshold.
    await clickOnCanvas(page, canvas, { x: 200, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 500, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 500, y: 400 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1000, y: 400 });
    await expectChipStillChained(page);

    // Close polygon #1 via Enter — `completePolygon` fires the POST
    // and resets `isDrawing` / `drawingPoints` so the next click
    // starts a fresh polygon.
    const firstPolygonCommit = captureNextCommit(page);
    await page.keyboard.press("Enter");
    const firstBody = await firstPolygonCommit;

    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("AREA");
    expect(Array.isArray(firstBody.points)).toBe(true);
    expect(firstBody.points!.length).toBe(4);

    // Each segment between consecutive committed vertices must be
    // EXPECTED_PX (the locked length). The first→second, second→
    // third, and third→fourth distances all go through
    // `applyFixedLength`. The fourth→first closing edge is NOT
    // length-locked (the polygon close-on-Enter doesn't append the
    // first vertex; `computePolygonAreaInFt2` treats it as implicit),
    // so we only assert the three click-driven segments.
    for (let i = 0; i < firstBody.points!.length - 1; i += 1) {
      const dist = segmentPx(firstBody.points![i], firstBody.points![i + 1]);
      expect(dist).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(dist).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }

    // Chip is STILL chained after the commit — the contract this
    // spec exists to enforce on the AREA branch.
    await expectChipStillChained(page);

    // ---------- Polygon #2 ----------
    // Same snake trajectory shifted right by 200 px so it doesn't
    // overlap polygon #1. The first vertex is unconstrained (no
    // anchor); the next three are each locked to EXPECTED_PX. If a
    // future regression dropped the chain gate from
    // `onConsumeDimLength`, the SECOND polygon's interior segments
    // would snap to cursor distance and this loop would fail.
    // Cursor x values are kept ≤ 1200 because at our 1600x1000
    // viewport the canvas's right edge sits a few pixels inside the
    // viewport's right edge — anything past ~1300 risks the same
    // off-canvas-click silent-drop pitfall called out for polygon #1.
    const secondPolygonCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 500, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 400 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1200, y: 400 });
    await expectChipStillChained(page);
    await page.keyboard.press("Enter");
    const secondBody = await secondPolygonCommit;

    expect(secondBody.sheetId).toBe(sheetIds[0]);
    expect(secondBody.type).toBe("AREA");
    expect(secondBody.points!.length).toBe(4);
    for (let i = 0; i < secondBody.points!.length - 1; i += 1) {
      const dist = segmentPx(secondBody.points![i], secondBody.points![i + 1]);
      expect(dist).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(dist).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }

    // And the chip is STILL chained after BOTH commits.
    await expectChipStillChained(page);
  });

  test("chain mode keeps each ARC's start→middle and middle→end legs locked across two consecutive arcs", async ({
    page,
  }) => {
    // Functional contract: ARC commits as a `LINEAR` measurement
    // with three points (start, middle, end —
    // `use-takeoff-interactions.ts:709-713`). With chain mode on and
    // 12.5 ft locked, the SECOND and THIRD click of each arc are
    // each clamped via `applyFixedLength` to be EXPECTED_PX away
    // from the previous click. So each committed arc's
    // start→middle and middle→end distances must equal the locked
    // length (the chord between the three points doesn't matter).
    //
    // The first click of each arc is unconstrained (no anchor), and
    // the third click commits + resets `drawingPoints`. The
    // start→middle of arc #2 going through `applyFixedLength` only
    // works if `pendingDimLengthFt` survived arc #1's commit — which
    // is precisely what `dimInputRepeatRef.current` gates inside
    // `onConsumeDimLength`. A regression that drops the chain gate
    // would snap arc #2's middle to the raw cursor and trip the
    // length tolerance below.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code, bid.id, sheetIds[0]);
    await lockChainLength(page, LOCKED_LENGTH_FT);

    await selectMeasureTool(page, "arc");
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ---------- Arc #1 ----------
    // Three click positions chosen so the cursor directions are
    // non-collinear (`createArcSegment` returns null for collinear
    // points and the commit aborts —
    // `use-takeoff-interactions.ts:697-703`). Locking to 125 px
    // means the actual committed middle/end points are pulled
    // toward the anchor along the cursor ray, so we deliberately
    // place the cursors well past EXPECTED_PX in distinct directions
    // to keep the resolved triple non-collinear.
    //
    // Two layout pitfalls drove the cursor box (x ∈ [300, 1100],
    // y ∈ [100, 350]):
    //
    //   1. The Konva stage's canvas DOM extends from viewport x=0
    //      across the full 1600 px width — including the area UNDER
    //      the left navigation sidebar. The sidebar overlay sits on
    //      top of the canvas in z-order, so any click whose viewport
    //      x lands inside the sidebar's footprint (~200 px wide on
    //      a fresh page) is silently swallowed by the sidebar
    //      instead of reaching the Konva stage. We keep cursor x
    //      ≥ 300 so the resolved viewport coordinate is safely past
    //      the sidebar even when the canvas reports `box.x = 0`.
    //   2. The seeded sheet's canvas is ~607 px tall and Konva's
    //      React-side hit detection drops clicks that land within a
    //      few pixels of the boundary (the same silent-drop pitfall
    //      called out in the AREA test above). y ≤ 350 keeps every
    //      click comfortably inside the visible canvas region.
    const firstArcCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 300, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 600, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 600, y: 350 });
    const firstBody = await firstArcCommit;

    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("LINEAR");
    expect(Array.isArray(firstBody.points)).toBe(true);
    expect(firstBody.points!.length).toBe(3);
    // start → middle and middle → end are both length-locked.
    {
      const startToMid = segmentPx(firstBody.points![0], firstBody.points![1]);
      const midToEnd = segmentPx(firstBody.points![1], firstBody.points![2]);
      expect(startToMid).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(startToMid).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
      expect(midToEnd).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(midToEnd).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }

    // Chip is STILL chained after the arc commit.
    await expectChipStillChained(page);

    // ---------- Arc #2 ----------
    // A second arc started in a different region of the canvas. The
    // start click is unconstrained; the middle and end clicks are
    // each locked to EXPECTED_PX from the prior point.
    const secondArcCommit = captureNextCommit(page);
    await clickOnCanvas(page, canvas, { x: 800, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1100, y: 100 });
    await expectChipStillChained(page);
    await clickOnCanvas(page, canvas, { x: 1100, y: 350 });
    const secondBody = await secondArcCommit;

    expect(secondBody.sheetId).toBe(sheetIds[0]);
    expect(secondBody.type).toBe("LINEAR");
    expect(secondBody.points!.length).toBe(3);
    {
      const startToMid = segmentPx(
        secondBody.points![0],
        secondBody.points![1],
      );
      const midToEnd = segmentPx(secondBody.points![1], secondBody.points![2]);
      expect(startToMid).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(startToMid).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
      expect(midToEnd).toBeGreaterThan(EXPECTED_PX - PX_TOLERANCE);
      expect(midToEnd).toBeLessThan(EXPECTED_PX + PX_TOLERANCE);
    }

    // And the chip is STILL chained after BOTH arc commits.
    await expectChipStillChained(page);
  });
});
